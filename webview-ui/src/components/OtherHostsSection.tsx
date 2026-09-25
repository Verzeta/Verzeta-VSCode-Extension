// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * OtherHostsSection — Home-tab section listing paired hosts that
 * are NOT the active host. Each row shows the host name, its state
 * pill, and clicking it makes the host active (which auto-connects
 * via ConnectionManager.setActiveHostId).
 *
 * Mirrors Android `HomeScreen` "OTHER HOSTS" section.
 */

import type { HostConnectionState, HostSummaryUi } from '../../../src/shared/webview-protocol.js';
import { stateOf } from '../state/hosts.js';
import { send } from '../lib/bus.js';

export function OtherHostsSection({
    hosts,
    activeHostId,
}: {
    readonly hosts: readonly HostSummaryUi[];
    readonly activeHostId: string | undefined;
}) {
    const others = hosts.filter((h) => h.id !== activeHostId);
    if (others.length === 0) return null;
    return (
        <section class="verzeta-section">
            <div class="verzeta-section__heading">OTHER HOSTS</div>
            <ul class="verzeta-otherhosts" role="list">
                {others.map((host) => (
                    <OtherHostRow key={host.id} host={host} state={stateOf(host.id)} />
                ))}
            </ul>
        </section>
    );
}

const STATE_LABEL: Record<HostConnectionState['state'], string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting…',
    authenticating: 'Authenticating…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    unauthorized: 'Unauthorized',
    error: 'Error',
};

function OtherHostRow({
    host,
    state,
}: {
    readonly host: HostSummaryUi;
    readonly state: HostConnectionState['state'];
}) {
    return (
        <li class="verzeta-otherhost">
            <button
                type="button"
                class="verzeta-otherhost__button"
                onClick={() => send({ type: 'host.setActive', hostId: host.id })}
                title={host.url}
            >
                <span class="verzeta-otherhost__icon" aria-hidden="true">
                    🖥
                </span>
                <span class="verzeta-otherhost__body">
                    <span class="verzeta-otherhost__name">{host.name}</span>
                    <span class="verzeta-otherhost__url">{host.url}</span>
                </span>
                <span class={`verzeta-otherhost__state verzeta-otherhost__state--${state}`}>
                    {STATE_LABEL[state]}
                </span>
            </button>
        </li>
    );
}
