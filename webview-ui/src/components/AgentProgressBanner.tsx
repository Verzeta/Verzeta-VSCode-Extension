// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * AgentProgressBanner — sits above the composer in the Chat tab.
 * Renders only when the current conversation has an active agent
 * run (`agent.run.state` with isRunning=true). Mirrors Android
 * `AgentProgressBanner.kt`:
 *
 *   ⚡ Agent Progress          Step 3
 *   ────────────────────────────────
 *   ⟳ Searching for files matching *.kt
 *   ✓ Read 42 files
 *   ⟳ Summarising findings
 *
 * Steps are rendered most-recent-first (reversed). Status icons:
 *   - running → spinning ⟳ (color: tertiary)
 *   - success → ✓ (color: primary)
 *   - error   → ✕ (color: error)
 *   - pending → ⏱ (dimmed)
 */

import type { AgentStepUi } from '../../../src/shared/wire-types.js';
import { agentRunStateFor, agentStepsFor } from '../state/agentRun.js';
import { activeConversationId } from '../state/conversations.js';

const MAX_STEPS_SHOWN = 8;

export function AgentProgressBanner() {
    const convId = activeConversationId.value;
    if (convId === undefined) return null;
    const runState = agentRunStateFor(convId);
    if (runState === undefined || !runState.isRunning) return null;
    const steps = agentStepsFor(convId);

    const recent = steps.slice(-MAX_STEPS_SHOWN).reverse();

    return (
        <div class="verzeta-agentbanner" role="status" aria-live="polite">
            <div class="verzeta-agentbanner__header">
                <span class="verzeta-agentbanner__icon" aria-hidden="true">
                    <BoltIcon />
                </span>
                <span class="verzeta-agentbanner__title">Agent Progress</span>
                <span class="verzeta-agentbanner__counter">
                    Step {runState.currentIteration}
                    {runState.maxIterations > 0 ? ` / ${runState.maxIterations}` : ''}
                </span>
            </div>
            {recent.length > 0 ? (
                <ul class="verzeta-agentbanner__steps" role="list">
                    {recent.map((step, idx) => (
                        <StepRow key={`${step.iteration}:${idx}`} step={step} />
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

function StepRow({ step }: { readonly step: AgentStepUi }) {
    const iconClass = `verzeta-agentbanner__stepIcon verzeta-agentbanner__stepIcon--${step.status}`;
    const textClass = `verzeta-agentbanner__stepText verzeta-agentbanner__stepText--${step.status}`;
    return (
        <li class="verzeta-agentbanner__step">
            <span class={iconClass} aria-hidden="true">
                <StatusGlyph status={step.status} />
            </span>
            <span class={textClass}>
                {step.description.length > 0 ? step.description : `Step ${step.iteration}`}
            </span>
        </li>
    );
}

function StatusGlyph({ status }: { readonly status: AgentStepUi['status'] }) {
    switch (status) {
        case 'running':
            return <SpinnerIcon />;
        case 'success':
            return <CheckIcon />;
        case 'error':
            return <CrossIcon />;
        case 'pending':
            return <HourglassIcon />;
    }
}

function BoltIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function SpinnerIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" class="verzeta-spin">
            <path
                d="M12 3a9 9 0 1 1-6.36 2.64"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
            />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
                d="M4 12l5 5L20 6"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function CrossIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
                d="M6 6l12 12M6 18L18 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
            />
        </svg>
    );
}

function HourglassIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
                d="M7 3h10M7 21h10M7 3l5 6 5-6M7 21l5-6 5 6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}
