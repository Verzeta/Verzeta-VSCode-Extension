// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import { Agent, WebSocket as UndiciWebSocket, type Dispatcher } from 'undici';
import type { Logger } from '../log/Logger.js';
import type {
    ClientRequest,
    ClientResponse,
    RemoteError,
    RemoteEvent,
    RemoteOp,
    RemoteResponse,
} from '../../shared/wire-envelope.js';
import type { RpcResult } from './ClientRpcHandler.js';
import { parseFrame } from './RemoteJson.js';
import { MAX_WIRE_FRAME_BYTES } from '../../shared/wire-limits.js';
import type { RemoteEndpoint } from './RemoteEndpoint.js';
import { websocketUrl } from './RemoteEndpoint.js';

export type ConnectionLifecycle = 'idle' | 'connecting' | 'open' | 'closed' | 'failed';

export type LifecycleListener = (state: ConnectionLifecycle) => void;
export type EventListener = (event: RemoteEvent) => void;
export type ErrorListener = (error: RemoteError) => void;

/**
 * Dispatcher signature for host-initiated `request` envelopes. The
 * extension exposes a single dispatcher slot per session; the
 * production wiring points it at `ClientRpcHandler.dispatch`. The
 * dispatcher MUST resolve to an `RpcResult` and SHOULD NOT throw —
 * `RemoteSession` defensively wraps the call in try/catch and treats
 * a thrown error as `handler_error`.
 */
export type ClientRequestDispatcher = (request: ClientRequest) => Promise<RpcResult>;

interface PendingRequest {
    readonly resolve: (value: RemoteResponse) => void;
    readonly reject: (reason: Error) => void;
    readonly op: string;
}

/**
 * A wire-op failure returned by the host. Carries the structured
 * RemoteError kind + detail so callers can map specific kinds to UX
 * (`unauthorized` -> re-pair, `not_found` -> stale id, ...).
 */
export class RemoteOpError extends Error {
    readonly kind: string;
    readonly detail: string;
    constructor(error: RemoteError) {
        super(`${error.kind}: ${error.detail}`);
        this.name = 'RemoteOpError';
        this.kind = error.kind;
        this.detail = error.detail;
    }
}

/**
 * How long `send` waits for a reply before giving up. The host bounds its
 * own work well below this, so a request that outlives it is sitting on a
 * half-open socket.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Extra reply wait per KiB of outgoing frame. A large attachment on a slow
 * uplink (about 64 KiB/s) can take longer than the base timeout just to
 * leave the machine, and the host still saves it afterwards, so the wait
 * grows with the frame instead of reporting a false failure.
 */
export const UPLOAD_MS_PER_KIB = 16;

export interface RemoteSessionOptions {
    readonly logger: Logger;
    /** Log state transitions at info level when true, debug when false. */
    readonly verboseState?: boolean;
    /** Reply timeout for `send`, in milliseconds. Defaults to `DEFAULT_REQUEST_TIMEOUT_MS`. */
    readonly requestTimeoutMs?: number;
}

interface UndiciCloseEvent {
    readonly code: number;
    readonly reason: string;
}

interface UndiciMessageEvent {
    readonly data: unknown;
}

export class RemoteSession {
    private readonly logger: Logger;
    private readonly verboseState: boolean;
    private readonly requestTimeoutMs: number;
    private socket: UndiciWebSocket | undefined;
    private dispatcher: Dispatcher | undefined;
    private state: ConnectionLifecycle = 'idle';
    private readonly pending = new Map<string, PendingRequest>();
    private readonly stateListeners = new Set<LifecycleListener>();
    private readonly eventListeners = new Set<EventListener>();
    private readonly errorListeners = new Set<ErrorListener>();
    private requestDispatcher: ClientRequestDispatcher | undefined;
    private disposed = false;
    private connectAwaiter: { resolve: () => void; reject: (e: Error) => void } | undefined;

    constructor(options: RemoteSessionOptions) {
        this.logger = options.logger;
        this.verboseState = options.verboseState ?? true;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    }

    currentState(): ConnectionLifecycle {
        return this.state;
    }

