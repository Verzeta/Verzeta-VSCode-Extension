// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ChatOverlays — the family of full-page surfaces openable from the
 * chat header "More" menu: Plans, Tool calls log, Activity log,
 * Polls, Media gallery. Each is a focused viewer over the current
 * conversation. Mirrors Android `PlansOverlayScreen.kt`,
 * `ToolCallLogScreen.kt`, `ActivityTimelineScreen.kt`,
 * `GeneratedMediaScreen.kt`, and the Polls panel in
 * `MainViewModel.kt`.
 */

import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type {
    ActivityEventUi,
    GeneratedFileUi,
    PlanUi,
    PollUi,
    StepUi,
    ToolCallLogUi,
} from '../../../src/shared/wire-types.js';
import {
    activityFor,
    chatOverlay,
    closeChatOverlay,
    mediaFor,
    openChatOverlay,
    plansFor,
    pollsFor,
    toolCallsFor,
} from '../state/chatOverlays.js';
import { activeConversationId } from '../state/conversations.js';
import { activeHostId } from '../state/hosts.js';
import { send } from '../lib/bus.js';

const STATUS_TINT: Record<string, string> = {
    queued: 'var(--vscode-descriptionForeground)',
    running: 'var(--vscode-charts-blue, #4fc1ff)',
    blocked: 'var(--vscode-charts-orange, #d18616)',
    complete: '#2ea043',
    success: '#2ea043',
    done: '#2ea043',
    abandoned: 'var(--vscode-errorForeground, #d33)',
    error: 'var(--vscode-errorForeground, #d33)',
    skipped: 'var(--vscode-descriptionForeground)',
};

export function ChatOverlaysHost() {
    const overlay = chatOverlay.value;
    if (overlay === null) return null;
    const hostId = activeHostId.value;
    const convId = activeConversationId.value;
    if (hostId === undefined || convId === undefined) {
        return null;
    }
    switch (overlay) {
        case 'plans':
            return <PlansOverlay hostId={hostId} convId={convId} />;
        case 'toolCalls':
            return <ToolCallsOverlay hostId={hostId} convId={convId} />;
        case 'activity':
            return <ActivityOverlay hostId={hostId} convId={convId} />;
        case 'polls':
            return <PollsOverlay hostId={hostId} convId={convId} />;
        case 'media':
            return <MediaOverlay hostId={hostId} convId={convId} />;
        case 'menu':
            return null;
    }
}

/**
 * ChatToolsMenu — small popover anchored at the top-right of the
 * chat header opening the overlays above.
 */
export function ChatToolsMenu() {
    if (chatOverlay.value !== 'menu') return null;
    const onPick = (target: 'plans' | 'toolCalls' | 'activity' | 'polls' | 'media'): void => {
        openChatOverlay(target);
    };
    const hostId = activeHostId.value;
    const convId = activeConversationId.value;
    const onOpenCanvas = (): void => {
        if (hostId === undefined || convId === undefined) return;
        closeChatOverlay();
        send({ type: 'ide.openCanvasRequested', hostId, conversationId: convId });
    };
    return (
        <div
            class="verzeta-chatmenu-backdrop"
            onClick={(e) => {
                if (e.target === e.currentTarget) closeChatOverlay();
            }}
        >
            <div class="verzeta-chatmenu">
                <button
                    type="button"
                    class="verzeta-chatmenu__item"
                    onClick={() => onPick('plans')}
                >
                    Plans
                </button>
                <button
                    type="button"
                    class="verzeta-chatmenu__item"
                    onClick={() => onPick('toolCalls')}
                >
                    Tool calls
                </button>
                <button
                    type="button"
                    class="verzeta-chatmenu__item"
                    onClick={() => onPick('activity')}
                >
                    Activity
                </button>
                <button
                    type="button"
                    class="verzeta-chatmenu__item"
                    onClick={() => onPick('polls')}
                >
                    Polls
                </button>
                <button
                    type="button"
                    class="verzeta-chatmenu__item"
                    onClick={() => onPick('media')}
                >
                    Generated media
                </button>
                <div class="verzeta-chatmenu__sep" aria-hidden="true" />
                <button
                    type="button"
                    class="verzeta-chatmenu__item"
                    onClick={onOpenCanvas}
                    disabled={hostId === undefined || convId === undefined}
                    title="Open the active canvas as a VS Code editor tab"
                >
                    Open canvas in editor
                </button>
            </div>
        </div>
    );
}

