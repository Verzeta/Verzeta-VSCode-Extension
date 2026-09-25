// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ConnectionPill — short status badge for the active host's
 * connection state. Matches the canonical "pill" shape used by
 * the desktop QML and Android surfaces: a coloured dot followed
 * by a short label.
 *
 * Colour mapping uses VS Code's semantic token names so the badge
 * reads correctly in every theme variant. The dot is a small
 * circle that picks up the same colour as the surrounding text
 * via `currentColor` on a CSS background.
 */

import { activeHostId, activeHostState } from '../state/hosts.js';
import type { HostConnectionState } from '../../../src/shared/webview-protocol.js';

interface PillSpec {
    readonly label: string;
    readonly modifier: string;
}

const SPEC: Record<HostConnectionState['state'], PillSpec> = {
    disconnected: { label: 'Disconnected', modifier: 'idle' },
    connecting: { label: 'Connecting…', modifier: 'pending' },
    authenticating: { label: 'Authenticating…', modifier: 'pending' },
    connected: { label: 'Connected', modifier: 'ok' },
    reconnecting: { label: 'Reconnecting…', modifier: 'pending' },
    unauthorized: { label: 'Unauthorized', modifier: 'error' },
    error: { label: 'Error', modifier: 'error' },
};

export function ConnectionPill() {
    const active = activeHostId.value;
    if (active === undefined) {
        return (
            <span class="verzeta-pill verzeta-pill--idle" role="status">
                <span class="verzeta-pill__dot" />
                <span class="verzeta-pill__label">No host selected</span>
            </span>
        );
    }
    const state = activeHostState() ?? 'disconnected';
    const spec = SPEC[state];
    return (
        <span
            class={`verzeta-pill verzeta-pill--${spec.modifier}`}
            role="status"
            aria-live="polite"
        >
            <span class="verzeta-pill__dot" />
            <span class="verzeta-pill__label">{spec.label}</span>
        </span>
    );
}
