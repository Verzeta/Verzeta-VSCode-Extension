// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import { DisposableStore, type Disposable, asDisposable } from '../infra/disposables.js';
import type { Logger } from '../log/Logger.js';
import { ClientRpcHandler } from '../wire/ClientRpcHandler.js';
import { TopLevelStructureWatcher } from './TopLevelStructureWatcher.js';
import {
    registerVfsHandlers,
    type ConfirmationAskParams,
    type ConfirmationProvider,
    type ConfirmationVerdict,
    type DirEntry,
    type FsStat,
    type MountLookup,
    type WorkspaceFsAdapter,
} from './VfsHandlers.js';
import { ExecPolicy } from './ExecPolicy.js';
import { matchGlob } from './PathResolver.js';
import {
    DEFAULT_IGNORE_GLOBS,
    DEFAULT_MAX_HINT_FILES,
    type StatFn,
} from './WorkspaceTreeBuilder.js';
import { decide, evaluateRules, type SmartModeConfig } from './SmartModeFilter.js';
import {
    WorkspaceMountService,
    type MountIdProvider,
    type MountPersistence,
    type MountRepository,
    type PersistedMountBinding,
    type TreeInputBundle,
} from './WorkspaceMountService.js';
import { WorkspaceMountStatusBar } from './WorkspaceMountStatusBar.js';
import type { WorkspaceMountInfoUi } from '../../shared/wire-types.js';

export { WorkspaceMountService } from './WorkspaceMountService.js';
export type { MountRepository, TreeInputBundle } from './WorkspaceMountService.js';

/**
 * Default exclude glob the production findFiles call uses. Kept in
 * sync with WorkspaceTreeBuilder's DEFAULT_IGNORE_GLOBS so we hand
 * findFiles the same list both as exclude (skip enumeration) and as
 * post-filter (defence in depth).
 */
function findFilesExcludeGlob(extra: readonly string[] = []): string {
    return `{${[...DEFAULT_IGNORE_GLOBS, ...extra].join(',')}}`;
}

/**
 * The user's extra path filters from `verzeta.workspaceMount.blocklist`
 * and `verzeta.workspaceMount.allowlist`, read fresh on every call so
 * a settings change applies without re-registering. Non-string and
 * empty entries are ignored.
 */
function readPathFilters(): { readonly blocklist: string[]; readonly allowlist: string[] } {
    const cfg = vscode.workspace.getConfiguration('verzeta.workspaceMount');
    const clean = (v: unknown): string[] =>
        Array.isArray(v)
            ? v.filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
            : [];
    return {
        blocklist: clean(cfg.get<unknown>('blocklist', [])),
        allowlist: clean(cfg.get<unknown>('allowlist', [])),
    };
}

const MOUNT_ID_STATE_PREFIX = 'verzeta.workspaceMount.mountId.';

/**
 * Production mountId persistence backed by ExtensionContext.workspaceState.
 * The same workspace registers with the same mountId across VS Code
 * restarts so the host treats reconnect as refresh-in-place rather
 * than mount-replace.
 */
function makeWorkspaceStateMountIds(context: vscode.ExtensionContext): MountIdProvider {
    return {
        getOrCreateMountId: (folderId): string => {
            const key = MOUNT_ID_STATE_PREFIX + folderId;
            const existing = context.workspaceState.get<string>(key);
            if (existing !== undefined && existing.length > 0) return existing;
            // Use crypto.randomUUID for the new id — uniform with the
            // wire layer's request_id generation.
            const fresh = crypto.randomUUID();
            void context.workspaceState.update(key, fresh);
            return fresh;
        },
        clearMountId: (folderId): void => {
            const key = MOUNT_ID_STATE_PREFIX + folderId;
            void context.workspaceState.update(key, undefined);
        },
    };
}

/**
 * Resolve which workspace folder a mount should read from. With a
 * preferredRoot (recorded in the mount's binding at register time)
 * the matching open root wins; a preferredRoot that is no longer
 * open resolves to undefined so callers fail closed instead of
 * silently reading a different project. Without a preference the
 * first root keeps the pre-multi-root behaviour.
 */
function resolveWorkspaceFolder(preferredRoot?: string): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) return undefined;
    if (preferredRoot === undefined) return folders[0];
    return folders.find((f) => toPosix(f.uri.fsPath) === toPosix(preferredRoot));
}

