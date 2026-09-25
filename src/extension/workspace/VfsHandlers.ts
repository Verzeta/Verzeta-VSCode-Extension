// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { PermissionTier, WorkspaceMountInfoUi } from '../../shared/wire-types.js';
import { asDisposable, type Disposable } from '../infra/disposables.js';
import type { Logger } from '../log/Logger.js';
import type { ClientRpcHandler, ClientRpcHandlerFn, RpcResult } from '../wire/ClientRpcHandler.js';
import { executeCommand, resolveSandboxKind } from './CommandExecutor.js';
import { evaluateCommandSafety } from './SmartModeFilter.js';
import type { ExecPolicy } from './ExecPolicy.js';
import { fingerprintOf, isValidFingerprintShape } from './Fingerprint.js';
import {
    resolveRequestPath,
    type MountSnapshot,
    type ResolveRejectionKind,
} from './PathResolver.js';

export const MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MiB
export const MAX_WRITE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_LIST_ENTRIES = 5000;

// === substrate interfaces ===

/**
 * Async substrate over the file-system APIs the production
 * wiring backs with vscode.workspace.fs. Each method may throw on
 * I/O failure; the handler catches and reports `io_error`.
 */
export interface WorkspaceFsAdapter {
    readFile(absPath: string): Promise<Uint8Array>;
    writeFile(absPath: string, content: Uint8Array): Promise<void>;
    stat(absPath: string): Promise<FsStat>;
    readDirectory(absPath: string): Promise<readonly DirEntry[]>;
    /**
     * Returns the canonical absolute path (symlinks resolved).
     * Used by the symlink-escape check: if `canonicalise(absPath)`
     * leaves the workspace root, reject with `symlink_escape`.
     */
    canonicalise(absPath: string): Promise<string>;
}

export interface FsStat {
    readonly kind: 'file' | 'directory' | 'symlink' | 'unknown';
    readonly size: number;
    readonly mtimeMs: number;
}

export interface DirEntry {
    readonly name: string;
    readonly kind: 'file' | 'directory' | 'symlink' | 'unknown';
}

export interface ConfirmationProvider {
    askForWrite(params: ConfirmationAskParams): Promise<ConfirmationVerdict>;
}

export interface ConfirmationAskParams {
    readonly folderId: string;
    readonly mountId: string;
    readonly tier: PermissionTier;
    readonly relPath: string;
    readonly currentContent: Uint8Array | undefined;
    readonly proposedContent: Uint8Array;
}

export type ConfirmationVerdict =
    | { readonly kind: 'apply' }
    | {
          readonly kind: 'reject';
          readonly reason: 'user_rejected' | 'smart_blocked';
          readonly detail: string;
      };

export interface MountLookup {
    getMountForFolder(folderId: string): WorkspaceMountInfoUi | undefined;
    /**
     * Returns the absolute filesystem path the mount maps to in
     * the current VS Code window. Production: the workspaceRoot
     * captured at register time. Tests: any string.
     */
    getWorkspaceRoot(folderId: string): string | undefined;
    /**
     * The user's extra path globs: `blocklist` paths are refused and,
     * when `allowlist` is non-empty, only matching paths are allowed.
     * Optional so test doubles can omit it (no extra filtering).
     */
    getPathFilters?(): {
        readonly blocklist: readonly string[];
        readonly allowlist: readonly string[];
    };
}

export interface VfsHandlersOptions {
    readonly logger: Logger;
    readonly clientRpc: ClientRpcHandler;
    readonly fs: WorkspaceFsAdapter;
    readonly confirmation: ConfirmationProvider;
    readonly mounts: MountLookup;
    readonly execPolicy: ExecPolicy;
    /**
     * Fired when a command is refused because the conversation's mode is
     * Off — drives the in-chat consent banner. Must never throw.
     */
    readonly onExecBlocked?: ((conversationId: string, commandPreview: string) => void) | undefined;
    /**
     * Ask-mode confirmation rendered in the chat area (resolves true to
     * run, false to reject). When absent, the native confirm dialog is
     * used instead.
     */
    readonly confirmExec?:
        | ((conversationId: string, command: string, sandboxed: boolean) => Promise<boolean>)
        | undefined;
    /**
     * Notify the user (once per session) that a command ran without a
     * sandbox, surfaced inside the extension. When absent, the native
     * warning notification is used instead.
     */
    readonly onUnsandboxed?: (() => void) | undefined;
}

