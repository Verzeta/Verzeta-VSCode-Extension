// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ConversationSettingsSheet — per-conversation settings panel,
 * mirrors Android's chat settings drawer + the desktop QML
 * RightSettingsPanel. Slides over the chat detail when the cog
 * in ChatHeader is clicked.
 *
 * Section order matches Android (`MainViewModel.kt` ordering):
 *   1. Primary agent (top — most often changed)
 *   2. Model (provider · model + Change button → ModelPickerSheet)
 *   3. System prompt
 *   4. Generation parameters: temperature · max tokens · context window
 *   5. Agent behaviour: pattern + require-confirmation + tools + RAG
 *
 * Each change posts a typed envelope back to the extension so
 * server state stays canonical; the sheet re-renders against the
 * `conv.settings.updated` echo.
 */

import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { AgentPattern, ConvSettingsUi, SkillUi } from '../../../src/shared/wire-types.js';
import type { RemoteExecMode } from '../../../src/shared/webview-protocol.js';
import { convExecModeFor } from '../state/convExecMode.js';
import { activeConversationId } from '../state/conversations.js';
import { activeConvSettings } from '../state/convSettings.js';
import { activeHostId } from '../state/hosts.js';
import { agentsFor } from '../state/agents.js';
import { skillsFor } from '../state/catalogs.js';
import { closeChatSettingsSheet, openModelPickerSheet } from '../state/chatUi.js';
import { modelCatalogFor } from '../state/models.js';
import {
    convHeartbeatGateFor,
    convPreferredSkillsFor,
    convSkillOverrideFor,
} from '../state/convSkills.js';
import { send } from '../lib/bus.js';

const AGENT_PATTERNS: readonly { value: AgentPattern; label: string }[] = [
    { value: 'direct', label: 'Direct' },
    { value: 'react', label: 'ReAct' },
    { value: 'planner', label: 'Planner' },
    { value: 'router', label: 'Router' },
    { value: 'multi_agent', label: 'Multi-agent' },
    { value: 'memory', label: 'Memory' },
];

export function ConversationSettingsSheet() {
    const hostId = activeHostId.value;
    const convId = activeConversationId.value;
    const settings = activeConvSettings.value;

    useEffect(() => {
        if (hostId === undefined || convId === undefined) return;
        send({ type: 'conv.settings.requested', hostId, conversationId: convId });
        send({ type: 'agents.listRequested', hostId });
        send({ type: 'models.catalog.requested', hostId });
        send({ type: 'skills.listRequested', hostId });
        send({ type: 'convSkillOverride.requested', hostId, conversationId: convId });
        send({ type: 'convPreferredSkills.requested', hostId, conversationId: convId });
        send({ type: 'convHeartbeatGate.requested', hostId, conversationId: convId });
    }, [hostId, convId]);

    if (hostId === undefined || convId === undefined) {
        return (
            <section class="verzeta-sheet" role="dialog" aria-label="Conversation settings">
                <header class="verzeta-sheet__header">
                    <h2 class="verzeta-sheet__title">Chat settings</h2>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={closeChatSettingsSheet}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-sheet__empty">No conversation selected.</div>
            </section>
        );
    }
    if (settings === undefined) {
        return (
            <section class="verzeta-sheet" role="dialog" aria-label="Conversation settings">
                <header class="verzeta-sheet__header">
                    <h2 class="verzeta-sheet__title">Chat settings</h2>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={closeChatSettingsSheet}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-sheet__empty">Loading…</div>
            </section>
        );
    }
    return <SheetBody hostId={hostId} conversationId={convId} initial={settings} />;
}

