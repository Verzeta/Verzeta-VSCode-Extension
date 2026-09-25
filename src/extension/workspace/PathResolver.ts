// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { PermissionTier } from '../../shared/wire-types.js';
import { DEFAULT_IGNORE_GLOBS } from './WorkspaceTreeBuilder.js';

/**
 * Reasons a resolve call may fail. Each maps to the wire-side
 * `error.kind` the host sees in the `client_response` envelope.
 */
export type ResolveRejectionKind =
    | 'mount_not_found'
    | 'mount_stale'
    | 'absolute_path_forbidden'
    | 'unsafe_path'
    | 'blocked_path'
    | 'not_allowlisted';

export interface ResolveOk {
    readonly ok: true;
    /** Workspace-relative POSIX path, normalised. Never empty. */
    readonly relPath: string;
}

export interface ResolveErr {
    readonly ok: false;
    readonly kind: ResolveRejectionKind;
    readonly detail: string;
}

export type ResolveResult = ResolveOk | ResolveErr;

/**
 * The subset of `WorkspaceMountInfoUi` the resolver needs. Defined
 * locally so the resolver does not depend on the full UI shape and
 * stays trivially mockable in tests.
 */
export interface MountSnapshot {
    readonly mountId: string;
    readonly permissionTier: PermissionTier;
    readonly allowlist?: readonly string[] | undefined;
    readonly blocklist?: readonly string[] | undefined;
}

export interface ResolveOptions {
    /**
     * The mount registered for the request's folderId. Pass
     * `undefined` to signal "no mount registered" — the resolver
     * surfaces that as `mount_not_found`.
     */
    readonly mount: MountSnapshot | undefined;
    /** The `mount_id` field carried by the inbound wire request. */
    readonly requestMountId: string;
    /** The `rel_path` field carried by the inbound wire request. */
    readonly requestRelPath: string;
}

/**
 * Runs the four sync guards. Returns a discriminated union so
 * handler bodies can pattern-match without try/catch.
 *
 * The function does NOT touch the file system. The handler that
 * calls this still has to do the symlink-escape check via
 * `vscode.workspace.fs.stat` after resolving the absolute URI; see
 * `VfsHandlers.ts` for that layer.
 */
export function resolveRequestPath(options: ResolveOptions): ResolveResult {
    const { mount, requestMountId, requestRelPath } = options;

    if (mount === undefined) {
        return {
            ok: false,
            kind: 'mount_not_found',
            detail: 'no workspace mount registered for the request folder',
        };
    }
    if (mount.mountId !== requestMountId) {
        return {
            ok: false,
            kind: 'mount_stale',
            detail: `mount id mismatch (request '${requestMountId}', registered '${mount.mountId}')`,
        };
    }

    const pathCheck = checkRelPath(requestRelPath);
    if (pathCheck.ok === false) return pathCheck;

    const rel = pathCheck.relPath;

    const blockSources = [...DEFAULT_IGNORE_GLOBS, ...(mount.blocklist ?? [])];
    for (const glob of blockSources) {
        if (matchGlob(rel, glob)) {
            return {
                ok: false,
                kind: 'blocked_path',
                detail: `path matches blocklist glob '${glob}'`,
            };
        }
    }

    // The allowlist only restricts when non-empty. An empty allowlist
    // means "no per-mount restriction" — every non-blocklisted path
    // is allowed.
    const allowList = mount.allowlist ?? [];
    if (allowList.length > 0) {
        let anyMatch = false;
        for (const glob of allowList) {
            if (matchGlob(rel, glob)) {
                anyMatch = true;
                break;
            }
        }
        if (!anyMatch) {
            return {
                ok: false,
                kind: 'not_allowlisted',
                detail: 'path is not on the mount allowlist',
            };
        }
    }

    return { ok: true, relPath: rel };
}

// === internals — exported for tests ===

/**
 * Returns a normalised workspace-relative POSIX path or a typed
 * rejection. Splits out so tests can exercise the path-shape
 * guards independently of the mount + blocklist context.
 */
export function checkRelPath(rawRelPath: string): ResolveOk | ResolveErr {
    if (typeof rawRelPath !== 'string') {
        return {
            ok: false,
            kind: 'unsafe_path',
            detail: 'rel_path must be a string',
        };
    }
    const trimmed = rawRelPath.trim();
    // Empty rel_path denotes the workspace ROOT — a legitimate target
    // for `vfs.list` (the agent discovers what's in the workspace) and
    // for `vfs.stat` (does the root exist as a directory? always yes
    // by definition of a registered mount). Reads / writes of "" fail
    // downstream at vscode.workspace.fs (can't read a directory as a
    // file), which surfaces as a clean io_error to the host. The
    // wire-side handlers in VfsHandlers.ts treat `""` as "the
    // workspace root absolute path" via `joinAbsolute(root, "")`.
    if (trimmed.length === 0) {
        return { ok: true, relPath: '' };
    }
    // Absolute POSIX / Windows-drive / UNC paths all reject. The
    // wire contract is "workspace-relative".
    if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
        return {
            ok: false,
            kind: 'absolute_path_forbidden',
            detail: 'rel_path must be workspace-relative',
        };
    }
    if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
        return {
            ok: false,
            kind: 'absolute_path_forbidden',
            detail: 'rel_path must be workspace-relative',
        };
    }
    if (/^\\\\/.test(trimmed)) {
        return {
            ok: false,
            kind: 'absolute_path_forbidden',
            detail: 'rel_path must be workspace-relative',
        };
    }
    if (trimmed.includes('\0')) {
        return {
            ok: false,
            kind: 'unsafe_path',
            detail: 'rel_path must not contain null bytes',
        };
    }
    // Normalise backslashes to forward slashes (callers may have
    // come from a Windows host); collapse repeats; resolve `.`;
    // reject any explicit `..` segment after the collapse.
    const segments = trimmed
        .replace(/\\/g, '/')
        .split('/')
        .filter((segment) => segment.length > 0 && segment !== '.');
    for (const segment of segments) {
        if (segment === '..') {
            return {
                ok: false,
                kind: 'unsafe_path',
                detail: 'rel_path must not contain `..` segments',
            };
        }
    }
    const normalised = segments.join('/');
    // Paths like "." or "./" or "/" all normalise to the empty string,
    // which means the workspace ROOT — same legitimate target as a
    // literally-empty input. Return `relPath: ''` so the rest of the
    // pipeline (blocklist / allowlist / VfsHandlers) treats both
    // forms identically.
    return { ok: true, relPath: normalised };
}

/**
 * Glob matcher shared between blocklist + allowlist checks.
 * Semantics intentionally match WorkspaceTreeBuilder's compileGlob
 * so a path that's hidden by the tree is also blocked by the
 * resolver — defence in depth.
 */
export function matchGlob(relPath: string, source: string): boolean {
    const compiled = compileGlobRegex(source);
    return compiled.test(relPath);
}

function compileGlobRegex(source: string): RegExp {
    const trimmed = source.trim();
    if (trimmed.length === 0) return /(?!.*)/;
    let pattern = trimmed;
    let prefix = '';
    if (pattern.startsWith('**/')) {
        prefix = '(?:.*/)?';
        pattern = pattern.slice(3);
    }
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const placeholder = 'AAADBLSTARAAA';
    const transformed = escaped
        .split('**')
        .join(placeholder)
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .split(placeholder)
        .join('.*');
    return new RegExp(`^${prefix}${transformed}$`);
}
