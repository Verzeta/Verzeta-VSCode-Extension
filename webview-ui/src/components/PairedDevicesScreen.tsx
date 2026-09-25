// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * PairedDevicesScreen — manage list of every device the active host
 * has paired. Surfaces from HomeFooter's "Manage devices" button.
 * Active (non-revoked) clients get a per-row Revoke pill; the
 * current client surfaces a "this device" badge so the user knows
 * which row would be a self-revoke.
 *
 * Revoked clients are NOT shown here — they live in the read-only
 * RevokedDevicesScreen under Settings.
 */

import { useEffect, useState } from 'preact/hooks';
import { activeHostId } from '../state/hosts.js';
import { clientsFor } from '../state/catalogs.js';
import { closePairedDevices, pairedDevicesOpen } from '../state/aboutHelp.js';
import { send } from '../lib/bus.js';

export function PairedDevicesScreen() {
    if (!pairedDevicesOpen.value) return null;
    const hostId = activeHostId.value;
    if (hostId === undefined) {
        closePairedDevices();
        return null;
    }
    return <Body hostId={hostId} />;
}

function Body({ hostId }: { readonly hostId: string }) {
    const all = clientsFor(hostId);
    const active = all.filter((c) => !c.revoked);
    const [confirming, setConfirming] = useState<{ id: string; name: string } | null>(null);

    useEffect(() => {
        send({ type: 'clients.listRequested', hostId });
    }, [hostId]);

    return (
        <div
            class="verzeta-prooms-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Paired devices"
        >
            <header class="verzeta-prooms__header">
                <button
                    type="button"
                    class="verzeta-prooms__back"
                    onClick={closePairedDevices}
                    aria-label="Back"
                >
                    ‹
                </button>
                <h1 class="verzeta-prooms__title">Paired devices</h1>
            </header>
            <div class="verzeta-prooms__crumb">
                <span>HOME</span>
                <span aria-hidden="true">·</span>
                <span>PAIRED DEVICES</span>
            </div>
            <div class="verzeta-prooms__scroll">
                <p class="verzeta-prooms__hint">
                    {active.length === 0
                        ? 'No active devices paired with this host. Pair another device from VS Code (Cmd/Ctrl+Shift+P → Verzeta: Add Host) or from the host’s desktop UI.'
                        : `${active.length} active device${active.length === 1 ? '' : 's'} paired with this host. Revoking ends the device’s session immediately and forces it to re-pair.`}
                </p>
                {active.length === 0 ? null : (
                    <ul class="verzeta-overlay__list" role="list">
                        {active.map((client) => (
                            <li key={client.id} class="verzeta-overlay__card">
                                <div class="verzeta-overlay__cardHead">
                                    <div class="verzeta-overlay__cardBody">
                                        <span class="verzeta-overlay__cardTitle">
                                            {client.name}
                                            {client.current ? (
                                                <span class="verzeta-team__coordTag">
                                                    This device
                                                </span>
                                            ) : null}
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
                                    {client.current ? (
                                        <span class="verzeta-overlay__cardMeta">
                                            Use HomeFooter → Revoke this device
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            class="verzeta-libcard__btn verzeta-libcard__btn--danger"
                                            onClick={() =>
                                                setConfirming({ id: client.id, name: client.name })
                                            }
                                        >
                                            Revoke
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {confirming !== null ? (
                <div
                    class="verzeta-addmember-backdrop"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Confirm revoke"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setConfirming(null);
                    }}
                >
                    <div class="verzeta-addmember">
                        <header class="verzeta-addmember__header">
                            <h3 class="verzeta-addmember__title">Revoke "{confirming.name}"?</h3>
                        </header>
                        <div class="verzeta-addmember__body">
                            <p>
                                The device’s session ends immediately. It must re-pair (Verzeta:
                                Pair) before it can talk to this host again.
                            </p>
                        </div>
                        <footer class="verzeta-addmember__footer">
                            <button
                                type="button"
                                class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                                onClick={() => setConfirming(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                class="verzeta-sheet__btn verzeta-sheet__btn--danger"
                                onClick={() => {
                                    send({
                                        type: 'clients.revokeRequested',
                                        hostId,
                                        clientId: confirming.id,
                                    });
                                    setConfirming(null);
                                }}
                            >
                                Revoke device
                            </button>
                        </footer>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