// ====================================================================
// Plans overlay
// ====================================================================

function PlansOverlay({ hostId, convId }: { readonly hostId: string; readonly convId: string }) {
    useEffect(() => {
        send({ type: 'plans.requested', hostId, conversationId: convId });
    }, [hostId, convId]);
    const plans = plansFor(hostId, convId);
    const [goalDraft, setGoalDraft] = useState<string>('');

    const onStart = (): void => {
        const trimmed = goalDraft.trim();
        if (trimmed.length === 0) return;
        send({ type: 'task.startRequested', hostId, conversationId: convId, goal: trimmed });
        setGoalDraft('');
    };

    return (
        <OverlayShell title="Plans" subtitle="Current and past agent runs in this conversation.">
            <div class="verzeta-overlay__taskbar">
                <input
                    type="text"
                    class="verzeta-sheet__textinput"
                    placeholder="Describe the goal for a new plan…"
                    value={goalDraft}
                    onInput={(e) => setGoalDraft((e.currentTarget as HTMLInputElement).value)}
                />
                <button
                    type="button"
                    class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                    onClick={onStart}
                    disabled={goalDraft.trim().length === 0}
                >
                    Start
                </button>
                <button
                    type="button"
                    class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                    onClick={() =>
                        send({
                            type: 'plan.stopAllRequested',
                            hostId,
                            conversationId: convId,
                        })
                    }
                >
                    Stop all
                </button>
            </div>
            {plans.length === 0 ? (
                <p class="verzeta-overlay__empty">No plans yet.</p>
            ) : (
                <ul class="verzeta-overlay__list" role="list">
                    {plans.map((p) => (
                        <PlanCard key={p.id} hostId={hostId} plan={p} />
                    ))}
                </ul>
            )}
        </OverlayShell>
    );
}

function PlanCard({ hostId, plan }: { readonly hostId: string; readonly plan: PlanUi }) {
    const [open, setOpen] = useState<boolean>(plan.status === 'running');
    const onStop = (): void => {
        send({ type: 'plan.stopRequested', hostId, planId: plan.id });
    };
    return (
        <li class="verzeta-overlay__card">
            <div class="verzeta-overlay__cardHead">
                <button
                    type="button"
                    class="verzeta-overlay__cardToggle"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                >
                    {open ? '▾' : '▸'}
                </button>
                <div class="verzeta-overlay__cardBody">
                    <span class="verzeta-overlay__cardTitle">
                        {plan.goal.length > 0 ? plan.goal : 'Untitled plan'}
                    </span>
                    <span class="verzeta-overlay__cardMeta">
                        <span style={{ color: STATUS_TINT[plan.status] ?? 'inherit' }}>
                            {plan.status}
                        </span>{' '}
                        · {plan.steps.length} step{plan.steps.length === 1 ? '' : 's'}
                    </span>
                </div>
                {plan.status === 'running' ||
                plan.status === 'queued' ||
                plan.status === 'blocked' ? (
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={onStop}
                    >
                        Stop
                    </button>
                ) : null}
            </div>
            {open ? (
                <ul class="verzeta-overlay__substack" role="list">
                    {plan.steps.map((s) => (
                        <StepRow key={s.id} hostId={hostId} step={s} />
                    ))}
                </ul>
            ) : null}
        </li>
    );
}

function StepRow({ hostId, step }: { readonly hostId: string; readonly step: StepUi }) {
    return (
        <li class="verzeta-overlay__substep">
            <span class="verzeta-overlay__substatus" style={{ color: STATUS_TINT[step.status] }}>
                ●
            </span>
            <div class="verzeta-overlay__substepBody">
                <span class="verzeta-overlay__substepDesc">{step.description}</span>
                {step.result.length > 0 ? (
                    <span class="verzeta-overlay__substepResult">{step.result}</span>
                ) : null}
                {step.errorMessage.length > 0 ? (
                    <span class="verzeta-overlay__substepError">{step.errorMessage}</span>
                ) : null}
            </div>
            {step.status === 'running' || step.status === 'queued' || step.status === 'error' ? (
                <div class="verzeta-overlay__substepActions">
                    {step.status === 'error' ? (
                        <button
                            type="button"
                            class="verzeta-overlay__substepBtn"
                            onClick={() =>
                                send({
                                    type: 'step.retryRequested',
                                    hostId,
                                    stepId: step.id,
                                    notes: '',
                                })
                            }
                        >
                            Retry
                        </button>
                    ) : null}
                    <button
                        type="button"
                        class="verzeta-overlay__substepBtn"
                        onClick={() =>
                            send({
                                type: 'step.overrideRequested',
                                hostId,
                                stepId: step.id,
                            })
                        }
                    >
                        Mark done
                    </button>
                    <button
                        type="button"
                        class="verzeta-overlay__substepBtn"
                        onClick={() =>
                            send({
                                type: 'step.skipRequested',
                                hostId,
                                stepId: step.id,
                                reason: 'Skipped by user',
                            })
                        }
                    >
                        Skip
                    </button>
                </div>
            ) : null}
        </li>
    );
}

