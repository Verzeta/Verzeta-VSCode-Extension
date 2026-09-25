// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Webview-side counterpart of `src/extension/webview/MessageBus.ts`.
 * Wraps the VS Code-injected `acquireVsCodeApi()` global into a
 * typed sender + listener pair that uses the same discriminated
 * union the extension imports.
 *
 * `acquireVsCodeApi` may be called AT MOST ONCE per webview load —
 * this module memoises the returned object so any component that
 * needs to send a message reuses the singleton.
 */

import type {
    ExtensionToWebview,
    WebviewToExtension,
} from '../../../src/shared/webview-protocol.js';

interface VsCodeApi {
    postMessage(message: unknown): void;
}

declare global {
    interface Window {
        acquireVsCodeApi?: () => VsCodeApi;
    }
}

let cached: VsCodeApi | null = null;

function api(): VsCodeApi {
    if (cached !== null) return cached;
    const acquire = window.acquireVsCodeApi;
    if (acquire === undefined) {
        // Outside VS Code (e.g. unit tests or a stray browser load).
        cached = { postMessage: () => undefined };
        return cached;
    }
    cached = acquire();
    return cached;
}

/** Sends a typed message UP to the extension host. */
export function send(message: WebviewToExtension): void {
    api().postMessage(message);
}

export type ExtensionMessageHandler = (msg: ExtensionToWebview) => void;

/**
 * Subscribes to typed inbound messages from the extension host.
 * Returns a function that removes the listener.
 */
export function onMessage(handler: ExtensionMessageHandler): () => void {
    const listener = (event: MessageEvent): void => {
        const data = event.data as ExtensionToWebview | undefined;
        if (data === undefined || data === null || typeof data !== 'object') return;
        if (typeof (data as { type: unknown }).type !== 'string') return;
        handler(data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
}
