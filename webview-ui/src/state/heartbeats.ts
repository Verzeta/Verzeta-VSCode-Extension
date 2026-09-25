// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-folder heartbeat-config cache. Populated by `heartbeats.updated`
 * envelopes the extension pushes on `heartbeats.requested` and on
 * `heartbeat.config.changed` / `.removed` events. Empty array =
 * no heartbeats configured.
 */

import { signal } from '@preact/signals';
import type { HeartbeatConfigUi } from '../../../src/shared/wire-types.js';

function key(hostId: string, folderId: string): string {
    return `${hostId}::${folderId}`;
}

const heartbeatsMap = signal<ReadonlyMap<string, readonly HeartbeatConfigUi[]>>(new Map());

export function heartbeatsFor(hostId: string, folderId: string): readonly HeartbeatConfigUi[] {
    return heartbeatsMap.value.get(key(hostId, folderId)) ?? [];
}

export function setHeartbeats(
    hostId: string,
    folderId: string,
    configs: readonly HeartbeatConfigUi[],
): void {
    const next = new Map(heartbeatsMap.value);
    next.set(key(hostId, folderId), configs);
    heartbeatsMap.value = next;
}