function SheetBody({
    hostId,
    conversationId,
    initial,
}: {
    readonly hostId: string;
    readonly conversationId: string;
    readonly initial: ConvSettingsUi;
}) {
    const [draft, setDraft] = useState<ConvSettingsUi>(initial);
    const agents = agentsFor(hostId);

    // When the canonical settings stream in (echo from save) reset
    // the local draft to match.
    useEffect(() => {
        setDraft(initial);
    }, [initial]);

    const savePromptOnBlur = (): void => {
        if (draft.systemPrompt === initial.systemPrompt) return;
        send({
            type: 'conv.settings.save',
            hostId,
            conversationId,
            patch: { systemPrompt: draft.systemPrompt },
        });
    };

    const saveNumberOnBlur = (
        field:
            | 'temperature'
            | 'maxTokens'
            | 'contextWindow'
            | 'topK'
            | 'topP'
            | 'repeatPenalty'
            | 'presencePenalty'
            | 'frequencyPenalty'
            | 'compactEveryTurns',
        value: number,
    ): void => {
        if (draft[field] === initial[field]) return;
        send({
            type: 'conv.settings.save',
            hostId,
            conversationId,
            patch: { [field]: value },
        });
    };

    const saveBoolean = (
        field: 'forceAppSampling' | 'toolsInSystemPrompt' | 'dynamicCompactEnabled' | 'ragEnabled',
        value: boolean,
    ): void => {
        setDraft({ ...draft, [field]: value });
        send({
            type: 'conv.settings.save',
            hostId,
            conversationId,
            patch: { [field]: value },
        });
    };

    const catalog = modelCatalogFor(hostId);
    const activeProviderText = catalog?.activeProvider ?? '';
    const activeModelText = catalog?.activeModel ?? '';
    const modelSubtitle =
        activeProviderText.length > 0 && activeModelText.length > 0
            ? `${activeProviderText} · ${activeModelText}`
            : activeModelText.length > 0
              ? activeModelText
              : activeProviderText.length > 0
                ? activeProviderText
                : 'No model selected';

    const primaryAgent = agents.find((a) => a.id === draft.primaryAgentId);
    const primaryAgentName =
        draft.primaryAgentId.length === 0 || primaryAgent === undefined
            ? 'Default (no agent)'
            : primaryAgent.name;

    return (
        <section class="verzeta-sheet" role="dialog" aria-label="Conversation settings">
            <header class="verzeta-sheet__header">
                <h2 class="verzeta-sheet__title">Chat settings</h2>
                <button
                    type="button"
                    class="verzeta-sheet__close"
                    onClick={closeChatSettingsSheet}
                    aria-label="Close"
                >
                    ✕
                </button>
            </header>
            <div class="verzeta-sheet__body">
                {!initial.isGroup ? (
                    <FieldSection label="Primary agent">
                        <div class="verzeta-sheet__rowwithaction">
                            <span class="verzeta-sheet__rowprimary" title={primaryAgentName}>
                                {primaryAgentName}
                            </span>
                            <select
                                class="verzeta-sheet__select verzeta-sheet__select--inline"
                                value={draft.primaryAgentId}
                                aria-label="Pick primary agent"
                                onChange={(e) => {
                                    const v = (e.currentTarget as HTMLSelectElement).value;
                                    setDraft({ ...draft, primaryAgentId: v });
                                    send({
                                        type: 'conv.primary_agent.set',
                                        hostId,
                                        conversationId,
                                        agentId: v,
                                    });
                                }}
                            >
                                <option value="">(Not set)</option>
                                {agents.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </FieldSection>
                ) : (
                    <FieldSection label="Members">
                        <p class="verzeta-sheet__detail">
                            Group chat members are managed in the project room editor on the host.
                            Edit the folder this chat belongs to via the Verzeta Studio desktop app
                            to change the roster.
                        </p>
                    </FieldSection>
                )}

                <FieldSection label="Model">
                    <div class="verzeta-sheet__rowwithaction">
                        <span class="verzeta-sheet__rowprimary" title={modelSubtitle}>
                            {modelSubtitle}
                        </span>
                        <button
                            type="button"
                            class="verzeta-sheet__rowbutton"
                            onClick={openModelPickerSheet}
                        >
                            Change
                        </button>
                    </div>
                </FieldSection>

                <FieldSection label="System prompt">
                    <textarea
                        class="verzeta-sheet__textarea"
                        rows={5}
                        value={draft.systemPrompt}
                        onInput={(e) =>
                            setDraft({
                                ...draft,
                                systemPrompt: (e.currentTarget as HTMLTextAreaElement).value,
                            })
                        }
                        onBlur={savePromptOnBlur}
                        placeholder="You are a helpful assistant…"
                    />
                </FieldSection>

                <FieldSection label="Parameters">
                    <div class="verzeta-sheet__grid">
                        <NumberField
                            label="Temperature"
                            value={draft.temperature}
                            min={0}
                            max={2}
                            step={0.05}
                            onChange={(v) => {
                                setDraft({ ...draft, temperature: v });
                            }}
                            onCommit={(v) => saveNumberOnBlur('temperature', v)}
                        />
                        <NumberField
                            label="Max tokens (-1 = Auto)"
                            value={draft.maxTokens}
                            min={-1}
                            max={128_000}
                            step={128}
                            onChange={(v) => setDraft({ ...draft, maxTokens: v })}
                            onCommit={(v) => saveNumberOnBlur('maxTokens', v)}
                        />
                        <NumberField
                            label="Context window"
                            value={draft.contextWindow}
                            min={1024}
                            max={131_072}
                            step={1024}
                            onChange={(v) => setDraft({ ...draft, contextWindow: v })}
                            onCommit={(v) => saveNumberOnBlur('contextWindow', v)}
                        />
                    </div>
                </FieldSection>

                <FieldSection label="Sampling">
                    <ToggleRow
                        label="Use app-recommended sampling"
                        detail="Apply the host's tuned profile for the active model. Turn off to set the values yourself."
                        value={draft.forceAppSampling}
                        onChange={(v) => saveBoolean('forceAppSampling', v)}
                    />
                    <div class="verzeta-sheet__grid">
                        <NumberField
                            label="Top K (-1 = Auto)"
                            value={draft.topK}
                            min={-1}
                            max={200}
                            step={1}
                            disabled={draft.forceAppSampling}
                            onChange={(v) => setDraft({ ...draft, topK: v })}
                            onCommit={(v) => saveNumberOnBlur('topK', v)}
                        />
                        <NumberField
                            label="Top P (-1 = Auto)"
                            value={draft.topP}
                            min={-1}
                            max={1}
                            step={0.05}
                            disabled={draft.forceAppSampling}
                            onChange={(v) => setDraft({ ...draft, topP: v })}
                            onCommit={(v) => saveNumberOnBlur('topP', v)}
                        />
                        <NumberField
                            label="Repeat penalty (-1 = Auto)"
                            value={draft.repeatPenalty}
                            min={-1}
                            max={2}
                            step={0.01}
                            disabled={draft.forceAppSampling}
                            onChange={(v) => setDraft({ ...draft, repeatPenalty: v })}
                            onCommit={(v) => saveNumberOnBlur('repeatPenalty', v)}
                        />
                        <NumberField
                            label="Presence penalty (-1 = Auto)"
                            value={draft.presencePenalty}
                            min={-1}
                            max={2}
                            step={0.05}
                            disabled={draft.forceAppSampling}
                            onChange={(v) => setDraft({ ...draft, presencePenalty: v })}
                            onCommit={(v) => saveNumberOnBlur('presencePenalty', v)}
                        />
                        <NumberField
                            label="Frequency penalty (-1 = Auto)"
                            value={draft.frequencyPenalty}
                            min={-1}
                            max={2}
                            step={0.05}
                            disabled={draft.forceAppSampling}
                            onChange={(v) => setDraft({ ...draft, frequencyPenalty: v })}
                            onCommit={(v) => saveNumberOnBlur('frequencyPenalty', v)}
                        />
                    </div>
                </FieldSection>

                <FieldSection label="Conversation memory">
                    <ToggleRow
                        label="Auto-compact long chats"
                        detail="Summarise old turns into a compact memory before the context fills up."
                        value={draft.dynamicCompactEnabled}
                        onChange={(v) => saveBoolean('dynamicCompactEnabled', v)}
                    />
                    {draft.dynamicCompactEnabled ? (
                        <NumberField
                            label="Compact every N turns (0 = off)"
                            value={draft.compactEveryTurns}
                            min={0}
                            max={500}
                            step={1}
                            onChange={(v) => setDraft({ ...draft, compactEveryTurns: v })}
                            onCommit={(v) => saveNumberOnBlur('compactEveryTurns', v)}
                        />
                    ) : null}
                </FieldSection>

                <FieldSection label="Agent behaviour">
                    <label class="verzeta-sheet__numberlabel" for="verzeta-agentpattern">
                        Agent pattern
                    </label>
                    <select
                        id="verzeta-agentpattern"
                        class="verzeta-sheet__select"
                        value={draft.agentPattern}
                        onChange={(e) => {
                            const v = (e.currentTarget as HTMLSelectElement).value as AgentPattern;
                            setDraft({ ...draft, agentPattern: v });
                            send({
                                type: 'agent.pattern.set',
                                hostId,
                                conversationId,
                                pattern: v,
                            });
                        }}
                    >
                        {AGENT_PATTERNS.map((p) => (
                            <option key={p.value} value={p.value}>
                                {p.label}
                            </option>
                        ))}
                    </select>
                    <ToggleRow
                        label="Streaming"
                        detail="Render tokens as they arrive."
                        value={draft.streaming}
                        onChange={(v) => {
                            setDraft({ ...draft, streaming: v });
                            send({
                                type: 'conv.settings.save',
                                hostId,
                                conversationId,
                                patch: { streaming: v },
                            });
                        }}
                    />
                    <ToggleRow
                        label="Thinking"
                        detail="Request a reasoning sidecar when the model supports it."
                        value={draft.thinking}
                        onChange={(v) => {
                            setDraft({ ...draft, thinking: v });
                            send({
                                type: 'conv.settings.save',
                                hostId,
                                conversationId,
                                patch: { thinking: v },
                            });
                        }}
                    />
                    <ToggleRow
                        label="Require confirmation"
                        detail="Pause the agent before executing destructive tools."
                        value={draft.requireConfirmation}
                        onChange={(v) => {
                            setDraft({ ...draft, requireConfirmation: v });
                            send({
                                type: 'agent.require_confirmation.set',
                                hostId,
                                conversationId,
                                require: v,
                            });
                        }}
                    />
                    <ToggleRow
                        label="Tools enabled"
                        detail="Allow agents to call host-side tools. This applies to every conversation on the host."
                        value={draft.toolsEnabled}
                        onChange={(v) => {
                            setDraft({ ...draft, toolsEnabled: v });
                            send({
                                type: 'tools.enabled.set',
                                hostId,
                                conversationId,
                                enabled: v,
                            });
                        }}
                    />
                    <ToggleRow
                        label="Describe tools in system prompt"
                        detail="Adds long tool descriptions to the prompt. Leave it off; structured tool definitions already cover this."
                        value={draft.toolsInSystemPrompt}
                        onChange={(v) => saveBoolean('toolsInSystemPrompt', v)}
                    />
                    <ToggleRow
                        label="RAG enabled"
                        detail="Inject retrieved context into the prompt. Applies to this conversation."
                        value={draft.ragEnabled}
                        onChange={(v) => saveBoolean('ragEnabled', v)}
                    />
                </FieldSection>

                <CommandExecutionSection hostId={hostId} conversationId={conversationId} />

                <HeartbeatGateSection hostId={hostId} conversationId={conversationId} />

                <PreferredSkillsConvSection
                    hostId={hostId}
                    conversationId={conversationId}
                    folderId={initial.folderId}
                />
            </div>
        </section>
    );
}

const EXEC_MODES: readonly { value: RemoteExecMode; label: string }[] = [
    { value: 'off', label: 'Off: run on the host instead' },
    { value: 'ask', label: 'Ask: confirm every command' },
    { value: 'allow', label: 'Allow: auto-run (safety-filtered)' },
];

/**
 * Per-conversation command-execution control (vfs.execute). Client-local
 * to this device: lets the agent run shell commands in this
 * conversation's mounted workspace, gated Off / Ask / Allow. The value
 * is fetched on open and persisted via the convExecMode messages.
 */
function CommandExecutionSection({
    hostId,
    conversationId,
}: {
    readonly hostId: string;
    readonly conversationId: string;
}) {
    useEffect(() => {
        send({ type: 'convExecMode.requested', hostId, conversationId });
    }, [hostId, conversationId]);

    const mode: RemoteExecMode = convExecModeFor(conversationId) ?? 'off';
    return (
        <FieldSection label="Command execution">
            <label class="verzeta-sheet__numberlabel" for="verzeta-execmode">
                Let agents run commands in this workspace (this device)
            </label>
            <select
                id="verzeta-execmode"
                class="verzeta-sheet__select"
                value={mode}
                onChange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value as RemoteExecMode;
                    send({ type: 'convExecMode.set', hostId, conversationId, mode: v });
                }}
            >
                {EXEC_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                        {m.label}
                    </option>
                ))}
            </select>
            <p class="verzeta-sheet__detail">
                Commands run only on this device, sandboxed where available, and are always checked
                by the safety filter. When Off, the agent runs commands on the host instead.
            </p>
        </FieldSection>
    );
}