// === inbound arg shapes ===

interface ReadArgs {
    readonly folderId: string;
    readonly mountId: string;
    readonly relPath: string;
    readonly maxBytes: number;
}

interface WriteArgs {
    readonly folderId: string;
    readonly mountId: string;
    readonly relPath: string;
    readonly content: Uint8Array;
    readonly expectedFingerprint: string | undefined;
}

interface StatArgs {
    readonly folderId: string;
    readonly mountId: string;
    readonly relPath: string;
}

interface ListArgs {
    readonly folderId: string;
    readonly mountId: string;
    readonly relPath: string;
    readonly recursive: boolean;
}

// === public entry point ===

/**
 * Registers the four vfs.* handlers on `clientRpc` and returns a
 * Disposable that unregisters them all. The caller pushes the
 * returned Disposable onto the extension's subscription chain so
 * VS Code's deactivate path tears the registrations down before
 * the wire substrate is torn down.
 */
export function registerVfsHandlers(options: VfsHandlersOptions): Disposable {
    const {
        logger,
        clientRpc,
        fs,
        confirmation,
        mounts,
        execPolicy,
        onExecBlocked,
        confirmExec,
        onUnsandboxed,
    } = options;

    const readHandler: ClientRpcHandlerFn = (args) => runRead(args, { logger, fs, mounts });
    const writeHandler: ClientRpcHandlerFn = (args) =>
        runWrite(args, { logger, fs, mounts, confirmation });
    const statHandler: ClientRpcHandlerFn = (args) => runStat(args, { logger, fs, mounts });
    const listHandler: ClientRpcHandlerFn = (args) => runList(args, { logger, fs, mounts });
    const executeHandler: ClientRpcHandlerFn = (args) =>
        runExecute(args, { logger, mounts, execPolicy, onExecBlocked, confirmExec, onUnsandboxed });

    const registrations: Disposable[] = [
        clientRpc.registerHandler('vfs.read', readHandler),
        clientRpc.registerHandler('vfs.write', writeHandler),
        clientRpc.registerHandler('vfs.stat', statHandler),
        clientRpc.registerHandler('vfs.list', listHandler),
        clientRpc.registerHandler('vfs.execute', executeHandler),
    ];

    return asDisposable(() => {
        for (const reg of registrations) {
            try {
                reg.dispose();
            } catch {
                // best-effort
            }
        }
    });
}

interface ExecuteDeps {
    readonly logger: Logger;
    readonly mounts: MountLookup;
    readonly execPolicy: ExecPolicy;
    /**
     * Fired when a command is refused because the conversation's mode is
     * Off, so the composition root can surface an in-chat banner
     * offering to enable execution. Must never throw.
     */
    readonly onExecBlocked?: ((conversationId: string, commandPreview: string) => void) | undefined;
    /** In-chat Ask confirmation; see VfsHandlersOptions.confirmExec. */
    readonly confirmExec?:
        | ((conversationId: string, command: string, sandboxed: boolean) => Promise<boolean>)
        | undefined;
    /** Notify (once) that a command ran un-sandboxed; see options. */
    readonly onUnsandboxed?: (() => void) | undefined;
}

/**
 * Translate the host's virtual mount namespace into the real workspace
 * path on this device. `list_files` presents a mounted workspace to the
 * agent under `/mount/<short-client-id>/<rel>`, so an agent command may
 * reference that path — which does not exist on the executing machine.
 * Every `/mount/<hex-id>/…` (and bare `/mount/<hex-id>`) is rewritten to
 * the absolute workspace root, so the command resolves the real files.
 * Other text is untouched.
 *
 * @param command       The raw command line from the agent.
 * @param workspaceRoot Absolute path this mount maps to on this device.
 * @returns The command with mount-namespace paths rewritten.
 */
