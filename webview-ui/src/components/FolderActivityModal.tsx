// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * FolderActivityModal — project-scope audit log surface, the
 * extension's port of Android `FolderEditorSheet`'s "View Activity
 * Log" button. Fetches via `activity.for_project` (already wired in
 * WebviewSync) and renders each event with kind chip + description
 * + actor + relative timestamp. Reachable only from the folder
 * editor; closes on backdrop click or back button.
 */

import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { ActivityEventUi } from '../../../src/shared/wire-types.js';
import { activeHostId } from '../state/hosts.js';
import { activityFor } from '../state/chatOverlays.js';
import { send } from '../lib/bus.js';

export const folderActivityFolderId = signal<string | null>(null);

export function openFolderActivity(folderId: string): void {
    folderActivityFolderId.value = folderId;
}

export function closeFolderActivity(): void {
    folderActivityFolderId.value = null;
}

export function FolderActivityModal() {
    const folderId = folderActivityFolderId.value;
    if (folderId === null) return null;
    const hostId = activeHostId.value;
    if (hostId === undefined) {
        closeFolderActivity();
        return null;
    }
    const events = activityFor(hostId, 'project', folderId);

    useEffect(() => {
        send({
            type: 'activity.requested',
            hostId,
            scopeKind: 'project',
            scopeId: folderId,
        });
    }, [hostId, folderId]);

    return (
        <div
            class="verzeta-prooms-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Project activity log"
        >
            <header class="verzeta-prooms__header">
                <button
                    type="button"
                    class="verzeta-prooms__back"
                    onClick={closeFolderActivity}
                    aria-label="Back"
                >
                    ‹
                </button>
                <h1 class="verzeta-prooms__title">Activity log</h1>
            </header>
            <div class="verzeta-prooms__crumb">
                <span>PROJECT</span>
                <span aria-hidden="true">·</span>
                <span>ACTIVITY</span>
            </div>
            <div class="verzeta-prooms__scroll">
                {events.length === 0 ? (
                    <p class="verzeta-prooms__empty">
                        No activity yet. Plan events, tool calls, heartbeat runs, and membership
                        changes will appear here as the project runs.
                    </p>
                ) : (
                    <ul class="verzeta-overlay__list" role="list">
                        {events.map((e) => (
                            <li key={e.id} class="verzeta-overlay__card">
                                <ActivityCard event={e} />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function ActivityCard({ event }: { readonly event: ActivityEventUi }) {
    const when =
        event.createdAt > 0
            ? new Date(
                  event.createdAt < 1e11 ? event.createdAt * 1000 : event.createdAt,
              ).toLocaleString()
            : '';
    return (
        <div class="verzeta-overlay__cardHead">
            <div class="verzeta-overlay__cardBody">
                <span class="verzeta-overlay__cardTitle">
                    <span class="verzeta-overlay__kindChip">{event.kind}</span>
                    {event.description}
                </span>
                <span class="verzeta-overlay__cardMeta">
                    {event.actorAlias.length > 0 ? `@${event.actorAlias}` : 'system'}
                    {when.length > 0 ? ` · ${when}` : ''}
                </span>
            </div>
        </div>
    );
}
