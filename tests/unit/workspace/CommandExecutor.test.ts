// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';

import {
    executeCommand,
    resolveSandboxKind,
    resetSandboxProbeForTests,
} from '../../../src/extension/workspace/CommandExecutor.js';

describe('CommandExecutor', () => {
    test('captures stdout + exit code', async () => {
        const r = await executeCommand({
            workspaceRoot: os.tmpdir(),
            command: 'echo hello-exec',
            timeoutMs: 10_000,
            maxOutputBytes: 1024,
        });
        assert.match(r.stdout, /hello-exec/);
        assert.equal(r.exitCode, 0);
        assert.equal(r.timedOut, false);
    });

    test('non-zero exit code is surfaced', async () => {
        const r = await executeCommand({
            workspaceRoot: os.tmpdir(),
            command: 'exit 3',
            timeoutMs: 10_000,
            maxOutputBytes: 1024,
        });
        assert.equal(r.exitCode, 3);
    });

    test('output is capped + flagged truncated', async () => {
        const r = await executeCommand({
            workspaceRoot: os.tmpdir(),
            command: 'yes abcdefgh | head -c 100000',
            timeoutMs: 10_000,
            maxOutputBytes: 256,
        });
        assert.ok(r.stdout.length <= 256);
        assert.equal(r.truncated, true);
    });

    test('timeout kills the command and flags timedOut', async () => {
        const r = await executeCommand({
            workspaceRoot: os.tmpdir(),
            command: 'sleep 5',
            timeoutMs: 300,
            maxOutputBytes: 1024,
        });
        assert.equal(r.timedOut, true);
        assert.equal(r.exitCode, -1);
    });

    test('sandboxed flag matches the platform probe', async () => {
        resetSandboxProbeForTests();
        const kind = resolveSandboxKind();
        const r = await executeCommand({
            workspaceRoot: os.tmpdir(),
            command: 'echo ok',
            timeoutMs: 10_000,
            maxOutputBytes: 1024,
        });
        assert.equal(r.sandboxed, kind !== 'none');
    });
});
