// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-folder preferred-skill state. Mirrors Android
 * `PreferredSkillsUi` (data/skill/PreferredSkillsUi.kt) — a tuple of
 * `skillIds` (the allowlist) plus `exposeOnly` (when true,
 * non-preferred skills are hidden from the assistant entirely on
 * conversations under this folder).
 */

import { signal } from '@preact/signals';

export interface PreferredSkillsUi {
    readonly skillIds: readonly string[];
    readonly exposeOnly: boolean;
}

function key(hostId: string, folderId: string): string {
    return `${hostId}::${folderId}`;
}

const map = signal<ReadonlyMap<string, PreferredSkillsUi>>(new Map());

export function preferredSkillsFor(hostId: string, folderId: string): PreferredSkillsUi {
    return map.value.get(key(hostId, folderId)) ?? { skillIds: [], exposeOnly: false };
}

export function setPreferredSkills(
    hostId: string,
    folderId: string,
    snapshot: PreferredSkillsUi,
): void {
    const next = new Map(map.value);
    next.set(key(hostId, folderId), snapshot);
    map.value = next;
}
