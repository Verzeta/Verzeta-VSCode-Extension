// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { useEffect } from 'preact/hooks';
import { agentsFor } from '../state/agents.js';
import { activeHostId } from '../state/hosts.js';
import {
    collapsedSections,
    expandedFolderIds,
    searchQuery,
    toggleFolder,
    toggleSection,
} from '../state/chatNav.js';
import {
    foldersFor,
    fullConversationsFor,
    membersFor,
    setActiveConversationId,
} from '../state/conversations.js';
import { openFolderCreateSheet, openGroupCreateSheet, requestDelete } from '../state/chatUi.js';
import { setEditingFolderId } from '../state/folderEditor.js';
import { buildRows, sectionLabel, type RowKind } from '../lib/conversationSections.js';
import { send } from '../lib/bus.js';
import { SearchField } from './SearchField.js';
import type { ConversationFullUi } from '../../../src/shared/webview-protocol.js';

export function ChatNavRail() {
    const hostId = activeHostId.value;
    return (
        <div class="verzeta-chatnav">
            <SearchField />
            {hostId !== undefined ? <ActionRow /> : null}
            {hostId === undefined ? <EmptyState /> : <SectionedList hostId={hostId} />}
            {hostId !== undefined ? <NewChatFab hostId={hostId} /> : null}
        </div>
    );
}

function ActionRow() {
    // Class is `verzeta-chatnav__newRow` (NOT `__actionRow`) on
    // purpose — `__actionRow` is also used by the per-project
    // "Start group chat with all" button further down and the two
    // selectors used to collide, causing inconsistent padding /
    // alignment.
    return (
        <div class="verzeta-chatnav__newRow">
            <button
                type="button"
                class="verzeta-chatnav__newRowBtn"
                onClick={openFolderCreateSheet}
                title="Create a new folder"
                aria-label="Create a new folder"
            >
                <FolderPlusIcon />
                <span class="verzeta-chatnav__newRowLabel">New folder</span>
            </button>
            <button
                type="button"
                class="verzeta-chatnav__newRowBtn"
                onClick={openGroupCreateSheet}
                title="Start a new group chat"
                aria-label="Start a new group chat"
            >
                <GroupPlusIconAction />
                <span class="verzeta-chatnav__newRowLabel">New group</span>
            </button>
        </div>
    );
}

function GroupPlusIconAction() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.6" />
            <circle cx="17" cy="9" r="2.4" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M3 19c0-3 2.5-5.5 6-5.5s6 2.5 6 5.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
            <path
                d="M19 14v6M16 17h6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function EmptyState() {
    return (
        <div class="verzeta-chatnav__empty">
            Pick a host on the <strong>Home</strong> tab to load its conversations.
        </div>
    );
}

function SectionedList({ hostId }: { readonly hostId: string }) {
    const conversations = fullConversationsFor(hostId);
    const folders = foldersFor(hostId);
    const query = searchQuery.value;
    const collapsed = collapsedSections.value;
    const expanded = expandedFolderIds.value;
    const agents = agentsFor(hostId);

    // Pull every project's member list into a Map so the bucketing
    // function stays pure. `membersFor` is a signal accessor so
    // mutations to any folder's members will re-trigger this render.
    const projectFolders = folders.filter(
        (f) => f.folderType === 'project' || f.folderType === 'organization',
    );
    const membersByFolder = new Map(
        projectFolders.map((f) => [f.id, membersFor(hostId, f.id)] as const),
    );

    // Auto-request member lists for any project we don't have cached
    // yet — happens on first sidebar render after `conversations.full
    // .updated` lands but before the seedHost member-fan-out completes
    // (or for folders that were created post-connect via folder.added).
    // Depend only on the folder-id stringification so a folder added or
    // removed re-triggers; mutating membersByFolder during the effect
    // would loop.
    const folderIdsKey = projectFolders.map((f) => f.id).join(',');
    useEffect(() => {
        for (const f of projectFolders) {
            if ((membersByFolder.get(f.id)?.length ?? 0) === 0) {
                send({ type: 'folder.members.requested', hostId, folderId: f.id });
            }
        }
    }, [hostId, folderIdsKey]);

    const rows = buildRows({
        conversations,
        folders,
        searchQuery: query,
        collapsedSections: collapsed,
        expandedFolderIds: expanded,
        membersByFolder,
        agents,
    });

    if (rows.length === 0) {
        return (
            <div class="verzeta-chatnav__empty">
                {query.trim().length > 0
                    ? `No conversations match "${query}".`
                    : 'No conversations on this host yet.'}
            </div>
        );
    }

    return (
        <div class="verzeta-chatnav__list" role="list">
            {rows.map((row) => (
                <Row key={rowKey(row)} row={row} hostId={hostId} />
            ))}
        </div>
    );
}

