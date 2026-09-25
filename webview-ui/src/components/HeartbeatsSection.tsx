// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * HeartbeatsSection — list + add / edit / remove / run-now for the
 * scheduled subagent runs attached to a folder. Visible only in EDIT
 * mode in FolderCreateSheet (the new folder has no id yet to attach
 * heartbeats to — matches Android FolderEditorSheet line 245-254).
 * Mirrors Android `HeartbeatsSection` (ui/folders/FolderEditorSheet.kt
 * lines 591-637) + `HeartbeatCard` (lines 641-730) + the inline
 * Heartbeat editor sheet (`HeartbeatEditorSheet.kt`, simplified
 * here — we ship MVP fields: alias / agent / schedule / goal /
 * enabled + max-runs-per-day).
 *
 *  ┌──────────────────────────────────────────────────────────┐
 *  │ ⚡ Project heartbeats          (3)        [Activity]      │
 *  │ Scheduled subagent runs that produce reports.            │
 *  │                                                          │
 *  │ ┌────────────────────────────────────────────────────┐   │
 *  │ │ ⚡  morning-brief                                  │   │
 *  │ │     @Researcher · 0 0 8 * * *                      │   │
 *  │ │     Goal: summarise overnight metrics ...          │   │
 *  │ │                       [▶ Run] [✎ Edit] [🗑 Remove]│   │
 *  │ └────────────────────────────────────────────────────┘   │
 *  │ [+ Add heartbeat]                                        │
 *  └──────────────────────────────────────────────────────────┘
 */

import { useEffect, useState } from 'preact/hooks';
import type { AgentSummaryUi, HeartbeatConfigUi } from '../../../src/shared/wire-types.js';
import { agentsFor } from '../state/agents.js';
import { heartbeatsFor } from '../state/heartbeats.js';
import { heartbeatRunsFor, heartbeatRunsLoaded } from '../state/detailCaches.js';
import { send } from '../lib/bus.js';

interface DraftHeartbeat {
    readonly id: string;
    alias: string;
    agentId: string;
    schedule: string;
    goal: string;
    enabled: boolean;
    maxRunsPerDay: number;
}

const EMPTY_DRAFT: Omit<DraftHeartbeat, 'id'> = {
    alias: '',
    agentId: '',
    schedule: '',
    goal: '',
    enabled: true,
    maxRunsPerDay: 0,
};

export function HeartbeatsSection({
    hostId,
    folderId,
}: {
    readonly hostId: string;
    readonly folderId: string;
}) {
    const configs = heartbeatsFor(hostId, folderId);
    const agents = agentsFor(hostId);
    const [draft, setDraft] = useState<DraftHeartbeat | null>(null);

    const onAdd = (): void => {
        setDraft({ id: '', ...EMPTY_DRAFT });
    };

    const onEdit = (cfg: HeartbeatConfigUi): void => {
        setDraft({
            id: cfg.id,
            alias: cfg.alias,
            agentId: cfg.agentId,
            schedule: cfg.schedule,
            goal: cfg.goal,
            enabled: cfg.enabled,
            maxRunsPerDay: cfg.maxRunsPerDay,
        });
    };

    const onRun = (id: string): void => {
        send({ type: 'heartbeat.runRequested', hostId, id });
    };

    const onRemove = (id: string): void => {
        send({ type: 'heartbeat.removeRequested', hostId, id, folderId });
    };

    const onApply = (next: DraftHeartbeat): void => {
        if (next.agentId.length === 0 || next.alias.trim().length === 0) return;
        send({
            type: 'heartbeat.upsertRequested',
            hostId,
            id: next.id,
            folderId,
            agentId: next.agentId,
            alias: next.alias.trim(),
            schedule: next.schedule.trim(),
            goal: next.goal.trim(),
            enabled: next.enabled,
            maxRunsPerDay: next.maxRunsPerDay,
            autoSurfaceTargetConversationId: '',
        });
        setDraft(null);
    };

    return (
        <section class="verzeta-sheet__section">
            <div class="verzeta-hb__header">
                <h3 class="verzeta-sheet__label">Project heartbeats</h3>
                <span class="verzeta-hb__count">{configs.length}</span>
            </div>
            <p class="verzeta-sheet__detail">
                Scheduled subagent runs that produce reports. With an empty schedule, a heartbeat
                runs only when started manually.
            </p>
            {configs.length === 0 ? (
                <div class="verzeta-hb__empty">
                    No heartbeats yet. Click "Add heartbeat" to schedule one for a project member.
                </div>
            ) : (
                <ul class="verzeta-hb__list" role="list">
                    {configs.map((cfg) => (
                        <HeartbeatCard
                            key={cfg.id}
                            config={cfg}
                            agents={agents}
                            hostId={hostId}
                            onRun={() => onRun(cfg.id)}
                            onEdit={() => onEdit(cfg)}
                            onRemove={() => onRemove(cfg.id)}
                        />
                    ))}
                </ul>
            )}
            <button type="button" class="verzeta-team__addBtn" onClick={onAdd}>
                + Add heartbeat
            </button>
            {draft !== null ? (
                <HeartbeatEditorDialog
                    draft={draft}
                    agents={agents}
                    onChange={setDraft}
                    onApply={() => onApply(draft)}
                    onCancel={() => setDraft(null)}
                />
            ) : null}
        </section>
    );
}

