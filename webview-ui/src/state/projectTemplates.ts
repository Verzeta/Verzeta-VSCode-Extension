// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Per-host project-template caches. Two distinct projections:
 *
 *  - **Landing** (`projectTemplatesFor`) — built-ins + user-pinned
 *    templates. Surfaces on the Home → Project Rooms landing.
 *  - **Full catalog** (`projectTemplatesAllFor`) — every template
 *    on the host (built-ins, pinned user templates, AND unpinned
 *    user templates). Surfaces in the Template Library full-catalog
 *    screen.
 *
 *  - **Roster** (`templateRosterFor`) — keyed by (hostId, templateId).
 *    Lazily fetched by the Read-More detail sheet via
 *    `template.roster.requested`.
 */

import { signal } from '@preact/signals';
import type {
    ProjectTemplateRosterMemberUi,
    ProjectTemplateUi,
} from '../../../src/shared/wire-types.js';

const landingMap = signal<ReadonlyMap<string, readonly ProjectTemplateUi[]>>(new Map());
const allMap = signal<ReadonlyMap<string, readonly ProjectTemplateUi[]>>(new Map());
const rosterMap = signal<ReadonlyMap<string, readonly ProjectTemplateRosterMemberUi[]>>(new Map());

function rosterKey(hostId: string, templateId: string): string {
    return `${hostId}::${templateId}`;
}

export function projectTemplatesFor(hostId: string): readonly ProjectTemplateUi[] {
    return landingMap.value.get(hostId) ?? [];
}

export function setProjectTemplates(hostId: string, templates: readonly ProjectTemplateUi[]): void {
    const next = new Map(landingMap.value);
    next.set(hostId, templates);
    landingMap.value = next;
}

export function projectTemplatesAllFor(hostId: string): readonly ProjectTemplateUi[] {
    return allMap.value.get(hostId) ?? [];
}

export function setProjectTemplatesAll(
    hostId: string,
    templates: readonly ProjectTemplateUi[],
): void {
    const next = new Map(allMap.value);
    next.set(hostId, templates);
    allMap.value = next;
}

export function templateRosterFor(
    hostId: string,
    templateId: string,
): readonly ProjectTemplateRosterMemberUi[] {
    return rosterMap.value.get(rosterKey(hostId, templateId)) ?? [];
}

export function setTemplateRoster(
    hostId: string,
    templateId: string,
    members: readonly ProjectTemplateRosterMemberUi[],
): void {
    const next = new Map(rosterMap.value);
    next.set(rosterKey(hostId, templateId), members);
    rosterMap.value = next;
}
