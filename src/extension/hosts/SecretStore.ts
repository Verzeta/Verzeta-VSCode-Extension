// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * SecretStore — wraps vscode.SecretStorage for the per-host bearer
 * token. Keys are namespaced under `verzeta.token.<hostId>` so
 * collisions with other extensions in the same SecretStorage are
 * impossible.
 *
 * VS Code's SecretStorage is OS-keychain-backed on every supported
 * platform. We do not use globalState / workspaceState for tokens
 * under any circumstances.
 */

import type * as vscode from 'vscode';
import type { Logger } from '../log/Logger.js';

const KEY_PREFIX = 'verzeta.token.';

export class SecretStore {
    private readonly secrets: vscode.SecretStorage;
    private readonly logger: Logger;

    constructor(secrets: vscode.SecretStorage, logger: Logger) {
        this.secrets = secrets;
        this.logger = logger;
    }

    /** Returns the stored token for a host, or undefined if absent. */
    async getToken(hostId: string): Promise<string | undefined> {
        try {
            return await this.secrets.get(this.keyFor(hostId));
        } catch (error) {
            this.logger.warn('SecretStore.getToken failed', {
                hostId,
                error: errorMessage(error),
            });
            return undefined;
        }
    }

    async setToken(hostId: string, token: string): Promise<void> {
        await this.secrets.store(this.keyFor(hostId), token);
        this.logger.info('token stored', { hostId });
    }

    async deleteToken(hostId: string): Promise<void> {
        try {
            await this.secrets.delete(this.keyFor(hostId));
            this.logger.info('token deleted', { hostId });
        } catch (error) {
            this.logger.warn('SecretStore.deleteToken failed', {
                hostId,
                error: errorMessage(error),
            });
        }
    }

    /** Returns true when a token exists for the host. */
    async hasToken(hostId: string): Promise<boolean> {
        const token = await this.getToken(hostId);
        return token !== undefined && token.length > 0;
    }

    private keyFor(hostId: string): string {
        return `${KEY_PREFIX}${hostId}`;
    }
}

function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}
