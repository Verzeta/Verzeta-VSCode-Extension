// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ProjectRoomsCard — secondary hero card on the Home tab that
 * surfaces Project Rooms as a first-class entry point. Mirrors the
 * Android HomeScreen card that sits below the active-host hero.
 *
 *   ┌─────────────────────────────────────────┐
 *   │ 👥  Project Rooms              ›        │
 *   │ Multi-agent teams collaborating on      │
 *   │ shared goals — pick a room or start one.│
 *   └─────────────────────────────────────────┘
 *
 * On tap: switch to the Chat tab so the user can see the project
 * folders + members surfaced in the sidebar. When the
 * project_template ops are wired (next tier), this will route to
 * the Project Rooms landing screen instead.
 */

import { openProjectRoomsLanding } from '../state/projectRoomsUi.js';

export function ProjectRoomsCard() {
    const onOpen = (): void => {
        openProjectRoomsLanding();
    };
    return (
        <button
            type="button"
            class="verzeta-projcard"
            onClick={onOpen}
            aria-label="Open Project Rooms"
        >
            <span class="verzeta-projcard__icon" aria-hidden="true">
                <GroupIcon />
            </span>
            <span class="verzeta-projcard__body">
                <span class="verzeta-projcard__title">Project Rooms</span>
                <span class="verzeta-projcard__detail">
                    Multi-agent teams working toward shared goals. Pick a room or start one.
                </span>
            </span>
            <span class="verzeta-projcard__chevron" aria-hidden="true">
                <ChevronIcon />
            </span>
        </button>
    );
}

function GroupIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="9" cy="9" r="3.2" stroke="currentColor" stroke-width="1.6" />
            <circle cx="17" cy="9" r="2.5" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
            <path
                d="M14 17c0-2 1.8-4 4-4s3 1.5 3 4"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function ChevronIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}
