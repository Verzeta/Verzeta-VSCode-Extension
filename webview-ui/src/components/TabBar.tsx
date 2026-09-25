// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * TabBar — the persistent header that drives the three-tab routing
 * (L23). Each button is a plain `<button>` styled with VS Code
 * theme variables. The active tab gets a bottom border in the
 * accent colour; inactive tabs use the muted foreground.
 *
 * Accessibility: ARIA `role="tablist"` + `role="tab"` per the WAI
 * tablist pattern, with `aria-selected` and `tabindex` managed for
 * keyboard navigation. Arrow keys move focus + activate per the
 * pattern.
 */

import type { ComponentChildren } from 'preact';
import type { TabId } from '../state/tabs.js';
import { currentTab, setTab } from '../state/tabs.js';
import { ChatIcon, HomeIcon, SettingsIcon } from './AppShellHeader.js';

interface TabDef {
    readonly id: TabId;
    readonly label: string;
    readonly icon: ComponentChildren;
}

const TABS: readonly TabDef[] = [
    { id: 'home', label: 'Home', icon: <HomeIcon /> },
    { id: 'chat', label: 'Chat', icon: <ChatIcon /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function TabBar() {
    const active = currentTab.value;

    const onKey = (event: KeyboardEvent, currentIndex: number): void => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        const next = TABS[(currentIndex + delta + TABS.length) % TABS.length];
        if (next !== undefined) setTab(next.id);
    };

    return (
        <div class="verzeta-tabbar" role="tablist" aria-label="Verzeta sections">
            {TABS.map((tab, idx) => {
                const isActive = tab.id === active;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={`verzeta-tab-${tab.id}`}
                        aria-controls={`verzeta-panel-${tab.id}`}
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        class={isActive ? 'verzeta-tab verzeta-tab--active' : 'verzeta-tab'}
                        onClick={() => setTab(tab.id)}
                        onKeyDown={(ev) => onKey(ev, idx)}
                    >
                        <span class="verzeta-tab__icon" aria-hidden="true">
                            {tab.icon}
                        </span>
                        <span class="verzeta-tab__label">{tab.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
