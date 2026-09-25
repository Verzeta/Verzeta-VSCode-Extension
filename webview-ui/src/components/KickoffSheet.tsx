// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * KickoffSheet — "Start chatting with your team?" bottom sheet that
 * appears after a project is created (Quick Start or regular folder
 * create with members). Mirrors Android `KickoffSheet`
 * (Verzeta-Android/app/.../ui/folders/KickoffSheet.kt).
 *
 * Two checkboxes:
 *  - "Create a 1:1 conversation with each member"
 *  - "Start a group chat with all members" (disabled if memberCount < 2)
 *
 * Default state: both checked when memberCount >= 2 (mirrors Android
 * line 109 default state). The host owns the actual chat creation —
 * we just fire `folder.kickoff.individualRequested` and / or
 * `folder.kickoff.groupRequested` based on the user's picks.
 *
 * "Not now" dismisses the sheet without firing anything. The user
 * can still create chats manually from the project rail at any time.
 */

import { useState } from 'preact/hooks';
import { closeQuickStart } from '../state/projectQuickStart.js';
import { projectRoomsLandingOpen } from '../state/projectRoomsUi.js';
import { dismissPendingKickoff, pendingKickoff } from '../state/pendingKickoff.js';
import { send } from '../lib/bus.js';

export function KickoffSheet() {
    const info = pendingKickoff.value;
    if (info === null) return null;

    const memberCount = info.memberCount;
    const groupEnabled = memberCount >= 2;
    const [individual, setIndividual] = useState<boolean>(true);
    const [group, setGroup] = useState<boolean>(groupEnabled);

    const dismiss = (): void => {
        dismissPendingKickoff();
        // The Quick Start sheet (if it was the trigger) and the
        // Project Rooms landing modal both close here so the user
        // lands back on whatever tab they were on (typically Chat,
        // where the new project is now visible in the rail).
        closeQuickStart();
        projectRoomsLandingOpen.value = false;
    };

    const onStart = (): void => {
        if (individual) {
            send({
                type: 'folder.kickoff.individualRequested',
                hostId: info.hostId,
                folderId: info.folderId,
            });
        }
        if (group && groupEnabled) {
            send({
                type: 'folder.kickoff.groupRequested',
                hostId: info.hostId,
                folderId: info.folderId,
            });
        }
        dismiss();
    };

    const memberLabel = memberCount === 1 ? '1 member' : `${memberCount} members`;
    const folderLabel = info.folderName.length > 0 ? info.folderName : 'this project';

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Start chatting with your team"
            onClick={(e) => {
                if (e.target === e.currentTarget) dismiss();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">Start chatting with your team?</h3>
                </header>
                <div class="verzeta-addmember__body">
                    <p>
                        <strong>{folderLabel}</strong> is ready with {memberLabel}. Pick how you
                        want the first conversations to look.
                    </p>
                    <label class="verzeta-kickoff__row">
                        <input
                            type="checkbox"
                            checked={individual}
                            onChange={(e) => setIndividual((e.target as HTMLInputElement).checked)}
                        />
                        <span class="verzeta-kickoff__rowMain">
                            <span class="verzeta-kickoff__rowTitle">
                                Create a 1:1 conversation with each member
                            </span>
                            <span class="verzeta-kickoff__rowHint">
                                {memberCount} direct chat{memberCount === 1 ? '' : 's'}, one per
                                teammate.
                            </span>
                        </span>
                    </label>
                    <label
                        class={
                            groupEnabled
                                ? 'verzeta-kickoff__row'
                                : 'verzeta-kickoff__row verzeta-kickoff__row--disabled'
                        }
                    >
                        <input
                            type="checkbox"
                            checked={group && groupEnabled}
                            disabled={!groupEnabled}
                            onChange={(e) => setGroup((e.target as HTMLInputElement).checked)}
                        />
                        <span class="verzeta-kickoff__rowMain">
                            <span class="verzeta-kickoff__rowTitle">
                                Start a group chat with all members
                            </span>
                            <span class="verzeta-kickoff__rowHint">
                                {groupEnabled
                                    ? 'One shared room with everyone in it.'
                                    : 'Needs at least two members.'}
                            </span>
                        </span>
                    </label>
                </div>
                <footer class="verzeta-addmember__footer">
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={dismiss}
                    >
                        Not now
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                        onClick={onStart}
                        disabled={!individual && !(group && groupEnabled)}
                    >
                        Start
                    </button>
                </footer>
            </div>
        </div>
    );
}
