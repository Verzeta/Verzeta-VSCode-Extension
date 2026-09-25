// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Chat-tab UI signals: settings sheet open/closed, folder-create
 * sheet open/closed.
 *
 * The Chat Settings sheet slides over the conversation detail
 * surface when the user clicks the cog in the chat header. The
 * sheet renders edits against the cached ConvSettingsUi and posts
 * each commit back through the typed bus.
 *
 * The Folder Create sheet slides over the conversation rail when
 * the user clicks "+ New folder". It collects name + type +
 * (optional) goal + description and posts a single
 * `folder.createRequested` envelope. The extension host stages the
 * follow-up `folder.update_metadata` call when the user picked a
 * non-default type so the persisted folder matches their intent.
 */

import { signal } from '@preact/signals';

export const chatSettingsSheetOpen = signal<boolean>(false);

export function openChatSettingsSheet(): void {
    chatSettingsSheetOpen.value = true;
}

export function closeChatSettingsSheet(): void {
    chatSettingsSheetOpen.value = false;
}

export const folderCreateSheetOpen = signal<boolean>(false);

export function openFolderCreateSheet(): void {
    folderCreateSheetOpen.value = true;
}

export function closeFolderCreateSheet(): void {
    folderCreateSheetOpen.value = false;
}

/**
 * Model-picker sheet visibility. Opens when the user clicks the
 * provider/model subtitle in ChatHeader, or the "Change" button in
 * ConversationSettingsSheet's Model section. Closes after a model
 * row is picked (the host echoes `models.active_changed` back).
 */
export const modelPickerSheetOpen = signal<boolean>(false);

export function openModelPickerSheet(): void {
    modelPickerSheetOpen.value = true;
}

export function closeModelPickerSheet(): void {
    modelPickerSheetOpen.value = false;
}

/**
 * Group-chat create sheet visibility. Opens via "+ New group chat"
 * in ChatNavRail; closes after the user presses Save (which fires
 * `group.createRequested` and the host's `conv.added` flows back).
 */
export const groupCreateSheetOpen = signal<boolean>(false);

export function openGroupCreateSheet(): void {
    groupCreateSheetOpen.value = true;
}

export function closeGroupCreateSheet(): void {
    groupCreateSheetOpen.value = false;
}

/**
 * Pending-delete signal shared by ChatNavRail (trash icons on
 * conversation rows + project headers) and DeleteConfirmModal
 * (the actual destructive-action confirmation surface). Set to
 * non-null to surface the modal; the modal clears it on either
 * action.
 *
 *   - kind 'conv'   -> conversation.deleteRequested
 *   - kind 'folder' -> folder.deleteRequested
 *
 * `label` is shown in the modal body so the user knows what they
 * are about to drop. `subtitle` carries an optional extra warning
 * (e.g. "This will also delete N conversations inside.").
 */
export interface PendingDelete {
    readonly kind: 'conv' | 'folder';
    readonly id: string;
    readonly label: string;
    readonly subtitle: string;
}

export const pendingDelete = signal<PendingDelete | null>(null);

export function requestDelete(pending: PendingDelete): void {
    pendingDelete.value = pending;
}

export function clearPendingDelete(): void {
    pendingDelete.value = null;
}
