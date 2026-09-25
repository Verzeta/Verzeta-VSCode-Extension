// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Wire envelope shapes — the request / response / event envelopes
 * carried over the WebSocket between the extension and the paired
 * Verzeta Studio host.
 *
 * Mirrors `Verzeta-Android/app/src/main/kotlin/com/verzeta/android/
 * protocol/RemoteModels.kt`. Field names use the on-wire snake_case
 * form for request_id / client_id / last_seen_at / time_ms so the
 * wire JSON shape is the literal interface.
 *
 * Used by the extension-host wire layer (`src/extension/wire/`); not
 * imported by the webview bundle (the webview never sees raw wire
 * frames — it speaks the typed bus protocol in `webview-protocol.ts`).
 */

/**
 * Client-to-host operation envelope. Every op carries a client-
 * generated `request_id` so the session can match the response.
 */
export interface RemoteOp {
    readonly op: string;
    readonly request_id: string;
    readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Host-to-client response envelope. `data` and `error` are
 * mutually exclusive — `ok: true` implies `data`, `ok: false`
 * implies `error`.
 */
export interface RemoteResponse {
    readonly type: 'response';
    readonly request_id: string;
    readonly ok: boolean;
    readonly data?: unknown;
    readonly error?: RemoteError | undefined;
}

/**
 * Host-to-client event envelope. Events are unsolicited.
 * The `event` field carries the event name (e.g. `conv.added`,
 * `message.streaming.delta`) and `data` carries the payload.
 */
export interface RemoteEvent {
    readonly type: 'event';
    readonly event: string;
    readonly data?: unknown | undefined;
}

/**
 * Sanitised host error. `kind` is the stable machine-readable tag,
 * `detail` a human-readable explanation.
 */
export interface RemoteError {
    readonly kind: string;
    readonly detail: string;
}

/**
 * Host-to-client request envelope. The host initiates an RPC the
 * paired client must serve, keyed on `request_id`. The client answers
 * with a matching `ClientResponse` carrying the same id.
 *
 * Transport substrate for client-served operations (host plan 53
 * `vfs.*` family and any future host→client surface). The agent
 * tool surface is unchanged — these envelopes are internal wire
 * plumbing between the host and a paired client, never visible to
 * the LLM.
 */
export interface ClientRequest {
    readonly type: 'request';
    readonly request_id: string;
    readonly op: string;
    readonly args?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Client-to-host reply to a `ClientRequest`. `data` and `error` are
 * mutually exclusive on `ok` — `ok: true` implies `data`, `ok: false`
 * implies `error`. Mirrors `RemoteResponse` so handler bodies can
 * return the same discriminated shape uniformly.
 */
export interface ClientResponse {
    readonly type: 'client_response';
    readonly request_id: string;
    readonly ok: boolean;
    readonly data?: unknown;
    readonly error?: RemoteError | undefined;
}

/**
 * Response payload for `auth.pair`. The host has accepted the pair
 * code and minted a long-lived bearer token for this client.
 */
export interface PairResponse {
    readonly token: string;
    readonly client_id: string;
    readonly name: string;
}

/**
 * Response payload for `auth.token`. Echo of the client's identity
 * after the stored bearer token has been validated.
 */
export interface TokenAuthResponse {
    readonly client_id: string;
    readonly name: string;
    readonly last_seen_at?: number | undefined;
}

/**
 * Response payload for `auth.me`. Identical shape to
 * `TokenAuthResponse`; the op is a sanity-check after a long
 * idle / suspend.
 */
export interface AuthMeResponse {
    readonly client_id: string;
    readonly name: string;
    readonly last_seen_at?: number | undefined;
}

/**
 * Response payload for the `ping` op. The host echoes its current
 * monotonic-ish timestamp in milliseconds.
 */
export interface PingResponse {
    readonly time_ms: number;
}
