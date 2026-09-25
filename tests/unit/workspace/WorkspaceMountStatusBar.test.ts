// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    buildStatusBarLabel,
    formatTier,
    workspaceTail,
} from '../../../src/extension/workspace/WorkspaceMountStatusBarLabel.js';
import type { WorkspaceMountInfoUi } from '../../../src/shared/wire-types.js';

const MOUNT_BASE: WorkspaceMountInfoUi = {
    folderId: 'folder-1',
    mountId: 'mount-abc',
    ownerLabel: 'My Team',
    permissionTier: 'ask',
    workspaceRoot: '/home/user/projects/web-app',
    registeredAtMs: 1700000000,
    fileCount: 42,
};

describe('buildStatusBarLabel', () => {
    test('text includes workspace tail + owner label + tier', () => {
        const { text } = buildStatusBarLabel(MOUNT_BASE);
        assert.match(text, /Verzeta:/);
        assert.match(text, /web-app/);
        assert.match(text, /My Team/);
        assert.match(text, /\(ask\)/);
    });

    test('text starts with the link codicon', () => {
        const { text } = buildStatusBarLabel(MOUNT_BASE);
        assert.ok(text.startsWith('$(link)'));
    });

    test('tooltip lists folder, workspace, tier, file count', () => {
        const { tooltip } = buildStatusBarLabel(MOUNT_BASE);
        assert.match(tooltip, /Folder: My Team/);
        assert.match(tooltip, /Workspace: \/home\/user\/projects\/web-app/);
        assert.match(tooltip, /Tier: ask/);
        assert.match(tooltip, /Files \(manifest\): 42/);
    });

    test('bypass tier renders in the tier text slot', () => {
        const out = buildStatusBarLabel({ ...MOUNT_BASE, permissionTier: 'bypass' });
        assert.match(out.text, /\(bypass\)/);
        assert.match(out.tooltip, /Tier: bypass/);
    });

    test('smart tier renders in the tier text slot', () => {
        const out = buildStatusBarLabel({ ...MOUNT_BASE, permissionTier: 'smart' });
        assert.match(out.text, /\(smart\)/);
    });

    test('tooltip mentions click affordance', () => {
        const { tooltip } = buildStatusBarLabel(MOUNT_BASE);
        assert.match(tooltip, /Click for actions/);
    });
});

describe('workspaceTail', () => {
    test('returns the basename of a posix path', () => {
        assert.equal(workspaceTail('/home/user/projects/web-app'), 'web-app');
    });

    test('strips trailing slash before computing the tail', () => {
        assert.equal(workspaceTail('/home/user/projects/web-app/'), 'web-app');
    });

    test('handles windows-style separators', () => {
        assert.equal(workspaceTail('C:\\Users\\u\\projects\\web-app'), 'web-app');
    });

    test('returns the input itself when there is no separator', () => {
        assert.equal(workspaceTail('only-one-segment'), 'only-one-segment');
    });

    test('returns "(workspace)" for empty input', () => {
        assert.equal(workspaceTail(''), '(workspace)');
    });
});

describe('formatTier', () => {
    test('maps each tier to its literal text', () => {
        assert.equal(formatTier('ask'), 'ask');
        assert.equal(formatTier('smart'), 'smart');
        assert.equal(formatTier('bypass'), 'bypass');
    });
});
