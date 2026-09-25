// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Project Rooms landing visibility signal. Set true when the user
 * taps the ProjectRoomsCard on Home; the App-root renders the
 * landing surface as a full-page overlay. The landing screen
 * dismisses itself via `closeProjectRoomsLanding`.
 *
 * Mirrors the standalone Project Rooms screen Android keeps via the
 * `MainScreen.ProjectRooms` enum + `showProjectRoomsLanding` event.
 */

import { signal } from '@preact/signals';

export const projectRoomsLandingOpen = signal<boolean>(false);

export function openProjectRoomsLanding(): void {
    projectRoomsLandingOpen.value = true;
}

export function closeProjectRoomsLanding(): void {
    projectRoomsLandingOpen.value = false;
}

/**
 * Template Library full-catalog screen visibility. Mirrors Android
 * `MainScreen.TemplateLibrary`. Opens from ProjectRoomsLanding via
 * "Browse all" button.
 */
export const templateLibraryOpen = signal<boolean>(false);

export function openTemplateLibrary(): void {
    templateLibraryOpen.value = true;
}

export function closeTemplateLibrary(): void {
    templateLibraryOpen.value = false;
}

/**
 * Template detail sheet — null when closed, otherwise the templateId
 * to display. Surfaces from a "Read more" tap on any template card
 * (landing or library).
 */
export const templateDetailOpen = signal<string | null>(null);

export function openTemplateDetail(templateId: string): void {
    templateDetailOpen.value = templateId;
}

export function closeTemplateDetail(): void {
    templateDetailOpen.value = null;
}