async function gatherTreeInput(
    logger: Logger,
    preferredRoot?: string,
): Promise<TreeInputBundle | undefined> {
    const primary = resolveWorkspaceFolder(preferredRoot);
    if (primary === undefined) {
        logger.warn('workspace-mount: no matching workspace folder open', {
            preferredRoot: preferredRoot ?? '(first)',
        });
        return undefined;
    }
    const root = primary.uri.fsPath;
    const { blocklist, allowlist } = readPathFilters();
    // Blocked paths are excluded from the scan itself, so they do not use
    // up the file cap; with an allowlist only matching paths are scanned.
    const include = new vscode.RelativePattern(
        primary,
        allowlist.length > 0 ? `{${allowlist.join(',')}}` : '**/*',
    );
    const exclude = findFilesExcludeGlob(blocklist);
    const uris = await vscode.workspace.findFiles(include, exclude, 1500);
    const rootPosix = toPosix(root);
    const candidates = uris
        .map((uri) => toPosix(uri.fsPath))
        .filter((abs) => {
            if (allowlist.length === 0) return true;
            const rel = abs.startsWith(rootPosix + '/') ? abs.slice(rootPosix.length + 1) : abs;
            return allowlist.some((glob) => matchGlob(rel, glob));
        });
    const statFn = makeStatFn(primary, logger);
    return {
        workspaceRoot: rootPosix,
        candidates,
        statFn,
        additionalIgnores: blocklist,
    };
}

function toPosix(fsPath: string): string {
    return fsPath.split(path.sep).join('/');
}

function makeStatFn(folder: vscode.WorkspaceFolder, logger: Logger): StatFn {
    // The map is populated lazily by the caller before buildWorkspaceTree
    // runs. We attach the populate step to gatherTreeInput so the
    // sync StatFn signature is honoured.
    const cache = new Map<string, { size: number; mtimeMs: number }>();
    const fn: StatFn = (relPath) => cache.get(relPath);
    // Expose the populate hook via a property — the gatherTreeInput
    // wrapper drives it for every candidate.
    (
        fn as StatFn & {
            populate(relPath: string, stat: { size: number; mtimeMs: number }): void;
        }
    ).populate = (relPath, stat) => {
        cache.set(relPath, stat);
    };
    void folder;
    void logger;
    return fn;
}

/**
 * Production wrapper that pre-stats every candidate and returns the
 * resulting bundle. Splits in two so gatherTreeInput (above) stays
 * a pure URI walk and the stat round-trip is observable here.
 */
async function gatherTreeInputWithStats(
    logger: Logger,
    preferredRoot?: string,
): Promise<TreeInputBundle | undefined> {
    const base = await gatherTreeInput(logger, preferredRoot);
    if (base === undefined) return undefined;
    const statFn = base.statFn as StatFn & {
        populate(relPath: string, stat: { size: number; mtimeMs: number }): void;
    };
    const folder = resolveWorkspaceFolder(preferredRoot);
    if (folder === undefined) return undefined;
    const rootFs = folder.uri.fsPath;
    // Stat each candidate. Failures are silently skipped — the
    // tree builder records droppedMissing for them.
    for (const candidate of base.candidates) {
        const native = candidate.split('/').join(path.sep);
        const absoluteFs = path.isAbsolute(native) ? native : path.join(rootFs, native);
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absoluteFs));
            // The candidate path is already workspace-relative POSIX
            // because gatherTreeInput converted before pushing.
            const rel = relativise(toPosix(rootFs), candidate);
            if (rel === undefined) continue;
            statFn.populate(rel, { size: stat.size, mtimeMs: stat.mtime });
        } catch {
            // File vanished between findFiles and stat — leave the
            // cache empty so the builder's droppedMissing counter
            // increments.
        }
    }
    return base;
}

function relativise(root: string, candidate: string): string | undefined {
    if (candidate === root) return '';
    const prefix = root + '/';
    if (!candidate.startsWith(prefix)) return undefined;
    return candidate.slice(prefix.length);
}

/**
 * Wires the file-system watcher against the primary workspace
 * folder. Returns a Disposable so the caller (subscriptions
 * composition) can tear it down on extension deactivate.
 */
