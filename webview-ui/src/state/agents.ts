// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-host agent-catalog cache. Populated by an `agents.updated`
 * envelope that the extension pushes once the host has been seeded
 * (or whenever the webview explicitly asks via `agents.listRequested`).
 */

import { signal } from '@preact/signals';
import type { AgentSummaryUi } from '../../../src/shared/wire-types.js';

const agentsMap = signal<ReadonlyMap<string, readonly AgentSummaryUi[]>>(new Map());

export function agentsFor(hostId: string): readonly AgentSummaryUi[] {
    return agentsMap.value.get(hostId) ?? [];
}

export function setAgentsFor(hostId: string, agents: readonly AgentSummaryUi[]): void {
    const next = new Map(agentsMap.value);
    next.set(hostId, agents);
    agentsMap.value = next;
}
