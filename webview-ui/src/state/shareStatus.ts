// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-conversation workspace-share status, fed by the extension's
 * `workspace.shareStatus.updated` envelope (pushed on conversation
 * switch and whenever mounts / workspace folders change). Drives the
 * in-chat banner that tells the user agents cannot see their files
 * and offers a one-click share.
 *
 * Dismissals are webview-session-local and per conversation — the
 * banner is meant to stay noticeable until the user acts on it or
 * explicitly closes it.
 */

import { computed, signal } from '@preact/signals';
import { activeConversationId } from './conversations.js';

export type ShareStatus = 'mounted' | 'unmounted' | 'mismatched' | 'none';

export interface ShareStatusEntry {
    readonly status: ShareStatus;
    readonly workspaceName: string;
}

const statuses = signal<ReadonlyMap<string, ShareStatusEntry>>(new Map());
const dismissed = signal<ReadonlySet<string>>(new Set());

export function setShareStatus(
    conversationId: string,
    status: ShareStatus,
    workspaceName: string,
): void {
    const next = new Map(statuses.value);
    next.set(conversationId, { status, workspaceName });
    statuses.value = next;
    // A fresh status revives a previously dismissed banner when the
    // situation changed (e.g. workspace switched after dismissal).
    if (status === 'mounted' && dismissed.value.has(conversationId)) {
        const nextDismissed = new Set(dismissed.value);
        nextDismissed.delete(conversationId);
        dismissed.value = nextDismissed;
    }
}

export function dismissShareBanner(conversationId: string): void {
    const next = new Set(dismissed.value);
    next.add(conversationId);
    dismissed.value = next;
}

/** Banner model for the active conversation; undefined = hidden. */
export const activeShareBanner = computed<ShareStatusEntry | undefined>(() => {
    const id = activeConversationId.value;
    if (id === undefined) return undefined;
    if (dismissed.value.has(id)) return undefined;
    const entry = statuses.value.get(id);
    if (entry === undefined) return undefined;
    if (entry.status === 'mounted' || entry.status === 'none') return undefined;
    return entry;
});