// ====================================================================
// Tool calls overlay
// ====================================================================

function ToolCallsOverlay({
    hostId,
    convId,
}: {
    readonly hostId: string;
    readonly convId: string;
}) {
    useEffect(() => {
        send({ type: 'toolCalls.requested', hostId, conversationId: convId });
    }, [hostId, convId]);
    const calls = toolCallsFor(hostId, convId);
    return (
        <OverlayShell title="Tool calls" subtitle="Every tool call in this conversation.">
            {calls.length === 0 ? (
                <p class="verzeta-overlay__empty">No tool calls in this conversation yet.</p>
            ) : (
                <ul class="verzeta-overlay__list" role="list">
                    {calls.map((c) => (
                        <ToolCallRow key={c.id} call={c} />
                    ))}
                </ul>
            )}
        </OverlayShell>
    );
}

function ToolCallRow({ call }: { readonly call: ToolCallLogUi }) {
    const [open, setOpen] = useState<boolean>(false);
    return (
        <li class="verzeta-overlay__card">
            <div class="verzeta-overlay__cardHead">
                <button
                    type="button"
                    class="verzeta-overlay__cardToggle"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                >
                    {open ? '▾' : '▸'}
                </button>
                <div class="verzeta-overlay__cardBody">
                    <span class="verzeta-overlay__cardTitle">{call.toolName}</span>
                    <span class="verzeta-overlay__cardMeta">
                        <span style={{ color: STATUS_TINT[call.status] ?? 'inherit' }}>
                            {call.status}
                        </span>
                        {call.memberAlias.length > 0 ? ` · @${call.memberAlias}` : ''}
                    </span>
                </div>
            </div>
            {open ? (
                <div class="verzeta-overlay__details">
                    {call.arguments.length > 0 ? (
                        <details>
                            <summary>Arguments</summary>
                            <pre class="verzeta-toolconfirm__args">{call.arguments}</pre>
                        </details>
                    ) : null}
                    {call.result.length > 0 ? (
                        <details>
                            <summary>Result</summary>
                            <pre class="verzeta-toolconfirm__args">{call.result}</pre>
                        </details>
                    ) : null}
                    {call.errorMessage.length > 0 ? (
                        <p class="verzeta-overlay__substepError">{call.errorMessage}</p>
                    ) : null}
                </div>
            ) : null}
        </li>
    );
}

// ====================================================================
// Activity overlay
// ====================================================================

function ActivityOverlay({ hostId, convId }: { readonly hostId: string; readonly convId: string }) {
    useEffect(() => {
        send({
            type: 'activity.requested',
            hostId,
            scopeKind: 'conversation',
            scopeId: convId,
        });
    }, [hostId, convId]);
    const events = activityFor(hostId, 'conversation', convId);
    return (
        <OverlayShell title="Activity" subtitle="Audit timeline scoped to this conversation.">
            {events.length === 0 ? (
                <p class="verzeta-overlay__empty">No activity events yet.</p>
            ) : (
                <ul class="verzeta-overlay__list" role="list">
                    {events.map((e) => (
                        <ActivityRow key={e.id} event={e} />
                    ))}
                </ul>
            )}
        </OverlayShell>
    );
}

function ActivityRow({ event }: { readonly event: ActivityEventUi }) {
    return (
        <li class="verzeta-overlay__card">
            <div class="verzeta-overlay__cardHead">
                <span class="verzeta-overlay__activityKind">{event.kind}</span>
                <div class="verzeta-overlay__cardBody">
                    <span class="verzeta-overlay__cardTitle">{event.description}</span>
                    <span class="verzeta-overlay__cardMeta">
                        {event.actorAlias.length > 0 ? `@${event.actorAlias} · ` : ''}
                        {formatTime(event.createdAt)}
                    </span>
                </div>
            </div>
        </li>
    );
}

// ====================================================================
// Polls overlay
// ====================================================================

