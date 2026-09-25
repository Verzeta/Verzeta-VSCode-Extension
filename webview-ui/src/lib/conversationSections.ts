// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Conversations sidebar layout — bucketed flat list mirroring
 * Android's `categoriseSidebar` (see Verzeta-Android/.../data/chat/
 * SidebarRow.kt) and the desktop's SidebarFlatModel.
 *
 * Ordering (top to bottom):
 *   1. Pinned          (conversations with isPinned)
 *   2. Project Rooms   (expandable per folder; inside each project:
 *                          TEAM MEMBERS subsection (members → tap to
 *                          open 1:1)
 *                          "Start Group Chat with All" action row
 *                          Group Chats subsection (group-role convs
 *                          in this folder, sorted by updated_at desc)
 *                          Direct Chats subsection (1:1 convs in this
 *                          folder, sorted by updated_at desc))
 *   3. Group Chats     (groups outside any project)
 *   4. Direct Agents   (1:1 with primary_agent_id outside any project)
 *   5. Plain Chats     (everything else)
 *
 * Search filters all rows by title (case-insensitive substring).
 * Empty buckets are pruned. The build is pure — no DOM access or
 * signal subscription happens inside.
 */

import type { ConversationFullUi, FolderSummaryUi } from '../../../src/shared/webview-protocol.js';
import type { AgentSummaryUi, MemberUi } from '../../../src/shared/wire-types.js';
import type { SectionId } from '../state/chatNav.js';

export type RowKind =
    | { readonly kind: 'sectionHeader'; readonly section: SectionId; readonly count: number }
    | {
          readonly kind: 'projectHeader';
          readonly folderId: string;
          readonly name: string;
          readonly folderType: 'project' | 'organization' | 'regular';
          readonly count: number;
      }
    | {
          readonly kind: 'subsectionHeader';
          readonly folderId: string;
          readonly subsection: 'members' | 'groups' | 'directs';
          readonly label: string;
          readonly count: number;
      }
    | {
          readonly kind: 'memberRow';
          readonly folderId: string;
          readonly agentId: string;
          readonly alias: string;
          readonly roleName: string;
          readonly isCoordinator: boolean;
      }
    | {
          readonly kind: 'actionRow';
          readonly folderId: string;
          readonly action: 'startGroupChatAll';
          readonly label: string;
      }
    | {
          readonly kind: 'conversation';
          readonly conv: ConversationFullUi;
          readonly indent: 0 | 1 | 2;
      };

export interface BuildRowsInput {
    readonly conversations: readonly ConversationFullUi[];
    readonly folders: readonly FolderSummaryUi[];
    readonly searchQuery: string;
    readonly collapsedSections: ReadonlySet<SectionId>;
    readonly expandedFolderIds: ReadonlySet<string>;
    /** Map of folderId → member list (for the active host). */
    readonly membersByFolder: ReadonlyMap<string, readonly MemberUi[]>;
    /** Agent registry for the active host. Used to resolve role names. */
    readonly agents: readonly AgentSummaryUi[];
}

