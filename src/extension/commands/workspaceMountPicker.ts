// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { ConversationUi, FolderUi } from '../../shared/wire-types.js';

/**
 * Walks the parent chain for a folder starting at `startFolderId`,
 * mirroring the host's `ConversationService::folderChainForConversation`
 * algorithm. Returns the chain ordered innermost-first.
 *
 * @param folders host's folder list (cached client-side, e.g. via
 *                ProjectStore.foldersByHost).
 * @param startFolderId the conv's direct folder id (host's
 *                       `conversations.folder_id`).
 * @returns chain of folders from innermost (the conv's direct
 *          folder) to outermost (root). Empty when `startFolderId`
 *          is undefined / empty, or when the starting folder is
 *          missing from the cache.
 */
export function walkFolderChain(
    folders: readonly FolderUi[],
    startFolderId: string | undefined,
): readonly FolderUi[] {
    if (startFolderId === undefined || startFolderId.length === 0) return [];
    const byId = new Map<string, FolderUi>();
    for (const f of folders) byId.set(f.id, f);
    const chain: FolderUi[] = [];
    let currentId: string | undefined = startFolderId;
    let safety = 32;
    while (currentId !== undefined && currentId.length > 0 && safety-- > 0) {
        const f = byId.get(currentId);
        if (f === undefined) break;
        chain.push(f);
        currentId = f.parentId;
    }
    return chain;
}

/**
 * Replicates the host's caller-folder resolution algorithm — see
 * `backend/services/chat/tool-dispatcher.cpp` lines 280-301. Given a
 * conversation's folder chain (innermost-first), returns the folder
 * the host will resolve as `__caller_folder_id` for that conv's
 * tool calls.
 *
 *   1. First folder in the chain where `folderType` is `'project'` or
 *      `'organization'` wins.
 *   2. Else, the chain's first entry (the conv's direct folder).
 *   3. Else (empty chain), `undefined`.
 *
 * The mount MUST be registered against this folder so the host's
 * `FolderMountRegistry::mountFor(callerFolderId)` lookup matches at
 * agent-tool-call time.
 */
export function resolveCallerFolderId(chain: readonly FolderUi[]): string | undefined {
    for (const f of chain) {
        if (f.folderType === 'project' || f.folderType === 'organization') {
            return f.id;
        }
    }
    return chain[0]?.id;
}

/** Display-kind enum for the conversation picker. */
export type ConversationKind = 'plain' | 'oneToOne' | 'group';

export function conversationKindOf(conv: ConversationUi): ConversationKind {
    if (conv.isGroup) return 'group';
    if (conv.primaryAgentId !== undefined && conv.primaryAgentId.length > 0) {
        return 'oneToOne';
    }
    return 'plain';
}

/** Codicon prefix for the conversation picker's label. */
export function iconForConversation(conv: ConversationUi): string {
    switch (conversationKindOf(conv)) {
        case 'group':
            return '$(organization)';
        case 'oneToOne':
            return '$(person)';
        case 'plain':
            return '$(comment)';
    }
}

/**
 * Per-row label for the conversation QuickPick. Combines the codicon
 * for the conv type with the conv's title (or a sensible placeholder
 * when the title is empty — convs default to "New Chat" on the host,
 * but we still defend against an explicitly cleared title).
 */
export function labelForConversation(conv: ConversationUi): string {
    const title = conv.title.trim().length > 0 ? conv.title.trim() : 'Untitled conversation';
    return `${iconForConversation(conv)} ${title}`;
}

/**
 * Description string for a conversation picker item — surfaces the
 * conv's folder context so the user knows where it lives. Renders the
 * chain outermost-first (e.g. "Sales / Marketing Sub-project")
 * because that reads as a natural breadcrumb.
 */
export function describeConversationContext(
    conv: ConversationUi,
    folders: readonly FolderUi[],
): string {
    const chain = walkFolderChain(folders, conv.folderId);
    if (chain.length === 0) return '(root)';
    return [...chain]
        .reverse()
        .map((f) => f.name)
        .join(' / ');
}

/** Small slice of the wire repository surface the resolver needs. */
export interface BindRepository {
    createFolder(name: string): Promise<{ readonly id: string; readonly type: string }>;
    moveConversationToFolder(convId: string, folderId: string): Promise<void>;
}

/** Optional hook that keeps the local folder cache in sync. */
export interface BindCacheUpdater {
    upsertFolder(folder: FolderUi): void;
}

export interface ResolveBindFolderArgs {
    readonly conv: ConversationUi;
    readonly folders: readonly FolderUi[];
    readonly workspaceTail: string;
    readonly repository: BindRepository;
    readonly cacheUpdater?: BindCacheUpdater;
}

export interface ResolveBindFolderResult {
    readonly folderId: string;
    /** `true` iff a new host folder was created and the conv moved into it. */
    readonly created: boolean;
    /** Display name for the resolved folder (drives the success toast). */
    readonly name: string;
}

export async function resolveBindFolderForConv(
    args: ResolveBindFolderArgs,
): Promise<ResolveBindFolderResult> {
    const direct = args.conv.folderId;
    if (direct !== undefined && direct.length > 0) {
        const chain = walkFolderChain(args.folders, direct);
        if (chain.length > 0) {
            const resolvedId = resolveCallerFolderId(chain) ?? direct;
            const resolvedFolder = args.folders.find((f) => f.id === resolvedId);
            return {
                folderId: resolvedId,
                created: false,
                name: resolvedFolder?.name ?? args.workspaceTail,
            };
        }
        // conv.folderId is set but the folder isn't in the cache —
        // the cache is stale relative to the host. Trust conv.folderId
        // directly so the mount still anchors against the conv's
        // chain. The host's `folderChainForConversation` will resolve
        // chain.first() for a regular folder (and itself for a
        // project), and either way the mount sits on the resolved id.
        return { folderId: direct, created: false, name: args.workspaceTail };
    }
    // Conv is at root — auto-create a folder named after the
    // workspace tail and move the conv into it.
    const created = await args.repository.createFolder(args.workspaceTail);
    await args.repository.moveConversationToFolder(args.conv.id, created.id);
    if (args.cacheUpdater !== undefined) {
        const folderType = isKnownFolderKind(created.type) ? created.type : 'project';
        args.cacheUpdater.upsertFolder({
            id: created.id,
            name: args.workspaceTail,
            parentId: undefined,
            folderType,
        });
    }
    return { folderId: created.id, created: true, name: args.workspaceTail };
}

function isKnownFolderKind(value: string): value is FolderUi['folderType'] {
    return value === 'project' || value === 'organization' || value === 'regular';
}

/**
 * Clamp a configured default tier to `ask` or `smart`. `bypass` is never
 * a default, because the automatic share applies the default without a
 * prompt; it can only be chosen in the tier picker, which confirms it.
 * Anything unrecognised falls back to `ask`.
 *
 * @param raw the `verzeta.workspaceMount.defaultTier` value.
 * @returns `smart` when configured, otherwise `ask`.
 */
export function clampDefaultTier(raw: unknown): 'ask' | 'smart' {
    return raw === 'smart' ? 'smart' : 'ask';
}