export function rewriteMountPaths(command: string, workspaceRoot: string): string {
    const root = workspaceRoot.replace(/\/+$/, '');
    return command.replace(/\/mount\/[0-9a-fA-F]{6,}(\/?)/g, (_match, slash: string) =>
        slash === '/' ? `${root}/` : root,
    );
}

async function runExecute(
    rawArgs: Readonly<Record<string, unknown>>,
    deps: ExecuteDeps,
): Promise<RpcResult> {
    const folderId = requireString(rawArgs['folder_id'], 'folder_id');
    if (folderId.ok === false) return folderId.result;
    const command = requireString(rawArgs['command'], 'command');
    if (command.ok === false) return command.result;

    // Conversation id is carried by the host so the policy can be
    // per-conversation. Older hosts may omit it; an empty id resolves to
    // the default (Off), so the command runs on the host instead.
    const conversationIdRaw = rawArgs['conversation_id'];
    const conversationId = typeof conversationIdRaw === 'string' ? conversationIdRaw : '';

    const workspaceRoot = deps.mounts.getWorkspaceRoot(folderId.value);
    if (workspaceRoot === undefined) {
        return rpcErr('mount_not_found', 'no workspace mount registered');
    }

    // Translate the host's virtual mount namespace (/mount/<short>/…,
    // how list_files presents this workspace to the agent) into the real
    // path on THIS device. Without it, a command like
    // `grep -r foo /mount/52a7223b/` references a path that does not
    // exist here and silently finds nothing.
    const cmd = rewriteMountPaths(command.value, workspaceRoot);
    const timeoutMsRaw = rawArgs['timeout_ms'];
    const timeoutMs =
        typeof timeoutMsRaw === 'number' && timeoutMsRaw > 0 ? Math.floor(timeoutMsRaw) : 120_000;
    const maxOutRaw = rawArgs['max_output_bytes'];
    const maxOutputBytes =
        typeof maxOutRaw === 'number' && maxOutRaw > 0 ? Math.floor(maxOutRaw) : 1024 * 1024;

    // Per-conversation policy gate. Off → refuse this turn so the host
    // runs the command instead; the user enables Ask/Allow from the
    // conversation's settings.
    const mode = deps.execPolicy.getMode(conversationId);
    if (mode === 'off') {
        if (conversationId.length > 0) {
            const preview = cmd.length > 80 ? `${cmd.slice(0, 79)}…` : cmd;
            deps.onExecBlocked?.(conversationId, preview);
        }
        return rpcErr(
            'exec_disabled',
            'command execution is disabled for this conversation — ' +
                'enable it in the conversation settings',
        );
    }

    // SmartFilter — always, even in Allow, even sandboxed.
    const safety = evaluateCommandSafety(cmd);
    if (safety.blocked) {
        deps.logger.warn('vfs.execute: blocked by smart filter', { rule: safety.rule });
        return rpcErr('blocked_by_smart_filter', safety.rule ?? 'suspicious command');
    }

    const sandboxed = resolveSandboxKind() !== 'none';

    if (mode === 'ask') {
        // Prefer the in-chat webview confirmation; fall back to the
        // native dialog (e.g. in tests with no webview wired).
        const approved = deps.confirmExec
            ? await deps.confirmExec(conversationId, cmd, sandboxed)
            : await deps.execPolicy.confirmCommand(cmd, sandboxed);
        if (!approved) {
            return rpcErr('user_rejected', 'the user declined to run the command');
        }
    }

    if (!sandboxed) {
        // Prefer an in-extension notice; fall back to the native warning
        // (e.g. in tests with no webview wired).
        if (deps.onUnsandboxed) deps.onUnsandboxed();
        else deps.execPolicy.noticeRanUnsandboxed();
    }

    try {
        const result = await executeCommand({
            workspaceRoot,
            command: cmd,
            timeoutMs,
            maxOutputBytes,
        });
        deps.logger.info('vfs.execute: ran', {
            sandboxed: result.sandboxed,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
        });
        return {
            ok: true,
            data: {
                stdout: result.stdout,
                stderr: result.stderr,
                exit_code: result.exitCode,
                sandboxed: result.sandboxed,
                timed_out: result.timedOut,
                truncated: result.truncated,
            },
        };
    } catch (error) {
        deps.logger.warn('vfs.execute: run failed', { error: errorMessage(error) });
        return rpcErr('exec_failed', errorMessage(error));
    }
}

