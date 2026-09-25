// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ConnectionState — the finite state machine describing where a
 * paired host's WebSocket lifecycle currently sits.
 *
 * Transitions (driven by ConnectionManager):
 *
 *   disconnected ──connect()──► connecting
 *   connecting   ──open──────► authenticating
 *   connecting   ──error─────► error
 *   authenticating ──ok──────► connected
 *   authenticating ──reject──► unauthorized
 *   connected    ──drop──────► reconnecting
 *   reconnecting ──open──────► authenticating
 *   reconnecting ──giveup────► error
 *   *            ──user stop─► disconnected
 */

export type ConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'authenticating'
    | 'connected'
    | 'reconnecting'
    | 'unauthorized'
    | 'error';

/**
 * Human-readable label for the status bar. Short — fits in the
 * narrow status-bar item.
 */
export function describeState(state: ConnectionState): string {
    switch (state) {
        case 'disconnected':
            return 'Disconnected';
        case 'connecting':
            return 'Connecting…';
        case 'authenticating':
            return 'Authenticating…';
        case 'connected':
            return 'Connected';
        case 'reconnecting':
            return 'Reconnecting…';
        case 'unauthorized':
            return 'Unauthorized';
        case 'error':
            return 'Error';
    }
}

/**
 * VS Code ThemeIcon name to surface alongside the label. The icon
 * names below are stable across VS Code releases (codicon set).
 */
export function iconForState(state: ConnectionState): string {
    switch (state) {
        case 'disconnected':
            return 'circle-slash';
        case 'connecting':
        case 'authenticating':
        case 'reconnecting':
            return 'sync~spin';
        case 'connected':
            return 'pass-filled';
        case 'unauthorized':
            return 'shield';
        case 'error':
            return 'error';
    }
}
