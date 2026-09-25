// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * QuickStartProjectSheet — port of Android ProjectCreateScreen.
 * Tapping a template card opens this sheet seeded with the
 * template's name / scenario / goal / description / roster. The
 * user edits any field, adds / removes / re-aliases members,
 * marks a coordinator, then taps "Spin up room" — the host's
 * `project_template.create_project` op runs with the user's
 * customisations payload (host falls back to the template's
 * defaults for any blank field).
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AgentSummaryUi } from '../../../src/shared/wire-types.js';
import { agentsFor } from '../state/agents.js';
import { activeHostId } from '../state/hosts.js';
import { toolsFor } from '../state/catalogs.js';
import { modelCatalogFor } from '../state/models.js';
import {
    projectTemplatesAllFor,
    projectTemplatesFor,
    templateRosterFor,
} from '../state/projectTemplates.js';
import {
    closeQuickStart,
    quickStartCreateFailure,
    quickStartDraft,
    setQuickStartMembers,
    updateQuickStartDraft,
    type QuickStartMember,
} from '../state/projectQuickStart.js';
import { hasBlankAlias } from '../lib/members.js';
import { send } from '../lib/bus.js';
import { ConfigureMemberSheet } from './ConfigureMemberSheet.js';

export function QuickStartProjectSheet() {
    const draft = quickStartDraft.value;
    if (draft === null) return null;
    const hostId = activeHostId.value;
    if (hostId === undefined) {
        closeQuickStart();
        return null;
    }
    return <Body hostId={hostId} />;
}