// === handler bodies ===

interface ReadDeps {
    readonly logger: Logger;
    readonly fs: WorkspaceFsAdapter;
    readonly mounts: MountLookup;
}

async function runRead(
    rawArgs: Readonly<Record<string, unknown>>,
    deps: ReadDeps,
): Promise<RpcResult> {
    const parsed = parseReadArgs(rawArgs);
    if (parsed.ok === false) return parsed.result;

    const args = parsed.value;
    const resolved = resolvePath(args.folderId, args.mountId, args.relPath, deps.mounts);
    if (resolved.ok === false) return resolved.result;

    const guard = await runSymlinkEscapeCheck(
        deps.fs,
        resolved.workspaceRoot,
        resolved.relPath,
        deps.logger,
    );
    if (guard.ok === false) return guard.result;

    let bytes: Uint8Array;
    try {
        bytes = await deps.fs.readFile(guard.absPath);
    } catch (error) {
        deps.logger.warn('vfs.read: io error', {
            relPath: resolved.relPath,
            error: errorMessage(error),
        });
        return rpcErr('io_error', errorMessage(error));
    }

    const cap = Math.min(args.maxBytes, MAX_READ_BYTES);
    const truncated = bytes.length > cap;
    const slice = truncated ? bytes.slice(0, cap) : bytes;
    const fingerprint = fingerprintOf(bytes);

    return {
        ok: true,
        data: {
            content: encodeBase64(slice),
            fingerprint,
            truncated,
        },
    };
}

interface WriteDeps {
    readonly logger: Logger;
    readonly fs: WorkspaceFsAdapter;
    readonly mounts: MountLookup;
    readonly confirmation: ConfirmationProvider;
}

async function runWrite(
    rawArgs: Readonly<Record<string, unknown>>,
    deps: WriteDeps,
): Promise<RpcResult> {
    const parsed = parseWriteArgs(rawArgs);
    if (parsed.ok === false) return parsed.result;

    const args = parsed.value;
    if (args.content.length > MAX_WRITE_BYTES) {
        return rpcErr(
            'payload_too_large',
            `write payload ${args.content.length} bytes exceeds cap ${MAX_WRITE_BYTES}`,
        );
    }

    const resolved = resolvePath(args.folderId, args.mountId, args.relPath, deps.mounts);
    if (resolved.ok === false) return resolved.result;

    const guard = await runSymlinkEscapeCheck(
        deps.fs,
        resolved.workspaceRoot,
        resolved.relPath,
        deps.logger,
    );
    if (guard.ok === false) return guard.result;

    // Stale-fingerprint check: read the current bytes, compute
    // their fingerprint, compare against the agent's
    // expected_fingerprint. The agent gets a chance to re-read
    // and retry. If the file does not exist yet AND
    // expected_fingerprint is also undefined, this is a
    // create-new-file write — allowed.
    let currentContent: Uint8Array | undefined;
    try {
        currentContent = await deps.fs.readFile(guard.absPath);
    } catch {
        currentContent = undefined;
    }
    if (args.expectedFingerprint !== undefined) {
        if (currentContent === undefined) {
            return rpcErr(
                'stale_fingerprint',
                'file does not exist but write carries an expected fingerprint',
            );
        }
        if (fingerprintOf(currentContent) !== args.expectedFingerprint) {
            return rpcErr(
                'stale_fingerprint',
                'file was modified out of band since the agent read it',
            );
        }
    }

    const mount = deps.mounts.getMountForFolder(args.folderId);
    if (mount === undefined) {
        return rpcErr('mount_not_found', 'no workspace mount registered');
    }
    const verdict = await runConfirmation(
        deps.confirmation,
        mount,
        args,
        currentContent,
        resolved.relPath,
    );
    if (verdict.kind === 'reject') {
        return rpcErr(verdict.reason, verdict.detail);
    }

    try {
        await deps.fs.writeFile(guard.absPath, args.content);
    } catch (error) {
        deps.logger.warn('vfs.write: io error', {
            relPath: resolved.relPath,
            error: errorMessage(error),
        });
        return rpcErr('write_failed', errorMessage(error));
    }

    return {
        ok: true,
        data: {
            applied_bytes: args.content.length,
            new_fingerprint: fingerprintOf(args.content),
        },
    };
}

