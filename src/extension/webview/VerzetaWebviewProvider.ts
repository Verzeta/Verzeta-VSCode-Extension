// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as vscode from 'vscode';
import type { Disposable } from '../infra/disposables.js';
import { DisposableStore } from '../infra/disposables.js';
import type { Logger } from '../log/Logger.js';
import { MessageBus } from './MessageBus.js';
import { buildHtmlShell, generateNonce } from './htmlShell.js';
import { CONFIG_SECTION, SETTING } from '../settings/ConfigurationSchema.js';
import type { ExtensionToWebview, HostHandshake } from '../../shared/webview-protocol.js';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { ConversationStore } from '../conversations/ConversationStore.js';
import type { HostStore } from '../hosts/HostStore.js';
import type { ContextFillStore } from '../conversations/ContextFillStore.js';
import type { MessageStore } from '../conversations/MessageStore.js';
import type { ProjectStore } from '../conversations/ProjectStore.js';
import { showError, showWarning } from '../ui/notifications.js';
import { WebviewSync, createAndActivateConversation, type WebviewSyncDeps } from './WebviewSync.js';

export interface VerzetaWebviewProviderDeps {
    readonly viewId: string;
    readonly extensionUri: vscode.Uri;
    readonly extensionVersion: string;
    readonly logger: Logger;
    readonly hostStore: HostStore;
    readonly connectionManager: ConnectionManager;
    readonly conversationStore: ConversationStore;
    readonly projectStore: ProjectStore;
    readonly messageStore: MessageStore;
    readonly contextFillStore: ContextFillStore;
    /** Forwarded to WebviewSync — see WebviewSyncDeps.onMessageSent. */
    readonly onMessageSent?: ((hostId: string, conversationId: string) => void) | undefined;
    /** Forwarded to WebviewSync — see WebviewSyncDeps.onShareRequested. */
    readonly onShareRequested?: ((hostId: string, conversationId: string) => void) | undefined;
    /** Forwarded to WebviewSync — see WebviewSyncDeps.execModeStore. */
    readonly execModeStore?: WebviewSyncDeps['execModeStore'];
    /** Forwarded to WebviewSync — see WebviewSyncDeps.onExecConfirmResponse. */
    readonly onExecConfirmResponse?: WebviewSyncDeps['onExecConfirmResponse'];
}

