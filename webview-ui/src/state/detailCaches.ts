// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * On-demand detail caches for drill-down surfaces in Settings:
 *   - MCP server tools (per server name)
 *   - Skill detail (per skill id)
 *   - Heartbeat recent-run history (per config id)
 *
 * Each is fetched lazily when the user expands a row. Populated by
 * the matching `*.updated` envelope.
 */

import { signal } from '@preact/signals';
import type { HeartbeatRunUi, SkillUi, ToolUi } from '../../../src/shared/wire-types.js';

function key(hostId: string, item: string): string {
    return `${hostId}::${item}`;
}

const mcpToolsMap = signal<ReadonlyMap<string, readonly ToolUi[]>>(new Map());
export function mcpServerToolsFor(hostId: string, serverName: string): readonly ToolUi[] {
    return mcpToolsMap.value.get(key(hostId, serverName)) ?? [];
}
export function setMcpServerTools(
    hostId: string,
    serverName: string,
    tools: readonly ToolUi[],
): void {
    const next = new Map(mcpToolsMap.value);
    next.set(key(hostId, serverName), tools);
    mcpToolsMap.value = next;
}

const skillDetailMap = signal<ReadonlyMap<string, SkillUi>>(new Map());
export function skillDetailFor(hostId: string, skillId: string): SkillUi | undefined {
    return skillDetailMap.value.get(key(hostId, skillId));
}
export function setSkillDetail(hostId: string, skill: SkillUi): void {
    const next = new Map(skillDetailMap.value);
    next.set(key(hostId, skill.id), skill);
    skillDetailMap.value = next;
}

const heartbeatRunsMap = signal<ReadonlyMap<string, readonly HeartbeatRunUi[]>>(new Map());
export function heartbeatRunsFor(hostId: string, configId: string): readonly HeartbeatRunUi[] {
    return heartbeatRunsMap.value.get(key(hostId, configId)) ?? [];
}
/** Whether runs for this heartbeat have arrived, so an empty list means "none". */
export function heartbeatRunsLoaded(hostId: string, configId: string): boolean {
    return heartbeatRunsMap.value.has(key(hostId, configId));
}
export function setHeartbeatRuns(
    hostId: string,
    configId: string,
    runs: readonly HeartbeatRunUi[],
): void {
    const next = new Map(heartbeatRunsMap.value);
    next.set(key(hostId, configId), runs);
    heartbeatRunsMap.value = next;
}