    onStateChanged(cb: LifecycleListener): () => void {
        this.stateListeners.add(cb);
        return () => {
            this.stateListeners.delete(cb);
        };
    }

    onEvent(cb: EventListener): () => void {
        this.eventListeners.add(cb);
        return () => {
            this.eventListeners.delete(cb);
        };
    }

    onError(cb: ErrorListener): () => void {
        this.errorListeners.add(cb);
        return () => {
            this.errorListeners.delete(cb);
        };
    }

    /**
     * Installs the dispatcher that serves host-initiated `request`
     * envelopes. Replacing the dispatcher mid-session is supported —
     * the most recent dispatcher wins for every subsequent inbound
     * frame. Setting to `undefined` (via `clearRequestDispatcher`)
     * makes the session reply `unknown_op` to every inbound request
     * until a dispatcher is installed again.
     */
    setRequestDispatcher(dispatcher: ClientRequestDispatcher): void {
        this.requestDispatcher = dispatcher;
    }

    /**
     * Removes the currently-installed request dispatcher. Used at
     * disposal time + when composition wants to deliberately reject
     * inbound RPCs while the session is otherwise alive (e.g. during
     * an auth-rotation gap). Idempotent.
     */
    clearRequestDispatcher(): void {
        this.requestDispatcher = undefined;
    }

    /**
     * Opens the WebSocket. Resolves when the socket reaches `open`,
     * rejects if it fails to open or closes before open. Idempotent:
     * any prior socket is closed first.
     */
    async connect(endpoint: RemoteEndpoint, tlsCertSha256?: string): Promise<void> {
        if (this.disposed) throw new Error('RemoteSession disposed');
        this.closeSocketOnly('idle');
        this.setState('connecting');

        const url = websocketUrl(endpoint);
        const pin = (tlsCertSha256 ?? '').trim();
        try {
            this.dispatcher =
                endpoint.tls && pin.length > 0 ? this.buildPinnedDispatcher(pin) : undefined;
            const socket =
                this.dispatcher !== undefined
                    ? new UndiciWebSocket(url, { dispatcher: this.dispatcher })
                    : new UndiciWebSocket(url);
            this.socket = socket;
            return await new Promise<void>((resolve, reject) => {
                this.connectAwaiter = { resolve, reject };
                socket.addEventListener('open', () => {
                    this.onOpen();
                });
                socket.addEventListener('message', (ev) => {
                    this.onMessage(ev as unknown as UndiciMessageEvent);
                });
                socket.addEventListener('close', (ev) => {
                    const ce = ev as unknown as UndiciCloseEvent;
                    this.onClose(ce.code, ce.reason);
                });
                socket.addEventListener('error', () => {
                    this.onSocketError();
                });
            });
        } catch (error) {
            this.setState('failed');
            await this.tearDownDispatcher();
            throw asError(error);
        }
    }

    /**
     * Sends an op envelope and awaits the matching response.
     * Resolves with the parsed RemoteResponse on `ok: true`. Throws
     * `RemoteOpError` with the host's `kind`/`detail` on `ok: false`.
     * Throws a generic Error if the socket closes before the response
     * arrives, or if no response arrives within the request timeout
     * (extended by `UPLOAD_MS_PER_KIB` for large frames).
     */
    async send(op: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
        if (this.disposed) throw new Error('RemoteSession disposed');
        const socket = this.socket;
        if (socket === undefined || this.state !== 'open') {
            throw new Error('Not connected');
        }
        const requestId = randomUUID();
        const envelope: RemoteOp = { op, request_id: requestId, params };
        const payload = JSON.stringify(envelope);

        // Single transport-frame guard (mirrors the host's kMaxWireFrameBytes).
        // Reject an oversized frame here with a clear, actionable message
        // instead of letting the WebSocket silently drop the connection —
        // the dominant cause is a too-large attachment payload.
        if (payload.length > MAX_WIRE_FRAME_BYTES) {
            const mib = (payload.length / (1024 * 1024)).toFixed(1);
            throw new Error(
                `Message too large to send (${mib} MiB; the wire limit is ` +
                    `${MAX_WIRE_FRAME_BYTES / (1024 * 1024)} MiB). ` +
                    `Remove or shrink attachments and try again.`,
            );
        }

        const response = await new Promise<RemoteResponse>((resolve, reject) => {
            const timer = setTimeout(
                () => {
                    if (!this.pending.delete(requestId)) return;
                    reject(new Error(`No reply from the host for ${op}. Check the connection.`));
                },
                this.requestTimeoutMs + Math.floor(payload.length / 1024) * UPLOAD_MS_PER_KIB,
            );
            timer.unref();
            this.pending.set(requestId, {
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (reason) => {
                    clearTimeout(timer);
                    reject(reason);
                },
                op,
            });
            try {
                socket.send(payload);
            } catch (error) {
                this.pending.get(requestId)?.reject(asError(error));
                this.pending.delete(requestId);
            }
        });
        if (!response.ok) {
            const err = response.error ?? { kind: 'unknown', detail: 'unspecified host error' };
            throw new RemoteOpError(err);
        }
        return response.data;
    }

