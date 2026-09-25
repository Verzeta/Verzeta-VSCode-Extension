// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Tab routing for the three-tab shell (L23). One `@preact/signals`
 * signal carries the active tab; the tab bar reads + writes it,
 * each tab body subscribes via signal `.value` in render.
 *
 * Routing through a signal keeps the App component itself dumb —
 * no React-router, no context provider, no prop drilling. Tab
 * switches mutate one signal and the affected components re-run
 * automatically.
 */

import { signal } from '@preact/signals';

export type TabId = 'home' | 'chat' | 'settings';

export const currentTab = signal<TabId>('home');

export function setTab(tab: TabId): void {
    if (currentTab.value !== tab) currentTab.value = tab;
}