function rowKey(row: RowKind): string {
    switch (row.kind) {
        case 'sectionHeader':
            return `section:${row.section}`;
        case 'projectHeader':
            return `project:${row.folderId}`;
        case 'subsectionHeader':
            return `sub:${row.folderId}:${row.subsection}`;
        case 'memberRow':
            return `member:${row.folderId}:${row.alias}`;
        case 'actionRow':
            return `action:${row.folderId}:${row.action}`;
        case 'conversation':
            return `conv:${row.conv.id}:${row.indent}`;
    }
}

function Row({ row, hostId }: { readonly row: RowKind; readonly hostId: string }) {
    switch (row.kind) {
        case 'sectionHeader':
            return (
                <button
                    type="button"
                    class="verzeta-chatnav__sectionHeader"
                    onClick={() => toggleSection(row.section)}
                    aria-expanded={!collapsedSections.value.has(row.section)}
                >
                    <span class="verzeta-chatnav__chevron" aria-hidden="true">
                        <ChevronIcon expanded={!collapsedSections.value.has(row.section)} />
                    </span>
                    <span class="verzeta-chatnav__sectionLabel">{sectionLabel(row.section)}</span>
                    <span class="verzeta-chatnav__count">{row.count}</span>
                </button>
            );
        case 'projectHeader':
            return (
                <div class="verzeta-chatnav__projectHeaderWrap" role="group" aria-label={row.name}>
                    <button
                        type="button"
                        class="verzeta-chatnav__projectHeader"
                        onClick={() => toggleFolder(row.folderId)}
                        aria-expanded={expandedFolderIds.value.has(row.folderId)}
                    >
                        <span class="verzeta-chatnav__chevron" aria-hidden="true">
                            <ChevronIcon expanded={expandedFolderIds.value.has(row.folderId)} />
                        </span>
                        <ProjectIcon folderType={row.folderType} />
                        <div class="verzeta-chatnav__projectBody">
                            <span class="verzeta-chatnav__projectName">{row.name}</span>
                            <span class="verzeta-chatnav__projectKind">
                                {row.folderType === 'organization'
                                    ? 'ORGANIZATION'
                                    : row.folderType === 'regular'
                                      ? 'FOLDER'
                                      : 'PROJECT'}
                            </span>
                        </div>
                        <span class="verzeta-chatnav__count">{row.count}</span>
                    </button>
                    <button
                        type="button"
                        class="verzeta-chatnav__editBtn"
                        onClick={(e) => {
                            e.stopPropagation();
                            setEditingFolderId(row.folderId);
                            openFolderCreateSheet();
                        }}
                        title={`Settings for ${row.name}`}
                        aria-label={`Open settings for ${row.name}`}
                    >
                        <CogIcon />
                    </button>
                    <button
                        type="button"
                        class="verzeta-chatnav__deleteBtn"
                        onClick={(e) => {
                            e.stopPropagation();
                            requestDelete({
                                kind: 'folder',
                                id: row.folderId,
                                label: row.name,
                                subtitle:
                                    row.count > 0
                                        ? `Conversations inside this folder will also be removed (${row.count} item${row.count === 1 ? '' : 's'}).`
                                        : '',
                            });
                        }}
                        title={`Delete ${row.folderType === 'organization' ? 'organization' : 'folder'}`}
                        aria-label={`Delete ${row.name}`}
                    >
                        <TrashIcon />
                    </button>
                </div>
            );
        case 'subsectionHeader':
            return (
                <div class="verzeta-chatnav__subsectionHeader" role="presentation">
                    <span class="verzeta-chatnav__subsectionLabel">{row.label}</span>
                    <span class="verzeta-chatnav__count">{row.count}</span>
                </div>
            );
        case 'memberRow':
            return (
                <button
                    type="button"
                    class="verzeta-chatnav__memberRow"
                    onClick={() =>
                        send({
                            type: 'folder.member.chat.openRequested',
                            hostId,
                            folderId: row.folderId,
                            agentId: row.agentId,
                            alias: row.alias,
                        })
                    }
                    title={`Open 1:1 chat with @${row.alias}`}
                >
                    <span class="verzeta-chatnav__memberAvatar" aria-hidden="true">
                        <PersonIcon />
                    </span>
                    <span class="verzeta-chatnav__memberBody">
                        <span class="verzeta-chatnav__memberName">
                            @{row.alias}
                            {row.isCoordinator ? (
                                <span
                                    class="verzeta-chatnav__coordStar"
                                    aria-label="Coordinator"
                                    title="Coordinator"
                                >
                                    ★
                                </span>
                            ) : null}
                        </span>
                        {row.roleName.length > 0 ? (
                            <span class="verzeta-chatnav__memberRole">{row.roleName}</span>
                        ) : null}
                    </span>
                    <span class="verzeta-chatnav__memberChatIcon" aria-hidden="true">
                        <ChatBubbleIcon />
                    </span>
                </button>
            );
        case 'actionRow':
            return (
                <button
                    type="button"
                    class="verzeta-chatnav__actionRow"
                    onClick={() =>
                        send({
                            type: 'folder.kickoff.groupRequested',
                            hostId,
                            folderId: row.folderId,
                        })
                    }
                >
                    <span class="verzeta-chatnav__actionIcon" aria-hidden="true">
                        <GroupPlusIcon />
                    </span>
                    <span class="verzeta-chatnav__actionLabel">{row.label}</span>
                </button>
            );
        case 'conversation':
            return <ConversationRow conv={row.conv} hostId={hostId} indent={row.indent} />;
    }
}

