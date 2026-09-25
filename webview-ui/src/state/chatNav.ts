// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Chat-tab navigation state — search query, section collapse, and
 * project-folder expansion. All transient + webview-local; never
 * synced to the extension host (no persistent intent to capture).
 */

import { signal } from '@preact/signals';

export type SectionId = 'pinned' | 'projects' | 'groups' | 'directs' | 'plain';

export const searchQuery = signal<string>('');
export const collapsedSections = signal<ReadonlySet<SectionId>>(new Set());
export const expandedFolderIds = signal<ReadonlySet<string>>(new Set());

export function toggleSection(id: SectionId): void {
    const next = new Set(collapsedSections.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedSections.value = next;
}

export function toggleFolder(folderId: string): void {
    const next = new Set(expandedFolderIds.value);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    expandedFolderIds.value = next;
}

/** Mark a folder as expanded (no-op when already expanded). Used by
 *  the Project Rooms landing folder cards so tapping one lands the
 *  user on the rail with the folder already opened up to show its
 *  members and the "Start group chat with all" action row. */
export function expandFolder(folderId: string): void {
    const current = expandedFolderIds.value;
    if (current.has(folderId)) return;
    const next = new Set(current);
    next.add(folderId);
    expandedFolderIds.value = next;
}

export function setSearchQuery(query: string): void {
    if (searchQuery.value !== query) searchQuery.value = query;
}
