// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ClientRpcHandler, type RpcResult } from '../../../src/extension/wire/ClientRpcHandler.js';
import type { ClientRequest } from '../../../src/shared/wire-envelope.js';

interface LoggedEntry {
    readonly level: 'error' | 'warn' | 'info' | 'debug';
    readonly message: string;
    readonly context: Readonly<Record<string, unknown>> | undefined;
}

class TestLogger {
    readonly entries: LoggedEntry[] = [];

    error(message: string, context?: Readonly<Record<string, unknown>>): void {
        this.entries.push({ level: 'error', message, context });
    }

    warn(message: string, context?: Readonly<Record<string, unknown>>): void {
        this.entries.push({ level: 'warn', message, context });
    }

    info(message: string, context?: Readonly<Record<string, unknown>>): void {
        this.entries.push({ level: 'info', message, context });
    }

    debug(message: string, context?: Readonly<Record<string, unknown>>): void {
        this.entries.push({ level: 'debug', message, context });
    }
}

function makeHandler(): { logger: TestLogger; handler: ClientRpcHandler } {
    const logger = new TestLogger();
    const handler = new ClientRpcHandler({ logger: logger as unknown as never });
    return { logger, handler };
}

function makeRequest(op: string, args?: Readonly<Record<string, unknown>>): ClientRequest {
    return {
        type: 'request',
        request_id: `req-${op}`,
        op,
        args,
    };
}

describe('ClientRpcHandler — round trip', () => {
    test('returns the handler result on the happy path', async () => {
        const { handler } = makeHandler();
        handler.registerHandler('echo', async (args) => ({
            ok: true,
            data: { echoed: args },
        }));

        const result = await handler.dispatch(makeRequest('echo', { hello: 'world' }));

        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.deepEqual(result.data, { echoed: { hello: 'world' } });
    });

    test('hands an empty args object to the handler when the wire envelope omits args', async () => {
        const { handler } = makeHandler();
        let observed: Readonly<Record<string, unknown>> | undefined;
        handler.registerHandler('peek', async (args) => {
            observed = args;
            return { ok: true, data: null };
        });

        await handler.dispatch(makeRequest('peek'));

        assert.deepEqual(observed, {});
    });
});

describe('ClientRpcHandler — unknown op', () => {
    test('returns ok:false with kind=unknown_op when no handler is registered', async () => {
        const { handler } = makeHandler();
        const result: RpcResult = await handler.dispatch(makeRequest('nonexistent'));
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.error.kind, 'unknown_op');
        assert.match(result.error.detail, /no handler registered for op 'nonexistent'/);
    });

    test('unknown_op does not log — the host already knows it sent an unsupported op', async () => {
        const { logger, handler } = makeHandler();
        await handler.dispatch(makeRequest('nonexistent'));
        assert.equal(logger.entries.length, 0);
    });
});

describe('ClientRpcHandler — handler errors', () => {
    test('catches thrown Errors and replies with kind=handler_error', async () => {
        const { handler } = makeHandler();
        handler.registerHandler('boom', async () => {
            throw new Error('synthetic failure');
        });

        const result = await handler.dispatch(makeRequest('boom'));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.error.kind, 'handler_error');
        assert.equal(result.error.detail, 'synthetic failure');
    });

    test('catches rejected promises with the same shape', async () => {
        const { handler } = makeHandler();
        handler.registerHandler('reject', () => Promise.reject(new Error('rejected')));

        const result = await handler.dispatch(makeRequest('reject'));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.error.kind, 'handler_error');
        assert.equal(result.error.detail, 'rejected');
    });

    test('catches non-Error throws and serialises the value into detail', async () => {
        const { handler } = makeHandler();
        handler.registerHandler('weird', () => Promise.reject('plain-string'));

        const result = await handler.dispatch(makeRequest('weird'));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.error.kind, 'handler_error');
        assert.equal(result.error.detail, 'plain-string');
    });

    test('emits a structured warn-level log entry on handler_error', async () => {
        const { logger, handler } = makeHandler();
        handler.registerHandler('boom', async () => {
            throw new Error('synthetic failure');
        });

        await handler.dispatch(makeRequest('boom'));

        assert.equal(logger.entries.length, 1);
        const entry = logger.entries[0];
        assert.ok(entry !== undefined);
        assert.equal(entry.level, 'warn');
        assert.equal(entry.message, 'client-rpc: handler threw');
        assert.equal(entry.context?.['op'], 'boom');
        assert.equal(entry.context?.['error'], 'synthetic failure');
    });
});

