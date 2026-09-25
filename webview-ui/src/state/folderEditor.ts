// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Folder-editor mode signal. When the user taps a folder card on
 * ProjectRoomsLanding the landing sets `editingFolderId` and opens
 * the folder sheet. The sheet reads the signal on mount: if it's
 * `null`, the sheet renders in CREATE mode (matches Android `New
 * folder` header); otherwise it loads the existing folder's
 * metadata + members + heartbeats and renders in EDIT mode (Android
 * `Edit folder` header with all sections visible per
 * `FolderEditorSheet.kt:227-273` `initial != null` gate).
 *
 * Save flow:
 *   - CREATE → `folder.createRequested` (existing path).
 *   - EDIT   → `folder.updateRequested` (new path that chains
 *              folder.rename → folder.update_metadata →
 *              folder.members.set). Heartbeats / preferred skills /
 *              project documents are saved inline as the user edits
 *              them (no batched commit) — Android does the same.
 */

import { signal } from '@preact/signals';

export const editingFolderId = signal<string | null>(null);

export function setEditingFolderId(id: string | null): void {
    editingFolderId.value = id;
}