function HeartbeatCard({
    config,
    agents,
    hostId,
    onRun,
    onEdit,
    onRemove,
}: {
    readonly config: HeartbeatConfigUi;
    readonly agents: readonly AgentSummaryUi[];
    readonly hostId: string;
    readonly onRun: () => void;
    readonly onEdit: () => void;
    readonly onRemove: () => void;
}) {
    const [runsOpen, setRunsOpen] = useState<boolean>(false);
    const runs = heartbeatRunsFor(hostId, config.id);
    const runsLoaded = heartbeatRunsLoaded(hostId, config.id);
    useEffect(() => {
        if (runsOpen) {
            send({ type: 'heartbeat.runs.requested', hostId, configId: config.id });
        }
    }, [runsOpen, hostId, config.id]);
    const agentName =
        agents.find((a) => a.id === config.agentId)?.name ?? config.agentId.slice(0, 8);
    const scheduleText = config.schedule.length > 0 ? config.schedule : 'manual runs only';
    return (
        <li class="verzeta-hb__card">
            <div class="verzeta-hb__cardHead">
                <span class="verzeta-hb__icon" aria-hidden="true">
                    <BoltIcon enabled={config.enabled} />
                </span>
                <div class="verzeta-hb__cardBody">
                    <span class="verzeta-hb__cardTitle">
                        {config.alias.length > 0 ? config.alias : agentName}
                    </span>
                    <span class="verzeta-hb__cardMeta">
                        @{agentName} · <code>{scheduleText}</code>
                    </span>
                </div>
                <div class="verzeta-hb__actions">
                    <button
                        type="button"
                        class="verzeta-hb__iconBtn"
                        onClick={onRun}
                        aria-label="Run now"
                        title="Run now"
                    >
                        <PlayIcon />
                    </button>
                    <button
                        type="button"
                        class="verzeta-hb__iconBtn"
                        onClick={onEdit}
                        aria-label="Edit"
                        title="Edit"
                    >
                        <EditIcon />
                    </button>
                    <button
                        type="button"
                        class="verzeta-hb__iconBtn verzeta-hb__iconBtn--danger"
                        onClick={onRemove}
                        aria-label="Remove"
                        title="Remove"
                    >
                        <TrashIcon />
                    </button>
                </div>
            </div>
            {config.goal.length > 0 ? <p class="verzeta-hb__goal">{config.goal}</p> : null}
            {!config.enabled || config.lastFireOutcome.length > 0 ? (
                <div class="verzeta-hb__statusrow">
                    {!config.enabled ? <span class="verzeta-hb__disabled">disabled</span> : null}
                    {config.lastFireOutcome.length > 0 ? (
                        <span class="verzeta-hb__lastfire">last: {config.lastFireOutcome}</span>
                    ) : null}
                </div>
            ) : null}
            <button type="button" class="verzeta-textbtn" onClick={() => setRunsOpen(!runsOpen)}>
                {runsOpen ? 'Hide recent runs' : 'View recent runs'}
            </button>
            {runsOpen ? (
                !runsLoaded ? (
                    <p class="verzeta-overlay__empty">Fetching runs…</p>
                ) : runs.length === 0 ? (
                    <p class="verzeta-overlay__empty">No runs yet.</p>
                ) : (
                    <ul class="verzeta-overlay__substack" role="list">
                        {runs.map((r) => (
                            <li key={r.id} class="verzeta-overlay__substep">
                                <div class="verzeta-overlay__substepBody">
                                    <span class="verzeta-overlay__substepDesc">
                                        {r.outcome.length > 0 ? r.outcome : 'pending'}
                                    </span>
                                    <span class="verzeta-overlay__substepResult">
                                        started{' '}
                                        {r.startedAt > 0
                                            ? new Date(
                                                  r.startedAt < 1e11
                                                      ? r.startedAt * 1000
                                                      : r.startedAt,
                                              ).toLocaleString()
                                            : 'never'}
                                    </span>
                                    {r.report.length > 0 ? (
                                        <span class="verzeta-overlay__substepResult">
                                            {r.report}
                                        </span>
                                    ) : null}
                                </div>
                            </li>
                        ))}
                    </ul>
                )
            ) : null}
        </li>
    );
}