function HeartbeatGateSection({
    hostId,
    conversationId,
}: {
    readonly hostId: string;
    readonly conversationId: string;
}) {
    const canonical = convHeartbeatGateFor(hostId, conversationId);
    const [draftCap, setDraftCap] = useState<number>(canonical.maxPerDay);

    useEffect(() => {
        setDraftCap(canonical.maxPerDay);
    }, [canonical.maxPerDay]);

    const safeCap =
        Number.isFinite(draftCap) && draftCap >= 1 ? Math.min(24, Math.round(draftCap)) : 1;
    return (
        <FieldSection label="Heartbeat">
            <ToggleRow
                label="Auto-surface heartbeat reports"
                detail="When on, eligible heartbeat reports post into this conversation. The daily cap below limits how many."
                value={canonical.allow}
                onChange={(v) =>
                    send({
                        type: 'convHeartbeatGate.setRequested',
                        hostId,
                        conversationId,
                        allow: v,
                        maxPerDay: safeCap,
                    })
                }
            />
            {canonical.allow ? (
                <label class="verzeta-sheet__numberfield">
                    <span class="verzeta-sheet__numberlabel">Daily cap: {safeCap}</span>
                    <input
                        type="range"
                        class="verzeta-sheet__range"
                        min={1}
                        max={24}
                        step={1}
                        value={safeCap}
                        onInput={(e) => {
                            const parsed = Number.parseInt(
                                (e.currentTarget as HTMLInputElement).value,
                                10,
                            );
                            if (Number.isFinite(parsed)) setDraftCap(parsed);
                        }}
                        onChange={(e) => {
                            const parsed = Number.parseInt(
                                (e.currentTarget as HTMLInputElement).value,
                                10,
                            );
                            if (Number.isFinite(parsed)) {
                                send({
                                    type: 'convHeartbeatGate.setRequested',
                                    hostId,
                                    conversationId,
                                    allow: true,
                                    maxPerDay: parsed,
                                });
                            }
                        }}
                    />
                </label>
            ) : null}
        </FieldSection>
    );
}