async function runStat(
    rawArgs: Readonly<Record<string, unknown>>,
    deps: ReadDeps,
): Promise<RpcResult> {
    const parsed = parseStatArgs(rawArgs);
    if (parsed.ok === false) return parsed.result;

    const args = parsed.value;
    const resolved = resolvePath(args.folderId, args.mountId, args.relPath, deps.mounts);
    if (resolved.ok === false) return resolved.result;

    const guard = await runSymlinkEscapeCheck(
        deps.fs,
        resolved.workspaceRoot,
        resolved.relPath,
        deps.logger,
    );
    if (guard.ok === false) return guard.result;

    try {
        const stat = await deps.fs.stat(guard.absPath);
        return {
            ok: true,
            data: {
                exists: true,
                kind: stat.kind,
                size: stat.size,
                mtime_ms: stat.mtimeMs,
            },
        };
    } catch {
        // The host treats stat-failures as exists=false rather
        // than io_error so the agent can use stat as a
        // "does this exist" probe without a special error path.
        return {
            ok: true,
            data: {
                exists: false,
                kind: 'unknown',
                size: 0,
                mtime_ms: 0,
            },
        };
    }
}

async function runList(
    rawArgs: Readonly<Record<string, unknown>>,
    deps: ReadDeps,
): Promise<RpcResult> {
    const parsed = parseListArgs(rawArgs);
    if (parsed.ok === false) return parsed.result;

    const args = parsed.value;
    const resolved = resolvePath(args.folderId, args.mountId, args.relPath, deps.mounts);
    if (resolved.ok === false) return resolved.result;

    const guard = await runSymlinkEscapeCheck(
        deps.fs,
        resolved.workspaceRoot,
        resolved.relPath,
        deps.logger,
    );
    if (guard.ok === false) return guard.result;

    const entries: { path: string; kind: string; size: number; mtime_ms: number }[] = [];
    let truncated = false;

    const queue: { absPath: string; relPath: string }[] = [
        { absPath: guard.absPath, relPath: resolved.relPath },
    ];

    while (queue.length > 0) {
        if (entries.length >= MAX_LIST_ENTRIES) {
            truncated = true;
            break;
        }
        const head = queue.shift();
        if (head === undefined) break;
        let kids: readonly DirEntry[];
        try {
            kids = await deps.fs.readDirectory(head.absPath);
        } catch (error) {
            // A read failure on a subdirectory is fatal only when
            // it's the root the agent asked for; we surface it
            // as io_error. For descendant directories we skip and
            // continue (the agent gets a partial list, with
            // truncated:false).
            if (head.absPath === guard.absPath) {
                return rpcErr('io_error', errorMessage(error));
            }
            continue;
        }
        for (const child of kids) {
            if (entries.length >= MAX_LIST_ENTRIES) {
                truncated = true;
                break;
            }
            const childRel =
                head.relPath.length === 0 ? child.name : `${head.relPath}/${child.name}`;
            const childAbs = `${head.absPath}/${child.name}`;
            let stat: FsStat | undefined;
            try {
                stat = await deps.fs.stat(childAbs);
            } catch {
                stat = undefined;
            }
            entries.push({
                path: childRel,
                kind: child.kind,
                size: stat?.size ?? 0,
                mtime_ms: stat?.mtimeMs ?? 0,
            });
            if (args.recursive && child.kind === 'directory') {
                queue.push({ absPath: childAbs, relPath: childRel });
            }
        }
    }

    return {
        ok: true,
        data: { entries, truncated },
    };
}

// === helpers ===

interface ResolvedPath {
    readonly workspaceRoot: string;
    readonly relPath: string;
}