export class VerzetaWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly PRIMARY_VIEW_ID = 'verzeta.sidebarView';
    public static readonly SECONDARY_VIEW_ID = 'verzeta.sidebarSecondaryView';

    private readonly deps: VerzetaWebviewProviderDeps;
    private readonly liveBuses = new DisposableStore();
    private readonly liveBusList = new Set<MessageBus>();
    /** The single editor-tab panel, when the chat is popped out. */
    private editorPanel: vscode.WebviewPanel | undefined;
    /**
     * A conversation to open in the next webview that says hello. Set
     * when a command creates a chat before any view has loaded.
     */
    private pendingFocus: { readonly hostId: string; readonly conversationId: string } | undefined;

    constructor(deps: VerzetaWebviewProviderDeps) {
        this.deps = deps;
    }

    /**
     * Push a message to every currently-resolved webview. Used by IDE
     * command handlers (send-selection, attach-file, etc) to stage
     * payloads into the chat composer without a round-trip through
     * the webview's own action surface.
     *
     * @returns `true` when at least one bus accepted the message.
     */
    broadcast(message: ExtensionToWebview): boolean {
        if (this.liveBusList.size === 0) return false;
        for (const bus of this.liveBusList) {
            bus.post(message);
        }
        return true;
    }

    /**
     * Reveal the Verzeta sidebar webview. IDE commands invoke this so
     * the user sees the staged attachment / inserted selection
     * immediately rather than having to manually open the sidebar.
     *
     * Focuses the Activity Bar view (`deps.viewId` is the primary/home
     * id). The chat is also available in the Secondary Side Bar on
     * 1.106+; the user can keep it on either side.
     */
    async reveal(): Promise<void> {
        await vscode.commands.executeCommand(`${this.deps.viewId}.focus`);
    }

    /**
     * Create a conversation on the active host and open it in the chat.
     * Backs the `verzeta.newConversation` command and runs the same
     * create sequence as the webview's New chat button. Warns when no
     * host is connected.
     */
    async newConversation(): Promise<void> {
        const hostId = this.deps.connectionManager.activeHostId();
        if (
            hostId === undefined ||
            this.deps.connectionManager.repositoryFor(hostId) === undefined
        ) {
            await showWarning('Connect to a host first, then start a new conversation.');
            return;
        }
        let conversationId: string;
        try {
            conversationId = await createAndActivateConversation(this.deps, hostId);
        } catch (error) {
            await showError(
                `New conversation failed: ${error instanceof Error ? error.message : String(error)}`,
                this.deps.logger,
            );
            return;
        }
        if (this.liveBusList.size > 0) {
            this.broadcast({ type: 'conversation.created', hostId, conversationId });
        } else {
            // No view has loaded yet: the one revealed below opens the
            // chat once it says hello.
            this.pendingFocus = { hostId, conversationId };
        }
        await this.reveal();
    }

    /**
     * Wire a fresh webview surface — the sidebar view OR an editor
     * panel: options, HTML shell, MessageBus, WebviewSync, and the
     * inbound-message switch. Returns a Disposable the caller fires on
     * the surface's onDidDispose. Both surfaces share identical content
     * and a live MessageBus, so broadcasts reach every open instance.
     */
    private setupWebview(webview: vscode.Webview): Disposable {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview'),
                vscode.Uri.joinPath(this.deps.extensionUri, 'resources'),
            ],
        };

        const nonce = generateNonce();
        webview.html = buildHtmlShell({
            webview,
            extensionUri: this.deps.extensionUri,
            nonce,
        });

        const bus = new MessageBus(webview, this.deps.logger);
        const sync = new WebviewSync({
            bus,
            hostStore: this.deps.hostStore,
            connectionManager: this.deps.connectionManager,
            conversationStore: this.deps.conversationStore,
            projectStore: this.deps.projectStore,
            messageStore: this.deps.messageStore,
            contextFillStore: this.deps.contextFillStore,
            logger: this.deps.logger,
            onMessageSent: this.deps.onMessageSent,
            onShareRequested: this.deps.onShareRequested,
            execModeStore: this.deps.execModeStore,
            onExecConfirmResponse: this.deps.onExecConfirmResponse,
        });
        const onMessage = bus.onMessage((msg) => {
            switch (msg.type) {
                case 'hello':
                    bus.post({
                        type: 'ready',
                        host: this.makeHandshake(),
                    });
                    sync.prime();
                    if (this.pendingFocus !== undefined) {
                        bus.post({ type: 'conversation.created', ...this.pendingFocus });
                        this.pendingFocus = undefined;
                    }
                    break;
                case 'ping':
                    bus.post({ type: 'pong', seq: msg.seq });
                    break;
                case 'host.setActive':
                case 'host.connectRequested':
                case 'host.disconnectRequested':
                case 'host.commandRequested':
                case 'host.pingRequested':
                case 'host.revokeSelfRequested':
                case 'conversation.openRequested':
                case 'conversation.deleteRequested':
                case 'folder.deleteRequested':
                case 'message.send':
                case 'message.sendWithAttachments':
                case 'message.stop':
                case 'workspace.shareRequested':
                case 'conv.settings.requested':
                case 'convExecMode.requested':
                case 'convExecMode.set':
                case 'exec.confirmResponse':
                case 'conv.settings.save':
                case 'agent.pattern.set':
                case 'agent.require_confirmation.set':
                case 'tools.enabled.set':
                case 'conv.primary_agent.set':
                case 'agents.listRequested':
                case 'clients.listRequested':
                case 'clients.revokeRequested':
                case 'tools.listRequested':
                case 'mcp.listRequested':
                case 'skills.listRequested':
                case 'verifySession.requested':
                case 'folder.members.requested':
                case 'folder.member.chat.openRequested':
                case 'folder.kickoff.groupRequested':
                case 'folder.kickoff.individualRequested':
                case 'conversation.createRequested':
                case 'folder.createRequested':
                case 'models.catalog.requested':
                case 'models.setActiveRequested':
                case 'search.providers.requested':
                case 'search.setActiveRequested':
                case 'tool_call.approveRequested':
                case 'tool_call.denyRequested':
                case 'folder.members.setRequested':
                case 'folder.member.override.setRequested':
                case 'folder.updateRequested':
                case 'heartbeats.requested':
                case 'heartbeat.upsertRequested':
                case 'heartbeat.removeRequested':
                case 'heartbeat.runRequested':
                case 'preferredSkills.requested':
                case 'preferredSkills.setRequested':
                case 'convSkillOverride.requested':
                case 'convSkillOverride.setRequested':
                case 'convPreferredSkills.requested':
                case 'convPreferredSkills.setRequested':
                case 'convHeartbeatGate.requested':
                case 'convHeartbeatGate.setRequested':
                case 'documents.requested':
                case 'document.uploadRequested':
                case 'document.removeRequested':
                case 'projectTemplates.requested':
                case 'projectTemplate.createProjectRequested':
                case 'projectTemplates.allRequested':
                case 'template.roster.requested':
                case 'template.pinRequested':
                case 'template.saveAsNewRequested':
                case 'template.deleteRequested':
                case 'ide.applyEditRequested':
                case 'ide.openCanvasRequested':
                case 'ide.addContextRequested':
                case 'ide.dropUrisRequested':
                case 'group.createRequested':
                case 'plans.requested':
                case 'task.startRequested':
                case 'plan.stopRequested':
                case 'plan.stopAllRequested':
                case 'step.retryRequested':
                case 'step.overrideRequested':
                case 'step.skipRequested':
                case 'toolCalls.requested':
                case 'activity.requested':
                case 'polls.requested':
                case 'poll.startRequested':
                case 'poll.voteRequested':
                case 'poll.closeRequested':
                case 'media.requested':
                case 'mcp.serverTools.requested':
                case 'skill.detail.requested':
                case 'heartbeat.runs.requested':
                    // WebviewSync handles these inbound actions.
                    break;
                default:
                    // Exhaustive switch — TS catches missing cases at compile time.
                    ((_: never) => undefined)(msg);
            }
        });

        this.liveBusList.add(bus);
        const trackedBus: Disposable = {
            dispose: () => {
                this.liveBusList.delete(bus);
                onMessage.dispose();
                sync.dispose();
                bus.dispose();
            },
        };
        this.liveBuses.add(trackedBus);
        return trackedBus;
    }

    resolveWebviewView(
        view: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        const tracked = this.setupWebview(view.webview);
        view.onDidDispose(() => tracked.dispose());
        this.deps.logger.info('VerzetaWebviewProvider resolved', {
            viewId: this.deps.viewId,
        });
    }

    /**
     * Open the chat as an editor tab (WebviewPanel) beside the active
     * editor. Unlike the sidebar view, an editor panel can be moved or
     * split into ANY editor group — including a right-hand pane — and
     * dragged anywhere in the window, the same affordance other AI chat
     * extensions offer. Reveals the existing panel if one is already
     * open rather than stacking duplicates.
     */
    openInEditor(): void {
        if (this.editorPanel !== undefined) {
            this.editorPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'verzeta.editorPanel',
            'Verzeta',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.deps.extensionUri, 'dist', 'webview'),
                    vscode.Uri.joinPath(this.deps.extensionUri, 'resources'),
                ],
            },
        );
        this.editorPanel = panel;
        const tracked = this.setupWebview(panel.webview);
        panel.onDidDispose(() => {
            tracked.dispose();
            this.editorPanel = undefined;
        });
        this.deps.logger.info('VerzetaWebviewProvider opened editor panel');
    }

    dispose(): void {
        this.editorPanel?.dispose();
        this.liveBuses.dispose();
    }

    private makeHandshake(): HostHandshake {
        return {
            extensionVersion: this.deps.extensionVersion,
            viewId: this.deps.viewId,
            initialTab: this.resolveInitialTab(),
        };
    }

    /**
     * Reads the user's preferred initial tab from the extension's
     * configuration. Defaults to `home`. The setting is declared in
     * package.json's `contributes.configuration`; see
     * `ConfigurationSchema.ts`.
     */
    private resolveInitialTab(): 'home' | 'chat' | 'settings' {
        const raw = vscode.workspace
            .getConfiguration(CONFIG_SECTION)
            .get<string>(SETTING.INITIAL_TAB, 'home');
        return raw === 'chat' || raw === 'settings' ? raw : 'home';
    }
}
