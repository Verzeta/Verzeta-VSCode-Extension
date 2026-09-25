// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Pair and New Conversation: the two palette commands that started
 * out as placeholders here.
 *
 * - `verzeta.pair` re-pairs a host that is already configured, for
 *   example after its token was revoked. It asks for a new pair code,
 *   swaps the stored token and reconnects. The code exchange is the
 *   same one Add Host uses (`pairing.ts`).
 * - `verzeta.newConversation` creates a chat on the active host and
 *   opens it in the Verzeta view. The create-and-open sequence is the
 *   one the webview's New chat button runs, exposed by the view
 *   provider.
 *
 * `registerStub` stays available for a command that is declared before
 * its implementation lands.
 */

import * as vscode from 'vscode';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { HostStore } from '../hosts/HostStore.js';
import type { SecretStore } from '../hosts/SecretStore.js';
import type { Logger } from '../log/Logger.js';
import { showError, showInfo, showInfoWithActions } from '../ui/notifications.js';
import { PAIR_CODE_PROMPT, exchangePairCode, friendlyPairError } from './pairing.js';

export function registerStub(commandId: string, message: string): vscode.Disposable {
    return vscode.commands.registerCommand(commandId, async () => {
        await showInfo(message);
    });
}

export interface PairAndChatCommandDeps {
    readonly hostStore: HostStore;
    readonly secretStore: SecretStore;
    readonly connectionManager: ConnectionManager;
    readonly logger: Logger;
    /**
     * Creates a conversation on the active host and opens it. Provided
     * by the view provider so the command and the New chat button share
     * one sequence.
     */
    readonly newConversation: () => Promise<void>;
}

export function registerStubCommands(deps: PairAndChatCommandDeps): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('verzeta.pair', () => runPair(deps)),
        vscode.commands.registerCommand('verzeta.newConversation', () => deps.newConversation()),
    ];
}

async function runPair(deps: PairAndChatCommandDeps): Promise<void> {
    const hosts = deps.hostStore.list();
    if (hosts.length === 0) {
        const action = await showInfoWithActions('No hosts yet. Add one first.', 'Add Host');
        if (action === 'Add Host') await vscode.commands.executeCommand('verzeta.addHost');
        return;
    }

    // Hosts that need pairing are listed first.
    const items = hosts
        .map((h) => {
            const state = deps.connectionManager.stateOf(h.id);
            return {
                label: h.name,
                description: h.url,
                detail: state === 'unauthorized' ? 'Not paired' : state,
                hostId: h.id,
                needsPair: state === 'unauthorized',
            };
        })
        .sort((a, b) => Number(b.needsPair) - Number(a.needsPair));
    const pick =
        items.length === 1
            ? items[0]
            : await vscode.window.showQuickPick(items, {
                  title: 'Verzeta: Pair',
                  placeHolder: 'Pick the host to pair again',
                  ignoreFocusOut: true,
              });
    if (pick === undefined) return;
    const host = deps.hostStore.findById(pick.hostId);
    if (host === undefined) return;

    const code = await vscode.window.showInputBox({
        title: `Verzeta: Pair ${host.name}`,
        prompt: PAIR_CODE_PROMPT,
        placeHolder: '123456',
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim().length === 0 ? 'Pair code cannot be empty.' : undefined),
    });
    if (code === undefined) return;

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Pairing ${host.name}…`,
                cancellable: false,
            },
            async () => {
                const response = await exchangePairCode(
                    { url: host.url, tlsCertSha256: host.tlsCertSha256 },
                    code,
                    deps.logger,
                );
                // Drop the live connection that holds the old token, then
                // store the new one and connect with it.
                await deps.connectionManager.disconnect(host.id);
                await deps.secretStore.setToken(host.id, response.token);
            },
        );
    } catch (error) {
        deps.logger.warn('pair: failed', { hostId: host.id, error: errorText(error) });
        await showError(`Pairing failed: ${friendlyPairError(error)}`, deps.logger);
        return;
    }

    await showInfo(`Host "${host.name}" paired.`);
    try {
        await deps.connectionManager.connect(host.id);
    } catch (error) {
        deps.logger.warn('pair: post-pair connect failed', {
            hostId: host.id,
            error: errorText(error),
        });
    }
}

function errorText(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}