interface ResolveFailure {
    readonly ok: false;
    readonly result: RpcResult;
}

function resolvePath(
    folderId: string,
    requestMountId: string,
    requestRelPath: string,
    mounts: MountLookup,
): (ResolvedPath & { readonly ok: true }) | ResolveFailure {
    const root = mounts.getWorkspaceRoot(folderId);
    const mount = mounts.getMountForFolder(folderId);
    const snapshot: MountSnapshot | undefined =
        mount === undefined
            ? undefined
            : {
                  mountId: mount.mountId,
                  permissionTier: mount.permissionTier,
                  blocklist: mounts.getPathFilters?.().blocklist,
                  allowlist: mounts.getPathFilters?.().allowlist,
              };
    const resolved = resolveRequestPath({
        mount: snapshot,
        requestMountId,
        requestRelPath,
    });
    if (resolved.ok === false) {
        return { ok: false, result: rpcErr(resolved.kind, resolved.detail) };
    }
    if (root === undefined) {
        return {
            ok: false,
            result: rpcErr('mount_not_found', 'workspace root not bound to folder'),
        };
    }
    return { ok: true, workspaceRoot: root, relPath: resolved.relPath };
}

interface SymlinkOk {
    readonly ok: true;
    readonly absPath: string;
}

async function runSymlinkEscapeCheck(
    fs: WorkspaceFsAdapter,
    workspaceRoot: string,
    relPath: string,
    logger: Logger,
): Promise<SymlinkOk | ResolveFailure> {
    // Empty relPath denotes the workspace ROOT — avoid synthesising
    // `<workspaceRoot>/` (trailing slash) as the tentative path, which
    // some FS adapters normalise inconsistently and which would also
    // break the canonical-prefix check below (the root itself does
    // not start with `<root>/`).
    const tentative = relPath.length === 0 ? workspaceRoot : `${workspaceRoot}/${relPath}`;
    let canonical: string;
    try {
        canonical = await fs.canonicalise(tentative);
    } catch (error) {
        // Canonicalise failures (file doesn't exist yet for
        // a write, etc.) fall through to a soft-pass: we use
        // the tentative path. The handler's downstream call
        // (readFile, writeFile) surfaces the real failure.
        logger.debug('vfs: canonicalise soft-fail (file may not exist)', {
            tentative,
            error: errorMessage(error),
        });
        return { ok: true, absPath: tentative };
    }
    if (!canonical.startsWith(workspaceRoot + '/') && canonical !== workspaceRoot) {
        return {
            ok: false,
            result: rpcErr(
                'symlink_escape',
                `canonical path '${canonical}' escapes workspace root '${workspaceRoot}'`,
            ),
        };
    }
    return { ok: true, absPath: canonical };
}

async function runConfirmation(
    confirmation: ConfirmationProvider,
    mount: WorkspaceMountInfoUi,
    args: WriteArgs,
    currentContent: Uint8Array | undefined,
    relPath: string,
): Promise<ConfirmationVerdict> {
    return confirmation.askForWrite({
        folderId: args.folderId,
        mountId: args.mountId,
        tier: mount.permissionTier,
        relPath,
        currentContent,
        proposedContent: args.content,
    });
}

// === arg parsers ===

interface ArgParseOk<T> {
    readonly ok: true;
    readonly value: T;
}

interface ArgParseErr {
    readonly ok: false;
    readonly result: RpcResult;
}

type ArgParseResult<T> = ArgParseOk<T> | ArgParseErr;

function parseReadArgs(raw: Readonly<Record<string, unknown>>): ArgParseResult<ReadArgs> {
    const folderId = requireString(raw['folder_id'], 'folder_id');
    if (folderId.ok === false) return folderId;
    const mountId = requireString(raw['mount_id'], 'mount_id');
    if (mountId.ok === false) return mountId;
    const relPath = requireString(raw['rel_path'], 'rel_path');
    if (relPath.ok === false) return relPath;
    const maxBytesRaw = raw['max_bytes'];
    const maxBytes =
        typeof maxBytesRaw === 'number' && Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
            ? Math.floor(maxBytesRaw)
            : MAX_READ_BYTES;
    return {
        ok: true,
        value: {
            folderId: folderId.value,
            mountId: mountId.value,
            relPath: relPath.value,
            maxBytes,
        },
    };
}

