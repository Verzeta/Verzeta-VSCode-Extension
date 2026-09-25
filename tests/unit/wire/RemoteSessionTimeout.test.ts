// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { RemoteSession } from '../../../src/extension/wire/RemoteSession.js';

function silentLogger(): never {
    const noop = (): void => {};
    return { error: noop, warn: noop, info: noop, debug: noop } as unknown as never;
}

function openWithSilentSocket(session: RemoteSession): string[] {
    const frames: string[] = [];
    const internals = session as unknown as { socket: unknown; state: string };
    internals.socket = { send: (payload: string) => frames.push(payload) };
    internals.state = 'open';
    return frames;
}

test('send rejects when no reply arrives within the timeout', async () => {
    const session = new RemoteSession({ logger: silentLogger(), requestTimeoutMs: 20 });
    const frames = openWithSilentSocket(session);

    await assert.rejects(session.send('ping'), /No reply from the host for ping/);
    assert.equal(frames.length, 1);
    assert.equal(session.pendingCount(), 0);
});

test('a reply before the timeout resolves normally', async () => {
    const session = new RemoteSession({ logger: silentLogger(), requestTimeoutMs: 1000 });
    const frames = openWithSilentSocket(session);

    const pending = session.send('ping');
    const sent = JSON.parse(frames[0] ?? '{}') as { request_id: string };
    const internals = session as unknown as { onMessage: (event: { data: unknown }) => void };
    internals.onMessage({
        data: JSON.stringify({
            type: 'response',
            request_id: sent.request_id,
            ok: true,
            data: { time_ms: 5 },
        }),
    });

    assert.deepEqual(await pending, { time_ms: 5 });
    assert.equal(session.pendingCount(), 0);
});
