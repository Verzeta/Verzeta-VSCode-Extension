// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Project Quick Start state — Android `ProjectCreateScreen` port.
 * One signal holds the templateId being customised; null means the
 * sheet is closed. Draft fields + roster live in this module so the
 * sheet itself stays render-focused.
 */

import { signal } from '@preact/signals';

export interface QuickStartMember {
    readonly agentId: string;
    readonly alias: string;
    readonly isCoordinator: boolean;
    readonly agentName: string;
    readonly modelProvider: string;
    readonly modelName: string;
    readonly allowedTools: readonly string[];
}

export interface QuickStartDraft {
    readonly templateId: string;
    readonly name: string;
    readonly scenario: string;
    readonly goal: string;
    readonly description: string;
    readonly members: readonly QuickStartMember[];
}

/**
 * `null` when the Quick Start sheet is closed; a draft object when
 * open. The draft is seeded from the template + its fetched roster
 * the first time the sheet opens for a given templateId, then the
 * user's edits live here until they tap Cancel or Spin up room.
 */
export const quickStartDraft = signal<QuickStartDraft | null>(null);

export function openQuickStart(seed: QuickStartDraft): void {
    quickStartDraft.value = seed;
}

export function closeQuickStart(): void {
    quickStartDraft.value = null;
    quickStartCreateFailure.value = null;
}

/**
 * The last create failure for the open sheet. `seq` changes on every
 * failure so the same message twice still re-arms the sheet.
 */
export interface QuickStartCreateFailure {
    readonly seq: number;
    readonly templateId: string;
    readonly message: string;
}

export const quickStartCreateFailure = signal<QuickStartCreateFailure | null>(null);

let failureSeq = 0;

/** Record a create failure reported by the extension. */
export function reportQuickStartCreateFailure(templateId: string, message: string): void {
    failureSeq += 1;
    quickStartCreateFailure.value = { seq: failureSeq, templateId, message };
}

export function updateQuickStartDraft(patch: Partial<Omit<QuickStartDraft, 'templateId'>>): void {
    const current = quickStartDraft.value;
    if (current === null) return;
    quickStartDraft.value = { ...current, ...patch };
}

export function setQuickStartMembers(members: readonly QuickStartMember[]): void {
    const current = quickStartDraft.value;
    if (current === null) return;
    quickStartDraft.value = { ...current, members };
}
