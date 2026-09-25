// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * NewGroupSheet — standalone group-chat creation surface. Mirrors
 * Android `NewGroupScreen.kt` and the existing FolderCreateSheet's
 * Team section pattern. Fields:
 *
 *   1. Title (required, non-blank).
 *   2. Members — at least one row, each row picks an agent + alias
 *      + coordinator star (radio-style, exactly one coordinator).
 *
 * On Save fires `group.createRequested`; WebviewSync calls
 * `group.create` and the new conv id flows back via
 * `conversation.created` (App.tsx switches to Chat tab).
 *
 * Per-member model / tool overrides are NOT exposed here — group
 * chats inherit conversation defaults like Android does at create
 * time. Edit the conv settings after creation to override.
 */

import { useMemo, useState } from 'preact/hooks';
import type { AgentSummaryUi } from '../../../src/shared/wire-types.js';
import { agentsFor } from '../state/agents.js';
import { activeHostId } from '../state/hosts.js';
import { closeGroupCreateSheet } from '../state/chatUi.js';
import { BLANK_ALIAS_HINT, hasBlankAlias } from '../lib/members.js';
import { send } from '../lib/bus.js';

interface DraftMember {
    readonly key: string;
    readonly agentId: string;
    readonly agentName: string;
    alias: string;
    isCoordinator: boolean;
}

export function NewGroupSheet() {
    const hostId = activeHostId.value;
    const [title, setTitle] = useState<string>('');
    const [members, setMembers] = useState<readonly DraftMember[]>([]);
    const [pickerOpen, setPickerOpen] = useState<boolean>(false);

    if (hostId === undefined) {
        return (
            <section class="verzeta-sheet" role="dialog" aria-label="New group chat">
                <header class="verzeta-sheet__header">
                    <h2 class="verzeta-sheet__title">New group chat</h2>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={closeGroupCreateSheet}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-sheet__empty">
                    Connect to a host first before creating a group chat.
                </div>
            </section>
        );
    }

    const trimmedTitle = title.trim();
    const blankAlias = hasBlankAlias(members);
    const canSave = trimmedTitle.length > 0 && members.length > 0 && !blankAlias;

    const onSave = (): void => {
        if (!canSave) return;
        send({
            type: 'group.createRequested',
            hostId,
            title: trimmedTitle,
            members: members.map((m) => ({
                agentId: m.agentId,
                alias: m.alias.trim(),
                isCoordinator: m.isCoordinator,
                modelProvider: '',
                modelName: '',
                allowedTools: [],
            })),
        });
        closeGroupCreateSheet();
    };

    const onAddMember = (agent: AgentSummaryUi, alias: string, isCoordinator: boolean): void => {
        const cleanAlias = alias.trim();
        if (cleanAlias.length === 0) return;
        const key = `${agent.id}:${cleanAlias.toLowerCase()}:${Date.now()}`;
        const draft: DraftMember = {
            key,
            agentId: agent.id,
            agentName: agent.name,
            alias: cleanAlias,
            isCoordinator,
        };
        const next = isCoordinator
            ? [...members.map((m) => ({ ...m, isCoordinator: false })), draft]
            : [...members, draft];
        setMembers(next);
        setPickerOpen(false);
    };

    const onToggleCoordinator = (key: string): void => {
        const target = members.find((m) => m.key === key);
        if (target === undefined) return;
        if (target.isCoordinator) {
            setMembers(members.map((m) => (m.key === key ? { ...m, isCoordinator: false } : m)));
        } else {
            setMembers(members.map((m) => ({ ...m, isCoordinator: m.key === key })));
        }
    };

    const onSetAlias = (key: string, alias: string): void => {
        setMembers(members.map((m) => (m.key === key ? { ...m, alias } : m)));
    };

    const onRemove = (key: string): void => {
        setMembers(members.filter((m) => m.key !== key));
    };

    return (
        <section class="verzeta-sheet" role="dialog" aria-label="New group chat">
            <header class="verzeta-sheet__header">
                <h2 class="verzeta-sheet__title">New group chat</h2>
                <button
                    type="button"
                    class="verzeta-sheet__close"
                    onClick={closeGroupCreateSheet}
                    aria-label="Close"
                >
                    ✕
                </button>
            </header>
            <div class="verzeta-sheet__body">
                <section class="verzeta-sheet__section">
                    <h3 class="verzeta-sheet__label">Title</h3>
                    <input
                        type="text"
                        class="verzeta-sheet__textinput"
                        value={title}
                        autoFocus
                        placeholder="e.g. Launch crew brainstorm"
                        onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
                    />
                </section>
                <section class="verzeta-sheet__section">
                    <h3 class="verzeta-sheet__label">Members</h3>
                    <p class="verzeta-sheet__detail">
                        ⭐ marks the coordinator, the agent that decides who responds when the group
                        is addressed without a specific @mention. Aliases work as in the folder
                        editor: each must be unique in the chat, and the same template can be added
                        more than once under different aliases.
                    </p>
                    <ul class="verzeta-team" role="list">
                        {members.length === 0 ? (
                            <li class="verzeta-team__empty">
                                No members yet. Add agents below to build the group.
                            </li>
                        ) : (
                            members.map((m) => (
                                <li class="verzeta-team__row" key={m.key}>
                                    <div class="verzeta-team__rowHead">
                                        <span class="verzeta-team__avatar" aria-hidden="true">
                                            {m.alias.length > 0
                                                ? (m.alias[0]?.toUpperCase() ?? '?')
                                                : '?'}
                                        </span>
                                        <div class="verzeta-team__rowBody">
                                            <input
                                                type="text"
                                                class="verzeta-team__alias"
                                                value={m.alias}
                                                placeholder="Alias"
                                                onInput={(e) =>
                                                    onSetAlias(
                                                        m.key,
                                                        (e.currentTarget as HTMLInputElement).value,
                                                    )
                                                }
                                            />
                                            <div class="verzeta-team__meta">
                                                <span class="verzeta-team__agentName">
                                                    {m.agentName}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            class={[
                                                'verzeta-team__star',
                                                m.isCoordinator ? 'verzeta-team__star--filled' : '',
                                            ]
                                                .filter((s) => s.length > 0)
                                                .join(' ')}
                                            onClick={() => onToggleCoordinator(m.key)}
                                            title={
                                                m.isCoordinator
                                                    ? 'Coordinator'
                                                    : 'Mark as coordinator'
                                            }
                                            aria-pressed={m.isCoordinator}
                                        >
                                            <StarIcon filled={m.isCoordinator} />
                                        </button>
                                        <button
                                            type="button"
                                            class="verzeta-team__delete"
                                            onClick={() => onRemove(m.key)}
                                            aria-label="Remove"
                                            title="Remove"
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                </li>
                            ))
                        )}
                    </ul>
                    <button
                        type="button"
                        class="verzeta-team__addBtn"
                        onClick={() => setPickerOpen(true)}
                    >
                        + Add Member
                    </button>
                </section>
            </div>
            <footer class="verzeta-sheet__footer">
                <button
                    type="button"
                    class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                    onClick={closeGroupCreateSheet}
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
                            ? 'Create group chat'
                            : trimmedTitle.length === 0
                              ? 'Enter a title'
                              : members.length === 0
                                ? 'Add at least one member'
                                : BLANK_ALIAS_HINT
                    }
                >
                    Create
                </button>
            </footer>
            {pickerOpen ? (
                <AgentPickerDialog
                    hostId={hostId}
                    existingAliases={members.map((m) => m.alias.toLowerCase())}
                    onCancel={() => setPickerOpen(false)}
                    onAdd={onAddMember}
                />
            ) : null}
        </section>
    );
}

