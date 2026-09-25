// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * FolderCreateSheet — slide-over panel for creating a new folder
 * with a chosen type and an optional team roster. Mirrors Android's
 * `FolderEditorSheet` + `MembershipEditor` (line 119-257), the
 * primary surface for `MainViewModel.createFolderWithMembers`.
 *
 * Sections:
 *   1. Name (required, non-blank)
 *   2. Type radio group: Project (default) / Organization / Regular
 *   3. Goal textarea — shown only when type !== 'regular'
 *   4. Description textarea — shown only when type !== 'regular'
 *   5. Team — shown only when type !== 'regular'. List of member
 *      rows; each row has avatar + alias text field + coordinator
 *      star (radio-style) + delete + a labelled Configure button
 *      that opens ConfigureMemberSheet (per-member provider override
 *      + model override + tool whitelist). Add Member opens a
 *      dialog with agent picker + alias + coordinator checkbox.
 *
 * On Save the sheet posts a single typed `folder.createRequested`
 * envelope carrying the roster. The extension host's WebviewSync
 * chains `folder.create` → `folder.update_metadata` (when needed) →
 * `folder.members.set` so the new folder ships with its team
 * already installed.
 *
 * Per-member overrides and provenance ship in the payload too, and the
 * host stores them with the roster, so a save keeps settings made on
 * the desktop. The draft seeds every member from the host's values.
 *
 * When editing an existing project, Configure on a member that is
 * already saved writes straight to the host through
 * `folder.member.override.setRequested`, keyed by the member's saved
 * alias. Members added in this session (and every member of a new
 * folder) keep their overrides in the draft until Save / Create.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { AgentSummaryUi, MemberAddedByKind } from '../../../src/shared/wire-types.js';
import { agentsFor } from '../state/agents.js';
import { toolsFor } from '../state/catalogs.js';
import { foldersFor, membersFor } from '../state/conversations.js';
import { modelCatalogFor } from '../state/models.js';
import { activeHostId } from '../state/hosts.js';
import { closeFolderCreateSheet } from '../state/chatUi.js';
import { editingFolderId, setEditingFolderId } from '../state/folderEditor.js';
import { BLANK_ALIAS_HINT, hasBlankAlias } from '../lib/members.js';
import { send } from '../lib/bus.js';
import { ConfigureMemberSheet } from './ConfigureMemberSheet.js';
import { HeartbeatsSection } from './HeartbeatsSection.js';
import { PreferredSkillsSection } from './PreferredSkillsSection.js';
import { ProjectDocumentsSection } from './ProjectDocumentsSection.js';
import { openFolderActivity } from './FolderActivityModal.js';

type FolderType = 'regular' | 'project' | 'organization';

interface DraftMember {
    readonly key: string;
    readonly agentId: string;
    readonly agentName: string;
    readonly isBuiltinCoordinator: boolean;
    alias: string;
    isCoordinator: boolean;
    modelProvider: string;
    modelName: string;
    allowedTools: readonly string[];
    /** Provenance from the host; undefined for members added in this session. */
    readonly addedByKind: MemberAddedByKind | undefined;
    readonly addedByAgentId: string | undefined;
    /** The alias the host has saved, or null when the member is not saved yet. */
    readonly savedAlias: string | null;
}

function hasOverride(m: DraftMember): boolean {
    return m.modelProvider.length > 0 || m.modelName.length > 0 || m.allowedTools.length > 0;
}

function overrideSummary(m: DraftMember): string {
    const parts: string[] = [];
    if (m.modelProvider.length > 0) {
        parts.push(
            m.modelName.length > 0 ? `${m.modelProvider} / ${m.modelName}` : m.modelProvider,
        );
    } else if (m.modelName.length > 0) {
        parts.push(`model: ${m.modelName}`);
    }
    if (m.allowedTools.length > 0) {
        parts.push(`${m.allowedTools.length} tool(s)`);
    }
    return parts.length === 0 ? 'Default model · all tools' : parts.join('  ·  ');
}