function PollsOverlay({ hostId, convId }: { readonly hostId: string; readonly convId: string }) {
    useEffect(() => {
        send({ type: 'polls.requested', hostId, conversationId: convId });
    }, [hostId, convId]);
    const polls = pollsFor(hostId, convId);
    const [showForm, setShowForm] = useState<boolean>(false);
    return (
        <OverlayShell title="Polls" subtitle="Vote on a question or start a new one.">
            <button
                type="button"
                class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                onClick={() => setShowForm(true)}
            >
                + Start poll
            </button>
            {showForm ? (
                <StartPollForm hostId={hostId} convId={convId} onClose={() => setShowForm(false)} />
            ) : null}
            {polls.length === 0 ? (
                <p class="verzeta-overlay__empty">No polls in this conversation yet.</p>
            ) : (
                <ul class="verzeta-overlay__list" role="list">
                    {polls.map((p) => (
                        <PollRow key={p.id} hostId={hostId} poll={p} />
                    ))}
                </ul>
            )}
        </OverlayShell>
    );
}

function StartPollForm({
    hostId,
    convId,
    onClose,
}: {
    readonly hostId: string;
    readonly convId: string;
    readonly onClose: () => void;
}) {
    const [question, setQuestion] = useState<string>('');
    const [option1, setOption1] = useState<string>('');
    const [option2, setOption2] = useState<string>('');
    const [option3, setOption3] = useState<string>('');
    const [option4, setOption4] = useState<string>('');
    const [mode, setMode] = useState<'single' | 'multi'>('single');
    const [closesInMinutes, setClosesInMinutes] = useState<number>(0);

    const opts = [option1, option2, option3, option4]
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
    const canSubmit = question.trim().length > 0 && opts.length >= 2;

    const onStart = (): void => {
        if (!canSubmit) return;
        send({
            type: 'poll.startRequested',
            hostId,
            conversationId: convId,
            question: question.trim(),
            options: opts,
            mode,
            closesInMinutes,
        });
        onClose();
    };

    return (
        <div class="verzeta-overlay__form">
            <input
                type="text"
                class="verzeta-sheet__textinput"
                placeholder="Question"
                value={question}
                onInput={(e) => setQuestion((e.currentTarget as HTMLInputElement).value)}
            />
            {([option1, option2, option3, option4] as const).map((o, i) => (
                <input
                    key={i}
                    type="text"
                    class="verzeta-sheet__textinput"
                    placeholder={`Option ${i + 1}${i < 2 ? ' (required)' : ''}`}
                    value={o}
                    onInput={(e) => {
                        const v = (e.currentTarget as HTMLInputElement).value;
                        if (i === 0) setOption1(v);
                        else if (i === 1) setOption2(v);
                        else if (i === 2) setOption3(v);
                        else setOption4(v);
                    }}
                />
            ))}
            <label class="verzeta-overlay__formRow">
                <span>Mode:</span>
                <select
                    value={mode}
                    onChange={(e) =>
                        setMode((e.currentTarget as HTMLSelectElement).value as 'single' | 'multi')
                    }
                >
                    <option value="single">Single</option>
                    <option value="multi">Multi</option>
                </select>
            </label>
            <label class="verzeta-overlay__formRow">
                <span>Closes in (minutes, 0 = manual):</span>
                <input
                    type="number"
                    min={0}
                    class="verzeta-sheet__textinput"
                    value={closesInMinutes}
                    onInput={(e) =>
                        setClosesInMinutes(Number((e.currentTarget as HTMLInputElement).value) || 0)
                    }
                />
            </label>
            <div class="verzeta-overlay__formActions">
                <button
                    type="button"
                    class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                    onClick={onClose}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                    onClick={onStart}
                    disabled={!canSubmit}
                >
                    Start
                </button>
            </div>
        </div>
    );
}

