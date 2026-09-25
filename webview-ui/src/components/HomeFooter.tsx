// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * HomeFooter — pinned section at the bottom of the Home tab.
 * Just two actions scoped to the active host: Ping (round-trip the
 * wire link) and Revoke this device (drop the bearer token issued
 * to this client).
 *
 * Connection state + ping latency are shown ONCE on the hero card
 * above; paired-device count + Manage devices live on the Settings
 * tab where the user manages those things. Earlier revisions of
 * this footer duplicated all three, which the user called out as
 * crowded and redundant — keep this footer narrow.
 */

import { useState } from 'preact/hooks';
import { activeHostId, stateOf } from '../state/hosts.js';
import { send } from '../lib/bus.js';

function PingIcon() {
    // Concentric arcs + dot — reads as "round-trip / signal" at 14 px.
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="18" r="1.6" fill="currentColor" />
            <path
                d="M7 13a7 7 0 0 1 10 0M3 9a13 13 0 0 1 18 0"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function RevokeIcon() {
    // Key with a slash — "drop the bearer token issued to this device".
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="8" cy="14" r="3" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M10 12l8-8M16 6l3 3M14 8l3 3"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            <path d="M4 4l16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M5 12.5l4.5 4.5L19 7"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M6 6l12 12M18 6l-12 12"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />
        </svg>
    );
}

export function HomeFooter() {
    const hostId = activeHostId.value;
    if (hostId === undefined) {
        return (
            <footer class="verzeta-homefooter">
                <div class="verzeta-homefooter__status">
                    No host selected. Pair one to get started.
                </div>
            </footer>
        );
    }
    const state = stateOf(hostId);
    return (
        <footer class="verzeta-homefooter">
            <div class="verzeta-homefooter__actions">
                <button
                    type="button"
                    class="verzeta-btn verzeta-btn--outline"
                    disabled={state !== 'connected'}
                    onClick={() => send({ type: 'host.pingRequested', hostId })}
                    title="Round-trip a ping to the host"
                >
                    <PingIcon />
                    <span>Ping</span>
                </button>
                <RevokeButton hostId={hostId} disabled={state !== 'connected'} />
            </div>
        </footer>
    );
}

function RevokeButton({
    hostId,
    disabled,
}: {
    readonly hostId: string;
    readonly disabled: boolean;
}) {
    const [armed, setArmed] = useState(false);
    if (armed) {
        return (
            <span class="verzeta-homefooter__confirm">
                <button
                    type="button"
                    class="verzeta-btn verzeta-btn--danger"
                    onClick={() => {
                        send({ type: 'host.revokeSelfRequested', hostId });
                        setArmed(false);
                    }}
                >
                    <CheckIcon />
                    <span>Confirm revoke</span>
                </button>
                <button
                    type="button"
                    class="verzeta-btn verzeta-btn--outline"
                    onClick={() => setArmed(false)}
                >
                    <CloseIcon />
                    <span>Cancel</span>
                </button>
            </span>
        );
    }
    return (
        <button
            type="button"
            class="verzeta-btn verzeta-btn--outline"
            disabled={disabled}
            onClick={() => setArmed(true)}
            title="Invalidate this device's bearer token on the host"
        >
            <RevokeIcon />
            <span>Revoke this device</span>
        </button>
    );
}
