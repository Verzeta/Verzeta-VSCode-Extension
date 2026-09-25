// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * CommandExecutor — runs a shell command in the workspace for the
 * `vfs.execute` capability, sandboxed where the platform provides a
 * sandbox primitive and un-sandboxed (with the result flagged) where it
 * does not.
 *
 * Mirrors the host's CanvasRunner model: prefer an OS sandbox, fall
 * back to direct execution when the primitive is missing/broken.
 *   - Linux / WSL2 : `bwrap` (bubblewrap) — workspace writable, the rest
 *                    read-only-bound, isolated /tmp, dies with the parent.
 *   - macOS        : `sandbox-exec` with a profile that confines writes
 *                    to the workspace.
 *   - Windows / no primitive : un-sandboxed, `sandboxed: false`.
 *
 * Network is intentionally left ON (matching the host CanvasRunner,
 * which avoids the AppArmor/Ubuntu-24.04 `--unshare-net` breakage).
 *
 * Pure of any VS Code dependency so the sandbox-selection logic is unit-
 * testable; the caller supplies the workspace root and caps.
 */

import { spawn, spawnSync } from 'node:child_process';
import * as os from 'node:os';

export interface CommandResult {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    readonly sandboxed: boolean;
    readonly timedOut: boolean;
    readonly truncated: boolean;
}

export interface ExecuteOptions {
    readonly workspaceRoot: string;
    readonly command: string;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
}

/** Which sandbox wrapper (if any) is available on this platform. */
export type SandboxKind = 'bwrap' | 'sandbox-exec' | 'none';

let cachedKind: SandboxKind | undefined;

/** Probe (once) which sandbox primitive this platform offers. */
export function resolveSandboxKind(): SandboxKind {
    if (cachedKind !== undefined) return cachedKind;
    cachedKind = probeSandboxKind();
    return cachedKind;
}

/** Reset the cached probe — tests only. */
export function resetSandboxProbeForTests(): void {
    cachedKind = undefined;
}

function probeSandboxKind(): SandboxKind {
    const platform = os.platform();
    if (platform === 'linux') {
        // Presence is not enough — bwrap can be installed but unable to
        // create user namespaces (restricted containers, some hardened
        // kernels). Probe a trivial sandboxed `true`; only use bwrap if
        // it actually works, else fall back (mirrors the host
        // CanvasRunner's bwrap-usable check).
        return canRun('bwrap', ['--ro-bind', '/', '/', '--unshare-user', 'true'])
            ? 'bwrap'
            : 'none';
    }
    if (platform === 'darwin') {
        return canRun('sandbox-exec', ['-p', '(version 1)(allow default)', 'true'])
            ? 'sandbox-exec'
            : 'none';
    }
    // Windows and everything else: no sandbox primitive in v1.
    return 'none';
}

/** True iff `program args…` runs and exits 0 within a short budget. */
function canRun(program: string, args: readonly string[]): boolean {
    try {
        const probe = spawnSync(program, [...args], { timeout: 3000 });
        return probe.status === 0 && probe.error === undefined;
    } catch {
        return false;
    }
}

/**
 * Build the argv that runs `command` under the resolved sandbox, with
 * the shell as the interpreter. Returns the program + args for spawn.
 */
function buildArgv(
    kind: SandboxKind,
    workspaceRoot: string,
    command: string,
): { readonly program: string; readonly args: readonly string[] } {
    if (kind === 'bwrap') {
        // Read-only-bind the whole filesystem, then re-bind the
        // workspace writable; isolated /tmp + /proc; die with us. No
        // --unshare-net (network stays on, like the host CanvasRunner).
        return {
            program: 'bwrap',
            args: [
                '--ro-bind',
                '/',
                '/',
                '--bind',
                workspaceRoot,
                workspaceRoot,
                '--tmpfs',
                '/tmp',
                '--proc',
                '/proc',
                '--dev',
                '/dev',
                '--unshare-user',
                '--unshare-pid',
                '--unshare-uts',
                '--unshare-ipc',
                '--die-with-parent',
                '--chdir',
                workspaceRoot,
                'bash',
                '-lc',
                command,
            ],
        };
    }
    if (kind === 'sandbox-exec') {
        // Minimal SBPL: allow everything, deny writes outside the
        // workspace + the system temp dir.
        const profile = [
            '(version 1)',
            '(allow default)',
            '(deny file-write*)',
            `(allow file-write* (subpath ${sbplString(workspaceRoot)}))`,
            `(allow file-write* (subpath ${sbplString(os.tmpdir())}))`,
            '(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))',
        ].join('\n');
        return {
            program: 'sandbox-exec',
            args: ['-p', profile, 'bash', '-lc', command],
        };
    }
    // No sandbox — run directly through the shell.
    return { program: 'bash', args: ['-lc', command] };
}

function sbplString(path: string): string {
    // SBPL string literal: double-quoted, backslash-escaped.
    return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Run a command and return its captured output. Enforces the timeout
 * (killing the child) and the output cap (truncating + flagging).
 */
export async function executeCommand(options: ExecuteOptions): Promise<CommandResult> {
    const kind = resolveSandboxKind();
    const { program, args } = buildArgv(kind, options.workspaceRoot, options.command);

    return await new Promise<CommandResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let truncated = false;
        let timedOut = false;
        let settled = false;

        const child = spawn(program, [...args], {
            cwd: options.workspaceRoot,
            env: process.env,
        });

        const cap = options.maxOutputBytes;
        const append = (buf: Buffer, onto: 'out' | 'err'): void => {
            const current = onto === 'out' ? stdout : stderr;
            if (current.length >= cap) {
                truncated = true;
                return;
            }
            const room = cap - current.length;
            const text = buf.toString('utf8');
            const slice = text.length > room ? text.slice(0, room) : text;
            if (text.length > room) truncated = true;
            if (onto === 'out') stdout += slice;
            else stderr += slice;
        };

        child.stdout.on('data', (b: Buffer) => append(b, 'out'));
        child.stderr.on('data', (b: Buffer) => append(b, 'err'));

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, options.timeoutMs);

        const finish = (exitCode: number): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                stdout,
                stderr,
                exitCode,
                sandboxed: kind !== 'none',
                timedOut,
                truncated,
            });
        };

        child.on('error', (err) => {
            stderr += `\n[spawn error] ${err.message}`;
            finish(-1);
        });
        child.on('close', (code) => finish(timedOut ? -1 : (code ?? -1)));
    });
}
