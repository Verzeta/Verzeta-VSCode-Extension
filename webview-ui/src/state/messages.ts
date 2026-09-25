// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-conversation message state, signal-backed for fine-grained
 * reactivity during streaming.
 *
 * The store keeps a `Map<conversationId, signal<MessageRowUi[]>>`.
 * Each conversation's signal is a discrete reactive cell — switching
 * conversations does not re-render the whole app, and a streaming
 * delta mutates only the affected conversation's message array (and
 * inside that, Preact only re-renders the row whose content changed
 * because we key on message id).
 */

import { computed, signal, type Signal } from '@preact/signals';
import type { MessageRowUi } from '../../../src/shared/webview-protocol.js';
import { activeConversationId } from './conversations.js';

const perConversation = new Map<string, Signal<readonly MessageRowUi[]>>();

function ensureSignal(conversationId: string): Signal<readonly MessageRowUi[]> {
    let sig = perConversation.get(conversationId);
    if (sig === undefined) {
        sig = signal<readonly MessageRowUi[]>([]);
        perConversation.set(conversationId, sig);
    }
    return sig;
}

export function messagesFor(conversationId: string): Signal<readonly MessageRowUi[]> {
    return ensureSignal(conversationId);
}

export function setMessages(conversationId: string, messages: readonly MessageRowUi[]): void {
    // Preserve any pending synthetic thinking placeholder (id prefix
    // "thinking:") so the dots stay visible until the host's first
    // streaming event lands. Snapshot replaces canonical history but
    // not the locally-inserted thinking row.
    const sig = ensureSignal(conversationId);
    const pending = sig.value.filter((m) => m.id.startsWith('thinking:'));
    sig.value = pending.length === 0 ? messages : [...messages, ...pending];
}

/**
 * Insert a synthetic assistant placeholder so the user sees a
 * "typing" animation the moment they hit send. The placeholder has
 * id = "thinking:<ts>" so it's easy to identify + drop when the
 * real `message.streaming.started` event lands with the canonical
 * message id.
 */
export function insertThinkingPlaceholder(conversationId: string): string {
    const id = `thinking:${Date.now()}`;
    const sig = ensureSignal(conversationId);
    sig.value = [
        ...sig.value,
        {
            id,
            conversationId,
            role: 'assistant',
            content: '',
            thinkingContent: '',
            createdAt: Date.now(),
            modelUsed: '',
            tokenCount: 0,
            finishReason: '',
            agentId: undefined,
            memberAlias: undefined,
        },
    ];
    return id;
}

/** Remove every thinking placeholder for a conversation. */
export function clearThinkingPlaceholders(conversationId: string): void {
    const sig = ensureSignal(conversationId);
    const filtered = sig.value.filter((m) => !m.id.startsWith('thinking:'));
    if (filtered.length !== sig.value.length) {
        sig.value = filtered;
    }
}

/**
 * Remove thinking placeholders across ALL conversations. Used on a send
 * failure: the send never reached the host, so no snapshot or delta will
 * arrive to clear the synthetic typing-dots row, and the only in-flight
 * send (the composer's send flag is global) may have targeted any
 * conversation. Idempotent.
 */
export function clearAllThinkingPlaceholders(): void {
    for (const conversationId of perConversation.keys()) {
        clearThinkingPlaceholders(conversationId);
    }
}

/**
 * Apply a streaming delta. If the message id is unknown, push it as a
 * new row (covers `message.streaming.started` racing the delta).
 */
export function applyDelta(
    conversationId: string,
    messageId: string,
    content: string,
    thinkingContent: string,
): void {
    const sig = ensureSignal(conversationId);
    const current = sig.value;
    const idx = current.findIndex((m) => m.id === messageId);
    if (idx === -1) {
        sig.value = [
            ...current,
            {
                id: messageId,
                conversationId,
                role: 'assistant',
                content,
                thinkingContent,
                createdAt: 0,
                modelUsed: '',
                tokenCount: 0,
                finishReason: '',
                agentId: undefined,
                memberAlias: undefined,
            },
        ];
        return;
    }
    const next = current.slice();
    const existing = next[idx];
    if (existing === undefined) return;
    next[idx] = { ...existing, content, thinkingContent };
    sig.value = next;
}

export const activeMessages = computed<readonly MessageRowUi[]>(() => {
    const id = activeConversationId.value;
    if (id === undefined) return [];
    return ensureSignal(id).value;
});