function AgentPickerDialog({
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

    const onPick = (agent: AgentSummaryUi): void => {
        setSelected(agent);
        if (alias.length === 0) setAlias(agent.name);
        if (agent.isCoordinator && existingAliases.length === 0) setIsCoordinator(true);
    };

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Add member to group"
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
                                No agents available. Catalogs may still be loading.
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
                                                onClick={() => onPick(agent)}
                                            >
                                                <span class="verzeta-addmember__agentName">
                                                    {agent.name}
                                                </span>
                                                {agent.isCoordinator ? (
                                                    <span class="verzeta-team__coordTag">
                                                        coordinator
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
                        <h4 class="verzeta-addmember__sectionTitle">Alias for this group</h4>
                        <input
                            type="text"
                            class="verzeta-sheet__textinput"
                            placeholder="e.g. Researcher, PM-Sarah"
                            value={alias}
                            onInput={(e) => setAlias((e.currentTarget as HTMLInputElement).value)}
                        />
                        {aliasConflict ? (
                            <p class="verzeta-addmember__error">
                                That alias is already in the group. Pick something unique.
                            </p>
                        ) : null}
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
                        disabled={!canAdd}
                        onClick={() =>
                            selected !== null && onAdd(selected, trimmedAlias, isCoordinator)
                        }
                    >
                        Add
                    </button>
                </footer>
            </div>
        </div>
    );
}

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
                d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}
