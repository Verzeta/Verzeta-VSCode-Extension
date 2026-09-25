// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    exchangePairCode,
    friendlyPairError,
    type PairSession,
} from '../../../src/extension/commands/pairing.js';
import { RemoteOpError } from '../../../src/extension/wire/RemoteSession.js';
import { silentLogger } from '../helpers/silentLogger.js';

function fakeSession(reply: unknown): PairSession & { disposed: boolean; sent: unknown[] } {
    const state = { disposed: false, sent: [] as unknown[] };
    return {
        get disposed() {
            return state.disposed;
        },
        sent: state.sent,
        connect: () => Promise.resolve(),
        send: (op, params) => {
            state.sent.push({ op, params });
            return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
        },
        dispose: () => {
            state.disposed = true;
            return Promise.resolve();
        },
    };
}

const TARGET = { url: 'ws://localhost:9180/', tlsCertSha256: '' };

test('exchangePairCode returns the token and closes the session', async () => {
    const session = fakeSession({ token: 't0k', client_id: 'c1', name: 'VS Code' });
    const response = await exchangePairCode(TARGET, ' 123456 ', silentLogger(), () => session);
    assert.equal(response.token, 't0k');
    assert.equal(session.disposed, true);
    const first = session.sent[0] as { op: string; params: { code: string } };
    assert.equal(first.op, 'auth.pair');
    assert.equal(first.params.code, '123456');
});

test('exchangePairCode closes the session when the host rejects the code', async () => {
    const session = fakeSession(
        new RemoteOpError({ kind: 'auth_failed', detail: 'invalid or expired pairing code' }),
    );
    await assert.rejects(
        exchangePairCode(TARGET, '000000', silentLogger(), () => session),
        RemoteOpError,
    );
    assert.equal(session.disposed, true);
});

test('friendlyPairError explains the host auth_failed kind', () => {
    const text = friendlyPairError(
        new RemoteOpError({ kind: 'auth_failed', detail: 'invalid or expired pairing code' }),
    );
    assert.match(text, /not accepted/);
    assert.equal(text.includes('auth_failed'), false);
});

test('friendlyPairError passes other errors through', () => {
    assert.equal(
        friendlyPairError(new RemoteOpError({ kind: 'server_error', detail: 'boom' })),
        'server_error: boom',
    );
    assert.equal(friendlyPairError(new Error('socket closed')), 'socket closed');
});