function parseWriteArgs(raw: Readonly<Record<string, unknown>>): ArgParseResult<WriteArgs> {
    const folderId = requireString(raw['folder_id'], 'folder_id');
    if (folderId.ok === false) return folderId;
    const mountId = requireString(raw['mount_id'], 'mount_id');
    if (mountId.ok === false) return mountId;
    const relPath = requireString(raw['rel_path'], 'rel_path');
    if (relPath.ok === false) return relPath;
    const contentRaw = raw['content'];
    if (typeof contentRaw !== 'string') {
        return {
            ok: false,
            result: rpcErr('invalid_argument', 'content must be a base64 string'),
        };
    }
    const content = decodeBase64(contentRaw);
    if (content === undefined) {
        return {
            ok: false,
            result: rpcErr('invalid_argument', 'content is not valid base64'),
        };
    }
    const expectedRaw = raw['expected_fingerprint'];
    let expectedFingerprint: string | undefined;
    if (expectedRaw !== undefined && expectedRaw !== null) {
        if (!isValidFingerprintShape(expectedRaw)) {
            return {
                ok: false,
                result: rpcErr(
                    'invalid_argument',
                    'expected_fingerprint must be 64 lowercase hex characters',
                ),
            };
        }
        expectedFingerprint = expectedRaw;
    }
    return {
        ok: true,
        value: {
            folderId: folderId.value,
            mountId: mountId.value,
            relPath: relPath.value,
            content,
            expectedFingerprint,
        },
    };
}

function parseStatArgs(raw: Readonly<Record<string, unknown>>): ArgParseResult<StatArgs> {
    const folderId = requireString(raw['folder_id'], 'folder_id');
    if (folderId.ok === false) return folderId;
    const mountId = requireString(raw['mount_id'], 'mount_id');
    if (mountId.ok === false) return mountId;
    const relPath = requireString(raw['rel_path'], 'rel_path');
    if (relPath.ok === false) return relPath;
    return {
        ok: true,
        value: {
            folderId: folderId.value,
            mountId: mountId.value,
            relPath: relPath.value,
        },
    };
}

function parseListArgs(raw: Readonly<Record<string, unknown>>): ArgParseResult<ListArgs> {
    const folderId = requireString(raw['folder_id'], 'folder_id');
    if (folderId.ok === false) return folderId;
    const mountId = requireString(raw['mount_id'], 'mount_id');
    if (mountId.ok === false) return mountId;
    const relPath = requireString(raw['rel_path'], 'rel_path');
    if (relPath.ok === false) return relPath;
    const recursive = raw['recursive'] === true;
    return {
        ok: true,
        value: {
            folderId: folderId.value,
            mountId: mountId.value,
            relPath: relPath.value,
            recursive,
        },
    };
}

function requireString(value: unknown, name: string): ArgParseResult<string> {
    if (typeof value !== 'string' || value.length === 0) {
        return {
            ok: false,
            result: rpcErr('invalid_argument', `${name} must be a non-empty string`),
        };
    }
    return { ok: true, value };
}

// === encoding + error helpers ===

function rpcErr(kind: string | ResolveRejectionKind, detail: string): RpcResult {
    return { ok: false, error: { kind, detail } };
}

function errorMessage(value: unknown): string {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    return 'unknown error';
}

function encodeBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
}

function decodeBase64(text: string): Uint8Array | undefined {
    try {
        const buf = Buffer.from(text, 'base64');
        // Round-trip check: Buffer.from is permissive with invalid
        // input and silently truncates/skips. Re-encoding catches
        // garbage payloads.
        const reencoded = buf.toString('base64');
        const padded = text.padEnd(reencoded.length, '=');
        if (reencoded !== padded && reencoded !== text) {
            // Mismatch — not a valid base64 string.
            return undefined;
        }
        return new Uint8Array(buf);
    } catch {
        return undefined;
    }
}
