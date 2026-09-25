// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-host catalog caches: clients (paired devices), tools, MCP
 * servers, skills. Populated by the matching `*.updated` envelopes
 * the extension pushes on demand (Global Settings sub-section
 * expand) or on revoke / refresh.
 */

import { signal } from '@preact/signals';
import type { ClientUi, McpServerUi, SkillUi, ToolUi } from '../../../src/shared/wire-types.js';

const clientsMap = signal<ReadonlyMap<string, readonly ClientUi[]>>(new Map());
const toolsMap = signal<ReadonlyMap<string, readonly ToolUi[]>>(new Map());
const mcpMap = signal<ReadonlyMap<string, readonly McpServerUi[]>>(new Map());
const skillsMap = signal<ReadonlyMap<string, readonly SkillUi[]>>(new Map());

export function clientsFor(hostId: string): readonly ClientUi[] {
    return clientsMap.value.get(hostId) ?? [];
}
export function setClientsFor(hostId: string, clients: readonly ClientUi[]): void {
    const next = new Map(clientsMap.value);
    next.set(hostId, clients);
    clientsMap.value = next;
}

export function toolsFor(hostId: string): readonly ToolUi[] {
    return toolsMap.value.get(hostId) ?? [];
}
export function setToolsFor(hostId: string, tools: readonly ToolUi[]): void {
    const next = new Map(toolsMap.value);
    next.set(hostId, tools);
    toolsMap.value = next;
}

export function mcpFor(hostId: string): readonly McpServerUi[] {
    return mcpMap.value.get(hostId) ?? [];
}
export function setMcpFor(hostId: string, servers: readonly McpServerUi[]): void {
    const next = new Map(mcpMap.value);
    next.set(hostId, servers);
    mcpMap.value = next;
}

export function skillsFor(hostId: string): readonly SkillUi[] {
    return skillsMap.value.get(hostId) ?? [];
}
export function setSkillsFor(hostId: string, skills: readonly SkillUi[]): void {
    const next = new Map(skillsMap.value);
    next.set(hostId, skills);
    skillsMap.value = next;
}

/** Per-host last "Verify session" result for the Settings Session row. */
export interface VerifySessionResultUi {
    readonly ok: boolean;
    readonly latencyMs: number;
    readonly clientId: string;
    readonly clientName: string;
    readonly error: string;
    readonly at: number;
}

const verifyMap = signal<ReadonlyMap<string, VerifySessionResultUi>>(new Map());

export function verifyResultFor(hostId: string): VerifySessionResultUi | undefined {
    return verifyMap.value.get(hostId);
}

export function setVerifyResult(
    hostId: string,
    ok: boolean,
    latencyMs: number,
    clientId: string,
    clientName: string,
    error: string,
): void {
    const next = new Map(verifyMap.value);
    next.set(hostId, { ok, latencyMs, clientId, clientName, error, at: Date.now() });
    verifyMap.value = next;
}