const TYPE_OPTIONS: readonly {
    readonly value: FolderType;
    readonly label: string;
    readonly detail: string;
}[] = [
    {
        value: 'project',
        label: 'Project',
        detail: 'A team of named agents collaborating on a shared goal.',
    },
    {
        value: 'organization',
        label: 'Organization',
        detail: 'A higher-level grouping of related projects and chats.',
    },
    {
        value: 'regular',
        label: 'Regular',
        detail: 'A simple folder for grouping conversations. No agents.',
    },
];

export function FolderCreateSheet() {
    const hostId = activeHostId.value;
    const editingId = editingFolderId.value;
    const isEdit = editingId !== null;

    // Hydrate from the existing folder when entering edit mode. Done
    // via useEffect (not useMemo) because the form fields are
    // user-editable React state — useMemo would force them to
    // re-derive on every render.
    const [name, setName] = useState<string>('');
    const [originalName, setOriginalName] = useState<string>('');
    const [folderType, setFolderType] = useState<FolderType>('project');
    const [goal, setGoal] = useState<string>('');
    const [description, setDescription] = useState<string>('');
    const [members, setMembers] = useState<readonly DraftMember[]>([]);
    const [pickerOpen, setPickerOpen] = useState<boolean>(false);
    const [configureKey, setConfigureKey] = useState<string | null>(null);

    // Track which folder id we've hydrated for so we don't clobber
    // the user's edits on every render. Re-runs the metadata copy
    // once the folder lands in the store; a separate effect keeps
    // members in sync as their fetch resolves.
    const [hydratedForId, setHydratedForId] = useState<string | null>(null);
    const editingFolderRecord =
        isEdit && hostId !== undefined && editingId !== null
            ? foldersFor(hostId).find((f) => f.id === editingId)
            : undefined;
    const editingMembers =
        isEdit && hostId !== undefined && editingId !== null ? membersFor(hostId, editingId) : [];

    useEffect(() => {
        if (!isEdit || hostId === undefined || editingId === null) return;
        // Always fetch fresh members + heartbeats when the user opens
        // the editor — the rail may not have triggered the request
        // yet (Home tab path, freshly-created folder, etc).
        send({ type: 'folder.members.requested', hostId, folderId: editingId });
        send({ type: 'heartbeats.requested', hostId, folderId: editingId });
    }, [isEdit, editingId, hostId]);

    useEffect(() => {
        if (!isEdit || hostId === undefined || editingId === null) return;
        if (editingFolderRecord === undefined) return;
        if (hydratedForId === editingId) return;
        // First-time hydration for this folder: copy metadata from
        // the host record into the draft. Subsequent runs are
        // suppressed by the hydratedForId guard so the user's edits
        // don't get clobbered.
        setName(editingFolderRecord.name);
        setOriginalName(editingFolderRecord.name);
        setFolderType(editingFolderRecord.folderType);
        setGoal(editingFolderRecord.goal ?? '');
        setDescription(editingFolderRecord.description ?? '');
        setHydratedForId(editingId);
    }, [isEdit, editingId, hostId, editingFolderRecord, hydratedForId]);

    useEffect(() => {
        if (!isEdit || hostId === undefined || editingId === null) return;
        if (hydratedForId !== editingId) return;
        // Members arrive asynchronously after the editor opens —
        // re-derive the draft list when the cache changes BUT only
        // when the user hasn't already touched it. We treat "no draft
        // members yet" as the signal that hydration is welcome; once
        // the user adds/removes one, the cache push won't clobber.
        if (members.length > 0) return;
        if (editingMembers.length === 0) return;
        const agents = agentsFor(hostId);
        const drafted: DraftMember[] = editingMembers.map((m, i) => {
            const agentSummary = agents.find((a) => a.id === m.agentId);
            return {
                key: `existing:${m.id}:${i}`,
                agentId: m.agentId,
                agentName: agentSummary?.name ?? m.alias,
                isBuiltinCoordinator: agentSummary?.isCoordinator ?? false,
                alias: m.alias,
                isCoordinator: m.isCoordinator,
                modelProvider: m.modelProvider ?? '',
                modelName: m.modelName ?? '',
                // Seed from the host so a save sends back the tools the
                // member already has, not an empty list that clears them.
                allowedTools: m.allowedTools ?? [],
                addedByKind: m.addedByKind,
                addedByAgentId: m.addedByAgentId,
                savedAlias: m.alias,
            };
        });
        setMembers(drafted);
    }, [isEdit, editingId, hostId, hydratedForId, editingMembers, members.length]);

    useEffect(() => {
        if (isEdit) return;
        // Leaving edit mode (or starting fresh) — reset the
        // hydration guard so the next edit-mode entry hydrates.
        setHydratedForId(null);
    }, [isEdit]);

    const onClose = (): void => {
        setEditingFolderId(null);
        closeFolderCreateSheet();
    };

    if (hostId === undefined) {
        return (
            <section class="verzeta-sheet" role="dialog" aria-label="Create folder">
                <header class="verzeta-sheet__header">
                    <h2 class="verzeta-sheet__title">Create folder</h2>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-sheet__empty">
                    Connect to a host first before creating a folder.
                </div>
            </section>
        );
    }

    const trimmedName = name.trim();
    const showTeam = folderType !== 'regular';
    const blankAlias = hasBlankAlias(members);
    const canSave = trimmedName.length > 0 && !blankAlias;

    const onSave = (): void => {
        if (!canSave) return;
        const payloadMembers = showTeam
            ? members.map((m) => ({
                  agentId: m.agentId,
                  alias: m.alias.trim(),
                  isCoordinator: m.isCoordinator,
                  modelProvider: m.modelProvider,
                  modelName: m.modelName,
                  allowedTools: m.allowedTools,
                  ...(m.addedByKind !== undefined ? { addedByKind: m.addedByKind } : {}),
                  ...(m.addedByAgentId !== undefined ? { addedByAgentId: m.addedByAgentId } : {}),
              }))
            : [];
        if (isEdit && editingId !== null) {
            send({
                type: 'folder.updateRequested',
                hostId,
                folderId: editingId,
                originalName,
                name: trimmedName,
                folderType,
                goal: goal.trim(),
                description: description.trim(),
                members: payloadMembers,
            });
        } else {
            send({
                type: 'folder.createRequested',
                hostId,
                name: trimmedName,
                folderType,
                goal: goal.trim(),
                description: description.trim(),
                members: payloadMembers,
            });
        }
        onClose();
    };

    const onAddMember = (agent: AgentSummaryUi, alias: string, isCoordinator: boolean): void => {
        const cleanAlias = alias.trim();
        if (cleanAlias.length === 0) return;
        const key = `${agent.id}:${cleanAlias.toLowerCase()}:${Date.now()}`;
        const draft: DraftMember = {
            key,
            agentId: agent.id,
            agentName: agent.name,
            isBuiltinCoordinator: agent.isCoordinator,
            alias: cleanAlias,
            isCoordinator,
            modelProvider: '',
            modelName: '',
            allowedTools: [],
            addedByKind: undefined,
            addedByAgentId: undefined,
            savedAlias: null,
        };
        let next: DraftMember[];
        if (isCoordinator) {
            // Radio-style — exclusively one coordinator at a time. Mirrors
            // Android `MembershipEditor` coordinator click handler.
            next = members.map((m) => ({ ...m, isCoordinator: false }));
            next.push(draft);
        } else {
            next = [...members, draft];
        }
        setMembers(next);
        setPickerOpen(false);
    };

    const onSetAlias = (key: string, alias: string): void => {
        setMembers(members.map((m) => (m.key === key ? { ...m, alias } : m)));
    };

    const onToggleCoordinator = (key: string): void => {
        const target = members.find((m) => m.key === key);
        if (target === undefined) return;
        if (target.isCoordinator) {
            // Clicking the star on the current coordinator clears it.
            setMembers(members.map((m) => (m.key === key ? { ...m, isCoordinator: false } : m)));
        } else {
            // Radio-style — every other member's flag is cleared.
            setMembers(members.map((m) => ({ ...m, isCoordinator: m.key === key })));
        }
    };

    const onRemoveMember = (key: string): void => {
        setMembers(members.filter((m) => m.key !== key));
    };

    return (
        <section
            class="verzeta-sheet"
            role="dialog"
            aria-label={isEdit ? 'Edit folder' : 'Create folder'}
        >
            <header class="verzeta-sheet__header">
                <h2 class="verzeta-sheet__title">{isEdit ? 'Edit folder' : 'Create folder'}</h2>
                <button
                    type="button"
                    class="verzeta-sheet__close"
                    onClick={onClose}
                    aria-label="Close"
                >
                    ✕
                </button>
            </header>
            <div class="verzeta-sheet__body">
                <FieldSection label="Name">
                    <input
                        type="text"
                        class="verzeta-sheet__textinput"
                        value={name}
                        autoFocus
                        placeholder="My new folder"
                        onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
                    />
                </FieldSection>

                <FieldSection label="Type">
                    <div class="verzeta-sheet__radioGroup">
                        {TYPE_OPTIONS.map((opt) => (
                            <label
                                key={opt.value}
                                class={[
                                    'verzeta-sheet__radioOption',
                                    folderType === opt.value
                                        ? 'verzeta-sheet__radioOption--selected'
                                        : '',
                                ]
                                    .filter((s) => s.length > 0)
                                    .join(' ')}
                            >
                                <input
                                    type="radio"
                                    name="folder-type"
                                    value={opt.value}
                                    checked={folderType === opt.value}
                                    onChange={() => setFolderType(opt.value)}
                                />
                                <span class="verzeta-sheet__radioBody">
                                    <span class="verzeta-sheet__radioLabel">{opt.label}</span>
                                    <span class="verzeta-sheet__radioDetail">{opt.detail}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </FieldSection>

                {showTeam ? (
                    <>
                        <FieldSection label="Goal">
                            <textarea
                                class="verzeta-sheet__textarea"
                                rows={3}
                                value={goal}
                                placeholder="What is this project or organization trying to achieve?"
                                onInput={(e) =>
                                    setGoal((e.currentTarget as HTMLTextAreaElement).value)
                                }
                            />
                        </FieldSection>
                        <FieldSection label="Description">
                            <textarea
                                class="verzeta-sheet__textarea"
                                rows={3}
                                value={description}
                                placeholder="Additional context for the team."
                                onInput={(e) =>
                                    setDescription((e.currentTarget as HTMLTextAreaElement).value)
                                }
                            />
                        </FieldSection>
                        <TeamSection
                            hostId={hostId}
                            members={members}
                            onSetAlias={onSetAlias}
                            onToggleCoordinator={onToggleCoordinator}
                            onRemoveMember={onRemoveMember}
                            onOpenPicker={() => setPickerOpen(true)}
                            onConfigureMember={(key) => setConfigureKey(key)}
                        />
                        {isEdit && editingId !== null ? (
                            <>
                                <HeartbeatsSection hostId={hostId} folderId={editingId} />
                                <PreferredSkillsSection hostId={hostId} folderId={editingId} />
                                <ProjectDocumentsSection hostId={hostId} folderId={editingId} />
                                <FieldSection label="Activity log">
                                    <button
                                        type="button"
                                        class="verzeta-team__addBtn"
                                        onClick={() => openFolderActivity(editingId)}
                                    >
                                        View activity log
                                    </button>
                                    <p class="verzeta-sheet__detail">
                                        Read-only timeline of every audit event in this project:
                                        plan events, tool calls, heartbeat runs, and membership
                                        changes.
                                    </p>
                                </FieldSection>
                            </>
                        ) : (
                            <p class="verzeta-sheet__detail">
                                Heartbeats, preferred skills, project documents, and the activity
                                log become available after the project is saved.
                            </p>
                        )}
                    </>
                ) : null}
            </div>
            <footer class="verzeta-sheet__footer">
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
                    disabled={!canSave}
                    title={
                        canSave
                            ? isEdit
                                ? 'Save folder'
                                : 'Create folder'
                            : blankAlias
                              ? BLANK_ALIAS_HINT
                              : 'Enter a name to continue'
                    }
                >
                    {isEdit ? 'Save' : 'Create'}
                </button>
            </footer>

            {pickerOpen ? (
                <AddMemberDialog
                    hostId={hostId}
                    existingAliases={members.map((m) => m.alias.toLowerCase())}
                    onCancel={() => setPickerOpen(false)}
                    onAdd={onAddMember}
                />
            ) : null}

            <ConfigureMemberHost
                hostId={hostId}
                members={members}
                configureKey={configureKey}
                onClose={() => setConfigureKey(null)}
                onApply={(key, provider, model, allowed) => {
                    // A member the host already has is saved right away,
                    // without replacing the roster. Anything else waits
                    // for Save / Create.
                    const target = members.find((m) => m.key === key);
                    const savedAlias = target?.savedAlias ?? null;
                    if (isEdit && editingId !== null && savedAlias !== null) {
                        send({
                            type: 'folder.member.override.setRequested',
                            hostId,
                            folderId: editingId,
                            alias: savedAlias,
                            modelProvider: provider,
                            modelName: model,
                            allowedTools: allowed,
                        });
                    }
                    setMembers(
                        members.map((m) =>
                            m.key === key
                                ? {
                                      ...m,
                                      modelProvider: provider,
                                      modelName: model,
                                      allowedTools: allowed,
                                  }
                                : m,
                        ),
                    );
                    setConfigureKey(null);
                }}
            />
        </section>
    );
}

function ConfigureMemberHost({
    hostId,
    members,
    configureKey,
    onClose,
    onApply,
}: {
    readonly hostId: string;
    readonly members: readonly DraftMember[];
    readonly configureKey: string | null;
    readonly onClose: () => void;
    readonly onApply: (
        key: string,
        provider: string,
        model: string,
        allowed: readonly string[],
    ) => void;
}) {
    if (configureKey === null) return null;
    const member = members.find((m) => m.key === configureKey);
    if (member === undefined) return null;
    const catalog = modelCatalogFor(hostId);
    const providers = catalog?.providers ?? [];
    const tools = toolsFor(hostId);
    return (
        <ConfigureMemberSheet
            member={{
                alias: member.alias,
                modelProvider: member.modelProvider,
                modelName: member.modelName,
                allowedTools: member.allowedTools,
            }}
            providers={providers}
            availableTools={tools}
            onApply={(provider, model, allowed) => onApply(member.key, provider, model, allowed)}
            onCancel={onClose}
        />
    );
}

// ====================================================================
// Team section
// ====================================================================

function TeamSection({
    hostId,
    members,
    onSetAlias,
    onToggleCoordinator,
    onRemoveMember,
    onOpenPicker,
    onConfigureMember,
}: {
    readonly hostId: string;
    readonly members: readonly DraftMember[];
    readonly onSetAlias: (key: string, alias: string) => void;
    readonly onToggleCoordinator: (key: string) => void;
    readonly onRemoveMember: (key: string) => void;
    readonly onOpenPicker: () => void;
    readonly onConfigureMember: (key: string) => void;
}) {
    void hostId;
    return (
        <section class="verzeta-sheet__section">
            <h3 class="verzeta-sheet__label">Team</h3>
            <p class="verzeta-sheet__detail">
                ⭐ marks the coordinator: the agent that decides who responds when the team is
                addressed without a specific @mention. Configure overrides a member's model and tool
                whitelist.
            </p>
            <ul class="verzeta-team" role="list">
                {members.length === 0 ? (
                    <li class="verzeta-team__empty">
                        No members yet. Add agents below to build your team.
                    </li>
                ) : (
                    members.map((member) => (
                        <MemberRow
                            key={member.key}
                            member={member}
                            onSetAlias={(alias) => onSetAlias(member.key, alias)}
                            onToggleCoordinator={() => onToggleCoordinator(member.key)}
                            onRemove={() => onRemoveMember(member.key)}
                            onConfigure={() => onConfigureMember(member.key)}
                        />
                    ))
                )}
            </ul>
            <button
                type="button"
                class="verzeta-team__addBtn"
                onClick={onOpenPicker}
                title="Add an agent to this team"
            >
                + Add Member
            </button>
        </section>
    );
}

function MemberRow({
    member,
    onSetAlias,
    onToggleCoordinator,
    onRemove,
    onConfigure,
}: {
    readonly member: DraftMember;
    readonly onSetAlias: (alias: string) => void;
    readonly onToggleCoordinator: () => void;
    readonly onRemove: () => void;
    readonly onConfigure: () => void;
}) {
    const avatarLetter = member.alias.length > 0 ? (member.alias[0]?.toUpperCase() ?? '?') : '?';
    const overrideText = overrideSummary(member);
    const isOverridden = hasOverride(member);
    return (
        <li class="verzeta-team__row">
            <div class="verzeta-team__rowHead">
                <span class="verzeta-team__avatar" aria-hidden="true">
                    {avatarLetter}
                </span>
                <div class="verzeta-team__rowBody">
                    <input
                        type="text"
                        class="verzeta-team__alias"
                        value={member.alias}
                        placeholder="Alias"
                        onInput={(e) => onSetAlias((e.currentTarget as HTMLInputElement).value)}
                    />
                    <div class="verzeta-team__meta">
                        <span class="verzeta-team__agentName">{member.agentName}</span>
                        {member.isBuiltinCoordinator ? (
                            <span class="verzeta-team__coordTag">coordinator template</span>
                        ) : null}
                    </div>
                    <div
                        class={[
                            'verzeta-team__override',
                            isOverridden ? 'verzeta-team__override--set' : '',
                        ]
                            .filter((s) => s.length > 0)
                            .join(' ')}
                        title={overrideText}
                    >
                        {overrideText}
                    </div>
                </div>
                <button
                    type="button"
                    class={[
                        'verzeta-team__star',
                        member.isCoordinator ? 'verzeta-team__star--filled' : '',
                    ]
                        .filter((s) => s.length > 0)
                        .join(' ')}
                    onClick={onToggleCoordinator}
                    title={member.isCoordinator ? 'Coordinator' : 'Mark as coordinator'}
                    aria-label={
                        member.isCoordinator
                            ? 'Coordinator (click to clear)'
                            : 'Mark as coordinator'
                    }
                    aria-pressed={member.isCoordinator}
                >
                    <StarIcon filled={member.isCoordinator} />
                </button>
                <button
                    type="button"
                    class="verzeta-team__delete"
                    onClick={onRemove}
                    aria-label="Remove member"
                    title="Remove member"
                >
                    <TrashIcon />
                </button>
            </div>
            <button
                type="button"
                class="verzeta-team__configureBtn"
                onClick={onConfigure}
                title="Configure model & tools for this member"
            >
                <TuneIcon />
                Configure model &amp; tools
            </button>
        </li>
    );
}

// ====================================================================
// Add Member dialog
// ====================================================================

function AddMemberDialog({
    hostId,
    existingAliases,
    onCancel,
    onAdd,
}: {
    readonly hostId: string;
    readonly existingAliases: readonly string[];
    readonly onCancel: () => void;
    readonly onAdd: (agent: AgentSummaryUi, alias: string, isCoordinator: boolean) => void;
}) {
    const agents = agentsFor(hostId);
    const [selected, setSelected] = useState<AgentSummaryUi | null>(null);
    const [alias, setAlias] = useState<string>('');
    const [isCoordinator, setIsCoordinator] = useState<boolean>(false);
    const [search, setSearch] = useState<string>('');

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (needle.length === 0) return agents;
        return agents.filter((a) => a.name.toLowerCase().includes(needle));
    }, [agents, search]);

    const trimmedAlias = alias.trim();
    const aliasConflict = existingAliases.includes(trimmedAlias.toLowerCase());
    const canAdd = selected !== null && trimmedAlias.length > 0 && !aliasConflict;

    const onPickAgent = (agent: AgentSummaryUi): void => {
        setSelected(agent);
        if (alias.length === 0) setAlias(agent.name);
        if (agent.isCoordinator && existingAliases.length === 0) setIsCoordinator(true);
    };

    const onConfirm = (): void => {
        if (!canAdd || selected === null) return;
        onAdd(selected, trimmedAlias, isCoordinator);
    };

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Add team member"
            onClick={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">Add team member</h3>
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
                        <h4 class="verzeta-addmember__sectionTitle">Pick an agent</h4>
                        {agents.length > 6 ? (
                            <input
                                type="search"
                                class="verzeta-sheet__textinput"
                                placeholder="Search agents…"
                                value={search}
                                onInput={(e) =>
                                    setSearch((e.currentTarget as HTMLInputElement).value)
                                }
                            />
                        ) : null}
                        {agents.length === 0 ? (
                            <p class="verzeta-addmember__empty">
                                No agents available. Catalogs may still be loading. Try again in a
                                moment.
                            </p>
                        ) : (
                            <ul class="verzeta-addmember__agents" role="list">
                                {filtered.map((agent) => {
                                    const isPicked = selected?.id === agent.id;
                                    return (
                                        <li key={agent.id}>
                                            <button
                                                type="button"
                                                class={[
                                                    'verzeta-addmember__agentRow',
                                                    isPicked
                                                        ? 'verzeta-addmember__agentRow--picked'
                                                        : '',
                                                ]
                                                    .filter((s) => s.length > 0)
                                                    .join(' ')}
                                                onClick={() => onPickAgent(agent)}
                                            >
                                                <span class="verzeta-addmember__agentName">
                                                    {agent.name}
                                                </span>
                                                {agent.isCoordinator ? (
                                                    <span class="verzeta-team__coordTag">
                                                        coordinator
                                                    </span>
                                                ) : null}
                                                {agent.description !== undefined &&
                                                agent.description.length > 0 ? (
                                                    <span class="verzeta-addmember__agentDesc">
                                                        {agent.description}
                                                    </span>
                                                ) : null}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                    <section class="verzeta-addmember__section">
                        <h4 class="verzeta-addmember__sectionTitle">Alias for this team</h4>
                        <input
                            type="text"
                            class="verzeta-sheet__textinput"
                            placeholder="e.g. Researcher, PM-Sarah"
                            value={alias}
                            onInput={(e) => setAlias((e.currentTarget as HTMLInputElement).value)}
                        />
                        {aliasConflict ? (
                            <p class="verzeta-addmember__error">
                                That alias is already in the roster. Pick something unique.
                            </p>
                        ) : (
                            <p class="verzeta-addmember__hint">
                                Aliases let you have multiple members from the same agent template
                                (e.g. two Project Managers named differently).
                            </p>
                        )}
                    </section>
                    <section class="verzeta-addmember__section">
                        <label class="verzeta-addmember__coordToggle">
                            <input
                                type="checkbox"
                                checked={isCoordinator}
                                onChange={(e) =>
                                    setIsCoordinator((e.currentTarget as HTMLInputElement).checked)
                                }
                            />
                            <span class="verzeta-addmember__coordLabel">
                                Mark as coordinator (replaces the current coordinator)
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
                        onClick={onConfirm}
                        disabled={!canAdd}
                        title={
                            canAdd
                                ? 'Add to roster'
                                : aliasConflict
                                  ? 'Pick a unique alias'
                                  : selected === null
                                    ? 'Pick an agent first'
                                    : 'Enter an alias'
                        }
                    >
                        Add
                    </button>
                </footer>
            </div>
        </div>
    );
}

// ====================================================================
// Inline SVG icons
// ====================================================================

function StarIcon({ filled }: { readonly filled: boolean }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}>
            <path
                d="M12 3l2.9 6 6.6.6-5 4.6 1.5 6.5L12 17.5 5.9 20.7 7.5 14.2l-5-4.6L9 9 12 3z"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function TuneIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M3 6h13M3 12h9M3 18h13"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
            />
            <circle cx="18" cy="6" r="2" stroke="currentColor" stroke-width="1.8" />
            <circle cx="14" cy="12" r="2" stroke="currentColor" stroke-width="1.8" />
            <circle cx="18" cy="18" r="2" stroke="currentColor" stroke-width="1.8" />
        </svg>
    );
}

// ====================================================================
// Helpers
// ====================================================================

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