describe('ClientRpcHandler — concurrent dispatch', () => {
    test('replies are returned in the order their handlers resolve, regardless of dispatch order', async () => {
        const { handler } = makeHandler();
        let resolveSlow: ((result: RpcResult) => void) | undefined;
        const slowResult: Promise<RpcResult> = new Promise<RpcResult>((resolve) => {
            resolveSlow = resolve;
        });
        handler.registerHandler('slow', () => slowResult);
        handler.registerHandler('fast', async () => ({ ok: true, data: 'fast-data' }));

        const slowDispatch = handler.dispatch(makeRequest('slow'));
        const fastDispatch = handler.dispatch(makeRequest('fast'));

        const fast = await fastDispatch;
        assert.equal(fast.ok, true);
        if (fast.ok) {
            assert.equal(fast.data, 'fast-data');
        }

        assert.ok(resolveSlow !== undefined);
        resolveSlow({ ok: true, data: 'slow-data' });
        const slow = await slowDispatch;
        assert.equal(slow.ok, true);
        if (slow.ok) {
            assert.equal(slow.data, 'slow-data');
        }
    });

    test('two concurrent dispatches of the same op see independent args + results', async () => {
        const { handler } = makeHandler();
        handler.registerHandler('square', async (args) => {
            const n = args['n'];
            if (typeof n !== 'number') {
                return { ok: false, error: { kind: 'bad_arg', detail: 'n must be number' } };
            }
            return { ok: true, data: n * n };
        });

        const [r1, r2, r3] = await Promise.all([
            handler.dispatch(makeRequest('square', { n: 2 })),
            handler.dispatch(makeRequest('square', { n: 3 })),
            handler.dispatch(makeRequest('square', { n: 7 })),
        ]);

        assert.equal(r1.ok, true);
        assert.equal(r2.ok, true);
        assert.equal(r3.ok, true);
        if (r1.ok) assert.equal(r1.data, 4);
        if (r2.ok) assert.equal(r2.data, 9);
        if (r3.ok) assert.equal(r3.data, 49);
    });
});

describe('ClientRpcHandler — registry discipline', () => {
    test('registering the same op twice throws synchronously', () => {
        const { handler } = makeHandler();
        handler.registerHandler('op', async () => ({ ok: true, data: 1 }));
        assert.throws(
            () => handler.registerHandler('op', async () => ({ ok: true, data: 2 })),
            /duplicate registration for op 'op'/,
        );
    });

    test('disposing the registration unregisters the handler', async () => {
        const { handler } = makeHandler();
        const disposable = handler.registerHandler('op', async () => ({ ok: true, data: 'live' }));
        assert.equal(handler.hasHandler('op'), true);

        const before = await handler.dispatch(makeRequest('op'));
        assert.equal(before.ok, true);

        disposable.dispose();
        assert.equal(handler.hasHandler('op'), false);

        const after = await handler.dispatch(makeRequest('op'));
        assert.equal(after.ok, false);
        if (after.ok) return;
        assert.equal(after.error.kind, 'unknown_op');
    });

    test('disposing twice is a no-op', () => {
        const { handler } = makeHandler();
        const disposable = handler.registerHandler('op', async () => ({ ok: true, data: 1 }));
        disposable.dispose();
        disposable.dispose();
        handler.registerHandler('op', async () => ({ ok: true, data: 2 }));
        assert.equal(handler.hasHandler('op'), true);
    });

    test('disposing a stale registration does not clobber a fresh handler on the same op', async () => {
        const { handler } = makeHandler();
        const first = handler.registerHandler('op', async () => ({ ok: true, data: 'first' }));
        first.dispose();
        handler.registerHandler('op', async () => ({ ok: true, data: 'second' }));

        first.dispose();
        const result = await handler.dispatch(makeRequest('op'));
        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.data, 'second');
        }
    });

    test('registeredOps reports the current op set', () => {
        const { handler } = makeHandler();
        assert.deepEqual(handler.registeredOps(), []);
        handler.registerHandler('a', async () => ({ ok: true, data: null }));
        handler.registerHandler('b', async () => ({ ok: true, data: null }));
        assert.deepEqual(handler.registeredOps(), ['a', 'b']);
    });
});
