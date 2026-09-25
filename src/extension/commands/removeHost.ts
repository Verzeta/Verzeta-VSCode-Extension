// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * verzeta.removeHost — quick-pick over paired hosts; on confirm,
 * removes the host from settings and deletes its stored token.
 */

import * as vscode from 'vscode';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { HostStore } from '../hosts/HostStore.js';
import type { SecretStore } from '../hosts/SecretStore.js';
import type { Logger } from '../log/Logger.js';
import { showError, showInfo } from '../ui/notifications.js';

export interface RemoveHostDeps {
    readonly hostStore: HostStore;
    readonly secretStore: SecretStore;
    readonly connectionManager: ConnectionManager;
    readonly logger: Logger;
}

export function registerRemoveHost(deps: RemoveHostDeps): vscode.Disposable {
    return vscode.commands.registerCommand('verzeta.removeHost', () => runRemoveHost(deps));
}

async function runRemoveHost(deps: RemoveHostDeps): Promise<void> {
    const hosts = deps.hostStore.list();
    if (hosts.length === 0) {
        await showInfo('No hosts to remove.');
        return;
    }
    const pick = await vscode.window.showQuickPick(
        hosts.map((h) => ({
            label: h.name,
            description: h.url,
            detail: deps.connectionManager.stateOf(h.id),
            hostId: h.id,
        })),
        {
            title: 'Verzeta: Remove Host',
            placeHolder: 'Pick a host to remove',
            ignoreFocusOut: true,
            canPickMany: false,
        },
    );
    if (pick === undefined) return;

    const confirm = await vscode.window.showWarningMessage(
        `Remove host "${pick.label}" and delete its stored token?`,
        { modal: true },
        'Remove',
    );
    if (confirm !== 'Remove') return;

    try {
        await deps.connectionManager.disconnect(pick.hostId);
        await deps.secretStore.deleteToken(pick.hostId);
        await deps.hostStore.remove(pick.hostId);
        await showInfo(`Removed host "${pick.label}".`);
    } catch (error) {
        await showError(`Failed to remove host: ${errorText(error)}`, deps.logger);
    }
}

function errorText(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}
