// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Pending-kickoff state — Android `PendingKickoff` + `pendingKickoff`
 * field on `MainUiState` (MainViewModel.kt:139, :281). Set after a
 * project is created (Quick Start or regular folder.create with
 * members), drives the KickoffSheet that asks "Start chatting with
 * your team?" with the 1:1 / group checkboxes.
 *
 * `null` => no kickoff pending, sheet is closed.
 */

import { signal } from '@preact/signals';

export interface PendingKickoff {
    readonly hostId: string;
    readonly folderId: string;
    readonly folderName: string;
    readonly memberCount: number;
}

export const pendingKickoff = signal<PendingKickoff | null>(null);

export function setPendingKickoff(info: PendingKickoff): void {
    pendingKickoff.value = info;
}

export function dismissPendingKickoff(): void {
    pendingKickoff.value = null;
}
