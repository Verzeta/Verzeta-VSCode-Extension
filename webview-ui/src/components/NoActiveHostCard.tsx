// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * NoActiveHostCard — hero card for the Home tab when there is no
 * paired host OR the active host is in disconnected/error/unauthorized
 * state.
 *
 * Mirrors Android `HomeScreen` first-run path: large headline, short
 * detail, primary [Add host] CTA when the user has zero hosts paired,
 * or [Connect] CTA when a host exists but is disconnected.
 */

import type { HostSummaryUi } from '../../../src/shared/webview-protocol.js';
import { send } from '../lib/bus.js';

export function NoActiveHostCard({
    activeHost,
    activeState,
    totalHosts,
}: {
    readonly activeHost: HostSummaryUi | undefined;
    readonly activeState: string;
    readonly totalHosts: number;
}) {
    if (activeHost === undefined) {
        return (
            <div class="verzeta-hcard verzeta-hcard--first-run" role="region">
                <div class="verzeta-hcard__statusrow">
                    <span class="verzeta-hcard__statusdot verzeta-hcard__statusdot--idle" />
                    <span class="verzeta-hcard__statuslabel">NO ACTIVE HOST</span>
                </div>
                <div class="verzeta-hcard__name">Pair a Verzeta Studio host</div>
                <div class="verzeta-hcard__detail">
                    Run <code>verzeta-remote --pair-code</code> on your Verzeta&nbsp;Studio host to
                    generate a 6-digit code, then pair this VS&nbsp;Code device.
                </div>
                <div class="verzeta-hcard__actions">
                    <button
                        type="button"
                        class="verzeta-btn verzeta-btn--primary"
                        onClick={() =>
                            send({
                                type: 'host.commandRequested',
                                commandId: 'verzeta.addHost',
                            })
                        }
                    >
                        ＋ Add host
                    </button>
                </div>
            </div>
        );
    }

    let label: string;
    let detail: string;
    let actionLabel: string;
    let actionType: 'connect' | 'pair';
    switch (activeState) {
        case 'unauthorized':
            label = 'Unauthorized';
            detail = 'The stored token was rejected. Pair again with a fresh code from the host.';
            actionLabel = '＋ Pair again';
            actionType = 'pair';
            break;
        case 'error':
            label = 'Connection error';
            detail =
                'Couldn’t reach the host. Verify the URL in Settings or check the Verzeta output channel for diagnostics.';
            actionLabel = 'Try again';
            actionType = 'connect';
            break;
        default:
            label = 'Disconnected';
            detail = `${activeHost.name} is not currently connected. Open the connection to load conversations.`;
            actionLabel = '⚡ Connect';
            actionType = 'connect';
            break;
    }
    return (
        <div class="verzeta-hcard verzeta-hcard--idle" role="region">
            <div class="verzeta-hcard__statusrow">
                <span class="verzeta-hcard__statusdot verzeta-hcard__statusdot--idle" />
                <span class="verzeta-hcard__statuslabel">{label.toUpperCase()}</span>
            </div>
            <div class="verzeta-hcard__name" title={activeHost.name}>
                {activeHost.name}
            </div>
            <div class="verzeta-hcard__url" title={activeHost.url}>
                {activeHost.url}
            </div>
            <div class="verzeta-hcard__detail">{detail}</div>
            <div class="verzeta-hcard__actions">
                {actionType === 'connect' ? (
                    <button
                        type="button"
                        class="verzeta-btn verzeta-btn--primary"
                        onClick={() =>
                            send({ type: 'host.connectRequested', hostId: activeHost.id })
                        }
                    >
                        {actionLabel}
                    </button>
                ) : (
                    <button
                        type="button"
                        class="verzeta-btn verzeta-btn--primary"
                        onClick={() =>
                            send({
                                type: 'host.commandRequested',
                                commandId: 'verzeta.pair',
                            })
                        }
                    >
                        {actionLabel}
                    </button>
                )}
                {totalHosts === 0 ? null : (
                    <button
                        type="button"
                        class="verzeta-btn verzeta-btn--tonal"
                        onClick={() =>
                            send({
                                type: 'host.commandRequested',
                                commandId: 'verzeta.addHost',
                            })
                        }
                    >
                        ＋ Add another
                    </button>
                )}
            </div>
        </div>
    );
}
