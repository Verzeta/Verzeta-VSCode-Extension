// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    DEFAULT_MAX_DEPTH,
    DEFAULT_MAX_HINT_FILES,
    buildWorkspaceTree,
    serializeTreeManifest,
    type StatFn,
    type StatResult,
} from '../../../src/extension/workspace/WorkspaceTreeBuilder.js';

function makeStatFn(map: Readonly<Record<string, StatResult>>): StatFn {
    return (relPath) => map[relPath];
}

const FIXED_STAT: StatResult = { size: 42, mtimeMs: 1_700_000_000_000 };

describe('buildWorkspaceTree — happy path', () => {
    test('emits sorted entries with workspace-relative paths', () => {
        const root = '/home/user/proj';
        const candidates = [
            '/home/user/proj/src/foo.ts',
            '/home/user/proj/README.md',
            '/home/user/proj/src/bar.ts',
        ];
        const result = buildWorkspaceTree({
            workspaceRoot: root,
            candidates,
            statFn: () => FIXED_STAT,
        });

        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['README.md', 'src/bar.ts', 'src/foo.ts']);
        assert.equal(result.manifest.v, 1);
        assert.equal(result.truncated, false);
        assert.equal(result.droppedDepth, 0);
        assert.equal(result.droppedIgnored, 0);
        assert.equal(result.droppedMissing, 0);
    });

    test('emits size + mtime from statFn', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: ['/r/a.ts'],
            statFn: () => ({ size: 123, mtimeMs: 999 }),
        });
        const entry = result.manifest.files[0];
        assert.ok(entry !== undefined);
        assert.equal(entry.size, 123);
        assert.equal(entry.mtimeMs, 999);
    });

    test('trailing slash on workspaceRoot is normalised', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r/',
            candidates: ['/r/a.ts'],
            statFn: () => FIXED_STAT,
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['a.ts']);
    });
});

describe('buildWorkspaceTree — depth cap', () => {
    test('drops candidates beyond DEFAULT_MAX_DEPTH=3', () => {
        const root = '/r';
        const candidates = [
            '/r/a.ts',
            '/r/a/b.ts',
            '/r/a/b/c.ts',
            '/r/a/b/c/d.ts',
            '/r/a/b/c/d/e.ts',
        ];
        const result = buildWorkspaceTree({
            workspaceRoot: root,
            candidates,
            statFn: () => FIXED_STAT,
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['a.ts', 'a/b.ts', 'a/b/c.ts']);
        assert.equal(result.droppedDepth, 2);
        assert.equal(DEFAULT_MAX_DEPTH, 3);
    });

    test('maxDepth override honoured', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: ['/r/a.ts', '/r/a/b.ts'],
            statFn: () => FIXED_STAT,
            maxDepth: 1,
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['a.ts']);
        assert.equal(result.droppedDepth, 1);
    });
});

describe('buildWorkspaceTree — file cap', () => {
    test('emits truncated=true and stops at maxFiles', () => {
        const root = '/r';
        const candidates = ['1', '2', '3', '4', '5'].map((n) => `${root}/${n}.ts`);
        const result = buildWorkspaceTree({
            workspaceRoot: root,
            candidates,
            statFn: () => FIXED_STAT,
            maxFiles: 3,
        });
        assert.equal(result.manifest.files.length, 3);
        assert.equal(result.truncated, true);
    });

    test('DEFAULT_MAX_HINT_FILES is 1500', () => {
        assert.equal(DEFAULT_MAX_HINT_FILES, 1500);
    });
});

describe('buildWorkspaceTree — default ignore globs', () => {
    test('node_modules drops', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: ['/r/node_modules/foo/index.js', '/r/src/a.ts'],
            statFn: () => FIXED_STAT,
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['src/a.ts']);
        assert.equal(result.droppedIgnored, 1);
    });

    test('.git, dist, build, target all drop', () => {
        const root = '/r';
        const candidates = [
            '/r/.git/HEAD',
            '/r/dist/main.js',
            '/r/build/out.js',
            '/r/target/release/x',
            '/r/src/keep.ts',
        ];
        const result = buildWorkspaceTree({
            workspaceRoot: root,
            candidates,
            statFn: () => FIXED_STAT,
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['src/keep.ts']);
        assert.equal(result.droppedIgnored, 4);
    });

    test('root-level .env drops via leading **/ optional prefix', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: ['/r/.env', '/r/nested/.env', '/r/src/keep.ts'],
            statFn: () => FIXED_STAT,
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['src/keep.ts']);
        assert.equal(result.droppedIgnored, 2);
    });

    test('credentials + key files drop', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: [
                '/r/server.pem',
                '/r/secrets/db.txt',
                '/r/credentials.json',
                '/r/id_rsa',
                '/r/id_ed25519.pub',
                '/r/src/normal.ts',
            ],
            statFn: () => FIXED_STAT,
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['src/normal.ts']);
        assert.equal(result.droppedIgnored, 5);
    });
});

describe('buildWorkspaceTree — additionalIgnores', () => {
    test('user-supplied globs apply on top of defaults', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: ['/r/coverage/lcov.info', '/r/src/a.ts'],
            statFn: () => FIXED_STAT,
            additionalIgnores: ['coverage/**'],
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['src/a.ts']);
    });

    test('a single-file glob matches that file only', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: ['/r/private.md', '/r/public.md'],
            statFn: () => FIXED_STAT,
            additionalIgnores: ['private.md'],
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['public.md']);
    });
});

describe('buildWorkspaceTree — path-traversal safety', () => {
    test('candidates outside workspaceRoot are dropped silently', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/home/user/proj',
            candidates: ['/home/user/proj/keep.ts', '/home/user/other/sneaky.ts', '/etc/passwd'],
            statFn: () => FIXED_STAT,
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['keep.ts']);
    });

    test('candidate equal to root itself is dropped (root is not a file)', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: ['/r', '/r/a.ts'],
            statFn: makeStatFn({ '': FIXED_STAT, 'a.ts': FIXED_STAT }),
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.ok(paths.includes('a.ts'));
    });
});

describe('buildWorkspaceTree — stat returning undefined', () => {
    test('vanished files counted as droppedMissing', () => {
        const result = buildWorkspaceTree({
            workspaceRoot: '/r',
            candidates: ['/r/exists.ts', '/r/gone.ts'],
            statFn: makeStatFn({ 'exists.ts': FIXED_STAT }),
        });
        const paths = result.manifest.files.map((f) => f.path);
        assert.deepEqual(paths, ['exists.ts']);
        assert.equal(result.droppedMissing, 1);
    });
});

describe('serializeTreeManifest', () => {
    test('emits camelCase → snake_case for mtime_ms', () => {
        const out = serializeTreeManifest({
            v: 1,
            files: [{ path: 'a.ts', size: 10, mtimeMs: 123 }],
        });
        const parsed = JSON.parse(out) as Record<string, unknown>;
        assert.equal(parsed['v'], 1);
        const files = parsed['files'] as readonly Record<string, unknown>[];
        assert.ok(files !== undefined);
        const first = files[0];
        assert.ok(first !== undefined);
        assert.equal(first['path'], 'a.ts');
        assert.equal(first['size'], 10);
        assert.equal(first['mtime_ms'], 123);
        assert.equal(first['mtimeMs'], undefined);
    });

    test('byte-identical for the same input (stable diff)', () => {
        const manifest = {
            v: 1 as const,
            files: [{ path: 'a.ts', size: 1, mtimeMs: 1 }],
        };
        const a = serializeTreeManifest(manifest);
        const b = serializeTreeManifest(manifest);
        assert.equal(a, b);
    });
});
