// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Host signals — hot state mirrored from the extension host's
 * HostStore + ConnectionManager. The extension emits
 * `hosts.updated` whenever the list / active / states change, and
 * `host.stateChanged` for per-host state transitions in between.
 *
 * Components subscribe via signal `.value` accessor and re-render
 * automatically when the signal mutates.
 */

import { signal } from '@preact/signals';
import type { HostConnectionState, HostSummaryUi } from '../../../src/shared/webview-protocol.js';

export const hostsList = signal<readonly HostSummaryUi[]>([]);
export const activeHostId = signal<string | undefined>(undefined);
export const defaultHostId = signal<string | undefined>(undefined);

const stateMap = signal<ReadonlyMap<string, HostConnectionState['state']>>(new Map());

/** Returns the current connection state for the given host id. */
export function stateOf(hostId: string): HostConnectionState['state'] {
    return stateMap.value.get(hostId) ?? 'disconnected';
}

/**
 * Replaces the full host roster snapshot. Called when the host
 * pushes `hosts.updated`.
 */
export function setHostsSnapshot(snapshot: {
    readonly hosts: readonly HostSummaryUi[];
    readonly activeHostId: string | undefined;
    readonly defaultHostId: string | undefined;
    readonly states: readonly HostConnectionState[];
}): void {
    hostsList.value = snapshot.hosts;
    activeHostId.value = snapshot.activeHostId;
    defaultHostId.value = snapshot.defaultHostId;
    const next = new Map<string, HostConnectionState['state']>();
    for (const s of snapshot.states) next.set(s.hostId, s.state);
    stateMap.value = next;
}

/** Patches one host's connection state. Called on `host.stateChanged`. */
export function setHostState(hostId: string, state: HostConnectionState['state']): void {
    const next = new Map(stateMap.value);
    next.set(hostId, state);
    stateMap.value = next;
}

/** Convenience: the active host's connection state, or undefined. */
export function activeHostState(): HostConnectionState['state'] | undefined {
    const id = activeHostId.value;
    return id === undefined ? undefined : stateOf(id);
}

/** Per-host latest ping result. Used by the Home tab's footer / status surface. */
export interface PingResultUi {
    readonly ok: boolean;
    readonly latencyMs: number;
    readonly error: string;
    readonly at: number;
}

const pingMap = signal<ReadonlyMap<string, PingResultUi>>(new Map());

export function pingResultFor(hostId: string): PingResultUi | undefined {
    return pingMap.value.get(hostId);
}

export function setHostPingResult(
    hostId: string,
    ok: boolean,
    latencyMs: number,
    error: string,
): void {
    const next = new Map(pingMap.value);
    next.set(hostId, { ok, latencyMs, error, at: Date.now() });
    pingMap.value = next;
}

/** Per-host client identity (from auth.me). */
export interface ClientIdentityUi {
    readonly clientId: string;
    readonly clientName: string;
}

const identityMap = signal<ReadonlyMap<string, ClientIdentityUi>>(new Map());

export function identityFor(hostId: string): ClientIdentityUi | undefined {
    return identityMap.value.get(hostId);
}

export function setHostIdentity(hostId: string, clientId: string, clientName: string): void {
    const next = new Map(identityMap.value);
    next.set(hostId, { clientId, clientName });
    identityMap.value = next;
}
