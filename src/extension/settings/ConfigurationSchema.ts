// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ConfigurationSchema — typed view of the `contributes.configuration`
 * declared in package.json. Single source of truth for setting keys,
 * value types, and defaults. Read by hosts/HostStore and other
 * consumers via `vscode.workspace.getConfiguration('verzeta')`.
 *
 * Keep this file in sync with `package.json`'s `contributes.configuration.properties`.
 * If they ever drift, the lint step that compares them (added later)
 * fails the build.
 */

import type { LogLevel } from '../log/Logger.js';

/** The fully-qualified VS Code configuration section name. */
export const CONFIG_SECTION = 'verzeta';

/** Setting keys exposed to users via VS Code's settings UI. */
export const SETTING = {
    HOSTS: 'hosts',
    DEFAULT_HOST_ID: 'defaultHostId',
    CONNECT_ON_STARTUP: 'connectOnStartup',
    RECONNECT_BACKOFF_MS: 'reconnect.backoffMs',
    LOG_LEVEL: 'log.level',
    INITIAL_TAB: 'initialTab',
    CODE_LENS_ENABLED: 'codeLens.enabled',
} as const;

/**
 * Persisted shape of one paired host in the `verzeta.hosts` array.
 * Mirrors the inline JSON schema in package.json.
 */
export interface PersistedHostConfig {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly tlsCertSha256?: string;
}

/** Defaults — used when a setting is absent. */
export const SETTING_DEFAULT = {
    hosts: [] as readonly PersistedHostConfig[],
    defaultHostId: '',
    connectOnStartup: true,
    reconnectBackoffMs: 5000,
    logLevel: 'info' as LogLevel,
    initialTab: 'home' as 'home' | 'chat' | 'settings',
    codeLensEnabled: false,
} as const;

export const RECONNECT_BACKOFF_MIN_MS = 1000;
export const RECONNECT_BACKOFF_MAX_MS = 60000;

/** Context keys consumed by `when` clauses in `contributes.menus`. */
export const CONTEXT_KEY = {
    CONNECTED: 'verzeta.connected',
} as const;
