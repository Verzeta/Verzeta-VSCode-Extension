// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as vscode from 'vscode';
import * as path from 'node:path';
import type { Logger } from '../log/Logger.js';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { ConversationStore } from '../conversations/ConversationStore.js';
import type { ProjectStore } from '../conversations/ProjectStore.js';
import { type Disposable, DisposableStore } from '../infra/disposables.js';
import { RemoteOpError } from '../wire/RemoteSession.js';
import type {
    ConversationUi,
    FolderUi,
    PermissionTier,
    WorkspaceMountInfoUi,
} from '../../shared/wire-types.js';
import { STATUS_BAR_MENU_COMMAND } from '../workspace/WorkspaceMountStatusBar.js';
import type { WorkspaceMountService } from '../workspace/WorkspaceMountService.js';
import {
    clampDefaultTier,
    describeConversationContext,
    labelForConversation,
    resolveBindFolderForConv,
    resolveCallerFolderId,
    walkFolderChain,
    type ResolveBindFolderResult,
} from './workspaceMountPicker.js';

export const COMMAND_IDS = {
    REGISTER: 'verzeta.registerWorkspaceMount',
    UNREGISTER: 'verzeta.unregisterWorkspaceMount',
    REFRESH: 'verzeta.refreshWorkspaceMount',
    CHANGE_TIER: 'verzeta.changeWorkspaceMountTier',
    STATUS_MENU: STATUS_BAR_MENU_COMMAND,
} as const;

export interface WorkspaceMountCommandsDeps {
    readonly logger: Logger;
    readonly workspaceMount: WorkspaceMountService;
    readonly connectionManager: ConnectionManager;
    readonly projectStore: ProjectStore;
    readonly conversationStore: ConversationStore;
    /** Per-workspace memento for the "Never here" share-offer flag. */
    readonly workspaceState?: vscode.Memento | undefined;
}

export function registerWorkspaceMountCommands(deps: WorkspaceMountCommandsDeps): Disposable {
    const store = new DisposableStore();

    store.add(vscode.commands.registerCommand(COMMAND_IDS.REGISTER, () => doRegister(deps)));
    store.add(vscode.commands.registerCommand(COMMAND_IDS.UNREGISTER, () => doUnregister(deps)));
    store.add(vscode.commands.registerCommand(COMMAND_IDS.REFRESH, () => doRefresh(deps)));
    store.add(vscode.commands.registerCommand(COMMAND_IDS.CHANGE_TIER, () => doChangeTier(deps)));
    store.add(
        vscode.commands.registerCommand(COMMAND_IDS.STATUS_MENU, () => doStatusBarMenu(deps)),
    );

    return store;
}

// === flows ===

const NEVER_OFFER_SHARE_KEY = 'verzeta.workspaceMount.neverOfferShare';

// Module-session state for the share offer: one offer in flight at a
// time, and a "Not now" answer silences the offer until the next
// VS Code session (the per-workspace "Never here" flag persists in
// workspaceState).
let shareOfferInFlight = false;
let shareOfferDeclinedThisSession = false;

/**
 * Discoverability bridge for the workspace mount: invoked on every
 * message send from the webview. When the open workspace is NOT
 * shared with any conversation, surface a one-click consent offer
 * bound to the conversation the user is typing in — users should
 * never have to know a register command exists before their agents
 * can see files. Silent no-op when a mount exists, when there is no
 * workspace, when the user said "Not now" this session or "Never
 * here" for this workspace, or when stores are still cold.
 *
 * Consent stays explicit (a mount lets agents READ workspace files),
 * but it costs exactly one click at the exact moment of need; the
 * folder binding reuses resolveBindFolderForConv, so the mount lands
 * on the same host folder the host's chain walk resolves for this
 * conversation. Writes stay governed by the default permission tier.
 */
