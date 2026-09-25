// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * HomeTab — Verzeta landing surface, mirroring Android `HomeScreen`:
 *
 *   1. Hero — ConnectedHostCard when the active host is connected
 *      (or transitioning toward it); NoActiveHostCard otherwise.
 *   2. OTHER HOSTS — other paired hosts (clicking switches active +
 *      auto-connects).
 *   3. RECENT · hostname — the active host's most-recent conversations.
 *   4. HomeFooter — pinned Ping + Revoke buttons + status line.
 *
 * Layout flows vertically and scrolls inside the tab; no horizontal
 * scrollbars at any supported sidebar width.
 */

import { ConnectedHostCard } from '../components/ConnectedHostCard.js';
import { HomeFooter } from '../components/HomeFooter.js';
import { NoActiveHostCard } from '../components/NoActiveHostCard.js';
import { OtherHostsSection } from '../components/OtherHostsSection.js';
import { ProjectRoomsCard } from '../components/ProjectRoomsCard.js';
import { RecentConversations } from '../components/RecentConversations.js';
import { HomeIcon, TabHeader } from '../components/AppShellHeader.js';
import { activeHostId, hostsList, stateOf } from '../state/hosts.js';

export function HomeTab() {
    const hosts = hostsList.value;
    const activeId = activeHostId.value;
    const activeHost = activeId === undefined ? undefined : hosts.find((h) => h.id === activeId);
    const activeState = activeId === undefined ? 'disconnected' : stateOf(activeId);
    const heroShowsConnected =
        activeHost !== undefined &&
        (activeState === 'connected' ||
            activeState === 'connecting' ||
            activeState === 'authenticating' ||
            activeState === 'reconnecting');
    return (
        <div
            class="verzeta-tab-panel verzeta-home"
            id="verzeta-panel-home"
            role="tabpanel"
            aria-labelledby="verzeta-tab-home"
        >
            <TabHeader icon={<HomeIcon />} title="Home" />
            <div class="verzeta-home__scroll">
                {heroShowsConnected && activeHost !== undefined ? (
                    <ConnectedHostCard host={activeHost} state={activeState} />
                ) : (
                    <NoActiveHostCard
                        activeHost={activeHost}
                        activeState={activeState}
                        totalHosts={hosts.length}
                    />
                )}
                {heroShowsConnected ? <ProjectRoomsCard /> : null}
                <OtherHostsSection hosts={hosts} activeHostId={activeId} />
                <RecentConversations />
            </div>
            <HomeFooter />
        </div>
    );
}
