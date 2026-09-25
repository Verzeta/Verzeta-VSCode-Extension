// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * HostStore — read/write surface for the persistent host list.
 *
 * Backed by `vscode.workspace.getConfiguration('verzeta').hosts`
 * which lives in the user's settings.json (or workspace settings).
 * Emits `changed` whenever the underlying configuration mutates,
 * regardless of whether the change came from this store or the
 * user editing settings.json by hand.
 *
 * Bearer tokens are NOT stored here. See SecretStore.
 */

import * as vscode from 'vscode';
import type { Disposable } from '../infra/disposables.js';
import { TypedEventEmitter } from '../infra/TypedEventEmitter.js';
import type { Logger } from '../log/Logger.js';
import {
    CONFIG_SECTION,
    SETTING,
    SETTING_DEFAULT,
    type PersistedHostConfig,
} from '../settings/ConfigurationSchema.js';
import { fromPersisted, toPersisted, type HostConfig } from './HostConfig.js';

interface HostStoreEvents extends Record<string, readonly unknown[]> {
    readonly changed: readonly [readonly HostConfig[]];
}

export class HostStore extends TypedEventEmitter<HostStoreEvents> implements Disposable {
    private readonly logger: Logger;
    private readonly subscription: vscode.Disposable;

    constructor(logger: Logger) {
        super();
        this.logger = logger;
        this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration(`${CONFIG_SECTION}.${SETTING.HOSTS}`) ||
                event.affectsConfiguration(`${CONFIG_SECTION}.${SETTING.DEFAULT_HOST_ID}`)
            ) {
                this.emit('changed', this.list());
            }
        });
    }

    /** Snapshot of the current host list. */
    list(): readonly HostConfig[] {
        const raw = vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<readonly PersistedHostConfig[]>(SETTING.HOSTS, [...SETTING_DEFAULT.hosts]);
        return raw.map(fromPersisted);
    }

    findById(id: string): HostConfig | undefined {
        return this.list().find((h) => h.id === id);
    }

    /** Append a host to the persisted list. Returns the new list. */
    async add(host: HostConfig): Promise<readonly HostConfig[]> {
        const current = this.list();
        const next = [...current, host];
        await this.writePersisted(next);
        this.logger.info('host added', { id: host.id, name: host.name });
        return next;
    }

    /** Update an existing host by id. Returns the new list. */
    async update(host: HostConfig): Promise<readonly HostConfig[]> {
        const current = this.list();
        const next = current.map((h) => (h.id === host.id ? host : h));
        await this.writePersisted(next);
        this.logger.info('host updated', { id: host.id, name: host.name });
        return next;
    }

    /** Remove a host by id. Returns the new list. */
    async remove(id: string): Promise<readonly HostConfig[]> {
        const current = this.list();
        const next = current.filter((h) => h.id !== id);
        await this.writePersisted(next);
        this.logger.info('host removed', { id });
        return next;
    }

    defaultHostId(): string {
        return vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<string>(SETTING.DEFAULT_HOST_ID, SETTING_DEFAULT.defaultHostId);
    }

    async setDefaultHostId(id: string): Promise<void> {
        await vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .update(SETTING.DEFAULT_HOST_ID, id, vscode.ConfigurationTarget.Global);
    }

    dispose(): void {
        this.subscription.dispose();
        this.removeAllListeners();
    }

    private async writePersisted(hosts: readonly HostConfig[]): Promise<void> {
        const payload = hosts.map(toPersisted);
        await vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .update(SETTING.HOSTS, payload, vscode.ConfigurationTarget.Global);
    }
}