export async function maybeOfferWorkspaceShare(
    deps: WorkspaceMountCommandsDeps,
    hostId: string,
    conversationId: string,
): Promise<void> {
    const { logger, connectionManager, conversationStore } = deps;
    if (shareOfferInFlight || shareOfferDeclinedThisSession) return;
    if (evaluateWorkspaceShareStatus(deps, hostId, conversationId) !== 'unmounted') return;
    if (deps.workspaceState?.get<boolean>(NEVER_OFFER_SHARE_KEY) === true) return;
    const workspaceFolder = activeWorkspaceFolder();
    if (workspaceFolder === undefined) return;
    if (connectionManager.activeHostId() !== hostId) return;
    const repository = connectionManager.repositoryFor(hostId);
    if (repository === undefined) return;
    const conv = conversationStore.byHost(hostId).find((c) => c.id === conversationId);
    if (conv === undefined) return;

    // verzeta.workspaceMount.autoRegister: in a project room, with exactly
    // one workspace folder open, share without asking. Everything checked
    // above still applies (nothing mounted yet, no "Never for this
    // workspace", active host). Any other case falls back to the offer.
    if (shouldAutoRegister(deps, hostId, conv)) {
        shareOfferInFlight = true;
        try {
            await bindAndRegisterForConv(
                deps,
                hostId,
                conv,
                repository,
                workspaceFolderTail(workspaceFolder),
                workspaceFolder.uri.fsPath,
            );
        } catch (error) {
            const detail = errorText(error);
            await vscode.window.showErrorMessage(`Failed to share the workspace: ${detail}`);
            logger.warn('auto-register: failed', { error: detail, conversationId });
        } finally {
            shareOfferInFlight = false;
        }
        return;
    }

    shareOfferInFlight = true;
    try {
        const tail = workspaceFolderTail(workspaceFolder);
        const action = await vscode.window.showInformationMessage(
            `Agents in "${labelForConversation(conv)}" can't see your files yet. ` +
                `Share the "${tail}" workspace with this chat? ` +
                `If this chat isn't already in a folder, one named "${tail}" is created and the chat is filed into it.`,
            'Share workspace',
            'Not now',
            'Never for this workspace',
        );
        if (action === undefined || action === 'Not now') {
            shareOfferDeclinedThisSession = true;
            return;
        }
        if (action === 'Never for this workspace') {
            await deps.workspaceState?.update(NEVER_OFFER_SHARE_KEY, true);
            return;
        }

        const root = await pickWorkspaceRoot();
        if (root === undefined) return;
        await bindAndRegisterForConv(
            deps,
            hostId,
            conv,
            repository,
            workspaceFolderTail(root),
            root.uri.fsPath,
        );
    } catch (error) {
        const detail = errorText(error);
        await vscode.window.showErrorMessage(`Failed to share the workspace: ${detail}`);
        logger.warn('share-offer: failed', { error: detail, conversationId });
    } finally {
        shareOfferInFlight = false;
    }
}

/**
 * Bind-and-register core shared by the consent toast and the in-chat
 * banner: hydrate the folder cache, resolve the conversation's bind
 * folder (host chain-walk mirror; auto-create + move when the conv
 * is at root), register at the configured default tier, toast.
 */
async function bindAndRegisterForConv(
    deps: WorkspaceMountCommandsDeps,
    hostId: string,
    conv: ConversationUi,
    repository: NonNullable<ReturnType<ConnectionManager['repositoryFor']>>,
    workspaceTail: string,
    workspaceRoot?: string,
): Promise<void> {
    const { logger, workspaceMount, projectStore } = deps;
    let folders: readonly FolderUi[] = projectStore.foldersByHost(hostId);
    if (folders.length === 0) {
        folders = await repository.listAllFolders();
        if (folders.length > 0) projectStore.replaceFolders(hostId, folders);
    }
    const bind = await resolveBindFolderForConv({
        conv,
        folders,
        workspaceTail,
        repository: {
            createFolder: (name) => repository.createFolder(name),
            moveConversationToFolder: (cid, fid) => repository.moveConversationToFolder(cid, fid),
        },
        cacheUpdater: {
            upsertFolder: (folder) => projectStore.upsertFolder(hostId, folder),
        },
    });
    const tier = readDefaultTier();
    const info = await workspaceMount.registerMount(bind.folderId, bind.name, tier, workspaceRoot);
    await vscode.window.showInformationMessage(
        `Workspace shared with this chat (tier ${tier}). Manage it from the status bar.`,
    );
    logger.info('workspace-share: mount registered', {
        convId: conv.id,
        folderId: info.folderId,
        tier,
        createdHostFolder: bind.created,
    });
}

