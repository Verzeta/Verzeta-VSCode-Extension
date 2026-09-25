// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Conversation signals — recent conversations per host, mirrored
 * from the extension's ConversationStore via the
 * `conversations.recent.updated` envelope.
 */

import { signal } from '@preact/signals';
import type {
    ConversationFullUi,
    FolderSummaryUi,
    RecentConversationUi,
} from '../../../src/shared/webview-protocol.js';
import type { MemberUi } from '../../../src/shared/wire-types.js';

const recentPerHost = signal<ReadonlyMap<string, readonly RecentConversationUi[]>>(new Map());
const fullPerHost = signal<ReadonlyMap<string, readonly ConversationFullUi[]>>(new Map());
const foldersPerHost = signal<ReadonlyMap<string, readonly FolderSummaryUi[]>>(new Map());
// Members per (hostId + folderId) — keyed `${hostId}::${folderId}`.
const membersPerFolder = signal<ReadonlyMap<string, readonly MemberUi[]>>(new Map());

/**
 * The active conversation id (across the whole webview). Set
 * optimistically when the user clicks a conversation row, reset when
 * the active host changes. Held as a signal so all chat-area subtrees
 * react automatically.
 */
export const activeConversationId = signal<string | undefined>(undefined);

export function setActiveConversationId(id: string | undefined): void {
    activeConversationId.value = id;
}

/** Returns recent conversations for the given host, newest first. */
export function recentConversationsFor(hostId: string): readonly RecentConversationUi[] {
    return recentPerHost.value.get(hostId) ?? [];
}

/** Returns the full conversation list for a host (unsorted). */
export function fullConversationsFor(hostId: string): readonly ConversationFullUi[] {
    return fullPerHost.value.get(hostId) ?? [];
}

/** Returns folders for a host. */
export function foldersFor(hostId: string): readonly FolderSummaryUi[] {
    return foldersPerHost.value.get(hostId) ?? [];
}

/** Replaces recent conversations for one host. */
export function setRecentConversations(
    hostId: string,
    conversations: readonly RecentConversationUi[],
): void {
    const next = new Map(recentPerHost.value);
    next.set(hostId, conversations);
    recentPerHost.value = next;
}

/** Replaces full conversations + folders for one host (one envelope). */
export function setFullConversations(
    hostId: string,
    conversations: readonly ConversationFullUi[],
    folders: readonly FolderSummaryUi[],
): void {
    const nextConvs = new Map(fullPerHost.value);
    nextConvs.set(hostId, conversations);
    fullPerHost.value = nextConvs;
    const nextFolders = new Map(foldersPerHost.value);
    nextFolders.set(hostId, folders);
    foldersPerHost.value = nextFolders;
}

function memberKey(hostId: string, folderId: string): string {
    return `${hostId}::${folderId}`;
}

/** Returns the cached member list for one folder. */
export function membersFor(hostId: string, folderId: string): readonly MemberUi[] {
    return membersPerFolder.value.get(memberKey(hostId, folderId)) ?? [];
}

/** Replaces the cached member list for one folder (one envelope). */
export function setFolderMembers(
    hostId: string,
    folderId: string,
    members: readonly MemberUi[],
): void {
    const next = new Map(membersPerFolder.value);
    next.set(memberKey(hostId, folderId), members);
    membersPerFolder.value = next;
}