function ConversationRow({
    conv,
    hostId,
    indent,
}: {
    readonly conv: ConversationFullUi;
    readonly hostId: string;
    readonly indent: 0 | 1 | 2;
}) {
    const onOpen = (): void => {
        setActiveConversationId(conv.id);
        send({
            type: 'conversation.openRequested',
            hostId,
            conversationId: conv.id,
        });
    };
    const title = conv.title.length > 0 ? conv.title : 'Untitled';
    const wrapperClass = [
        'verzeta-chatnav__convRowWrap',
        indent === 1 ? 'verzeta-chatnav__convRowWrap--indent1' : '',
        indent === 2 ? 'verzeta-chatnav__convRowWrap--indent2' : '',
    ]
        .filter((s) => s.length > 0)
        .join(' ');
    return (
        <div class={wrapperClass} role="group">
            <button type="button" class="verzeta-chatnav__convRow" onClick={onOpen} title={title}>
                <span class="verzeta-chatnav__convIcon" aria-hidden="true">
                    {conv.isGroup ? <GroupIcon /> : <ChatBubbleIcon />}
                </span>
                <span class="verzeta-chatnav__convBody">
                    <span class="verzeta-chatnav__convTitle">
                        {conv.isPinned ? <span aria-hidden="true">★ </span> : null}
                        {title}
                    </span>
                    {conv.preview.length > 0 ? (
                        <span class="verzeta-chatnav__convPreview">{conv.preview}</span>
                    ) : null}
                </span>
                <span class="verzeta-chatnav__convMeta">
                    {conv.isGroup ? <span class="verzeta-chatnav__convBadge">Group</span> : null}
                    {conv.updatedAt > 0 ? (
                        <span class="verzeta-chatnav__convTime">
                            {formatRelative(conv.updatedAt)}
                        </span>
                    ) : null}
                </span>
            </button>
            <button
                type="button"
                class="verzeta-chatnav__deleteBtn"
                onClick={(e) => {
                    e.stopPropagation();
                    requestDelete({
                        kind: 'conv',
                        id: conv.id,
                        label: title,
                        subtitle: conv.isGroup
                            ? 'This is a group chat. Every member’s history of this thread will be removed on the host.'
                            : '',
                    });
                }}
                title="Delete conversation"
                aria-label={`Delete ${title}`}
            >
                <TrashIcon />
            </button>
        </div>
    );
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M4 7h16M9 7V4h6v3M6 7l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v8M14 11v8"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function CogIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.06a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.06a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function NewChatFab({ hostId }: { readonly hostId: string }) {
    const onClick = (): void => {
        send({ type: 'conversation.createRequested', hostId });
    };
    return (
        <button
            type="button"
            class="verzeta-chatnav__fab"
            onClick={onClick}
            title="New chat"
            aria-label="Start a new conversation"
        >
            <PencilIcon />
            <span class="verzeta-chatnav__fabLabel">New chat</span>
        </button>
    );
}

