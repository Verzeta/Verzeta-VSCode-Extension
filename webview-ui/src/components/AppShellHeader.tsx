// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * AppShellHeader — single brand row pinned above the TabBar.
 * Renders the Verzeta mark + name once for the whole shell, so the
 * three tabs don't each ship their own brand and end up
 * inconsistent. Plus a reusable per-tab TabHeader component that
 * each tab renders just below the TabBar with its icon + name in
 * the same height / spacing / typography across Home / Chat /
 * Settings.
 */

import type { ComponentChildren } from 'preact';
import { VerzetaMark } from './VerzetaMark.js';

/**
 * Brand strip rendered once at the top of the webview, above the
 * TabBar. The single source of brand identity in the shell.
 */
export function AppShellHeader() {
    return (
        <header class="verzeta-appheader" role="banner">
            <VerzetaMark size={22} title="Verzeta" />
            <span class="verzeta-appheader__name">Verzeta</span>
        </header>
    );
}

/**
 * Per-tab page header. Shown immediately below the TabBar by every
 * tab so the user always knows which tab they're on, with the same
 * height + horizontal padding + icon size + typography.
 *
 * `trailing` is an optional right-aligned slot for a tab-specific
 * action (e.g. Settings' refresh icon).
 */
export function TabHeader({
    icon,
    title,
    trailing,
}: {
    readonly icon: ComponentChildren;
    readonly title: string;
    readonly trailing?: ComponentChildren;
}) {
    return (
        <div class="verzeta-tabheader">
            <span class="verzeta-tabheader__icon" aria-hidden="true">
                {icon}
            </span>
            <h1 class="verzeta-tabheader__title">{title}</h1>
            {trailing !== undefined ? (
                <span class="verzeta-tabheader__trailing">{trailing}</span>
            ) : null}
        </div>
    );
}

/* ---------------------------------------------------------------- */
/* Per-tab inline icons. Kept here so each tab's icon ships at the  */
/* same 18 px stroke-1.6 weight, matching the brand mark.           */
/* ---------------------------------------------------------------- */

export function HomeIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-8.5z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
        </svg>
    );
}

export function ChatIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M21 12c0 4.4-4 8-9 8a10 10 0 0 1-3.6-.7L4 21l1.5-3.8A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
        </svg>
    );
}

export function SettingsIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.06a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.06a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
            />
        </svg>
    );
}