    disconnect(): void {
        this.closeSocketOnly('idle');
        void this.tearDownDispatcher();
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.closeSocketOnly('idle');
        this.stateListeners.clear();
        this.eventListeners.clear();
        this.errorListeners.clear();
        this.requestDispatcher = undefined;
        await this.tearDownDispatcher();
    }

    pendingCount(): number {
        return this.pending.size;
    }

    // === internals ===

    private onOpen(): void {
        this.setState('open');
        const awaiter = this.connectAwaiter;
        this.connectAwaiter = undefined;
        awaiter?.resolve();
    }

    private onMessage(event: UndiciMessageEvent): void {
        const raw = event.data;
        if (typeof raw !== 'string') {
            this.emitError({ kind: 'malformed_frame', detail: 'Non-text frame' });
            return;
        }
        let frame: RemoteResponse | RemoteEvent | ClientRequest | undefined;
        try {
            frame = parseFrame(raw);
        } catch (error) {
            this.emitError({
                kind: 'malformed_frame',
                detail: asError(error).message,
            });
            return;
        }
        if (frame === undefined) {
            this.emitError({
                kind: 'malformed_frame',
                detail: 'Unknown frame type',
            });
            return;
        }
        switch (frame.type) {
            case 'response':
                this.dispatchResponse(frame);
                return;
            case 'event':
                this.dispatchEvent(frame);
                return;
            case 'request':
                this.onRequest(frame);
                return;
        }
    }

    private onRequest(request: ClientRequest): void {
        const dispatcher = this.requestDispatcher;
        if (dispatcher === undefined) {
            this.sendClientResponse(request.request_id, {
                ok: false,
                error: {
                    kind: 'unknown_op',
                    detail: 'no client RPC dispatcher configured',
                },
            });
            return;
        }
        // Fire-and-forget intentionally — the response is written
        // from inside the chained .then so a slow handler does not
        // block the inbound message loop.
        dispatcher(request).then(
            (result) => {
                this.sendClientResponse(request.request_id, result);
            },
            (error: unknown) => {
                // The dispatcher contract says it should not throw,
                // but a buggy dispatcher must not crash the session.
                const detail = asError(error).message;
                this.logger.warn('wire: request dispatcher threw', {
                    op: request.op,
                    requestId: request.request_id,
                    error: detail,
                });
                this.sendClientResponse(request.request_id, {
                    ok: false,
                    error: { kind: 'handler_error', detail },
                });
            },
        );
    }

    private sendClientResponse(requestId: string, result: RpcResult): void {
        const socket = this.socket;
        if (socket === undefined || this.state !== 'open') {
            this.logger.debug('wire: dropping client_response (socket closed)', {
                requestId,
            });
            return;
        }
        const envelope: ClientResponse = result.ok
            ? {
                  type: 'client_response',
                  request_id: requestId,
                  ok: true,
                  data: result.data,
              }
            : {
                  type: 'client_response',
                  request_id: requestId,
                  ok: false,
                  error: result.error,
              };
        try {
            socket.send(JSON.stringify(envelope));
        } catch (error) {
            this.logger.warn('wire: client_response send failed', {
                requestId,
                error: asError(error).message,
            });
        }
    }

