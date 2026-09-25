// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    checkRelPath,
    matchGlob,
    resolveRequestPath,
    type MountSnapshot,
} from '../../../src/extension/workspace/PathResolver.js';

const MOUNT: MountSnapshot = {
    mountId: 'mount-123',
    permissionTier: 'ask',
};

describe('resolveRequestPath — mount checks', () => {
    test('mount_not_found when no mount is registered', () => {
        const r = resolveRequestPath({
            mount: undefined,
            requestMountId: 'mount-123',
            requestRelPath: 'src/a.ts',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'mount_not_found');
    });

    test('mount_stale when the request carries a different mount id', () => {
        const r = resolveRequestPath({
            mount: MOUNT,
            requestMountId: 'mount-XXX',
            requestRelPath: 'src/a.ts',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'mount_stale');
        assert.match(r.detail, /mount id mismatch/);
    });

    test('happy path returns the normalised rel path', () => {
        const r = resolveRequestPath({
            mount: MOUNT,
            requestMountId: 'mount-123',
            requestRelPath: 'src/a.ts',
        });
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.relPath, 'src/a.ts');
    });
});

describe('checkRelPath — path shape', () => {
    test('empty string allowed as workspace root', () => {
        const r = checkRelPath('');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.relPath, '');
    });

    test('whitespace-only string allowed as workspace root', () => {
        const r = checkRelPath('   ');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.relPath, '');
    });

    test('leading-slash absolute path rejects', () => {
        const r = checkRelPath('/etc/passwd');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'absolute_path_forbidden');
    });

    test('Windows drive path rejects', () => {
        const r = checkRelPath('C:\\Windows\\System32\\cmd.exe');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'absolute_path_forbidden');
    });

    test('UNC path rejects', () => {
        const r = checkRelPath('\\\\server\\share\\file');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'absolute_path_forbidden');
    });

    test('explicit .. segment rejects with unsafe_path', () => {
        const r = checkRelPath('src/../etc/passwd');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'unsafe_path');
    });

    test('leading .. rejects with unsafe_path', () => {
        const r = checkRelPath('../escape.txt');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'unsafe_path');
    });

    test('null byte rejects with unsafe_path', () => {
        const r = checkRelPath('src/a\0.ts');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'unsafe_path');
    });

    test('dot collapses cleanly', () => {
        const r = checkRelPath('src/./a.ts');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.relPath, 'src/a.ts');
    });

    test('repeat slashes collapse', () => {
        const r = checkRelPath('src///a.ts');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.relPath, 'src/a.ts');
    });

    test('backslashes normalise to forward slashes', () => {
        const r = checkRelPath('src\\nested\\a.ts');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.relPath, 'src/nested/a.ts');
    });

    test('path that normalises to empty resolves to workspace root', () => {
        const r = checkRelPath('./.');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.relPath, '');
    });

    test('single dot allowed as workspace root', () => {
        const r = checkRelPath('.');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.relPath, '');
    });
});

describe('resolveRequestPath — blocklist', () => {
    test('root-level .env rejects via leading-doublestar default', () => {
        const r = resolveRequestPath({
            mount: MOUNT,
            requestMountId: MOUNT.mountId,
            requestRelPath: '.env',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'blocked_path');
    });

    test('nested .env still rejects', () => {
        const r = resolveRequestPath({
            mount: MOUNT,
            requestMountId: MOUNT.mountId,
            requestRelPath: 'apps/web/.env',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'blocked_path');
    });

    test('.ssh directory contents reject', () => {
        const r = resolveRequestPath({
            mount: MOUNT,
            requestMountId: MOUNT.mountId,
            requestRelPath: '.ssh/id_rsa',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'blocked_path');
    });

    test('credentials.json rejects', () => {
        const r = resolveRequestPath({
            mount: MOUNT,
            requestMountId: MOUNT.mountId,
            requestRelPath: 'credentials.json',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'blocked_path');
    });

    test('node_modules contents reject', () => {
        const r = resolveRequestPath({
            mount: MOUNT,
            requestMountId: MOUNT.mountId,
            requestRelPath: 'node_modules/foo/index.js',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'blocked_path');
    });

    test('per-mount additions augment the defaults', () => {
        const r = resolveRequestPath({
            mount: { ...MOUNT, blocklist: ['coverage/**'] },
            requestMountId: MOUNT.mountId,
            requestRelPath: 'coverage/lcov.info',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'blocked_path');
    });

    test('regular source file passes the blocklist', () => {
        const r = resolveRequestPath({
            mount: MOUNT,
            requestMountId: MOUNT.mountId,
            requestRelPath: 'src/app.ts',
        });
        assert.equal(r.ok, true);
    });
});

describe('resolveRequestPath — allowlist', () => {
    test('empty allowlist allows every non-blocklisted path', () => {
        const r = resolveRequestPath({
            mount: { ...MOUNT, allowlist: [] },
            requestMountId: MOUNT.mountId,
            requestRelPath: 'src/a.ts',
        });
        assert.equal(r.ok, true);
    });

    test('non-matching path rejects with not_allowlisted', () => {
        const r = resolveRequestPath({
            mount: { ...MOUNT, allowlist: ['src/**'] },
            requestMountId: MOUNT.mountId,
            requestRelPath: 'docs/README.md',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'not_allowlisted');
    });

    test('matching path passes', () => {
        const r = resolveRequestPath({
            mount: { ...MOUNT, allowlist: ['src/**'] },
            requestMountId: MOUNT.mountId,
            requestRelPath: 'src/feature/a.ts',
        });
        assert.equal(r.ok, true);
    });

    test('multiple allowlist entries — any match succeeds', () => {
        const r = resolveRequestPath({
            mount: { ...MOUNT, allowlist: ['src/**', 'docs/**'] },
            requestMountId: MOUNT.mountId,
            requestRelPath: 'docs/README.md',
        });
        assert.equal(r.ok, true);
    });

    test('blocklist runs BEFORE allowlist — credentials in src/** still reject as blocked_path', () => {
        const r = resolveRequestPath({
            mount: { ...MOUNT, allowlist: ['**'] },
            requestMountId: MOUNT.mountId,
            requestRelPath: '.env',
        });
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.kind, 'blocked_path');
    });
});

describe('matchGlob — sanity', () => {
    test('leading double-star matches root-level files', () => {
        assert.equal(matchGlob('.env', '**/.env'), true);
        assert.equal(matchGlob('nested/.env', '**/.env'), true);
    });

    test('single star does not cross slashes', () => {
        assert.equal(matchGlob('src/a.ts', 'src/*.ts'), true);
        assert.equal(matchGlob('src/nested/a.ts', 'src/*.ts'), false);
    });

    test('double-star spans directories', () => {
        assert.equal(matchGlob('src/nested/a.ts', 'src/**/*.ts'), true);
    });
});