/** Share-status verdict for the in-chat banner. */
export type WorkspaceShareStatus =
    | 'mounted' // workspace shared and bound to this conversation's folder
    | 'unmounted' // workspace open, no mount at all
    | 'mismatched' // a mount exists but is bound to a different folder
    | 'none'; // no workspace open / unknown conv — banner stays hidden

/**
 * Evaluate whether the open workspace is shared WITH THIS
 * conversation. Pure cache reads — never touches the wire — so it is
 * safe to call on every conversation switch. 'mismatched' catches
 * the trap where a mount exists but the host's chain walk for this
 * conv resolves to a different folder, i.e. agents here still see
 * nothing.
 */
export function evaluateWorkspaceShareStatus(
    deps: WorkspaceMountCommandsDeps,
    hostId: string,
    conversationId: string,
): WorkspaceShareStatus {
    if (activeWorkspaceFolder() === undefined) return 'none';
    if (deps.connectionManager.activeHostId() !== hostId) return 'none';
    const conv = deps.conversationStore.byHost(hostId).find((c) => c.id === conversationId);
    if (conv === undefined) return 'none';
    const mounts = deps.workspaceMount.getActiveMounts();
    if (mounts.length === 0) return 'unmounted';
    const resolved = mountFolderForConv(deps, hostId, conv);
    if (resolved === undefined) return 'mismatched';
    return mounts.some((m) => m.folderId === resolved) ? 'mounted' : 'mismatched';
}

/**
 * The folder a conversation's mount must be bound to, resolved from the
 * cached folder chain the same way the host resolves it. Undefined for
 * a conversation at root. No auto-create: this stays side-effect free.
 */
function mountFolderForConv(
    deps: WorkspaceMountCommandsDeps,
    hostId: string,
    conv: ConversationUi,
): string | undefined {
    const direct = conv.folderId;
    if (direct === undefined || direct.length === 0) return undefined;
    const chain = walkFolderChain(deps.projectStore.foldersByHost(hostId), direct);
    return chain.length > 0 ? (resolveCallerFolderId(chain) ?? direct) : direct;
}

/** The mount serving the active conversation, if any. */
function activeConversationMount(
    deps: WorkspaceMountCommandsDeps,
): WorkspaceMountInfoUi | undefined {
    const hostId = deps.connectionManager.activeHostId();
    const convId = deps.conversationStore.activeConversationId();
    if (hostId === undefined || convId === undefined) return undefined;
    const conv = deps.conversationStore.byHost(hostId).find((c) => c.id === convId);
    if (conv === undefined) return undefined;
    const folderId = mountFolderForConv(deps, hostId, conv);
    return deps.workspaceMount.getActiveMounts().find((m) => m.folderId === folderId);
}

/**
 * The mount a tier, refresh or unregister command acts on: the one
 * serving the active conversation, else the only mount, else the one the
 * user picks. Undefined when there is none or the pick is cancelled.
 */
