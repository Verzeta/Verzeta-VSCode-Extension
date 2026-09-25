// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-conversation context-window fill percentage, fed by the
 * extension's `chat.contextFill.updated` envelope (which mirrors the
 * host's `chat.context_fill.changed` wire event). Drives the gauge
 * chip beside the composer send button.
 *
 * Absent entry = the host has not measured that conversation yet
 * this session — the chip stays hidden instead of showing a fake 0%.
 */

import { computed, signal } from '@preact/signals';
import { activeConversationId } from './conversations.js';

const fillPercents = signal<ReadonlyMap<string, number>>(new Map());

export function setContextFill(conversationId: string, percent: number): void {
    const next = new Map(fillPercents.value);
    next.set(conversationId, percent);
    fillPercents.value = next;
}

/** Fill percent for the active conversation, or undefined when unmeasured. */
export const activeContextFill = computed<number | undefined>(() => {
    const id = activeConversationId.value;
    if (id === undefined) return undefined;
    return fillPercents.value.get(id);
});