function Body({ hostId }: { readonly hostId: string }) {
    const draft = quickStartDraft.value;
    if (draft === null) return null;
    const templateId = draft.templateId;
    const template = useMemo(() => {
        const a = projectTemplatesAllFor(hostId).find((t) => t.id === templateId);
        if (a !== undefined) return a;
        return projectTemplatesFor(hostId).find((t) => t.id === templateId);
    }, [hostId, templateId]);
    const roster = templateRosterFor(hostId, templateId);
    const agents = agentsFor(hostId);
    const [creating, setCreating] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const failure = quickStartCreateFailure.value;

    // A failed create unlocks the form and shows why, so the user can
    // fix the draft or retry without closing the sheet.
    useEffect(() => {
        if (failure === null || failure.templateId !== templateId) return;
        setCreating(false);
        setError(failure.message);
    }, [failure, templateId]);
    const [pickerOpen, setPickerOpen] = useState<boolean>(false);

    // Fetch the template roster + agents the first time the sheet
    // opens for this template. Once roster lands, hydrate the members
    // list if the user hasn't already edited it.
    useEffect(() => {
        send({ type: 'template.roster.requested', hostId, templateId });
        send({ type: 'agents.listRequested', hostId });
        // The Add Member picker and the Configure (provider/model)
        // dialog both read from these catalogs — make sure we have
        // fresh data before the user reaches for either.
        send({ type: 'tools.listRequested', hostId });
        send({ type: 'models.catalog.requested', hostId });
    }, [hostId, templateId]);

    useEffect(() => {
        if (draft.members.length > 0) return;
        if (roster.length === 0) return;
        const seeded: QuickStartMember[] = roster.map((m) => ({
            agentId: m.agentId,
            alias: m.alias,
            isCoordinator: m.isCoordinator,
            agentName: m.agentName.length > 0 ? m.agentName : m.alias,
            modelProvider: m.modelProvider,
            modelName: m.modelName,
            allowedTools: m.allowedTools,
        }));
        setQuickStartMembers(seeded);
    }, [hostId, templateId, roster, draft.members.length]);

    const blankAlias = hasBlankAlias(draft.members);
    const canSave = draft.name.trim().length > 0 && !blankAlias && !creating;
    const canSaveAsTemplate = draft.name.trim().length > 0 && !blankAlias && !creating;
    const [configureIndex, setConfigureIndex] = useState<number | null>(null);

    const onSave = (): void => {
        if (!canSave) return;
        setCreating(true);
        setError('');
        send({
            type: 'projectTemplate.createProjectRequested',
            hostId,
            templateId,
            name: draft.name.trim(),
            goal: draft.goal.trim(),
            description: draft.description.trim(),
            scenario: draft.scenario.trim(),
            members: draft.members.map((m) => ({
                agentId: m.agentId,
                alias: m.alias.trim(),
                isCoordinator: m.isCoordinator,
                modelProvider: m.modelProvider,
                modelName: m.modelName,
                allowedTools: m.allowedTools,
            })),
        });
        // The host's projectTemplate.projectCreated event closes the
        // sheet via the App.tsx handler. We don't optimistically close
        // here so the user can see the spinner during the round-trip.
    };

    const onSaveAsTemplate = (): void => {
        if (!canSaveAsTemplate) return;
        send({
            type: 'template.saveAsNewRequested',
            hostId,
            sourceTemplateId: templateId,
            name: draft.name.trim(),
            scenario: draft.scenario.trim(),
            goal: draft.goal.trim(),
            description: draft.description.trim(),
            members: draft.members.map((m) => ({
                agentId: m.agentId,
                alias: m.alias.trim(),
                isCoordinator: m.isCoordinator,
                modelProvider: m.modelProvider,
                modelName: m.modelName,
                allowedTools: m.allowedTools,
            })),
        });
        setError('✓ Saved to your Template Library');
        // Clear the message after a few seconds.
        setTimeout(() => setError(''), 4000);
    };

    const onAddMember = (agent: AgentSummaryUi): void => {
        const base = agent.name.length > 0 ? agent.name : 'Member';
        const taken = new Set(draft.members.map((m) => m.alias.toLowerCase()));
        let alias = base;
        let n = 2;
        while (taken.has(alias.toLowerCase())) {
            alias = `${base} ${n}`;
            n += 1;
        }
        setQuickStartMembers([
            ...draft.members,
            {
                agentId: agent.id,
                alias,
                isCoordinator: agent.isCoordinator,
                agentName: agent.name,
                modelProvider: '',
                modelName: '',
                allowedTools: [],
            },
        ]);
        setPickerOpen(false);
    };

    const onMemberOverride = (
        index: number,
        modelProvider: string,
        modelName: string,
        allowedTools: readonly string[],
    ): void => {
        const next = draft.members.slice();
        const target = next[index];
        if (target === undefined) return;
        next[index] = { ...target, modelProvider, modelName, allowedTools };
        setQuickStartMembers(next);
    };

    const onAliasChange = (index: number, alias: string): void => {
        const next = draft.members.slice();
        const target = next[index];
        if (target === undefined) return;
        next[index] = { ...target, alias };
        setQuickStartMembers(next);
    };

    const onCoordinatorPick = (index: number): void => {
        setQuickStartMembers(draft.members.map((m, i) => ({ ...m, isCoordinator: i === index })));
    };

    const onRemoveMember = (index: number): void => {
        setQuickStartMembers(draft.members.filter((_, i) => i !== index));
    };

    const banner = template !== undefined ? bannerStyle(template.baseHue) : null;

    return (
        <div
            class="verzeta-prooms-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Quick Start"
        >
            <header class="verzeta-prooms__header">
                <button
                    type="button"
                    class="verzeta-prooms__back"
                    onClick={closeQuickStart}
                    aria-label="Back"
                    disabled={creating}
                >
                    ‹
                </button>
                <h1 class="verzeta-prooms__title">Quick Start</h1>
            </header>
            <div class="verzeta-prooms__crumb">
                <span>HOME</span>
                <span aria-hidden="true">·</span>
                <span>NEW PROJECT</span>
                {template !== undefined && template.tagLabel.length > 0 ? (
                    <>
                        <span aria-hidden="true">·</span>
                        <span>{template.tagLabel.toUpperCase()}</span>
                    </>
                ) : null}
            </div>
            <div class="verzeta-prooms__scroll">
                <section class="verzeta-qs__panel">
                    {banner !== null ? (
                        <div class="verzeta-qs__banner" style={banner} aria-hidden="true">
                            <span class="verzeta-tplcard__tag">
                                {template?.tagLabel || template?.category || 'PROJECT'}
                            </span>
                        </div>
                    ) : null}
                    <label class="verzeta-qs__label">PROJECT NAME</label>
                    <input
                        type="text"
                        class="verzeta-sheet__textinput"
                        value={draft.name}
                        onInput={(e) =>
                            updateQuickStartDraft({
                                name: (e.currentTarget as HTMLInputElement).value,
                            })
                        }
                        placeholder="Name your project room"
                        disabled={creating}
                    />
                    <label class="verzeta-qs__label">SCENARIO</label>
                    <input
                        type="text"
                        class="verzeta-sheet__textinput"
                        value={draft.scenario}
                        onInput={(e) =>
                            updateQuickStartDraft({
                                scenario: (e.currentTarget as HTMLInputElement).value,
                            })
                        }
                        placeholder='Shown in the room header, e.g. "Launch · multi-channel"'
                        disabled={creating}
                    />
                </section>

                <section class="verzeta-qs__panel">
                    <label class="verzeta-qs__label">GOAL: WHAT DOES SUCCESS LOOK LIKE?</label>
                    <textarea
                        class="verzeta-sheet__textarea"
                        rows={3}
                        value={draft.goal}
                        onInput={(e) =>
                            updateQuickStartDraft({
                                goal: (e.currentTarget as HTMLTextAreaElement).value,
                            })
                        }
                        placeholder="Describe the outcome the team should deliver."
                        disabled={creating}
                    />
                    <label class="verzeta-qs__label">PROJECT DESCRIPTION / CONTEXT</label>
                    <textarea
                        class="verzeta-sheet__textarea"
                        rows={4}
                        value={draft.description}
                        onInput={(e) =>
                            updateQuickStartDraft({
                                description: (e.currentTarget as HTMLTextAreaElement).value,
                            })
                        }
                        placeholder="Paste a brief, link a doc, or describe the situation."
                        disabled={creating}
                    />
                </section>

                <section class="verzeta-qs__panel">
                    <div class="verzeta-qs__teamHead">
                        <span class="verzeta-qs__teamTitle">Teammates</span>
                        <span class="verzeta-qs__teamCount">
                            {draft.members.length} member
                            {draft.members.length === 1 ? '' : 's'}
                        </span>
                    </div>
                    <p class="verzeta-qs__teamHint">
                        Add, remove, or rename agents and tune each one&apos;s provider, model, and
                        tools. The same agent can appear multiple times under different aliases. ★
                        marks the coordinator.
                    </p>
                    {draft.members.length === 0 ? (
                        <p class="verzeta-prooms__empty">
                            No members yet. Tap &quot;Add member&quot; to pick an agent.
                        </p>
                    ) : (
                        <ul class="verzeta-qs__memberList" role="list">
                            {draft.members.map((m, idx) => (
                                <li key={`${m.agentId}::${idx}`} class="verzeta-qs__memberRow">
                                    <span class="verzeta-qs__memberAvatar" aria-hidden="true">
                                        {m.alias.charAt(0).toUpperCase() || '?'}
                                    </span>
                                    <div class="verzeta-qs__memberBody">
                                        <input
                                            type="text"
                                            class="verzeta-qs__memberAlias"
                                            value={m.alias}
                                            onInput={(e) =>
                                                onAliasChange(
                                                    idx,
                                                    (e.currentTarget as HTMLInputElement).value,
                                                )
                                            }
                                            placeholder="alias"
                                            disabled={creating}
                                            aria-label={`Alias for ${m.agentName}`}
                                        />
                                        <span class="verzeta-qs__memberAgent">
                                            {m.agentName.length > 0 ? m.agentName : 'Unknown agent'}
                                        </span>
                                        <span class="verzeta-qs__memberOverride">
                                            {overrideSummary(m)}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        class="verzeta-qs__configBtn"
                                        onClick={() => setConfigureIndex(idx)}
                                        title="Configure provider / model / tool whitelist"
                                        aria-label={`Configure ${m.alias}`}
                                        disabled={creating}
                                    >
                                        <ConfigureIcon />
                                    </button>
                                    <button
                                        type="button"
                                        class={`verzeta-qs__coordBtn ${m.isCoordinator ? 'verzeta-qs__coordBtn--active' : ''}`}
                                        onClick={() => onCoordinatorPick(idx)}
                                        title={
                                            m.isCoordinator ? 'Coordinator' : 'Mark as coordinator'
                                        }
                                        disabled={creating}
                                    >
                                        {m.isCoordinator ? '★' : '☆'}
                                    </button>
                                    <button
                                        type="button"
                                        class="verzeta-qs__removeBtn"
                                        onClick={() => onRemoveMember(idx)}
                                        title="Remove member"
                                        disabled={creating}
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <button
                        type="button"
                        class="verzeta-team__addBtn"
                        onClick={() => setPickerOpen(true)}
                        disabled={creating || agents.length === 0}
                        title={agents.length === 0 ? 'Loading agents…' : 'Add a member'}
                    >
                        + Add member
                    </button>
                </section>
            </div>
            <footer class="verzeta-qs__footer">
                {error.length > 0 ? <p class="verzeta-qs__error">{error}</p> : null}
                <button
                    type="button"
                    class="verzeta-sheet__btn verzeta-sheet__btn--secondary verzeta-qs__saveTemplateBtn"
                    onClick={onSaveAsTemplate}
                    disabled={!canSaveAsTemplate}
                    title="Save the current draft (name, scenario, goal, description, roster) as a new template in your library"
                >
                    + Save as template
                </button>
                <div class="verzeta-qs__footerRow">
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={closeQuickStart}
                        disabled={creating}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                        onClick={onSave}
                        disabled={!canSave}
                    >
                        {creating ? 'Creating…' : '✓ Create room'}
                    </button>
                </div>
            </footer>
            {pickerOpen ? (
                <AgentPickerDialog
                    agents={agents}
                    onPick={onAddMember}
                    onClose={() => setPickerOpen(false)}
                />
            ) : null}
            {(() => {
                if (configureIndex === null) return null;
                const target = draft.members[configureIndex];
                if (target === undefined) return null;
                const idx = configureIndex;
                return (
                    <ConfigureMemberSheet
                        member={{
                            alias: target.alias,
                            modelProvider: target.modelProvider,
                            modelName: target.modelName,
                            allowedTools: target.allowedTools,
                        }}
                        providers={modelCatalogFor(hostId)?.providers ?? []}
                        availableTools={toolsFor(hostId)}
                        onApply={(provider, model, allowed) => {
                            onMemberOverride(idx, provider, model, allowed);
                            setConfigureIndex(null);
                        }}
                        onCancel={() => setConfigureIndex(null)}
                    />
                );
            })()}
        </div>
    );
}

function overrideSummary(m: QuickStartMember): string {
    const parts: string[] = [];
    if (m.modelProvider.length > 0) {
        parts.push(
            m.modelName.length > 0 ? `${m.modelProvider} / ${m.modelName}` : m.modelProvider,
        );
    } else if (m.modelName.length > 0) {
        parts.push(`model: ${m.modelName}`);
    }
    if (m.allowedTools.length > 0) {
        parts.push(`${m.allowedTools.length} tool${m.allowedTools.length === 1 ? '' : 's'}`);
    }
    return parts.length === 0 ? 'Default model · all tools' : parts.join(' · ');
}

function ConfigureIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M4 7h6M14 7h6M4 12h2M10 12h10M4 17h10M18 17h2"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
            <circle cx="12" cy="7" r="2" stroke="currentColor" stroke-width="1.6" />
            <circle cx="8" cy="12" r="2" stroke="currentColor" stroke-width="1.6" />
            <circle cx="16" cy="17" r="2" stroke="currentColor" stroke-width="1.6" />
        </svg>
    );
}

function AgentPickerDialog({
    agents,
    onPick,
    onClose,
}: {
    readonly agents: readonly AgentSummaryUi[];
    readonly onPick: (agent: AgentSummaryUi) => void;
    readonly onClose: () => void;
}) {
    const [query, setQuery] = useState<string>('');
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (needle.length === 0) return agents;
        return agents.filter(
            (a) =>
                a.name.toLowerCase().includes(needle) ||
                (a.description ?? '').toLowerCase().includes(needle),
        );
    }, [agents, query]);
    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">Add member</h3>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-addmember__body">
                    <input
                        type="search"
                        class="verzeta-sheet__textinput"
                        placeholder="Search agents…"
                        value={query}
                        onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
                    />
                    {filtered.length === 0 ? (
                        <p class="verzeta-prooms__empty">No agents match.</p>
                    ) : (
                        <ul class="verzeta-configmember__tools" role="list">
                            {filtered.map((a) => (
                                <li key={a.id}>
                                    <button
                                        type="button"
                                        class="verzeta-qs__pickRow"
                                        onClick={() => onPick(a)}
                                    >
                                        <span class="verzeta-qs__pickName">
                                            {a.name}
                                            {a.isCoordinator ? (
                                                <span class="verzeta-team__coordTag">★</span>
                                            ) : null}
                                        </span>
                                        {(a.description ?? '').length > 0 ? (
                                            <span class="verzeta-qs__pickDesc">
                                                {a.description}
                                            </span>
                                        ) : null}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}

function bannerStyle(baseHue: number): { background: string } {
    const hue = ((baseHue % 360) + 360) % 360;
    return {
        background: `linear-gradient(135deg, hsla(${hue}, 60%, 38%, 0.55) 0%, hsla(${hue}, 60%, 28%, 0.85) 100%)`,
    };
}
