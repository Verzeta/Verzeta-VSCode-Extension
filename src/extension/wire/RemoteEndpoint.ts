// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * RemoteEndpoint — parsed view of the WebSocket URL the user paired
 * against. Mirrors the Android client's RemoteEndpoint exactly: a
 * `{ host, port, tls }` triple plus a `websocketUrl()` helper that
 * always anchors the path at `/ws` (the host's wire-session entry).
 *
 * The parser accepts ws:// and wss:// (loopback and TLS); rejects
 * any other scheme; tolerates the path being absent OR `/ws` and
 * rejects everything else (the host plan exposes exactly one path).
 */

export interface RemoteEndpoint {
    readonly host: string;
    readonly port: number;
    readonly tls: boolean;
}

/**
 * Builds the canonical `ws[s]://host:port/ws` URL the WebSocket
 * client should open. Mirrors `RemoteEndpoint.websocketUrl()` in
 * the Kotlin client.
 */
export function websocketUrl(endpoint: RemoteEndpoint): string {
    const scheme = endpoint.tls ? 'wss' : 'ws';
    return `${scheme}://${endpoint.host.trim()}:${endpoint.port}/ws`;
}

/**
 * Parses a user-entered endpoint string into a typed RemoteEndpoint.
 * Throws `Error` on every failure mode the user could plausibly hit
 * — caller is expected to surface the message to the UI verbatim.
 */
export function parseEndpoint(raw: string): RemoteEndpoint {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        throw new Error('Endpoint cannot be empty.');
    }
    // Pre-validate the port substring before URL construction — Node's
    // URL constructor rejects out-of-range ports (e.g. 99999) with a
    // generic ERR_INVALID_URL, which would hide the real cause from
    // the user and the addHost UX. Extract and check it explicitly so
    // we can produce a port-specific error.
    const explicitPort = /:\/\/[^/]+:(\d+)/.exec(trimmed);
    if (explicitPort !== null) {
        const portNum = Number.parseInt(explicitPort[1] ?? '', 10);
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
            throw new Error('Endpoint port must be between 1 and 65535.');
        }
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error('Endpoint is not a valid URL.');
    }
    const scheme = parsed.protocol.replace(/:$/, '');
    let tls: boolean;
    if (scheme === 'ws') {
        tls = false;
    } else if (scheme === 'wss') {
        tls = true;
    } else {
        throw new Error('Endpoint must start with ws:// or wss://');
    }
    if (parsed.hostname.length === 0) {
        throw new Error('Endpoint is missing a hostname.');
    }
    const port = parsed.port.length > 0 ? Number.parseInt(parsed.port, 10) : tls ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Endpoint port must be between 1 and 65535.');
    }
    const path = parsed.pathname;
    if (path.length > 0 && path !== '/' && path !== '/ws') {
        throw new Error('Endpoint path must be /ws.');
    }
    return { host: parsed.hostname, port, tls };
}
