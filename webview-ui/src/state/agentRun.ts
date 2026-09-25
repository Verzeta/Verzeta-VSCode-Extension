// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Agent run state + per-conversation step list. Drives the
 * AgentProgressBanner that sits above the composer. Mirrors Android
 * `MainUiState.agentRunState` + `MainUiState.agentSteps`.
 *
 * Steps are keyed by (iteration, description) — the started event
 * appends a row with status=running; the matching completed event
 * mutates that row's status to success/error. When the run state's
 * `isRunning` flips to false the step list is cleared so the next
 * run starts clean.
 *
 * Both state buckets are scoped by conversationId — the user may
 * have multiple concurrent runs across paired clients, but this
 * extension only shows the currently-foregrounded conv's progress.
 */

import { signal } from '@preact/signals';
import type { AgentRunStateUi, AgentStepUi } from '../../../src/shared/wire-types.js';

interface RunStateMap {
    readonly [convId: string]: AgentRunStateUi;
}

interface StepsMap {
    readonly [convId: string]: readonly AgentStepUi[];
}

const runStatePerConv = signal<RunStateMap>({});
const stepsPerConv = signal<StepsMap>({});

export function agentRunStateFor(convId: string): AgentRunStateUi | undefined {
    return runStatePerConv.value[convId];
}

export function agentStepsFor(convId: string): readonly AgentStepUi[] {
    return stepsPerConv.value[convId] ?? [];
}

export function upsertAgentStep(step: AgentStepUi): void {
    if (step.conversationId.length === 0) return;
    const prev = stepsPerConv.value[step.conversationId] ?? [];
    const existingIdx = prev.findIndex(
        (s) => s.iteration === step.iteration && s.description === step.description,
    );
    let next: readonly AgentStepUi[];
    if (existingIdx === -1) {
        next = [...prev, step];
    } else {
        const clone = prev.slice();
        clone[existingIdx] = step;
        next = clone;
    }
    stepsPerConv.value = { ...stepsPerConv.value, [step.conversationId]: next };
}

export function setAgentRunState(runState: AgentRunStateUi): void {
    if (runState.conversationId.length === 0) return;
    runStatePerConv.value = { ...runStatePerConv.value, [runState.conversationId]: runState };
    if (!runState.isRunning) {
        // Run finished — clear the step list so the next run starts
        // from an empty banner.
        const { [runState.conversationId]: _drop, ...rest } = stepsPerConv.value;
        void _drop;
        stepsPerConv.value = rest;
    }
}
