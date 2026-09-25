// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * convSettingsMerge: overlays the values a client just wrote onto the
 * settings it read back.
 *
 * Several host setters (`conv.settings.save`, `agent.pattern.set`,
 * `conv.primary_agent.set`, `agent.require_confirmation.set`,
 * `tools.enabled.set`) queue the write and reply at once. A read issued
 * right after can still see the old values, so the settings the webview
 * shows are the read-back values with the written ones on top.
 */

import type { ConvSettingsUi } from '../../shared/wire-types.js';

/**
 * Return `settings` with every defined field of `written` applied.
 *
 * @param settings the settings read back from the host.
 * @param written the fields this client just wrote.
 * @returns a new settings object; neither input is changed.
 */
export function overlayWrittenSettings(
    settings: ConvSettingsUi,
    written: Partial<ConvSettingsUi>,
): ConvSettingsUi {
    const defined = Object.fromEntries(
        Object.entries(written).filter(([, value]) => value !== undefined),
    ) as Partial<ConvSettingsUi>;
    return { ...settings, ...defined };
}
