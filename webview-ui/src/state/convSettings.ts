// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-conversation settings cache for the Chat Settings sheet.
 *
 * Mirrors the Android `ConvSettingsUi` shape — system prompt,
 * generation knobs, model selection, plus host-global flags
 * (toolsEnabled / ragEnabled / agentPattern / requireConfirmation)
 * that the host inlines into conv.settings for convenience.
 */

import { computed, signal } from '@preact/signals';
import type { ConvSettingsUi } from '../../../src/shared/wire-types.js';
import { activeConversationId } from './conversations.js';

const settingsMap = signal<ReadonlyMap<string, ConvSettingsUi>>(new Map());

export function settingsFor(conversationId: string): ConvSettingsUi | undefined {
    return settingsMap.value.get(conversationId);
}

export function setConvSettings(conversationId: string, settings: ConvSettingsUi): void {
    const next = new Map(settingsMap.value);
    next.set(conversationId, settings);
    settingsMap.value = next;
}

export const activeConvSettings = computed<ConvSettingsUi | undefined>(() => {
    const id = activeConversationId.value;
    if (id === undefined) return undefined;
    return settingsMap.value.get(id);
});