async function pickTargetMount(
    deps: WorkspaceMountCommandsDeps,
    title: string,
): Promise<WorkspaceMountInfoUi | undefined> {
    const mounts = deps.workspaceMount.getActiveMounts();
    if (mounts.length === 0) {
        await vscode.window.showInformationMessage('No workspace mount is currently active.');
        return undefined;
    }
    const served = activeConversationMount(deps);
    if (served !== undefined) return served;
    if (mounts.length === 1) return mounts[0];
    const pick = await vscode.window.showQuickPick(
        mounts.map((m) => ({
            label: m.ownerLabel,
            description: `tier ${m.permissionTier}`,
            detail: m.workspaceRoot,
            mount: m,
        })),
        { title, placeHolder: 'Choose a workspace mount', ignoreFocusOut: true },
    );
    return pick?.mount;
}

/**
 * Direct share from the in-chat banner — the button click IS the
 * consent, so no toast question. When a mount is already bound to a
 * different folder ('mismatched'), it is released first (V1 is one
 * mount per window; the click is an explicit re-bind).
 */
export async function shareWorkspaceWithConversation(
    deps: WorkspaceMountCommandsDeps,
    hostId: string,
    conversationId: string,
): Promise<void> {
    const { logger, connectionManager, conversationStore } = deps;
    if (shareOfferInFlight) return;
    const workspaceFolder = activeWorkspaceFolder();
    if (workspaceFolder === undefined) return;
    if (connectionManager.activeHostId() !== hostId) return;
    const repository = connectionManager.repositoryFor(hostId);
    if (repository === undefined) return;
    const conv = conversationStore.byHost(hostId).find((c) => c.id === conversationId);
    if (conv === undefined) return;

    shareOfferInFlight = true;
    try {
        const root = await pickWorkspaceRoot();
        if (root === undefined) return;
        await bindAndRegisterForConv(
            deps,
            hostId,
            conv,
            repository,
            workspaceFolderTail(root),
            root.uri.fsPath,
        );
    } catch (error) {
        const detail = errorText(error);
        await vscode.window.showErrorMessage(`Failed to share the workspace: ${detail}`);
        logger.warn('workspace-share: banner share failed', { error: detail, conversationId });
    } finally {
        shareOfferInFlight = false;
    }
}

async function doRegister(deps: WorkspaceMountCommandsDeps): Promise<void> {
    const { logger, workspaceMount, connectionManager, projectStore, conversationStore } = deps;

    const workspaceFolder = await pickWorkspaceRoot();
    if (workspaceFolder === undefined) {
        await vscode.window.showWarningMessage(
            'Open a workspace folder in VS Code before registering a Verzeta workspace mount.',
        );
        return;
    }

    const hostId = connectionManager.activeHostId();
    if (hostId === undefined) {
        await vscode.window.showWarningMessage(
            'Connect to a Verzeta host before registering a workspace mount.',
        );
        return;
    }
    const repository = connectionManager.repositoryFor(hostId);
    if (repository === undefined) {
        await vscode.window.showWarningMessage(
            'Not connected to the host. Reconnect, then register the mount again.',
        );
        return;
    }

    // Hydrate caches from the wire when cold (typical right after a
    // fresh connect, before WireSync's first sync has landed).
    let conversations: readonly ConversationUi[] = conversationStore.byHost(hostId);
    if (conversations.length === 0) {
        try {
            conversations = await repository.listConversations();
        } catch (error) {
            const detail = errorText(error);
            await vscode.window.showErrorMessage(`Failed to list conversations: ${detail}`);
            logger.warn('register-mount: listConversations failed', { error: detail });
            return;
        }
    }
    let folders: readonly FolderUi[] = projectStore.foldersByHost(hostId);
    if (folders.length === 0) {
        try {
            folders = await repository.listAllFolders();
            if (folders.length > 0) projectStore.replaceFolders(hostId, folders);
        } catch (error) {
            const detail = errorText(error);
            await vscode.window.showErrorMessage(`Failed to list folders: ${detail}`);
            logger.warn('register-mount: listAllFolders failed', { error: detail });
            return;
        }
    }

    if (conversations.length === 0) {
        await vscode.window.showInformationMessage(
            'No conversations on the active host yet. Open or create a chat in Verzeta first, then pair the workspace.',
        );
        return;
    }

    const activeConvId = conversationStore.activeConversationId();
    const conv = await pickConversation(conversations, folders, activeConvId, workspaceFolder);
    if (conv === undefined) return;

    const tier = await pickTier(readDefaultTier(), 'Choose a permission tier');
    if (tier === undefined) return;

    let bind: ResolveBindFolderResult;
    try {
        bind = await resolveBindFolderForConv({
            conv,
            folders,
            workspaceTail: workspaceFolderTail(workspaceFolder),
            repository: {
                createFolder: (name) => repository.createFolder(name),
                moveConversationToFolder: (cid, fid) =>
                    repository.moveConversationToFolder(cid, fid),
            },
            cacheUpdater: {
                upsertFolder: (folder) => projectStore.upsertFolder(hostId, folder),
            },
        });
    } catch (error) {
        const detail = errorText(error);
        await vscode.window.showErrorMessage(
            `Failed to set up the host folder for this mount: ${detail}`,
        );
        logger.warn('register-mount: resolveBindFolder failed', {
            error: detail,
            convId: conv.id,
        });
        return;
    }

    try {
        const info = await workspaceMount.registerMount(
            bind.folderId,
            bind.name,
            tier,
            workspaceFolder.uri.fsPath,
        );
        const suffix = bind.created
            ? ` (created folder "${bind.name}" for this chat)`
            : ` (folder: ${bind.name})`;
        await vscode.window.showInformationMessage(
            `Verzeta workspace mount registered: ${info.ownerLabel} · tier ${tier}${suffix}.`,
        );
        logger.info('register-mount: success', {
            convId: conv.id,
            folderId: info.folderId,
            tier,
            fileCount: info.fileCount,
            createdHostFolder: bind.created,
        });
    } catch (error) {
        const detail = errorText(error);
        await vscode.window.showErrorMessage(`Failed to register workspace mount: ${detail}`);
        logger.warn('register-mount: registerMount failed', {
            error: detail,
            convId: conv.id,
            folderId: bind.folderId,
        });
    }
}

