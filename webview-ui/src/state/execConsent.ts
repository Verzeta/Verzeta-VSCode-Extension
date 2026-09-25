// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-conversation command-execution consent prompt. Fed by the
 * extension's `exec.consentSuggested` envelope, which fires when an
 * agent tried to run a command in a conversation whose execution mode
 * is Off. Drives the in-chat banner that offers to enable Ask / Allow —
 * the in-chat replacement for the old corner consent toast.
 *
 * Dismissals are webview-session-local and per conversation.
 */

import { computed, signal } from '@preact/signals';
import { activeConversationId } from './conversations.js';

export interface ExecConsentEntry {
    readonly commandPreview: string;
}

const suggestions = signal<ReadonlyMap<string, ExecConsentEntry>>(new Map());
const dismissed = signal<ReadonlySet<string>>(new Set());

/** Record (and revive) a consent suggestion for one conversation. */
export function setExecConsent(conversationId: string, commandPreview: string): void {
    const next = new Map(suggestions.value);
    next.set(conversationId, { commandPreview });
    suggestions.value = next;
    if (dismissed.value.has(conversationId)) {
        const nextDismissed = new Set(dismissed.value);
        nextDismissed.delete(conversationId);
        dismissed.value = nextDismissed;
    }
}

/** Hide the banner for a conversation (dismiss, or after enabling). */
export function clearExecConsent(conversationId: string): void {
    const next = new Set(dismissed.value);
    next.add(conversationId);
    dismissed.value = next;
}

/** Banner model for the active conversation; undefined = hidden. */
export const activeExecConsent = computed<ExecConsentEntry | undefined>(() => {
    const id = activeConversationId.value;
    if (id === undefined) return undefined;
    if (dismissed.value.has(id)) return undefined;
    return suggestions.value.get(id);
});
