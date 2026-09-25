// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * htmlShell — generates the HTML the WebviewViewProvider hands
 * back from resolveWebviewView. The shell is intentionally small
 * (~30 lines of body content) and matches the canonical Codex
 * pattern: a startup placeholder visible until the Preact bundle
 * mounts the real app into `#root`.
 *
 * The Content-Security-Policy is restrictive by default:
 *   - `default-src 'none'` — nothing loads unless explicitly allowed
 *   - `script-src` allows the nonce'd entry only
 *   - `style-src` allows the nonce'd entry plus VS Code's injected
 *     theme stylesheet (`unsafe-inline` is required by VS Code for
 *     the theme variables; alternatives would block the theming).
 *   - `img-src` permits VS Code's resource scheme so future tab
 *     icons sourced from the extension's `resources/` directory
 *     load without modification.
 *   - `connect-src` is empty — the webview never talks to anything
 *     other than the extension host via postMessage.
 */

import type * as vscode from 'vscode';

/**
 * Cryptographically-random nonce used in CSP + script tag. New on
 * every resolveWebviewView call so a forced page reload re-generates
 * a fresh nonce — defence in depth against any cached state.
 */
export function generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface HtmlShellOptions {
    readonly webview: vscode.Webview;
    readonly extensionUri: vscode.Uri;
    readonly nonce: string;
}

export function buildHtmlShell(opts: HtmlShellOptions): string {
    const { webview, extensionUri, nonce } = opts;
    const scriptUri = webview.asWebviewUri(joinUri(extensionUri, ['dist', 'webview', 'index.js']));
    const styleUri = webview.asWebviewUri(joinUri(extensionUri, ['dist', 'webview', 'index.css']));
    const csp = [
        `default-src 'none'`,
        `img-src ${webview.cspSource} data:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
        `font-src ${webview.cspSource}`,
        `connect-src 'none'`,
    ].join('; ');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verzeta</title>
<link rel="stylesheet" href="${styleUri.toString()}">
<style>
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: var(--vscode-sideBar-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    #root { height: 100%; width: 100%; }
    .verzeta-boot { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--vscode-descriptionForeground); font-size: 12px; }
</style>
</head>
<body>
<div id="root"><div class="verzeta-boot">Loading Verzeta…</div></div>
<script type="module" nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

/**
 * Lightweight helper to construct a child Uri without pulling in
 * vscode.Uri.joinPath (which exists, but importing vscode.Uri only
 * for this would expand the module's API surface unnecessarily).
 */
function joinUri(base: vscode.Uri, segments: readonly string[]): vscode.Uri {
    return base.with({ path: [base.path, ...segments].join('/').replace(/\/+/g, '/') });
}
