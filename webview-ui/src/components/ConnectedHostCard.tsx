// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ConnectedHostCard — hero card for the Home tab when the active
 * host is connected, authenticating, reconnecting, or connecting.
 *
 * Mirrors Android `HomeScreen.ConnectedHostCard`:
 *   - Status row: dot + "CONNECTED" label + state pill + optional latency
 *   - Host name (large, bold)
 *   - Endpoint URL (monospace, dim)
 *   - Action row: [⚡ Open chat] [⚙ Manage]
 *
 * The [Open chat] button jumps to the Chat tab; [Manage] jumps to
 * Settings with the host pre-selected.
 */

import type { HostSummaryUi } from '../../../src/shared/webview-protocol.js';
import type { HostConnectionState } from '../../../src/shared/webview-protocol.js';
import { pingResultFor } from '../state/hosts.js';
import { recentConversationsFor, setActiveConversationId } from '../state/conversations.js';
import { setTab } from '../state/tabs.js';
import { send } from '../lib/bus.js';

const STATE_LABEL: Record<HostConnectionState['state'], string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting…',
    authenticating: 'Authenticating…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    unauthorized: 'Unauthorized',
    error: 'Error',
};

export function ConnectedHostCard({
    host,
    state,
}: {
    readonly host: HostSummaryUi;
    readonly state: HostConnectionState['state'];
}) {
    const isConnected = state === 'connected';
    const ping = pingResultFor(host.id);
    const showLatency = isConnected && ping !== undefined && ping.ok;
    return (
        <div
            class={`verzeta-hcard verzeta-hcard--${isConnected ? 'connected' : 'pending'}`}
            role="region"
            aria-label={`Active host ${host.name}`}
        >
            <div class="verzeta-hcard__statusrow">
                <span class="verzeta-hcard__statusdot" aria-hidden="true" />
                <span class="verzeta-hcard__statuslabel">{STATE_LABEL[state]}</span>
                {showLatency ? (
                    <span class="verzeta-hcard__latency" aria-label="Round-trip latency">
                        {ping.latencyMs} ms
                    </span>
                ) : null}
            </div>
            <div class="verzeta-hcard__name" title={host.name}>
                {host.name}
            </div>
            <div class="verzeta-hcard__url" title={host.url}>
                {host.url}
            </div>
            <div class="verzeta-hcard__actions">
                <button
                    type="button"
                    class="verzeta-btn verzeta-btn--primary"
                    onClick={() => {
                        // Mirror Android HomeScreen's "Open chat":
                        // jump to the most-recent conversation if there
                        // is one, otherwise just land on the
                        // conversation list (the user can pick / start
                        // a new one).
                        const recents = recentConversationsFor(host.id);
                        const top = recents[0];
                        if (top !== undefined) {
                            setActiveConversationId(top.id);
                            send({
                                type: 'conversation.openRequested',
                                hostId: host.id,
                                conversationId: top.id,
                            });
                        }
                        setTab('chat');
                    }}
                    disabled={!isConnected}
                >
                    <BoltIcon />
                    Open chat
                </button>
                <button
                    type="button"
                    class="verzeta-btn verzeta-btn--tonal"
                    onClick={() => {
                        send({ type: 'host.setActive', hostId: host.id });
                        setTab('settings');
                    }}
                >
                    <CogIcon />
                    Manage
                </button>
            </div>
        </div>
    );
}

function BoltIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function CogIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.06a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.06a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
            />
        </svg>
    );
}
