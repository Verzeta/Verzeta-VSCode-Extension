// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { send } from '../lib/bus.js';
import { activeHostId, hostsList } from '../state/hosts.js';

const ADD_HOST_SENTINEL = '__verzeta_add_host__';

export function HostPicker() {
    const hosts = hostsList.value;
    const active = activeHostId.value;

    const onChange = (event: Event): void => {
        const target = event.target as HTMLSelectElement;
        const value = target.value;
        if (value === ADD_HOST_SENTINEL) {
            send({ type: 'host.commandRequested', commandId: 'verzeta.addHost' });
            // Revert the selection so the dropdown shows the active
            // host again — the command flow will refresh the list
            // through `hosts.updated` if a host is added.
            target.value = active ?? '';
            return;
        }
        if (value !== active) send({ type: 'host.setActive', hostId: value });
    };

    return (
        <label class="verzeta-host-picker" aria-label="Active host">
            <span class="verzeta-host-picker__label">Host</span>
            <select class="verzeta-host-picker__select" value={active ?? ''} onChange={onChange}>
                {hosts.length === 0 ? (
                    <option value="" disabled>
                        No hosts paired
                    </option>
                ) : null}
                {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                        {h.name}
                    </option>
                ))}
                <option disabled>──────</option>
                <option value={ADD_HOST_SENTINEL}>＋ Add host…</option>
            </select>
        </label>
    );
}