function PreferredSkillsConvSection({
    hostId,
    conversationId,
    folderId,
}: {
    readonly hostId: string;
    readonly conversationId: string;
    readonly folderId: string;
}) {
    const allSkills = skillsFor(hostId);
    const override = convSkillOverrideFor(hostId, conversationId);
    const convList = convPreferredSkillsFor(hostId, conversationId);
    const [editorOpen, setEditorOpen] = useState<boolean>(false);

    if (folderId.length === 0) {
        return (
            <FieldSection label="Preferred skills">
                <p class="verzeta-sheet__detail">
                    Preferred skills are stored per project. Move this conversation into a project
                    folder to manage its preferred skill set, or use a per-conversation override
                    once the conversation lives inside a project.
                </p>
            </FieldSection>
        );
    }

    const explainer = override
        ? convList.length === 0
            ? 'Override is on, but no skills are selected for this conversation, so the assistant sees no preferred skills.'
            : `Override is on. ${convList.length} skill${convList.length === 1 ? '' : 's'} preferred for this conversation.`
        : 'Override is off. This conversation inherits its parent folder’s preferred skills.';

    return (
        <FieldSection label="Preferred skills">
            <ToggleRow
                label="Override parent folder"
                detail="When on, this conversation uses its own preferred-skill list instead of the project folder’s."
                value={override}
                onChange={(v) =>
                    send({
                        type: 'convSkillOverride.setRequested',
                        hostId,
                        conversationId,
                        override: v,
                    })
                }
            />
            <p class="verzeta-sheet__detail">{explainer}</p>
            {override ? (
                <button
                    type="button"
                    class="verzeta-team__addBtn"
                    onClick={() => setEditorOpen(true)}
                    disabled={allSkills.length === 0}
                    title={
                        allSkills.length === 0
                            ? 'Install skills on the host to enable preferences'
                            : 'Edit preferred skills for this conversation'
                    }
                >
                    Edit preferred skills for this conversation
                </button>
            ) : null}
            {editorOpen ? (
                <ConvPreferredSkillsSheet
                    hostId={hostId}
                    conversationId={conversationId}
                    allSkills={allSkills}
                    initialIds={convList}
                    onClose={() => setEditorOpen(false)}
                />
            ) : null}
        </FieldSection>
    );
}

