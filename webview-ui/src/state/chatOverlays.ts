// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Overlay visibility signals for the chat-detail surfaces. Each
 * overlay sits on top of MessageTimeline + Composer when its
 * signal is true; only one renders at a time (the open-helpers
 * close the others). Mirrors Android's mutually-exclusive overlay
 * routing in `ChatScreen.kt`.
 */

import { signal } from '@preact/signals';
import type {
    ActivityEventUi,
    GeneratedFileUi,
    PlanUi,
    PollUi,
    ToolCallLogUi,
} from '../../../src/shared/wire-types.js';

export type ChatOverlay = null | 'plans' | 'toolCalls' | 'activity' | 'polls' | 'media' | 'menu';

export const chatOverlay = signal<ChatOverlay>(null);

export function openChatOverlay(o: Exclude<ChatOverlay, null>): void {
    chatOverlay.value = o;
}

export function closeChatOverlay(): void {
    chatOverlay.value = null;
}

// === per-conv caches populated by the *.updated envelopes ===

function key(hostId: string, convId: string): string {
    return `${hostId}::${convId}`;
}

const plansMap = signal<ReadonlyMap<string, readonly PlanUi[]>>(new Map());
export function plansFor(hostId: string, convId: string): readonly PlanUi[] {
    return plansMap.value.get(key(hostId, convId)) ?? [];
}
export function setPlans(hostId: string, convId: string, plans: readonly PlanUi[]): void {
    const next = new Map(plansMap.value);
    next.set(key(hostId, convId), plans);
    plansMap.value = next;
}

const toolCallsMap = signal<ReadonlyMap<string, readonly ToolCallLogUi[]>>(new Map());
export function toolCallsFor(hostId: string, convId: string): readonly ToolCallLogUi[] {
    return toolCallsMap.value.get(key(hostId, convId)) ?? [];
}
export function setToolCalls(
    hostId: string,
    convId: string,
    calls: readonly ToolCallLogUi[],
): void {
    const next = new Map(toolCallsMap.value);
    next.set(key(hostId, convId), calls);
    toolCallsMap.value = next;
}

const activityMap = signal<ReadonlyMap<string, readonly ActivityEventUi[]>>(new Map());
export function activityFor(
    hostId: string,
    scopeKind: 'project' | 'conversation' | 'turn',
    scopeId: string,
): readonly ActivityEventUi[] {
    return activityMap.value.get(`${hostId}::${scopeKind}::${scopeId}`) ?? [];
}
export function setActivity(
    hostId: string,
    scopeKind: 'project' | 'conversation' | 'turn',
    scopeId: string,
    events: readonly ActivityEventUi[],
): void {
    const next = new Map(activityMap.value);
    next.set(`${hostId}::${scopeKind}::${scopeId}`, events);
    activityMap.value = next;
}

const pollsMap = signal<ReadonlyMap<string, readonly PollUi[]>>(new Map());
export function pollsFor(hostId: string, convId: string): readonly PollUi[] {
    return pollsMap.value.get(key(hostId, convId)) ?? [];
}
export function setPolls(hostId: string, convId: string, polls: readonly PollUi[]): void {
    const next = new Map(pollsMap.value);
    next.set(key(hostId, convId), polls);
    pollsMap.value = next;
}

export interface MediaBundle {
    readonly images: readonly GeneratedFileUi[];
    readonly audio: readonly GeneratedFileUi[];
    readonly artifacts: readonly GeneratedFileUi[];
}

const mediaMap = signal<ReadonlyMap<string, MediaBundle>>(new Map());
export function mediaFor(hostId: string, convId: string): MediaBundle {
    return mediaMap.value.get(key(hostId, convId)) ?? { images: [], audio: [], artifacts: [] };
}
export function setMedia(hostId: string, convId: string, bundle: MediaBundle): void {
    const next = new Map(mediaMap.value);
    next.set(key(hostId, convId), bundle);
    mediaMap.value = next;
}