function PollRow({ hostId, poll }: { readonly hostId: string; readonly poll: PollUi }) {
    const total = poll.options.reduce((acc, o) => acc + o.voteCount, 0);
    return (
        <li class="verzeta-overlay__card">
            <div class="verzeta-overlay__cardHead">
                <div class="verzeta-overlay__cardBody">
                    <span class="verzeta-overlay__cardTitle">{poll.question}</span>
                    <span class="verzeta-overlay__cardMeta">
                        {poll.closed ? 'closed' : `${total} vote${total === 1 ? '' : 's'}`}
                        {poll.mode === 'multi' ? ' · multi-select' : ''}
                    </span>
                </div>
                {!poll.closed ? (
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={() =>
                            send({ type: 'poll.closeRequested', hostId, pollId: poll.id })
                        }
                    >
                        Close
                    </button>
                ) : null}
            </div>
            <ul class="verzeta-overlay__substack" role="list">
                {poll.options.map((opt) => {
                    const pct = total > 0 ? Math.round((opt.voteCount / total) * 100) : 0;
                    return (
                        <li
                            key={opt.id}
                            class="verzeta-overlay__pollOption"
                            style={{
                                background: `linear-gradient(to right, rgba(125,91,196,0.32) 0%, rgba(125,91,196,0.32) ${pct}%, transparent ${pct}%, transparent 100%)`,
                            }}
                        >
                            <button
                                type="button"
                                class="verzeta-overlay__pollVote"
                                disabled={poll.closed}
                                onClick={() =>
                                    send({
                                        type: 'poll.voteRequested',
                                        hostId,
                                        pollId: poll.id,
                                        optionId: opt.id,
                                    })
                                }
                            >
                                {opt.text}
                            </button>
                            <span class="verzeta-overlay__pollCount">
                                {opt.voteCount} ({pct}%)
                            </span>
                        </li>
                    );
                })}
            </ul>
        </li>
    );
}

// ====================================================================
// Media overlay
// ====================================================================

function MediaOverlay({ hostId, convId }: { readonly hostId: string; readonly convId: string }) {
    useEffect(() => {
        send({ type: 'media.requested', hostId, conversationId: convId });
    }, [hostId, convId]);
    const bundle = mediaFor(hostId, convId);
    const [tab, setTab] = useState<'images' | 'audio' | 'artifacts'>('images');
    const list =
        tab === 'images' ? bundle.images : tab === 'audio' ? bundle.audio : bundle.artifacts;
    return (
        <OverlayShell
            title="Generated media"
            subtitle="Images, audio, and artifacts produced by the assistant."
        >
            <div class="verzeta-overlay__tabs" role="tablist">
                {(['images', 'audio', 'artifacts'] as const).map((t) => (
                    <button
                        key={t}
                        type="button"
                        class={[
                            'verzeta-overlay__tab',
                            tab === t ? 'verzeta-overlay__tab--active' : '',
                        ]
                            .filter((s) => s.length > 0)
                            .join(' ')}
                        onClick={() => setTab(t)}
                    >
                        {t} (
                        {t === 'images'
                            ? bundle.images.length
                            : t === 'audio'
                              ? bundle.audio.length
                              : bundle.artifacts.length}
                        )
                    </button>
                ))}
            </div>
            {list.length === 0 ? (
                <p class="verzeta-overlay__empty">No {tab} in this conversation yet.</p>
            ) : (
                <ul class="verzeta-overlay__list" role="list">
                    {list.map((f) => (
                        <MediaRow key={f.name} file={f} />
                    ))}
                </ul>
            )}
        </OverlayShell>
    );
}

function MediaRow({ file }: { readonly file: GeneratedFileUi }) {
    return (
        <li class="verzeta-docs__row">
            <span class="verzeta-docs__icon" aria-hidden="true">
                📄
            </span>
            <span class="verzeta-docs__body">
                <span class="verzeta-docs__name">{file.name}</span>
                <span class="verzeta-docs__size">
                    {file.mimeType.length > 0 ? file.mimeType + ' · ' : ''}
                    {formatBytes(file.size)}
                </span>
            </span>
        </li>
    );
}

// ====================================================================
// Shell + helpers
// ====================================================================

function OverlayShell({
    title,
    subtitle,
    children,
}: {
    readonly title: string;
    readonly subtitle: string;
    readonly children: ComponentChildren;
}) {
    return (
        <div class="verzeta-overlay">
            <header class="verzeta-overlay__header">
                <button
                    type="button"
                    class="verzeta-overlay__back"
                    onClick={closeChatOverlay}
                    aria-label="Close"
                >
                    ✕
                </button>
                <div class="verzeta-overlay__heading">
                    <h2 class="verzeta-overlay__title">{title}</h2>
                    <p class="verzeta-overlay__subtitle">{subtitle}</p>
                </div>
            </header>
            <div class="verzeta-overlay__scroll">{children}</div>
        </div>
    );
}

function formatTime(ms: number): string {
    if (ms <= 0) return '';
    const norm = ms < 1e11 ? ms * 1000 : ms;
    const date = new Date(norm);
    return date.toLocaleString();
}

function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
