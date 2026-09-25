// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-conversation skill-override state. Mirrors the wire-protocol
 * surface `skill.override_parent_folder` + `skill.preferred.list`
 * with scope_type=conversation: a single boolean flag indicating
 * whether the conv overrides its parent folder's preferred-skill
 * list, plus the conv-scope list itself (only meaningful when the
 * flag is true).
 */

import { signal } from '@preact/signals';

function key(hostId: string, conversationId: string): string {
    return `${hostId}::${conversationId}`;
}

const overrideMap = signal<ReadonlyMap<string, boolean>>(new Map());
const listMap = signal<ReadonlyMap<string, readonly string[]>>(new Map());

export function convSkillOverrideFor(hostId: string, conversationId: string): boolean {
    return overrideMap.value.get(key(hostId, conversationId)) ?? false;
}

export function setConvSkillOverride(
    hostId: string,
    conversationId: string,
    override: boolean,
): void {
    const next = new Map(overrideMap.value);
    next.set(key(hostId, conversationId), override);
    overrideMap.value = next;
}

export function convPreferredSkillsFor(hostId: string, conversationId: string): readonly string[] {
    return listMap.value.get(key(hostId, conversationId)) ?? [];
}

export function setConvPreferredSkills(
    hostId: string,
    conversationId: string,
    skillIds: readonly string[],
): void {
    const next = new Map(listMap.value);
    next.set(key(hostId, conversationId), skillIds);
    listMap.value = next;
}

/**
 * Per-conversation heartbeat-gate cache. Sourced from the dedicated
 * `conv.heartbeat.gate` op (the W14 conv.settings.save path silently
 * dropped these fields). `allow` toggles auto-surface, `maxPerDay`
 * caps how many heartbeat reports may post into the conversation per
 * day (host clamps into [1, 24]).
 */
export interface ConvHeartbeatGateUi {
    readonly allow: boolean;
    readonly maxPerDay: number;
}

const gateMap = signal<ReadonlyMap<string, ConvHeartbeatGateUi>>(new Map());

export function convHeartbeatGateFor(hostId: string, conversationId: string): ConvHeartbeatGateUi {
    return gateMap.value.get(key(hostId, conversationId)) ?? { allow: false, maxPerDay: 1 };
}

export function setConvHeartbeatGate(
    hostId: string,
    conversationId: string,
    snapshot: ConvHeartbeatGateUi,
): void {
    const next = new Map(gateMap.value);
    next.set(key(hostId, conversationId), snapshot);
    gateMap.value = next;
}