export function buildRows(input: BuildRowsInput): readonly RowKind[] {
    const filter = input.searchQuery.trim().toLowerCase();
    const matches = (c: ConversationFullUi): boolean => {
        if (filter.length === 0) return true;
        return c.title.toLowerCase().includes(filter);
    };

    const filtered = input.conversations.filter(matches);
    const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);

    const pinned = sorted.filter((c) => c.isPinned);
    // Every folder is a sidebar group — project / organization folders
    // render a TEAM MEMBERS body, regular folders just hold their
    // conversations (matching the desktop + Android categoriser). The
    // bucket test below keys on membership in ANY known folder, NOT on
    // folder type, so a chat moved into a regular folder (e.g. a
    // workspace-mount anchor) appears UNDER that folder instead of
    // leaking into Plain Chats.
    const displayFolders = input.folders.slice().sort((a, b) => a.name.localeCompare(b.name));
    const knownFolderIds = new Set(displayFolders.map((f) => f.id));
    // "In a folder the client actually knows about." A conv whose
    // folderId is set but points to a folder missing from the list is
    // treated as a ROOT conv so it can never vanish — it falls back to
    // the group / direct / plain buckets below.
    const inKnownFolder = (c: ConversationFullUi): boolean =>
        c.folderId !== undefined && c.folderId.length > 0 && knownFolderIds.has(c.folderId);
    const groups = sorted.filter((c) => !c.isPinned && c.isGroup && !inKnownFolder(c));
    const directs = sorted.filter(
        (c) => !c.isPinned && !c.isGroup && c.primaryAgentId !== undefined && !inKnownFolder(c),
    );
    const plain = sorted.filter((c) => {
        if (c.isPinned) return false;
        if (inKnownFolder(c)) return false;
        if (c.isGroup) return false;
        if (c.primaryAgentId !== undefined) return false;
        return true;
    });

    const agentNameById = new Map<string, string>();
    for (const a of input.agents) agentNameById.set(a.id, a.name);

    const rows: RowKind[] = [];

    const pushSection = (
        section: SectionId,
        items: readonly ConversationFullUi[],
        render: () => void,
    ): void => {
        if (items.length === 0) return;
        rows.push({ kind: 'sectionHeader', section, count: items.length });
        if (input.collapsedSections.has(section)) return;
        render();
    };

    pushSection('pinned', pinned, () => {
        for (const c of pinned) rows.push({ kind: 'conversation', conv: c, indent: 0 });
    });

    if (displayFolders.length > 0) {
        rows.push({
            kind: 'sectionHeader',
            section: 'projects',
            count: displayFolders.length,
        });
        if (!input.collapsedSections.has('projects')) {
            for (const f of displayFolders) {
                const folderConvs = sorted.filter((c) => c.folderId === f.id);
                const isProjectish = f.folderType === 'project' || f.folderType === 'organization';
                rows.push({
                    kind: 'projectHeader',
                    folderId: f.id,
                    name: f.name,
                    folderType: isProjectish
                        ? f.folderType === 'organization'
                            ? 'organization'
                            : 'project'
                        : 'regular',
                    count: folderConvs.length,
                });
                if (input.expandedFolderIds.has(f.id)) {
                    if (isProjectish) {
                        appendProjectBody(
                            rows,
                            f,
                            folderConvs,
                            input.membersByFolder,
                            agentNameById,
                        );
                    } else {
                        // Regular folder: just its conversations, no
                        // team-member machinery.
                        for (const c of folderConvs) {
                            rows.push({ kind: 'conversation', conv: c, indent: 1 });
                        }
                    }
                }
            }
        }
    }

    pushSection('groups', groups, () => {
        for (const c of groups) rows.push({ kind: 'conversation', conv: c, indent: 0 });
    });
    pushSection('directs', directs, () => {
        for (const c of directs) rows.push({ kind: 'conversation', conv: c, indent: 0 });
    });
    pushSection('plain', plain, () => {
        for (const c of plain) rows.push({ kind: 'conversation', conv: c, indent: 0 });
    });

    return rows;
}

function appendProjectBody(
    rows: RowKind[],
    folder: FolderSummaryUi,
    folderConvs: readonly ConversationFullUi[],
    membersByFolder: ReadonlyMap<string, readonly MemberUi[]>,
    agentNameById: ReadonlyMap<string, string>,
): void {
    const members = membersByFolder.get(folder.id) ?? [];

    // 1. TEAM MEMBERS subsection — always emit when the folder has
    //    >=1 member so the user has a tap-target for 1:1 chats. Sort
    //    members so coordinators float to the top.
    if (members.length > 0) {
        rows.push({
            kind: 'subsectionHeader',
            folderId: folder.id,
            subsection: 'members',
            label: 'TEAM MEMBERS',
            count: members.length,
        });
        const sortedMembers = [...members].sort((a, b) => {
            if (a.isCoordinator && !b.isCoordinator) return -1;
            if (!a.isCoordinator && b.isCoordinator) return 1;
            return a.alias.localeCompare(b.alias);
        });
        for (const m of sortedMembers) {
            rows.push({
                kind: 'memberRow',
                folderId: folder.id,
                agentId: m.agentId,
                alias: m.alias,
                roleName: agentNameById.get(m.agentId) ?? '',
                isCoordinator: m.isCoordinator,
            });
        }
    }

    // 2. "Start group chat with all" action row — emit when the folder
    //    has 2+ members. Less than 2 = host rejects with server_error
    //    so don't surface the option.
    if (members.length >= 2) {
        rows.push({
            kind: 'actionRow',
            folderId: folder.id,
            action: 'startGroupChatAll',
            label: 'Start Group Chat with All',
        });
    }

    // 3. Group Chats subsection — group-role convs inside this folder.
    const groupConvs = folderConvs.filter((c) => c.isGroup);
    if (groupConvs.length > 0) {
        rows.push({
            kind: 'subsectionHeader',
            folderId: folder.id,
            subsection: 'groups',
            label: 'Group Chats',
            count: groupConvs.length,
        });
        for (const c of groupConvs) {
            rows.push({ kind: 'conversation', conv: c, indent: 2 });
        }
    }

    // 4. Direct Chats subsection — 1:1 convs inside this folder.
    const directConvs = folderConvs.filter((c) => !c.isGroup);
    if (directConvs.length > 0) {
        rows.push({
            kind: 'subsectionHeader',
            folderId: folder.id,
            subsection: 'directs',
            label: 'Direct Chats',
            count: directConvs.length,
        });
        for (const c of directConvs) {
            rows.push({ kind: 'conversation', conv: c, indent: 2 });
        }
    }
}

export function sectionLabel(section: SectionId): string {
    switch (section) {
        case 'pinned':
            return 'Pinned';
        case 'projects':
            return 'Project Rooms';
        case 'groups':
            return 'Group Chats';
        case 'directs':
            return 'Direct Agents';
        case 'plain':
            return 'Plain Chats';
    }
}
