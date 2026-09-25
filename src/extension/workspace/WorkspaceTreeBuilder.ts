// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { WorkspaceTreeEntry, WorkspaceTreeManifest } from '../../shared/wire-types.js';

export const DEFAULT_MAX_HINT_FILES = 1500;
export const DEFAULT_MAX_DEPTH = 3;

export const DEFAULT_IGNORE_GLOBS: readonly string[] = [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    'target/**',
    'out/**',
    '.next/**',
    '.cache/**',
    '.idea/**',
    '.vscode/.tmp/**',
    '**/.env',
    '**/.env.*',
    '**/.env.local',
    '**/.ssh/**',
    '**/.aws/**',
    '**/.azure/**',
    '**/.docker/config.json',
    '**/.kube/**',
    '**/.npmrc',
    '**/.pypirc',
    '**/.netrc',
    '**/secrets/**',
    '**/credentials*',
    '**/*.pem',
    '**/*.key',
    '**/id_rsa*',
    '**/id_ed25519*',
];

/**
 * Lookup for (size, mtimeMs) per relative path. Callers provide
 * the implementation; production wires it to vscode.workspace.fs.
 * stat, tests pass a synchronous map-backed stub.
 */
export type StatFn = (relPath: string) => StatResult | undefined;

export interface StatResult {
    readonly size: number;
    readonly mtimeMs: number;
}

export interface BuildTreeOptions {
    readonly workspaceRoot: string;
    readonly candidates: readonly string[];
    readonly statFn: StatFn;
    readonly additionalIgnores?: readonly string[] | undefined;
    readonly maxFiles?: number | undefined;
    readonly maxDepth?: number | undefined;
}

export interface BuildTreeResult {
    readonly manifest: WorkspaceTreeManifest;
    /** Number of candidates dropped because the file vanished between findFiles and stat. */
    readonly droppedMissing: number;
    /** Number of candidates dropped by the depth cap. */
    readonly droppedDepth: number;
    /** Number of candidates dropped by the ignore globs. */
    readonly droppedIgnored: number;
    /** True iff the cap was reached and remaining candidates were skipped. */
    readonly truncated: boolean;
}

/**
 * Builds a shallow tree manifest from a list of candidate paths.
 *
 * Algorithm:
 *   1. Convert each candidate to a workspace-relative POSIX path.
 *      Drop anything that doesn't live under workspaceRoot (path-
 *      traversal safety; the caller's findFiles should already
 *      enforce this).
 *   2. Drop entries beyond maxDepth (counted by `/` segments after
 *      removing the leading root prefix).
 *   3. Drop entries matching any ignore glob (bundled defaults
 *      union with additionalIgnores).
 *   4. Stat each survivor; drop if stat returns undefined.
 *   5. Stop when maxFiles is reached; record truncated: true.
 *   6. Sort the entries by path for deterministic wire output —
 *      the host compares manifest diffs, so consistent ordering
 *      keeps no-op updates from looking like real changes.
 */
export function buildWorkspaceTree(options: BuildTreeOptions): BuildTreeResult {
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_HINT_FILES;
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const ignoreSources: readonly string[] = [
        ...DEFAULT_IGNORE_GLOBS,
        ...(options.additionalIgnores ?? []),
    ];
    const ignoreMatchers = ignoreSources.map(compileGlob);
    const root = normaliseRoot(options.workspaceRoot);

    const entries: WorkspaceTreeEntry[] = [];
    let droppedMissing = 0;
    let droppedDepth = 0;
    let droppedIgnored = 0;
    let truncated = false;

    for (const candidate of options.candidates) {
        if (entries.length >= maxFiles) {
            truncated = true;
            break;
        }
        const rel = relativeUnderRoot(root, candidate);
        if (rel === undefined) continue;
        if (depthOf(rel) > maxDepth) {
            droppedDepth += 1;
            continue;
        }
        if (matchesAny(rel, ignoreMatchers)) {
            droppedIgnored += 1;
            continue;
        }
        const stat = options.statFn(rel);
        if (stat === undefined) {
            droppedMissing += 1;
            continue;
        }
        entries.push({
            path: rel,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
        });
    }

    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    return {
        manifest: { v: 1, files: entries },
        droppedMissing,
        droppedDepth,
        droppedIgnored,
        truncated,
    };
}

/**
 * Wire serialisation: TS-side camelCase to JSON snake_case with
 * mtime_ms. Returns a string ready for RemoteRepository.
 * registerWorkspaceMount.treeJson.
 *
 * The output is stable for a given input — entries already sorted
 * by buildWorkspaceTree so a refresh that found no changes
 * produces a byte-identical string.
 */
export function serializeTreeManifest(manifest: WorkspaceTreeManifest): string {
    return JSON.stringify({
        v: manifest.v,
        files: manifest.files.map((f) => ({
            path: f.path,
            size: f.size,
            mtime_ms: f.mtimeMs,
        })),
    });
}

// === internals ===

function normaliseRoot(root: string): string {
    // Strip trailing slash so we can use prefix + '/' cleanly for
    // descendant check. POSIX-style throughout — vscode.Uri.fsPath
    // is platform-native but candidates passed in here are expected
    // to be already POSIX-normalised by the caller.
    return root.replace(/\/+$/, '');
}

function relativeUnderRoot(root: string, candidate: string): string | undefined {
    if (candidate === root) return '';
    const prefix = root + '/';
    if (!candidate.startsWith(prefix)) return undefined;
    return candidate.slice(prefix.length);
}

function depthOf(relPath: string): number {
    // Count '/' segments. An empty path = depth 0 (the root itself,
    // never emitted as a file). A path of 'a' = depth 1 (single
    // directory level beyond root, file directly inside root).
    if (relPath.length === 0) return 0;
    let depth = 1;
    for (let i = 0; i < relPath.length; i += 1) {
        if (relPath[i] === '/') depth += 1;
    }
    return depth;
}

interface GlobMatcher {
    readonly source: string;
    readonly regex: RegExp;
}

function compileGlob(source: string): GlobMatcher {
    const trimmed = source.trim();
    if (trimmed.length === 0) {
        // An empty source matches nothing.
        return { source: '', regex: /(?!.*)/ };
    }
    let pattern = trimmed;
    // Leading double-star/ becomes the optional prefix BEFORE the
    // other transforms run, so the embedded double-star inside it
    // does not double-expand.
    let prefix = '';
    if (pattern.startsWith('**/')) {
        prefix = '(?:.*/)?';
        pattern = pattern.slice(3);
    }
    // Escape regex specials, then unescape glob specials we want to
    // map ourselves.
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // Order matters: double-star before single-star before question-
    // mark. Use a placeholder token of plain ASCII letters so the
    // single-star pass cannot clobber it and ESLint's
    // no-control-regex never triggers (no NUL or control bytes).
    const placeholder = 'AAADBLSTARAAA';
    const transformed = escaped
        .split('**')
        .join(placeholder)
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .split(placeholder)
        .join('.*');
    const regex = new RegExp(`^${prefix}${transformed}$`);
    return { source: trimmed, regex };
}

function matchesAny(relPath: string, matchers: readonly GlobMatcher[]): boolean {
    for (const m of matchers) {
        if (m.regex.test(relPath)) return true;
    }
    return false;
}