interface ConversationPickItem extends vscode.QuickPickItem {
    readonly conv: ConversationUi;
}

/**
 * Quick-pick a conversation. Shows every conversation on the active
 * host with its folder context. Sorted by recency (most-recently-
 * updated first); the active conv (when knowable from the store)
 * shows a `[active]` description suffix and is pre-selected.
 */
async function pickConversation(
    conversations: readonly ConversationUi[],
    folders: readonly FolderUi[],
    activeConvId: string | undefined,
    workspaceFolder: vscode.WorkspaceFolder,
): Promise<ConversationUi | undefined> {
    const tail = workspaceFolderTail(workspaceFolder);
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    let activeItem: ConversationPickItem | undefined;
    const items: ConversationPickItem[] = sorted.map((conv) => {
        const isActive = activeConvId !== undefined && conv.id === activeConvId;
        const baseDesc = describeConversationContext(conv, folders);
        const item: ConversationPickItem = {
            label: labelForConversation(conv),
            description: isActive ? `${baseDesc} · active in chat` : baseDesc,
            detail: formatUpdatedAt(conv.updatedAt),
            conv,
            picked: isActive,
        };
        if (isActive) activeItem = item;
        return item;
    });
    // The picked flag only renders for multi-select; for a regular
    // QuickPick we additionally reorder so the active conv is first.
    if (activeItem !== undefined) {
        const filtered = items.filter((it) => it !== activeItem);
        items.length = 0;
        items.push(activeItem, ...filtered);
    }
    const pick = await vscode.window.showQuickPick(items, {
        title: `Pair this workspace (${tail}) with a Verzeta conversation`,
        placeHolder: 'Choose the chat that will see this workspace',
        ignoreFocusOut: true,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    return pick?.conv;
}

async function doUnregister(deps: WorkspaceMountCommandsDeps): Promise<void> {
    const { logger, workspaceMount } = deps;
    const active = await pickTargetMount(deps, 'Unregister a workspace mount');
    if (active === undefined) return;
    const choice = await vscode.window.showWarningMessage(
        `Unregister Verzeta workspace mount for "${active.ownerLabel}"?`,
        { modal: true },
        'Unregister',
    );
    if (choice !== 'Unregister') return;
    try {
        await workspaceMount.unregisterMount(active.folderId);
        await vscode.window.showInformationMessage(
            `Verzeta workspace mount removed: ${active.ownerLabel}.`,
        );
        logger.info('unregister-mount: success', { folderId: active.folderId });
    } catch (error) {
        const detail = errorText(error);
        await vscode.window.showErrorMessage(`Failed to unregister workspace mount: ${detail}`);
        logger.warn('unregister-mount: failed', { error: detail });
    }
}

async function doRefresh(deps: WorkspaceMountCommandsDeps): Promise<void> {
    const { logger, workspaceMount } = deps;
    const active = await pickTargetMount(deps, 'Refresh a workspace mount');
    if (active === undefined) return;
    try {
        const pushed = await workspaceMount.refreshTree(active.folderId);
        if (pushed) {
            await vscode.window.showInformationMessage(
                `Verzeta workspace tree refreshed for ${active.ownerLabel}.`,
            );
        } else {
            await vscode.window.showInformationMessage(
                'Workspace tree already matches the host. No refresh needed.',
            );
        }
        logger.info('refresh-mount: completed', { folderId: active.folderId, pushed });
    } catch (error) {
        const detail = errorText(error);
        await vscode.window.showErrorMessage(`Failed to refresh workspace mount: ${detail}`);
        logger.warn('refresh-mount: failed', { error: detail });
    }
}

async function doChangeTier(deps: WorkspaceMountCommandsDeps): Promise<void> {
    const { logger, workspaceMount } = deps;
    const active = await pickTargetMount(deps, 'Change a workspace mount tier');
    if (active === undefined) return;
    const tier = await pickTier(active.permissionTier, 'Change permission tier');
    if (tier === undefined) return;
    if (tier === active.permissionTier) {
        await vscode.window.showInformationMessage(`Tier already set to ${tier}.`);
        return;
    }
    if (tier === 'bypass') {
        const ok = await vscode.window.showWarningMessage(
            'Bypass tier: every Verzeta write applies without a confirmation prompt. ' +
                'Smart Mode block rules still apply (credentials, shell pipe to interpreter, reverse shell). Continue?',
            { modal: true },
            'Enable bypass',
        );
        if (ok !== 'Enable bypass') return;
    }
    try {
        await workspaceMount.changeTier(active.folderId, tier);
    } catch (error) {
        const detail = errorText(error);
        await vscode.window.showErrorMessage(`Failed to change the workspace tier: ${detail}`);
        logger.warn('change-tier: failed', { folderId: active.folderId, error: detail });
        return;
    }
    await vscode.window.showInformationMessage(`Verzeta workspace tier set to ${tier}.`);
    logger.info('change-tier: applied', { folderId: active.folderId, tier });
}

async function doStatusBarMenu(deps: WorkspaceMountCommandsDeps): Promise<void> {
    const active = activeConversationMount(deps) ?? deps.workspaceMount.getActiveMounts()[0];
    if (active === undefined) {
        await vscode.commands.executeCommand(COMMAND_IDS.REGISTER);
        return;
    }
    const items: { label: string; description?: string; command: string }[] = [
        {
            label: '$(pencil) Change permission tier',
            description: `currently: ${active.permissionTier}`,
            command: COMMAND_IDS.CHANGE_TIER,
        },
        {
            label: '$(refresh) Refresh workspace tree',
            command: COMMAND_IDS.REFRESH,
        },
        {
            label: '$(trash) Unregister this workspace mount',
            description: active.ownerLabel,
            command: COMMAND_IDS.UNREGISTER,
        },
    ];
    const pick = await vscode.window.showQuickPick(items, {
        title: `Verzeta workspace mount: ${active.ownerLabel}`,
        placeHolder: 'Choose an action',
    });
    if (pick === undefined) return;
    await vscode.commands.executeCommand(pick.command);
}

// === helpers ===

async function pickTier(
    preselected: PermissionTier,
    title: string,
): Promise<PermissionTier | undefined> {
    const choices: {
        label: string;
        description: string;
        tier: PermissionTier;
        picked?: boolean;
    }[] = [
        {
            label: 'Ask before every edit',
            description: 'Default. Every write asks for your confirmation first.',
            tier: 'ask',
            picked: preselected === 'ask',
        },
        {
            label: 'Smart Mode (auto-edit safe changes)',
            description:
                'Auto-approves source-file edits, auto-rejects suspicious patterns, and asks about the rest.',
            tier: 'smart',
            picked: preselected === 'smart',
        },
        {
            label: 'Bypass (full auto, my responsibility)',
            description: 'All writes apply immediately. The audit log still records every write.',
            tier: 'bypass',
            picked: preselected === 'bypass',
        },
    ];
    const pick = await vscode.window.showQuickPick(choices, {
        title,
        placeHolder: 'Choose a permission tier',
        ignoreFocusOut: true,
    });
    return pick?.tier;
}

/**
 * Choose the workspace root for a new mount. Single-root windows
 * resolve silently; multi-root windows ask which project to share
 * (J1: one root per conversation — a chat's agents see only the root
 * its mount carries, so cross-project edits are structurally
 * impossible).
 */
async function pickWorkspaceRoot(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) return undefined;
    if (folders.length === 1) return folders[0];
    const picked = await vscode.window.showQuickPick(
        folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
        { title: 'Which project should this chat see?' },
    );
    return picked?.folder;
}

/**
 * True when `verzeta.workspaceMount.autoRegister` is on, exactly one
 * workspace folder is open, and the conversation is in a project or
 * organization folder (a project room) on this host.
 */
function shouldAutoRegister(
    deps: WorkspaceMountCommandsDeps,
    hostId: string,
    conv: ConversationUi,
): boolean {
    const enabled = vscode.workspace
        .getConfiguration('verzeta.workspaceMount')
        .get<boolean>('autoRegister', true);
    if (enabled !== true) return false;
    if ((vscode.workspace.workspaceFolders?.length ?? 0) !== 1) return false;
    const folderId = conv.folderId;
    if (folderId === undefined || folderId.length === 0) return false;
    const folder = deps.projectStore.foldersByHost(hostId).find((f) => f.id === folderId);
    return folder !== undefined && folder.folderType !== 'regular';
}

function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) return undefined;
    return folders[0];
}

function workspaceFolderTail(folder: vscode.WorkspaceFolder): string {
    return (
        folder.uri.fsPath
            .split(path.sep)
            .filter((s) => s.length > 0)
            .pop() ?? folder.name
    );
}

function readDefaultTier(): PermissionTier {
    const raw = vscode.workspace
        .getConfiguration('verzeta.workspaceMount')
        .get<string>('defaultTier', 'ask');
    return clampDefaultTier(raw);
}

function errorText(value: unknown): string {
    if (value instanceof RemoteOpError) return `${value.kind}: ${value.detail}`;
    if (value instanceof Error) return value.message;
    return String(value);
}

function formatUpdatedAt(epochMs: number): string {
    if (!Number.isFinite(epochMs) || epochMs <= 0) return '';
    const now = Date.now();
    const delta = now - epochMs;
    if (delta < 0) return new Date(epochMs).toLocaleString();
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < minute) return 'just now';
    if (delta < hour) return `${Math.floor(delta / minute)} min ago`;
    if (delta < day) return `${Math.floor(delta / hour)} h ago`;
    if (delta < 7 * day) return `${Math.floor(delta / day)} d ago`;
    return new Date(epochMs).toLocaleDateString();
}