    private dispatchResponse(response: RemoteResponse): void {
        const pending = this.pending.get(response.request_id);
        if (pending === undefined) {
            this.logger.warn('wire: response without pending request', {
                requestId: response.request_id,
            });
            return;
        }
        this.pending.delete(response.request_id);
        pending.resolve(response);
    }

    private dispatchEvent(event: RemoteEvent): void {
        if (event.event === 'error') {
            const error = parseEventError(event.data);
            this.emitError(error);
            return;
        }
        for (const cb of this.eventListeners) {
            try {
                cb(event);
            } catch (error) {
                this.logger.warn('wire: event listener threw', {
                    error: asError(error).message,
                });
            }
        }
    }

    private onClose(code: number, reason: string): void {
        this.failPendingWith(`socket closed (${code} ${reason})`);
        this.socket = undefined;
        const awaiter = this.connectAwaiter;
        this.connectAwaiter = undefined;
        this.setState('closed');
        awaiter?.reject(new Error(`WebSocket closed before open: ${code} ${reason}`));
        void this.tearDownDispatcher();
    }

    private onSocketError(): void {
        this.failPendingWith('socket failed');
        this.socket = undefined;
        const awaiter = this.connectAwaiter;
        this.connectAwaiter = undefined;
        this.setState('failed');
        this.emitError({ kind: 'connection_failed', detail: 'WebSocket connection failed' });
        awaiter?.reject(new Error('WebSocket connection failed'));
        void this.tearDownDispatcher();
    }

    private closeSocketOnly(nextState: ConnectionLifecycle): void {
        if (this.socket !== undefined) {
            try {
                this.socket.close(1000, 'Closing session');
            } catch {
                // ignore — socket may already be closed
            }
        }
        this.socket = undefined;
        this.failPendingWith('connection closed');
        this.setState(nextState);
    }

    private failPendingWith(reason: string): void {
        for (const [requestId, p] of this.pending) {
            p.reject(new Error(reason));
            this.pending.delete(requestId);
        }
    }

    private setState(next: ConnectionLifecycle): void {
        if (this.state === next) return;
        this.state = next;
        if (this.verboseState) {
            this.logger.info('wire: state', { state: next });
        } else {
            this.logger.debug('wire: state', { state: next });
        }
        for (const cb of this.stateListeners) {
            try {
                cb(next);
            } catch (error) {
                this.logger.warn('wire: state listener threw', {
                    error: asError(error).message,
                });
            }
        }
    }

    private emitError(error: RemoteError): void {
        for (const cb of this.errorListeners) {
            try {
                cb(error);
            } catch (innerError) {
                this.logger.warn('wire: error listener threw', {
                    error: asError(innerError).message,
                });
            }
        }
    }

    private buildPinnedDispatcher(pin: string): Dispatcher {
        // Both sides are colon-separated uppercase hex per
        // normaliseFingerprint() (HostConfig.ts) and Node's TLS layer
        // (cert.fingerprint256). Direct string compare is correct.
        const expected = pin.trim().toUpperCase();
        return new Agent({
            connect: {
                rejectUnauthorized: false,
                checkServerIdentity: (_host, cert) => {
                    const actual = cert.fingerprint256.toUpperCase();
                    if (actual !== expected) {
                        return new Error(
                            `TLS certificate fingerprint mismatch: expected ${expected}, got ${actual}`,
                        );
                    }
                    return undefined;
                },
            },
        });
    }

    private async tearDownDispatcher(): Promise<void> {
        if (this.dispatcher === undefined) return;
        try {
            await this.dispatcher.close();
        } catch (error) {
            this.logger.warn('wire: dispatcher close failed', {
                error: asError(error).message,
            });
        }
        this.dispatcher = undefined;
    }
}

function parseEventError(data: unknown): RemoteError {
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as { kind?: unknown; detail?: unknown };
        const kind = typeof obj.kind === 'string' ? obj.kind : 'unknown';
        const detail = typeof obj.detail === 'string' ? obj.detail : '';
        return { kind, detail };
    }
    return { kind: 'unknown', detail: '' };
}

function asError(value: unknown): Error {
    if (value instanceof Error) return value;
    return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}
