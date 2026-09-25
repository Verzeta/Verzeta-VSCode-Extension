// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { ClientRequest, RemoteError } from '../../shared/wire-envelope.js';
import { asDisposable, type Disposable } from '../infra/disposables.js';
import type { Logger } from '../log/Logger.js';

/**
 * Successful handler outcome. `data` is the JSON payload that goes
 * straight onto the wire reply's `data` field.
 */
export interface RpcOk {
    readonly ok: true;
    readonly data: unknown;
}

/**
 * Failed handler outcome. `error` is the structured wire error the
 * caller (the host) sees in the `client_response.error` field.
 */
export interface RpcErr {
    readonly ok: false;
    readonly error: RemoteError;
}

/**
 * Discriminated union returned by every handler and by `dispatch`.
 * Matches the wire `client_response` shape so `RemoteSession`
 * forwards it without further translation.
 */
export type RpcResult = RpcOk | RpcErr;

/**
 * Handler signature: receives the request's `args` (always an object
 * — empty `{}` when the wire envelope omits the field) and resolves
 * to an `RpcResult`. Handlers MAY throw; `dispatch` will catch and
 * convert to a `handler_error` reply.
 */
export type ClientRpcHandlerFn = (args: Readonly<Record<string, unknown>>) => Promise<RpcResult>;

/**
 * Options accepted by the constructor. `logger` is required so a
 * misbehaving handler shows up in the Verzeta output channel even
 * when the wire reply is structured + sent successfully.
 */
export interface ClientRpcHandlerOptions {
    readonly logger: Logger;
}

/**
 * Registry of host-initiated RPC handlers, keyed by wire op name.
 *
 * Composition: build once at activation, register the per-surface
 * handlers as those surfaces come online, hand `dispatch` to
 * `RemoteSession.setRequestDispatcher`. The same instance can be
 * shared across sessions because handlers are op-keyed, not
 * session-keyed.
 */
export class ClientRpcHandler {
    private readonly handlers = new Map<string, ClientRpcHandlerFn>();
    private readonly logger: Logger;

    constructor(options: ClientRpcHandlerOptions) {
        this.logger = options.logger;
        // Bind so callers can pass `handler.dispatch` as a function
        // value without losing `this`.
        this.dispatch = this.dispatch.bind(this);
    }

    /**
     * Registers `fn` as the handler for `op`. Throws synchronously
     * if a handler is already registered for the same op — a
     * collision is a composition bug, not a runtime condition. The
     * returned disposable unregisters the handler when disposed;
     * disposing twice is a no-op.
     */
    registerHandler(op: string, fn: ClientRpcHandlerFn): Disposable {
        if (this.handlers.has(op)) {
            throw new Error(`ClientRpcHandler: duplicate registration for op '${op}'`);
        }
        this.handlers.set(op, fn);
        return asDisposable(() => {
            // Only unregister if the slot still holds the same fn —
            // protects against an out-of-order dispose racing a
            // subsequent re-register on the same op.
            if (this.handlers.get(op) === fn) {
                this.handlers.delete(op);
            }
        });
    }

    /**
     * `true` iff `op` currently has a registered handler. Useful for
     * tests + diagnostics; production code should treat missing
     * handlers as the dispatcher's `unknown_op` reply.
     */
    hasHandler(op: string): boolean {
        return this.handlers.has(op);
    }

    /**
     * Snapshot of currently-registered op names. Order is
     * insertion order per Map semantics. Returned as a readonly
     * array so callers cannot mutate the registry indirectly.
     */
    registeredOps(): readonly string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Dispatches a parsed `ClientRequest` to the matching handler
     * and returns the structured reply. Never throws — every
     * failure mode resolves to an `RpcErr`:
     *
     *  - no handler registered → `{kind: 'unknown_op'}`
     *  - handler throws / rejects → `{kind: 'handler_error'}` and a
     *    warn-level log line so the failure is surfaced
     *
     * The reply shape matches the wire `client_response` envelope
     * 1:1 so `RemoteSession` can forward it without translation.
     */
    async dispatch(request: ClientRequest): Promise<RpcResult> {
        const handler = this.handlers.get(request.op);
        if (handler === undefined) {
            return {
                ok: false,
                error: {
                    kind: 'unknown_op',
                    detail: `no handler registered for op '${request.op}'`,
                },
            };
        }
        const args = request.args ?? {};
        try {
            return await handler(args);
        } catch (error) {
            const message = errorMessage(error);
            this.logger.warn('client-rpc: handler threw', {
                op: request.op,
                requestId: request.request_id,
                error: message,
            });
            return {
                ok: false,
                error: {
                    kind: 'handler_error',
                    detail: message,
                },
            };
        }
    }
}

function errorMessage(value: unknown): string {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return 'non-serialisable handler error';
    }
}