// ====================================================================
// Inline SVG icons
// ====================================================================

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
    // Proper 14 px chevron — Android Material `ExpandMore` / `ChevronRight`.
    // Replaces the tiny ▸/▾ unicode characters which rendered as
    // 6 px dots in many VS Code themes and read as meaningless noise.
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 120ms ease',
            }}
        >
            <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function ProjectIcon({
    folderType,
}: {
    readonly folderType: 'project' | 'organization' | 'regular';
}) {
    return (
        <span class={`verzeta-chatnav__projectIcon verzeta-chatnav__projectIcon--${folderType}`}>
            {folderType === 'regular' ? (
                // Plain folder glyph — a regular folder is just an
                // organiser, no team roster.
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V6z"
                        fill="currentColor"
                    />
                </svg>
            ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="6" cy="9" r="2.5" fill="currentColor" />
                    <circle cx="18" cy="9" r="2.5" fill="currentColor" />
                    <circle cx="12" cy="17" r="2.5" fill="currentColor" />
                </svg>
            )}
        </span>
    );
}

function PersonIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function ChatBubbleIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M21 12c0 4.4-4 8-9 8a10 10 0 0 1-3.6-.7L4 21l1.5-3.8A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function GroupIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.6" />
            <circle cx="17" cy="11" r="2.5" stroke="currentColor" stroke-width="1.4" />
            <path
                d="M3 20c0-3 2.7-5 6-5s6 2 6 5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
            <path
                d="M15 19c0-2 2.2-4 4-4s2 1 2 1"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
            />
        </svg>
    );
}

function GroupPlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.6" />
            <path
                d="M3 20c0-3 2.7-5 6-5s6 2 6 5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
            <path
                d="M18 6v6M15 9h6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function FolderPlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
            <path
                d="M12 11v6M9 14h6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
        </svg>
    );
}

function PencilIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
                d="M14 4l6 6L8 22H2v-6L14 4z"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linejoin="round"
            />
            <path d="M13 5l6 6" stroke="currentColor" stroke-width="1.8" />
        </svg>
    );
}

function formatRelative(ms: number): string {
    if (ms <= 0) return '';
    const normalized = ms < 1e11 ? ms * 1000 : ms;
    const deltaSeconds = Math.max(0, Math.round((Date.now() - normalized) / 1000));
    if (deltaSeconds < 60) return 'now';
    if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m`;
    if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h`;
    if (deltaSeconds < 604800) return `${Math.floor(deltaSeconds / 86400)}d`;
    const date = new Date(normalized);
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}