function HeartbeatEditorDialog({
    draft,
    agents,
    onChange,
    onApply,
    onCancel,
}: {
    readonly draft: DraftHeartbeat;
    readonly agents: readonly AgentSummaryUi[];
    readonly onChange: (next: DraftHeartbeat) => void;
    readonly onApply: () => void;
    readonly onCancel: () => void;
}) {
    const canApply = draft.alias.trim().length > 0 && draft.agentId.length > 0;

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={draft.id.length > 0 ? 'Edit heartbeat' : 'Add heartbeat'}
            onClick={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">
                        {draft.id.length > 0 ? 'Edit heartbeat' : 'Add heartbeat'}
                    </h3>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={onCancel}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-addmember__body">
                    <section class="verzeta-addmember__section">
                        <h4 class="verzeta-addmember__sectionTitle">Alias</h4>
                        <input
                            type="text"
                            class="verzeta-sheet__textinput"
                            placeholder="e.g. morning-brief"
                            value={draft.alias}
                            onInput={(e) =>
                                onChange({
                                    ...draft,
                                    alias: (e.currentTarget as HTMLInputElement).value,
                                })
                            }
                        />
                    </section>
                    <section class="verzeta-addmember__section">
                        <h4 class="verzeta-addmember__sectionTitle">Agent</h4>
                        {agents.length === 0 ? (
                            <p class="verzeta-addmember__empty">
                                No agents available. Catalogs may still be loading.
                            </p>
                        ) : (
                            <select
                                class="verzeta-configmember__select"
                                value={draft.agentId}
                                onChange={(e) =>
                                    onChange({
                                        ...draft,
                                        agentId: (e.currentTarget as HTMLSelectElement).value,
                                    })
                                }
                            >
                                <option value="">Pick an agent</option>
                                {agents.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </section>
                    <section class="verzeta-addmember__section">
                        <h4 class="verzeta-addmember__sectionTitle">Schedule</h4>
                        <input
                            type="text"
                            class="verzeta-sheet__textinput"
                            placeholder="Cron expression (leave empty for manual runs only)"
                            value={draft.schedule}
                            onInput={(e) =>
                                onChange({
                                    ...draft,
                                    schedule: (e.currentTarget as HTMLInputElement).value,
                                })
                            }
                        />
                        <p class="verzeta-addmember__hint">
                            6-field cron, e.g. <code>0 0 8 * * *</code> = daily 08:00.
                        </p>
                    </section>
                    <section class="verzeta-addmember__section">
                        <h4 class="verzeta-addmember__sectionTitle">Goal</h4>
                        <textarea
                            class="verzeta-sheet__textarea"
                            rows={3}
                            placeholder="What should this heartbeat produce when it fires?"
                            value={draft.goal}
                            onInput={(e) =>
                                onChange({
                                    ...draft,
                                    goal: (e.currentTarget as HTMLTextAreaElement).value,
                                })
                            }
                        />
                    </section>
                    <section class="verzeta-addmember__section">
                        <h4 class="verzeta-addmember__sectionTitle">Max runs per day</h4>
                        <input
                            type="number"
                            min={0}
                            max={1440}
                            class="verzeta-sheet__textinput"
                            value={draft.maxRunsPerDay}
                            onInput={(e) => {
                                const raw = Number((e.currentTarget as HTMLInputElement).value);
                                onChange({
                                    ...draft,
                                    maxRunsPerDay: Number.isFinite(raw) ? raw : 0,
                                });
                            }}
                        />
                        <p class="verzeta-addmember__hint">
                            0 means no cap. The cap covers both scheduled and manual runs.
                        </p>
                    </section>
                    <section class="verzeta-addmember__section">
                        <label class="verzeta-addmember__coordToggle">
                            <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(e) =>
                                    onChange({
                                        ...draft,
                                        enabled: (e.currentTarget as HTMLInputElement).checked,
                                    })
                                }
                            />
                            <span class="verzeta-addmember__coordLabel">
                                Enabled: scheduled runs happen. Disabled: manual runs only.
                            </span>
                        </label>
                    </section>
                </div>
                <footer class="verzeta-addmember__footer">
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                        disabled={!canApply}
                        onClick={onApply}
                    >
                        {draft.id.length > 0 ? 'Save' : 'Add'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

function BoltIcon({ enabled }: { readonly enabled: boolean }) {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={enabled ? '#cd6700' : 'none'}
            stroke={enabled ? '#cd6700' : 'currentColor'}
        >
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke-width="1.6" stroke-linejoin="round" />
        </svg>
    );
}

function PlayIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4v16l13-8L7 4Z" />
        </svg>
    );
}

function EditIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M4 20h4l10-10-4-4L4 16v4ZM14 6l4 4"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}