function bindFileSystemWatcher(coalescer: TopLevelStructureWatcher, logger: Logger): Disposable {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
        logger.warn('workspace-mount: cannot bind watcher — no folder');
        return asDisposable(() => {});
    }
    // Pattern `*` against the workspace folder matches depth-1
    // entries (children directly under the workspace root). VS
    // Code's createFileSystemWatcher signature accepts an absolute
    // RelativePattern or a glob string; we use RelativePattern for
    // precision.
    const pattern = new vscode.RelativePattern(folder, '*');
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const store = new DisposableStore();
    store.add({
        dispose: () => {
            watcher.dispose();
        },
    });
    store.add(
        watcher.onDidCreate(() => {
            coalescer.notify('created');
        }),
    );
    store.add(
        watcher.onDidDelete(() => {
            coalescer.notify('deleted');
        }),
    );
    return store;
}

export interface WorkspaceMountSubsystemDeps {
    readonly context: vscode.ExtensionContext;
    readonly connectionManager: ConnectionManager;
    readonly logger: Logger;
    readonly onExecBlocked?: ((conversationId: string, commandPreview: string) => void) | undefined;
    readonly confirmExec?:
        | ((conversationId: string, command: string, sandboxed: boolean) => Promise<boolean>)
        | undefined;
    readonly onUnsandboxed?: (() => void) | undefined;
}

export interface WorkspaceMountSubsystem extends Disposable {
    readonly service: WorkspaceMountService;
    readonly clientRpc: ClientRpcHandler;
    readonly execPolicy: ExecPolicy;
}

export function registerWorkspaceMountSubsystem(
    deps: WorkspaceMountSubsystemDeps,
): WorkspaceMountSubsystem {
    const { context, connectionManager, logger } = deps;

    const clientRpc = new ClientRpcHandler({ logger });
    const mountIds = makeWorkspaceStateMountIds(context);

    const repository = makeRepositoryAdapter(connectionManager);
    // Mount bindings persist in workspaceState (per-workspace by
    // construction) so a registered mount survives VS Code restarts —
    // sessionReady restores it without the user re-running the
    // register command. Cleared whenever the last mount unregisters.
    const BINDINGS_KEY = 'verzeta.workspaceMount.bindings.v1';
    const VALID_TIERS = new Set(['ask', 'smart', 'bypass']);
    const persistence: MountPersistence = {
        load: () =>
            (context.workspaceState.get<PersistedMountBinding[]>(BINDINGS_KEY) ?? []).filter(
                (b) =>
                    typeof b.folderId === 'string' &&
                    b.folderId.length > 0 &&
                    typeof b.ownerLabel === 'string' &&
                    typeof b.workspaceRoot === 'string' &&
                    b.workspaceRoot.length > 0 &&
                    VALID_TIERS.has(b.permissionTier),
            ),
        save: (bindings) => {
            void context.workspaceState.update(BINDINGS_KEY, [...bindings]);
        },
    };

    const service = new WorkspaceMountService({
        logger,
        repository,
        mountIds,
        treeInput: (_folderId, preferredRoot) => gatherTreeInputWithStats(logger, preferredRoot),
        persistence,
    });

    const coalescer = new TopLevelStructureWatcher({
        logger,
        windowMs: 30_000,
        onCoalescedChange: async () => {
            for (const mount of service.getActiveMounts()) {
                try {
                    await service.refreshTree(mount.folderId);
                } catch (error) {
                    logger.warn('workspace-mount: refresh failed', {
                        folderId: mount.folderId,
                        error: errorMessage(error),
                    });
                }
            }
        },
    });

    const watcherDisposable = bindFileSystemWatcher(coalescer, logger);

    const execPolicy = new ExecPolicy(context.workspaceState);
    const vfsHandlers = registerVfsHandlers({
        logger,
        clientRpc,
        fs: makeVscodeFsAdapter(),
        confirmation: makeVscodeConfirmationProvider(logger),
        mounts: makeMountLookup(service),
        execPolicy,
        onExecBlocked: deps.onExecBlocked,
        confirmExec: deps.confirmExec,
        onUnsandboxed: deps.onUnsandboxed,
    });

    const statusBar = new WorkspaceMountStatusBar({ logger, service });

    const sessionReadyHandler = (hostId: string): void => {
        const session = connectionManager.sessionFor(hostId);
        if (session === undefined) {
            logger.warn('workspace-mount: sessionReady but no session for host', { hostId });
            return;
        }
        session.setRequestDispatcher(clientRpc.dispatch);
        logger.info('workspace-mount: client-rpc dispatcher installed', { hostId });
        void (async () => {
            // Restart path first: persisted bindings with no live
            // registry entry (fresh VS Code window) register from
            // scratch. Then refresh whatever was already live before
            // this (re)connect — skipping the just-restored ones so
            // they don't double-send their manifest.
            const restored = await service.restorePersistedMounts();
            const refreshed = await service.reRegisterActiveMounts(new Set(restored));
            if (restored.length > 0 || refreshed > 0) {
                logger.info('workspace-mount: mounts synced after (re)connect', {
                    hostId,
                    restored: restored.length,
                    refreshed,
                });
            }
        })();
    };
    connectionManager.on('sessionReady', sessionReadyHandler);

    const foldersChanged = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (service.getActiveMounts().length === 0) return;
        void service.unregisterAllMounts().then(() => {
            void vscode.window.showWarningMessage(
                'Verzeta: the workspace folders changed, so the workspace mount was released. ' +
                    'Re-register from the status bar to share the new workspace.',
            );
        });
    });

    const onMountAdded = (snap: WorkspaceMountInfoUi): void => {
        if (snap.fileCount >= DEFAULT_MAX_HINT_FILES) {
            void vscode.window.showWarningMessage(
                `Verzeta: the workspace manifest hit the ${DEFAULT_MAX_HINT_FILES}-file cap, so ` +
                    'agents see a partial file list. Narrow it with the ' +
                    'verzeta.workspaceMount.allowlist or verzeta.workspaceMount.blocklist setting.',
            );
        }
    };
    service.on('mountAdded', onMountAdded);

    const dispose = (): void => {
        service.off('mountAdded', onMountAdded);
        foldersChanged.dispose();
        connectionManager.off('sessionReady', sessionReadyHandler);
        statusBar.dispose();
        vfsHandlers.dispose();
        watcherDisposable.dispose();
        coalescer.dispose();
        service.dispose();
    };

    return {
        service,
        clientRpc,
        execPolicy,
        dispose,
    };
}