function ConvPreferredSkillsSheet({
    hostId,
    conversationId,
    allSkills,
    initialIds,
    onClose,
}: {
    readonly hostId: string;
    readonly conversationId: string;
    readonly allSkills: readonly SkillUi[];
    readonly initialIds: readonly string[];
    readonly onClose: () => void;
}) {
    const [selected, setSelected] = useState<readonly string[]>(initialIds);

    const onToggle = (id: string): void => {
        setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    };

    const onSave = (): void => {
        send({
            type: 'convPreferredSkills.setRequested',
            hostId,
            conversationId,
            skillIds: selected,
        });
        onClose();
    };

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Preferred skills for this conversation"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">Preferred skills (this chat)</h3>
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
                    <p class="verzeta-addmember__hint">
                        Tick the skills you want the assistant to prefer in this conversation only.
                        The folder's preferences are ignored while the override is on.
                    </p>
                    <ul class="verzeta-configmember__tools" role="list">
                        {allSkills.map((skill) => {
                            const checked = selected.includes(skill.id);
                            return (
                                <li key={skill.id}>
                                    <label class="verzeta-configmember__tool">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => onToggle(skill.id)}
                                        />
                                        <span class="verzeta-configmember__toolBody">
                                            <span class="verzeta-configmember__toolName">
                                                {skill.id}
                                                {skill.version.length > 0 ? (
                                                    <span class="verzeta-team__coordTag">
                                                        v{skill.version}
                                                    </span>
                                                ) : null}
                                            </span>
                                            {skill.description.length > 0 ? (
                                                <span class="verzeta-configmember__toolDesc">
                                                    {skill.description}
                                                </span>
                                            ) : null}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <footer class="verzeta-addmember__footer">
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
                        onClick={onSave}
                    >
                        Save
                    </button>
                </footer>
            </div>
        </div>
    );
}

function FieldSection({
    label,
    children,
}: {
    readonly label: string;
    readonly children: ComponentChildren;
}) {
    return (
        <section class="verzeta-sheet__section">
            <h3 class="verzeta-sheet__label">{label}</h3>
            {children}
        </section>
    );
}

function ToggleRow({
    label,
    detail,
    value,
    onChange,
}: {
    readonly label: string;
    readonly detail: string;
    readonly value: boolean;
    readonly onChange: (next: boolean) => void;
}) {
    return (
        <label class="verzeta-sheet__toggle">
            <span class="verzeta-sheet__togglebody">
                <span class="verzeta-sheet__togglelabel">{label}</span>
                <span class="verzeta-sheet__toggledetail">{detail}</span>
            </span>
            <input
                type="checkbox"
                checked={value}
                onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
            />
        </label>
    );
}

function NumberField({
    label,
    value,
    min,
    max,
    step,
    disabled,
    onChange,
    onCommit,
}: {
    readonly label: string;
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly disabled?: boolean;
    readonly onChange: (next: number) => void;
    readonly onCommit: (next: number) => void;
}) {
    return (
        <label class="verzeta-sheet__numberfield">
            <span class="verzeta-sheet__numberlabel">{label}</span>
            <input
                type="number"
                class="verzeta-sheet__numberinput"
                value={value}
                min={min}
                max={max}
                step={step}
                disabled={disabled === true}
                onInput={(e) => {
                    const parsed = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
                    if (Number.isFinite(parsed)) onChange(parsed);
                }}
                onBlur={(e) => {
                    const parsed = Number.parseFloat((e.currentTarget as HTMLInputElement).value);
                    if (Number.isFinite(parsed)) onCommit(parsed);
                }}
            />
        </label>
    );
}
