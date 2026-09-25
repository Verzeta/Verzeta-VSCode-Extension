// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * RevokedDevicesScreen — read-only audit list of every client
 * previously paired with the active host that has since been
 * revoked. Mirrors Android `RevokedDevicesScreen.kt`.
 *
 * Opened from the "Revoked devices" row in Settings; closes via the
 * back button.
 */

import { signal } from '@preact/signals';
import { activeHostId } from '../state/hosts.js';
import { clientsFor } from '../state/catalogs.js';

export const revokedDevicesOpen = signal<boolean>(false);

export function openRevokedDevices(): void {
    revokedDevicesOpen.value = true;
}

export function closeRevokedDevices(): void {
    revokedDevicesOpen.value = false;
}

export function RevokedDevicesScreen() {
    if (!revokedDevicesOpen.value) return null;
    const hostId = activeHostId.value;
    if (hostId === undefined) {
        closeRevokedDevices();
        return null;
    }
    const revoked = clientsFor(hostId).filter((c) => c.revoked);
    return (
        <div class="verzeta-prooms-overlay" role="dialog" aria-modal="true">
            <header class="verzeta-prooms__header">
                <button
                    type="button"
                    class="verzeta-prooms__back"
                    onClick={closeRevokedDevices}
                    aria-label="Back"
                >
                    ‹
                </button>
                <h1 class="verzeta-prooms__title">Revoked devices</h1>
            </header>
            <div class="verzeta-prooms__crumb">
                <span>SETTINGS</span>
                <span aria-hidden="true">·</span>
                <span>REVOKED DEVICES</span>
            </div>
            <div class="verzeta-prooms__scroll">
                {revoked.length === 0 ? (
                    <p class="verzeta-prooms__empty">
                        No revoked devices on this host. When you revoke a paired client it appears
                        here as audit history.
                    </p>
                ) : (
                    <ul class="verzeta-overlay__list" role="list">
                        {revoked.map((client) => (
                            <li key={client.id} class="verzeta-overlay__card">
                                <div class="verzeta-overlay__cardHead">
                                    <div class="verzeta-overlay__cardBody">
                                        <span class="verzeta-overlay__cardTitle">
                                            {client.name}
                                        </span>
                                        <span class="verzeta-overlay__cardMeta">
                                            id {client.id.slice(0, 8)} ·{' '}
                                            {client.lastSeenAt > 0
                                                ? `last seen ${new Date(
                                                      client.lastSeenAt < 1e11
                                                          ? client.lastSeenAt * 1000
                                                          : client.lastSeenAt,
                                                  ).toLocaleString()}`
                                                : 'never seen'}
                                        </span>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
