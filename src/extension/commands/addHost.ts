// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * verzeta.addHost — multi-step input box chain that walks the
 * user through pairing a new Verzeta Studio host.
 *
 * Real wire pair: `exchangePairCode` opens a one-shot connection and
 * trades the code for a bearer token (shared with the Pair command).
 * This command then stores the token via SecretStorage, persists the
 * host config, and hands control to ConnectionManager, which opens the
 * persistent connection.
 *
 * TLS pin policy:
 *   - ws://   — no TLS layer, no pin asked.
 *   - wss:// + user supplies pin — pin pre-validated; pinned
 *               trust at connect time.
 *   - wss:// + user leaves pin blank — system CA trust applies
 *               (works for Let's-Encrypt / corporate-CA hosts).
 *               Self-signed hosts in this mode fail the TLS
 *               handshake; user has to re-Add Host with a pin.
 */

import * as vscode from 'vscode';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import { makeHostConfig, normaliseFingerprint, requiresTls } from '../hosts/HostConfig.js';
import type { HostStore } from '../hosts/HostStore.js';
import type { SecretStore } from '../hosts/SecretStore.js';
import type { Logger } from '../log/Logger.js';
import { showError, showInfo } from '../ui/notifications.js';
import { parseEndpoint } from '../wire/RemoteEndpoint.js';
import { PAIR_CODE_PROMPT, exchangePairCode, friendlyPairError } from './pairing.js';

export interface AddHostDeps {
    readonly hostStore: HostStore;
    readonly secretStore: SecretStore;
    readonly connectionManager: ConnectionManager;
    readonly logger: Logger;
}

export function registerAddHost(deps: AddHostDeps): vscode.Disposable {
    return vscode.commands.registerCommand('verzeta.addHost', () => runAddHost(deps));
}

async function runAddHost(deps: AddHostDeps): Promise<void> {
    const name = await vscode.window.showInputBox({
        title: 'Verzeta: Add Host (1/4)',
        prompt: 'A name for this host (any label that helps you recognise it).',
        placeHolder: 'home-server',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim().length === 0 ? 'Name cannot be empty.' : undefined),
    });
    if (name === undefined) return;

    const url = await vscode.window.showInputBox({
        title: 'Verzeta: Add Host (2/4)',
        prompt: 'WebSocket URL of your Verzeta Studio host.',
        placeHolder: 'ws://localhost:9180/  or  wss://server.example.com:9180/',
        value: 'ws://localhost:9180/',
        ignoreFocusOut: true,
        validateInput: validateUrl,
    });
    if (url === undefined) return;

    let fingerprint = '';
    const needsPinPrompt = requiresTls(url);
    if (needsPinPrompt) {
        const raw = await vscode.window.showInputBox({
            title: 'Verzeta: Add Host (3/4), TLS Pin (optional)',
            prompt:
                "Paste the SHA-256 fingerprint of the host's TLS certificate to pin it, or leave blank to use " +
                'system CA trust. Get the fingerprint with: ' +
                'openssl x509 -in cert.pem -fingerprint -sha256 -noout',
            placeHolder: 'AB:CD:EF:01:23:...  (or blank for system trust)',
            ignoreFocusOut: true,
            validateInput: (v) => {
                const trimmed = v.trim();
                if (trimmed.length === 0) return undefined;
                const hex = trimmed.replace(/[^0-9a-fA-F]/g, '');
                if (hex.length < 64) {
                    return 'A SHA-256 fingerprint is 64 hex characters (32 bytes). Leave blank to skip pinning.';
                }
                return undefined;
            },
        });
        if (raw === undefined) return;
        fingerprint = raw.trim().length > 0 ? normaliseFingerprint(raw) : '';
    }

    const stepNumber = needsPinPrompt ? '(4/4)' : '(3/3)';
    const pairCode = await vscode.window.showInputBox({
        title: `Verzeta: Add Host ${stepNumber}`,
        prompt: PAIR_CODE_PROMPT,
        placeHolder: '123456',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim().length === 0 ? 'Pair code cannot be empty.' : undefined),
    });
    if (pairCode === undefined) return;

    try {
        parseEndpoint(url);
    } catch (error) {
        await showError(`Could not parse the host URL: ${errorText(error)}`, deps.logger);
        return;
    }

    let host: ReturnType<typeof makeHostConfig> | undefined;
    let savedHostInStore = false;
    let savedTokenInStore = false;
    let paired = false;

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Pairing ${name.trim()}…`,
                cancellable: false,
            },
            async () => {
                // The one-shot pair session is closed inside the exchange,
                // before the persistent connection opens below. Racing the
                // two sockets makes many hosts drop the persistent one.
                const response = await exchangePairCode(
                    { url: url.trim(), tlsCertSha256: fingerprint },
                    pairCode,
                    deps.logger,
                );

                host = makeHostConfig({
                    name: name.trim(),
                    url: url.trim(),
                    tlsCertSha256: fingerprint,
                });
                await deps.hostStore.add(host);
                savedHostInStore = true;
                await deps.secretStore.setToken(host.id, response.token);
                savedTokenInStore = true;
                if (deps.hostStore.list().length === 1) {
                    await deps.hostStore.setDefaultHostId(host.id);
                }
                paired = true;
            },
        );
    } catch (error) {
        deps.logger.warn('addHost: pair failed', { error: errorText(error) });
        await showError(`Pairing failed: ${friendlyPairError(error)}`, deps.logger);
        if (host !== undefined && savedTokenInStore) {
            await deps.secretStore.deleteToken(host.id);
        }
        if (host !== undefined && savedHostInStore) {
            await deps.hostStore.remove(host.id);
        }
        return;
    }

    if (!paired || host === undefined) {
        await showError('Internal error: the host record was lost during pairing.', deps.logger);
        return;
    }

    await showInfo(`Host "${host.name}" paired.`);
    deps.logger.info('addHost: pair complete, opening persistent connection', {
        hostId: host.id,
    });

    // Await the persistent connect so a failure surfaces in logs and
    // doesn't drop on the floor as it did with the prior fire-and-forget
    // `void` call. ConnectionManager.connect emits stateChanged at each
    // FSM transition; the webview reflects those automatically.
    try {
        await deps.connectionManager.connect(host.id);
    } catch (error) {
        deps.logger.warn('addHost: post-pair connect failed', {
            hostId: host.id,
            error: errorText(error),
        });
    }
}

function validateUrl(raw: string): string | undefined {
    const v = raw.trim();
    if (v.length === 0) return 'URL cannot be empty.';
    const lower = v.toLowerCase();
    if (!lower.startsWith('ws://') && !lower.startsWith('wss://')) {
        return 'URL must start with ws:// or wss://';
    }
    try {
        const u = new URL(v);
        if (u.hostname.length === 0) return 'URL is missing a hostname.';
    } catch {
        return 'URL is not valid.';
    }
    return undefined;
}

function errorText(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}
