// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as vscode from 'vscode';
import { ConnectionManager } from './hosts/ConnectionManager.js';
import { ContextFillStore } from './conversations/ContextFillStore.js';
import { ConversationStore } from './conversations/ConversationStore.js';
import { HostStore } from './hosts/HostStore.js';
import { MessageStore } from './conversations/MessageStore.js';
import { ProjectStore } from './conversations/ProjectStore.js';
import { SecretStore } from './hosts/SecretStore.js';
import { WireSync } from './conversations/WireSync.js';
import { Logger, type LogLevel } from './log/Logger.js';
import { registerAllCommands } from './commands/index.js';
import {
    evaluateWorkspaceShareStatus,
    maybeOfferWorkspaceShare,
    shareWorkspaceWithConversation,
} from './commands/workspaceMountCommands.js';
import { registerIdeBridge } from './ide/index.js';
import { CONFIG_SECTION, SETTING, SETTING_DEFAULT } from './settings/ConfigurationSchema.js';
import { VerzetaWebviewProvider } from './webview/VerzetaWebviewProvider.js';
import { registerWorkspaceMountSubsystem } from './workspace/index.js';

export function activate(context: vscode.ExtensionContext): void {
    const logger = new Logger({ level: resolveInitialLogLevel() });
    context.subscriptions.push(logger);
    logger.info('Verzeta extension activating');

    const hostStore = new HostStore(logger);
    context.subscriptions.push(hostStore);

    const secretStore = new SecretStore(context.secrets, logger);

    const connectionManager = new ConnectionManager(hostStore, secretStore, logger);
    context.subscriptions.push({
        dispose: () => {
            connectionManager.dispose();
        },
    });

    const conversationStore = new ConversationStore(logger);
    context.subscriptions.push(conversationStore);

    const projectStore = new ProjectStore(logger);
    context.subscriptions.push(projectStore);

    const messageStore = new MessageStore(logger);
    context.subscriptions.push(messageStore);

    const contextFillStore = new ContextFillStore();
    context.subscriptions.push(contextFillStore);

    // Construct the workspace-mount subsystem BEFORE the webview
    // provider so the share-offer callback below can reference its
    // service directly (and before registerAllCommands, which takes
    // a direct service reference). Subsystem disposable is pushed
    // onto the subscription chain further down.
    // Late-bound exec bridges: the workspace-mount subsystem is built
    // before the webview provider, yet its callbacks must forward to the
    // provider once it exists (Off-mode consent banner, Ask-mode confirm
    // modal, unsandboxed notice). A const holder with mutable fields lets
    // the callbacks below forward-reference bridges that are wired in just
    // after webviewProvider — without a reassigned `let` binding.
    const execBridge: {
        consent?: (conversationId: string, commandPreview: string) => void;
        confirm?: (
            conversationId: string,
            requestId: string,
            command: string,
            sandboxed: boolean,
        ) => void;
        unsandboxed?: () => void;
    } = {};

    // Ask-mode confirmations are rendered as a chat-area modal. The host
    // posts exec.confirmRequested and awaits the webview's
    // exec.confirmResponse; pending resolvers are keyed by requestId.
    const pendingExecConfirms = new Map<string, (approved: boolean) => void>();
    const confirmExec = (
        conversationId: string,
        command: string,
        sandboxed: boolean,
    ): Promise<boolean> => {
        if (execBridge.confirm === undefined) return Promise.resolve(false);
        const requestId = crypto.randomUUID();
        return new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (approved: boolean): void => {
                if (settled) return;
                settled = true;
                pendingExecConfirms.delete(requestId);
                resolve(approved);
            };
            pendingExecConfirms.set(requestId, finish);
            execBridge.confirm?.(conversationId, requestId, command, sandboxed);
            // Safety net: if the webview never answers (panel closed, host
            // moved on), reject so the worker is never pinned.
            setTimeout(() => finish(false), 10 * 60 * 1000);
        });
    };

    // One-time-per-session unsandboxed notice, surfaced inside the
    // webview (not a VS Code corner notification).
    let unsandboxedNoticeShown = false;

    const workspaceMount = registerWorkspaceMountSubsystem({
        context,
        connectionManager,
        logger,
        onExecBlocked: (conversationId, commandPreview) =>
            execBridge.consent?.(conversationId, commandPreview),
        confirmExec,
        onUnsandboxed: () => execBridge.unsandboxed?.(),
    });

    // Shared dependency bundle for the workspace-share flows (the
    // first-message offer, the in-chat banner evaluation, and the
    // banner's one-click share).
    const shareDeps = {
        logger,
        workspaceMount: workspaceMount.service,
        connectionManager,
        projectStore,
        conversationStore,
        workspaceState: context.workspaceState,
    };

    const pushShareStatus = (conversationId: string | undefined): void => {
        const hostId = connectionManager.activeHostId();
        if (hostId === undefined || conversationId === undefined) return;
        const root = vscode.workspace.workspaceFolders?.[0];
        webviewProvider.broadcast({
            type: 'workspace.shareStatus.updated',
            hostId,
            conversationId,
            status: evaluateWorkspaceShareStatus(shareDeps, hostId, conversationId),
            workspaceName: root?.name ?? '',
        });
    };

    // Verzeta is available in BOTH the Activity Bar (left — the primary
    // home, always present) AND, on VS Code 1.106+, the Secondary Side Bar
    // (the editor-area chat strip where other AI chat extensions sit). The
    // same provider backs both view ids, so the user can keep the chat on
    // either side. The secondary-sidebar view container only exists on
    // 1.106+ (older VS Code can't host it); set the context key its
    // package.json `when` switches on so it is hidden below that version.
    const [vMajor = 0, vMinor = 0] = vscode.version.split('.').map(Number);
    const supportsSecondarySidebar = vMajor > 1 || (vMajor === 1 && vMinor >= 106);
    if (!supportsSecondarySidebar) {
        void vscode.commands.executeCommand(
            'setContext',
            'verzeta:doesNotSupportSecondarySidebar',
            true,
        );
    }

    const extensionVersion = readExtensionVersion(context);
    const webviewProvider = new VerzetaWebviewProvider({
        viewId: VerzetaWebviewProvider.PRIMARY_VIEW_ID,
        extensionUri: context.extensionUri,
        extensionVersion,
        logger,
        hostStore,
        connectionManager,
        conversationStore,
        projectStore,
        messageStore,
        contextFillStore,
        onMessageSent: (hostId, conversationId) => {
            // Workspace-share discoverability bridge: when the open
            // workspace has no mount, the first message in a chat
            // surfaces a one-click consent offer bound to that chat.
            void maybeOfferWorkspaceShare(shareDeps, hostId, conversationId);
        },
        onShareRequested: (hostId, conversationId) => {
            // In-chat banner Share click: the click is the consent.
            void shareWorkspaceWithConversation(shareDeps, hostId, conversationId).then(() =>
                pushShareStatus(conversationId),
            );
        },
        execModeStore: workspaceMount.execPolicy,
        // The user's answer to a chat-area Ask confirmation modal.
        onExecConfirmResponse: (requestId, approved) =>
            pendingExecConfirms.get(requestId)?.(approved),
    });

    // Now the provider exists: forward Off-mode exec refusals to the
    // in-chat consent banner for the conversation that was refused.
    execBridge.consent = (conversationId, commandPreview) => {
        const hostId = connectionManager.activeHostId();
        if (hostId === undefined) return;
        webviewProvider.broadcast({
            type: 'exec.consentSuggested',
            hostId,
            conversationId,
            commandPreview,
        });
    };

    // Surface the unsandboxed-run notice inside the webview, once.
    execBridge.unsandboxed = () => {
        if (unsandboxedNoticeShown) return;
        unsandboxedNoticeShown = true;
        webviewProvider.broadcast({
            type: 'ide.notice',
            level: 'warn',
            message:
                'An agent command ran without a sandbox (none is available on this device). ' +
                'Install bubblewrap (Linux) for sandboxed execution.',
        });
    };

    // Post Ask-mode confirmation modals to the chat area; if no host is
    // active the request is rejected so the worker never hangs.
    execBridge.confirm = (conversationId, requestId, command, sandboxed) => {
        const hostId = connectionManager.activeHostId();
        if (hostId === undefined) {
            pendingExecConfirms.get(requestId)?.(false);
            return;
        }
        webviewProvider.broadcast({
            type: 'exec.confirmRequested',
            hostId,
            conversationId,
            requestId,
            command,
            sandboxed,
        });
    };

    // In-chat share banner feed: re-evaluate whenever the user
    // switches conversations, a mount appears/disappears, or the
    // VS Code workspace folder set changes.
    const onActiveConvForBanner = (conversationId: string | undefined): void => {
        pushShareStatus(conversationId);
    };
    conversationStore.on('activeChanged', onActiveConvForBanner);
    const onMountsChangedForBanner = (): void => {
        pushShareStatus(conversationStore.activeConversationId());
    };
    workspaceMount.service.on('mountAdded', onMountsChangedForBanner);
    workspaceMount.service.on('mountRemoved', onMountsChangedForBanner);
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            pushShareStatus(conversationStore.activeConversationId());
        }),
        {
            dispose: () => {
                conversationStore.off('activeChanged', onActiveConvForBanner);
                workspaceMount.service.off('mountAdded', onMountsChangedForBanner);
                workspaceMount.service.off('mountRemoved', onMountsChangedForBanner);
            },
        },
    );

    const wireSync = new WireSync({
        connectionManager,
        conversationStore,
        projectStore,
        messageStore,
        contextFillStore,
        logger,
        onUserMentioned: (hostId, conversationId, alias, text) => {
            // Suppress when the mentioning conversation is already
            // active — the user is looking at it (same rule as
            // Android). The Open action reveals the sidebar and asks
            // the webview to switch conversations.
            if (conversationStore.activeConversationId() === conversationId) return;
            const who = alias.length > 0 ? `@${alias}` : 'An agent';
            const preview = text.length > 120 ? `${text.slice(0, 119)}…` : text;
            void vscode.window
                .showInformationMessage(`Verzeta: ${who} mentioned you. ${preview}`, 'Open')
                .then((action) => {
                    if (action !== 'Open') return;
                    void webviewProvider.reveal();
                    webviewProvider.broadcast({
                        type: 'conversation.focusRequested',
                        hostId,
                        conversationId,
                    });
                });
        },
    });
    context.subscriptions.push(wireSync);

    registerAllCommands(context, {
        hostStore,
        secretStore,
        connectionManager,
        conversationStore,
        projectStore,
        messageStore,
        workspaceMount: workspaceMount.service,
        logger,
        newConversation: () => webviewProvider.newConversation(),
    });

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            VerzetaWebviewProvider.PRIMARY_VIEW_ID,
            webviewProvider,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        // Same provider also backs the Secondary Side Bar container. Only
        // one of the two view containers is active on any given VS Code
        // version (their package.json `when` clauses are mutually
        // exclusive), so exactly one resolves; the other registration is
        // inert. A single provider instance keeps both surfaces sharing
        // one live MessageBus list for broadcasts.
        vscode.window.registerWebviewViewProvider(
            VerzetaWebviewProvider.SECONDARY_VIEW_ID,
            webviewProvider,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        // Pop the chat out into a movable editor tab (title-bar button
        // + command palette). The editor tab can be split or dragged to
        // any pane, including a right-hand group.
        vscode.commands.registerCommand('verzeta.openInEditor', () =>
            webviewProvider.openInEditor(),
        ),
        { dispose: () => webviewProvider.dispose() },
    );

    registerIdeBridge(context, {
        provider: webviewProvider,
        connectionManager,
        conversationStore,
        logger,
    });

    context.subscriptions.push({
        dispose: () => workspaceMount.dispose(),
    });

    // React to log-level changes from VS Code's Settings UI in real
    // time — no restart required.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(`${CONFIG_SECTION}.${SETTING.LOG_LEVEL}`)) {
                logger.setLevel(resolveInitialLogLevel());
            }
        }),
    );

    if (shouldConnectOnStartup() && hostStore.list().length > 0) {
        const id = connectionManager.activeHostId();
        if (id !== undefined) {
            void connectionManager.connect(id);
        }
    }

    logger.info('Verzeta extension activated');
}

export function deactivate(): Promise<void> {
    return Promise.resolve();
}

function resolveInitialLogLevel(): LogLevel {
    const raw = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<string>(SETTING.LOG_LEVEL, SETTING_DEFAULT.logLevel);
    switch (raw) {
        case 'error':
        case 'warn':
        case 'info':
        case 'debug':
            return raw;
        default:
            return SETTING_DEFAULT.logLevel;
    }
}

function shouldConnectOnStartup(): boolean {
    return vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>(SETTING.CONNECT_ON_STARTUP, SETTING_DEFAULT.connectOnStartup);
}

function readExtensionVersion(context: vscode.ExtensionContext): string {
    const raw: unknown = context.extension.packageJSON;
    if (raw !== null && typeof raw === 'object' && 'version' in raw) {
        const version = (raw as { version: unknown }).version;
        if (typeof version === 'string' && version.length > 0) return version;
    }
    return '0.0.0';
}