/**
 * Production WorkspaceFsAdapter backed by vscode.workspace.fs.
 * URIs are constructed with vscode.Uri.file so the platform-
 * native path separator is honoured. canonicalise resolves
 * symlinks via vscode.workspace.fs.stat against a freshly-
 * constructed URI.
 */
function makeVscodeFsAdapter(): WorkspaceFsAdapter {
    return {
        readFile: async (absPath) => {
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        },
        writeFile: async (absPath, content) => {
            await vscode.workspace.fs.writeFile(vscode.Uri.file(absPath), content);
        },
        stat: async (absPath) => {
            const s = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
            return {
                kind: mapFileType(s.type),
                size: s.size,
                mtimeMs: s.mtime,
            };
        },
        readDirectory: async (absPath) => {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(absPath));
            const out: DirEntry[] = [];
            for (const [name, type] of entries) {
                out.push({ name, kind: mapFileType(type) });
            }
            return out;
        },
        canonicalise: async (absPath) => {
            // VS Code does not expose a direct realpath API. We
            // approximate symlink resolution by checking whether
            // the stat call reports SymbolicLink and (when it
            // does) refusing the call — the upstream symlink-
            // escape check in VfsHandlers treats that as
            // symlink_escape conservatively. For non-symlink
            // paths, the path is already canonical at the URI
            // layer.
            try {
                const s = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
                if ((s.type & vscode.FileType.SymbolicLink) !== 0) {
                    // Surface a sentinel path that's outside any
                    // workspace root so the escape check fires.
                    return '/__verzeta_symlink_rejected__';
                }
            } catch {
                // File doesn't exist — soft-fail (handler may be
                // writing a new file).
            }
            return absPath;
        },
    };
}

function mapFileType(t: vscode.FileType): FsStat['kind'] {
    if ((t & vscode.FileType.Directory) !== 0) return 'directory';
    if ((t & vscode.FileType.SymbolicLink) !== 0) return 'symlink';
    if ((t & vscode.FileType.File) !== 0) return 'file';
    return 'unknown';
}

function smartModeConfigFromSettings(): SmartModeConfig {
    const cfg = vscode.workspace.getConfiguration('verzeta.workspaceMount');
    return {
        extensionAllowlist: cfg.get<string[]>('smartMode.extensionAllowlist', []),
        blocklistGlobs: cfg.get<string[]>('blocklist', []),
        maxFileBytes: cfg.get<number>('smartMode.maxFileBytes', 262_144),
        maxDiffLines: cfg.get<number>('smartMode.maxDiffLines', 500),
        // Rule 6 reuses the tree builder's default ignore set as the
        // build-output heuristic; the workspace .gitignore itself is
        // already folded into the manifest exclusions.
        gitignoreGlobs: DEFAULT_IGNORE_GLOBS,
    };
}

function makeVscodeConfirmationProvider(logger: Logger): ConfirmationProvider {
    const decoder = new TextDecoder();
    return {
        askForWrite: async (params: ConfirmationAskParams): Promise<ConfirmationVerdict> => {
            const results = evaluateRules(
                {
                    relPath: params.relPath,
                    proposedContent: decoder.decode(params.proposedContent),
                    currentContent:
                        params.currentContent === undefined
                            ? undefined
                            : decoder.decode(params.currentContent),
                },
                smartModeConfigFromSettings(),
            );
            const decision = decide(params.tier, results);
            logger.info('vfs.write: smart-mode decision', {
                relPath: params.relPath,
                tier: params.tier,
                verdict: decision.verdict,
                detail: decision.detail,
            });
            if (decision.verdict === 'auto_reject') {
                return { kind: 'reject', reason: 'smart_blocked', detail: decision.detail };
            }
            if (decision.verdict === 'auto_apply') {
                return { kind: 'apply' };
            }
            const why = decision.detail.length > 0 ? ` (${decision.detail})` : '';
            const action = await vscode.window.showInformationMessage(
                `Verzeta wants to write ${params.relPath} (${params.proposedContent.length} bytes)${why}. Approve?`,
                { modal: true },
                'Approve',
                'Reject',
            );
            if (action === 'Approve') {
                logger.info('vfs.write: user approved', {
                    relPath: params.relPath,
                    tier: params.tier,
                });
                return { kind: 'apply' };
            }
            logger.info('vfs.write: user rejected', {
                relPath: params.relPath,
                tier: params.tier,
            });
            return {
                kind: 'reject',
                reason: 'user_rejected',
                detail: 'user clicked Reject',
            };
        },
    };
}

/**
 * Bridges WorkspaceMountService's snapshot API into VfsHandlers'
 * MountLookup contract. The workspaceRoot returned matches the
 * one recorded at register time so all four handlers resolve
 * against the same absolute root.
 */
function makeMountLookup(service: WorkspaceMountService): MountLookup {
    return {
        getMountForFolder: (folderId): WorkspaceMountInfoUi | undefined =>
            service.getMountForFolder(folderId),
        getWorkspaceRoot: (folderId): string | undefined => {
            const m = service.getMountForFolder(folderId);
            return m?.workspaceRoot;
        },
        getPathFilters: () => readPathFilters(),
    };
}

function makeRepositoryAdapter(connectionManager: ConnectionManager): MountRepository {
    const requireRepo = (): NonNullable<ReturnType<ConnectionManager['repositoryFor']>> => {
        const hostId = connectionManager.activeHostId();
        if (hostId === undefined) {
            throw new Error('No active host. Connect to a host, then try again.');
        }
        const repo = connectionManager.repositoryFor(hostId);
        if (repo === undefined) {
            throw new Error(`No repository available for host '${hostId}'`);
        }
        return repo;
    };
    return {
        registerWorkspaceMount: (params) => requireRepo().registerWorkspaceMount(params),
        unregisterWorkspaceMount: (folderId) => requireRepo().unregisterWorkspaceMount(folderId),
        updateWorkspaceMountTree: (folderId, treeJson) =>
            requireRepo().updateWorkspaceMountTree(folderId, treeJson),
        updateWorkspaceMountTier: (folderId, tier) =>
            requireRepo().updateWorkspaceMountTier(folderId, tier),
    };
}

function errorMessage(value: unknown): string {
    if (value instanceof Error) return value.message;
    return String(value);
}
