// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * WebviewSync — adapter that wires the extension-host stores
 * (HostStore, ConnectionManager, ConversationStore) to the webview
 * MessageBus.  One instance per resolved view; created by
 * `VerzetaWebviewProvider.resolveWebviewView`, disposed when the
 * view goes away.
 *
 * Responsibilities (no business logic):
 *   - On store events, push typed envelopes to the webview.
 *   - On inbound user actions from the webview, dispatch to the
 *     correct store mutation or VS Code command.
 *   - On the initial `hello` from the webview, prime it with a
 *     full state snapshot so the Home tab paints without delay.
 *
 * The class is intentionally thin — it does not hold its own state
 * and contains no policy. New protocol envelopes that need wiring
 * land as additional branches in `onInbound` and the corresponding
 * store-subscription handlers below.
 */

import * as vscode from 'vscode';
import { DisposableStore, type Disposable } from '../infra/disposables.js';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { ConnectionState } from '../hosts/ConnectionState.js';
import type { ConversationStore } from '../conversations/ConversationStore.js';
import type { HostStore } from '../hosts/HostStore.js';
import type { Logger } from '../log/Logger.js';
import type { ContextFillStore } from '../conversations/ContextFillStore.js';
import type { MessageStore } from '../conversations/MessageStore.js';
import type { ProjectStore } from '../conversations/ProjectStore.js';
import type { RemoteRepository } from '../wire/RemoteRepository.js';
import { overlayWrittenSettings } from '../conversations/convSettingsMerge.js';
import type { MessageBus } from './MessageBus.js';
import type {
    ConversationFullUi,
    FolderSummaryUi,
    HostSummaryUi,
    MessageRowUi,
    RecentConversationUi,
    RemoteExecMode,
    WebviewToExtension,
} from '../../shared/webview-protocol.js';
import type {
    AgentRunStateUi,
    AgentStepUi,
    ConvSettingsUi,
    HeartbeatConfigUi,
    MemberUi,
    MessageUi,
    PendingToolConfirmationUi,
    PlanUi,
    PollUi,
    ToolCallLogUi,
} from '../../shared/wire-types.js';

export interface WebviewSyncDeps {
    readonly bus: MessageBus;
    readonly hostStore: HostStore;
    readonly connectionManager: ConnectionManager;
    readonly conversationStore: ConversationStore;
    readonly projectStore: ProjectStore;
    readonly messageStore: MessageStore;
    readonly contextFillStore: ContextFillStore;
    readonly logger: Logger;
    /**
     * Fired after the user sends a message from the webview. The
     * composition root uses it to surface the workspace-share offer
     * when the open workspace has no mount (discoverability bridge —
     * see maybeOfferWorkspaceShare). Must never throw.
     */
    readonly onMessageSent?: ((hostId: string, conversationId: string) => void) | undefined;
    /**
     * Fired when the user clicks Share on the in-chat workspace
     * banner. The click is the consent; the composition root binds
     * the mount to the conversation. Must never throw.
     */
    readonly onShareRequested?: ((hostId: string, conversationId: string) => void) | undefined;
    /**
     * Client-local per-conversation command-execution policy store
     * (the workspace ExecPolicy). Read/written for the
     * `convExecMode.requested` / `convExecMode.set` messages; the sync
     * echoes `convExecMode.updated` back to the webview. Absent only in
     * tests that do not exercise the exec-mode control.
     */
    readonly execModeStore?:
        | {
              getMode(conversationId: string): RemoteExecMode;
              setMode(conversationId: string, mode: RemoteExecMode): Promise<void>;
          }
        | undefined;
    /**
     * The user's answer to a chat-area Ask confirmation modal
     * (exec.confirmResponse). Resolves the pending host-side promise.
     * Must never throw.
     */
    readonly onExecConfirmResponse?: ((requestId: string, approved: boolean) => void) | undefined;
}

const RECENT_CONVERSATIONS_LIMIT = 20;

export class WebviewSync implements Disposable {
    private readonly deps: WebviewSyncDeps;
    private readonly subs = new DisposableStore();
    private disposed = false;
    /**
     * Per-folder heartbeat-config cache so on `heartbeat.config.changed`
     * we can patch the right slot and push the full list to the webview
     * without re-issuing `heartbeat.configs_for_folder`. Keyed
     * `${hostId}::${folderId}`. Loaded on
     * `heartbeats.requested`.
     */
    private readonly heartbeatsByFolder = new Map<string, HeartbeatConfigUi[]>();
    /**
     * Per-conversation plans cache so plan.created/.updated/.deleted +
     * step.updated events patch the list without re-issuing
     * plan.list_for_conv on every event. Keyed `${hostId}::${convId}`.
     */
    private readonly plansByConv = new Map<string, PlanUi[]>();
    private readonly pollsByConv = new Map<string, PollUi[]>();

    constructor(deps: WebviewSyncDeps) {
        this.deps = deps;

        const onHostsChanged = (): void => this.pushHosts();
        const onStateChanged = (hostId: string, state: ConnectionState): void => {
            deps.bus.post({ type: 'host.stateChanged', hostId, state });
        };
        const onActiveHostChanged = (): void => {
            this.pushHosts();
            const activeHostId = deps.connectionManager.activeHostId();
            if (activeHostId !== undefined) {
                this.pushConversations(activeHostId);
                this.pushFullConversations(activeHostId);
            }
        };
        const onConversationsChanged = (hostId: string): void => {
            this.pushConversations(hostId);
            this.pushFullConversations(hostId);
        };
        const onFoldersChanged = (hostId: string): void => {
            this.pushFullConversations(hostId);
        };
        let lastSubscribedConv: string | undefined;
        const onActiveConvChanged = (conversationId: string | undefined): void => {
            // Honour the wire protocol's subscribe contract — the host
            // gates `message.added` + `message.streaming.*` events on
            // the per-session `msg.subscribe` set (see Android's
            // `MainViewModel.kt:314` + line 672 comments). Subscribe to
            // the new conv and unsubscribe the previous so the host's
            // filter set stays small.
            const hostId = deps.connectionManager.activeHostId();
            const repository =
                hostId === undefined ? undefined : deps.connectionManager.repositoryFor(hostId);
            if (
                lastSubscribedConv !== undefined &&
                lastSubscribedConv !== conversationId &&
                repository !== undefined
            ) {
                const previous = lastSubscribedConv;
                void repository.unsubscribeMessages(previous).catch((error: unknown) => {
                    deps.logger.warn('WebviewSync: unsubscribeMessages failed', {
                        conversationId: previous,
                        error: errorText(error),
                    });
                });
            }
            lastSubscribedConv = conversationId;
            if (conversationId === undefined) return;
            this.pushMessages(conversationId);
            this.refreshMessages(conversationId);
            if (repository === undefined) return;
            void repository.subscribeMessages(conversationId).catch((error: unknown) => {
                deps.logger.warn('WebviewSync: subscribeMessages failed', {
                    conversationId,
                    error: errorText(error),
                });
            });
        };
        const onMessagesChanged = (conversationId: string): void => {
            this.pushMessages(conversationId);
        };
        const onMessageDelta = (conversationId: string, messageId: string): void => {
            this.pushMessageDelta(conversationId, messageId);
        };
        const onContextFillChanged = (
            hostId: string,
            conversationId: string,
            percent: number,
        ): void => {
            if (this.disposed) return;
            this.deps.bus.post({
                type: 'chat.contextFill.updated',
                hostId,
                conversationId,
                percent,
            });
        };
        const onSessionReady = (hostId: string, repository: RemoteRepository): void => {
            // Auto-fetch + push catalogs the moment the host
            // authenticates, so the Settings tab sub-sections (devices
            // paired, tools, MCP, skills) are populated before the user
            // expands them. Each fetch is independent — a failure in
            // one catalog does not block the others.
            void this.seedCatalogs(hostId, repository);
            // If the user was already viewing a conversation when the
            // wire dropped (silent-reconnect path) the host destroyed
            // its per-session msg.subscribe set on close. Without an
            // explicit re-subscribe the user would have to switch
            // conversations and switch back before streaming resumed.
            // Mirrors Android `attemptSilentReconnect`
            // (MainViewModel.kt:672) where the post-reconnect
            // `subscribeMessages(convId)` call is explicitly called
            // out as load-bearing.
            const activeConv = deps.conversationStore.activeConversationId();
            if (activeConv !== undefined && activeConv.length > 0) {
                void repository.subscribeMessages(activeConv).catch((error: unknown) => {
                    deps.logger.warn('WebviewSync: post-sessionReady subscribe failed', {
                        conversationId: activeConv,
                        error: errorText(error),
                    });
                });
                lastSubscribedConv = activeConv;
                // Turns that finished while the wire was down never
                // arrived as events; re-read the timeline.
                this.refreshMessages(activeConv);
            }
        };

        const onMembersChanged = (hostId: string, folderId: string): void => {
            this.pushFolderMembers(hostId, folderId);
        };

        const onModelsActiveChanged = (
            hostId: string,
            activeProvider: string,
            activeModel: string,
        ): void => {
            this.pushModelsActiveChanged(hostId, activeProvider, activeModel);
        };

        const onToolCallRequested = (hostId: string, pending: PendingToolConfirmationUi): void => {
            deps.bus.post({ type: 'tool_call.confirmation.requested', hostId, pending });
        };
        const onToolCallCompleted = (hostId: string, callId: string): void => {
            deps.bus.post({ type: 'tool_call.confirmation.dismissed', hostId, callId });
        };
        const onAgentStepUpdated = (hostId: string, step: AgentStepUi): void => {
            deps.bus.post({ type: 'agent.step.update', hostId, step });
        };
        const onAgentRunStateChanged = (hostId: string, runState: AgentRunStateUi): void => {
            deps.bus.post({ type: 'agent.run.state.update', hostId, runState });
        };

        const onHeartbeatChanged = (hostId: string, config: HeartbeatConfigUi): void => {
            // Only fold into the cache when we know the scope folder
            // (scope_type=folder). conversation-scoped heartbeats land
            // alongside the conv settings sheet, not here.
            if (config.scopeType !== 'folder' || config.scopeId.length === 0) return;
            const key = `${hostId}::${config.scopeId}`;
            const list = this.heartbeatsByFolder.get(key) ?? [];
            const idx = list.findIndex((c) => c.id === config.id);
            const next =
                idx === -1 ? [...list, config] : list.map((c) => (c.id === config.id ? config : c));
            this.heartbeatsByFolder.set(key, next);
            deps.bus.post({
                type: 'heartbeats.updated',
                hostId,
                folderId: config.scopeId,
                configs: next,
            });
        };
        const onHeartbeatRemoved = (hostId: string, configId: string, scopeId: string): void => {
            if (scopeId.length === 0) {
                // Best-effort: scan every cached folder for the id and drop it.
                for (const [key, list] of this.heartbeatsByFolder.entries()) {
                    if (!key.startsWith(`${hostId}::`)) continue;
                    const filtered = list.filter((c) => c.id !== configId);
                    if (filtered.length === list.length) continue;
                    this.heartbeatsByFolder.set(key, filtered);
                    deps.bus.post({
                        type: 'heartbeats.updated',
                        hostId,
                        folderId: key.split('::')[1] ?? '',
                        configs: filtered,
                    });
                }
                return;
            }
            const key = `${hostId}::${scopeId}`;
            const list = this.heartbeatsByFolder.get(key) ?? [];
            const filtered = list.filter((c) => c.id !== configId);
            this.heartbeatsByFolder.set(key, filtered);
            deps.bus.post({
                type: 'heartbeats.updated',
                hostId,
                folderId: scopeId,
                configs: filtered,
            });
        };

        deps.hostStore.on('changed', onHostsChanged);
        deps.connectionManager.on('stateChanged', onStateChanged);
        deps.connectionManager.on('activeHostChanged', onActiveHostChanged);
        deps.connectionManager.on('sessionReady', onSessionReady);
        deps.connectionManager.on('modelsActiveChanged', onModelsActiveChanged);
        deps.connectionManager.on('toolCallRequested', onToolCallRequested);
        deps.connectionManager.on('toolCallCompleted', onToolCallCompleted);
        deps.connectionManager.on('agentStepUpdated', onAgentStepUpdated);
        deps.connectionManager.on('agentRunStateChanged', onAgentRunStateChanged);
        deps.connectionManager.on('heartbeatConfigChanged', onHeartbeatChanged);
        deps.connectionManager.on('heartbeatConfigRemoved', onHeartbeatRemoved);

        const onPlanChanged = (hostId: string, plan: PlanUi): void => {
            if (plan.conversationId.length === 0) return;
            const key = `${hostId}::${plan.conversationId}`;
            const prev = this.plansByConv.get(key) ?? [];
            const idx = prev.findIndex((p) => p.id === plan.id);
            const next =
                idx === -1 ? [plan, ...prev] : prev.map((p) => (p.id === plan.id ? plan : p));
            this.plansByConv.set(key, next);
            deps.bus.post({
                type: 'plans.updated',
                hostId,
                conversationId: plan.conversationId,
                plans: next,
            });
        };
        const onPlanRemoved = (hostId: string, planId: string, convId: string): void => {
            if (convId.length === 0) {
                for (const [key, plans] of this.plansByConv.entries()) {
                    if (!key.startsWith(`${hostId}::`)) continue;
                    const filtered = plans.filter((p) => p.id !== planId);
                    if (filtered.length === plans.length) continue;
                    this.plansByConv.set(key, filtered);
                    deps.bus.post({
                        type: 'plans.updated',
                        hostId,
                        conversationId: key.split('::')[1] ?? '',
                        plans: filtered,
                    });
                }
                return;
            }
            const key = `${hostId}::${convId}`;
            const next = (this.plansByConv.get(key) ?? []).filter((p) => p.id !== planId);
            this.plansByConv.set(key, next);
            deps.bus.post({ type: 'plans.updated', hostId, conversationId: convId, plans: next });
        };
        const onStepUpdated = (hostId: string, planId: string): void => {
            // Refetch the plan to get the canonical step list + status
            // (Android does the same on step.updated).
            const repository = deps.connectionManager.repositoryFor(hostId);
            if (repository === undefined) return;
            void repository
                .getPlan(planId)
                .then((plan) => {
                    if (plan !== undefined) onPlanChanged(hostId, plan);
                })
                .catch(() => undefined);
        };
        const onPollChanged = (hostId: string, poll: PollUi): void => {
            if (poll.conversationId.length === 0) return;
            const key = `${hostId}::${poll.conversationId}`;
            const prev = this.pollsByConv.get(key) ?? [];
            const idx = prev.findIndex((p) => p.id === poll.id);
            const next =
                idx === -1 ? [poll, ...prev] : prev.map((p) => (p.id === poll.id ? poll : p));
            this.pollsByConv.set(key, next);
            deps.bus.post({
                type: 'polls.updated',
                hostId,
                conversationId: poll.conversationId,
                polls: next,
            });
        };

        deps.connectionManager.on('planChanged', onPlanChanged);
        deps.connectionManager.on('planRemoved', onPlanRemoved);
        deps.connectionManager.on('stepUpdated', onStepUpdated);
        deps.connectionManager.on('pollChanged', onPollChanged);

        // Live tool-call card refresh — host emits tool_call.added/
        // updated as a tool call progresses. We refetch the per-conv
        // list to keep the cache canonical (the event carries the
        // updated row but parser-roundtrip costs more than the refetch).
        const onToolCallChanged = (hostId: string, toolCall: ToolCallLogUi): void => {
            const convId = toolCall.conversationId;
            if (convId.length === 0) return;
            const repository = deps.connectionManager.repositoryFor(hostId);
            if (repository === undefined) return;
            void repository
                .listToolCallsForConv(convId)
                .then((toolCalls) => {
                    deps.bus.post({
                        type: 'toolCalls.updated',
                        hostId,
                        conversationId: convId,
                        toolCalls,
                    });
                })
                .catch(() => undefined);
        };
        // Conv-level member roster refresh — host fires conv.members
        // .changed when any client mutates conv membership. Logged for
        // visibility; chat-header member list is currently sourced
        // from the conv-row member snapshot, which the host re-emits
        // via conv.updated alongside this event.
        const onConvMembersChanged = (
            hostId: string,
            conversationId: string,
            members: readonly MemberUi[],
        ): void => {
            deps.logger.info('WebviewSync: conv.members.changed observed', {
                hostId,
                conversationId,
                count: members.length,
            });
        };
        // Cross-client settings refresh — when any client (mobile,
        // desktop, other VS Code) mutates a per-conv setting, the
        // host fans out a `*.changed` event. We refetch the full
        // settings map so the Settings tab + chat header stay in sync.
        const onConvSettingsChanged = (
            hostId: string,
            conversationId: string,
            _partial: Partial<ConvSettingsUi>,
        ): void => {
            const repository = deps.connectionManager.repositoryFor(hostId);
            if (repository === undefined) return;
            if (conversationId.length === 0) {
                // rag.enabled.changed is host-wide; no per-conv refetch
                // makes sense. We could fan out across every conv but
                // the next conv-open will pull the fresh value anyway.
                return;
            }
            void repository
                .getConversationSettings(conversationId)
                .then((settings) => {
                    deps.bus.post({
                        type: 'conv.settings.updated',
                        hostId,
                        conversationId,
                        settings,
                    });
                })
                .catch(() => undefined);
        };
        // Template library auto-refresh when any client pins, saves,
        // or deletes a template.
        const onProjectTemplateCatalogChanged = (hostId: string): void => {
            const repository = deps.connectionManager.repositoryFor(hostId);
            if (repository === undefined) return;
            void repository
                .listLandingProjectTemplates()
                .then((templates) => {
                    deps.bus.post({ type: 'projectTemplates.updated', hostId, templates });
                })
                .catch(() => undefined);
            void repository
                .listProjectTemplates()
                .then((templates) => {
                    deps.bus.post({ type: 'projectTemplates.allUpdated', hostId, templates });
                })
                .catch(() => undefined);
        };
        // Media panel refetch on artifact / image / audio generation.
        // The existing media.updated bus envelope ships all three
        // tuples together, so we refetch all three in parallel even
        // when only one kind triggered the event — keeps the cache
        // canonical without per-kind state plumbing.
        const onMediaChanged = (
            hostId: string,
            conversationId: string,
            _kind: 'artifact' | 'image' | 'audio',
        ): void => {
            const repository = deps.connectionManager.repositoryFor(hostId);
            if (repository === undefined) return;
            void Promise.all([
                repository.listArtifactsForConv(conversationId),
                repository.listImagesForConv(conversationId),
                repository.listAudioForConv(conversationId),
            ])
                .then(([artifacts, images, audio]) => {
                    deps.bus.post({
                        type: 'media.updated',
                        hostId,
                        conversationId,
                        artifacts,
                        images,
                        audio,
                    });
                })
                .catch(() => undefined);
        };
        const onUserMessageQueued = (): void => {
            deps.bus.post({
                type: 'ide.notice',
                level: 'info',
                message: 'Message queued. It will be sent when the current reply finishes.',
            });
        };
        const onModelsRefreshed = (hostId: string): void => {
            const repository = deps.connectionManager.repositoryFor(hostId);
            if (repository === undefined) return;
            void repository
                .getModelCatalog()
                .then((catalog) => {
                    deps.bus.post({ type: 'models.catalog.updated', hostId, catalog });
                })
                .catch(() => undefined);
        };

        deps.connectionManager.on('toolCallChanged', onToolCallChanged);
        deps.connectionManager.on('convMembersChanged', onConvMembersChanged);
        deps.connectionManager.on('convSettingsChanged', onConvSettingsChanged);
        deps.connectionManager.on('projectTemplateCatalogChanged', onProjectTemplateCatalogChanged);
        deps.connectionManager.on('mediaChanged', onMediaChanged);
        deps.connectionManager.on('modelsRefreshed', onModelsRefreshed);
        deps.connectionManager.on('userMessageQueued', onUserMessageQueued);
        deps.conversationStore.on('changed', onConversationsChanged);
        deps.conversationStore.on('activeChanged', onActiveConvChanged);
        deps.projectStore.on('foldersChanged', onFoldersChanged);
        deps.projectStore.on('membersChanged', onMembersChanged);
        deps.messageStore.on('changed', onMessagesChanged);
        deps.messageStore.on('delta', onMessageDelta);
        deps.contextFillStore.on('changed', onContextFillChanged);

        this.subs.add({
            dispose: () => {
                deps.hostStore.off('changed', onHostsChanged);
                deps.connectionManager.off('stateChanged', onStateChanged);
                deps.connectionManager.off('activeHostChanged', onActiveHostChanged);
                deps.connectionManager.off('sessionReady', onSessionReady);
                deps.connectionManager.off('modelsActiveChanged', onModelsActiveChanged);
                deps.connectionManager.off('toolCallRequested', onToolCallRequested);
                deps.connectionManager.off('toolCallCompleted', onToolCallCompleted);
                deps.connectionManager.off('agentStepUpdated', onAgentStepUpdated);
                deps.connectionManager.off('agentRunStateChanged', onAgentRunStateChanged);
                deps.connectionManager.off('heartbeatConfigChanged', onHeartbeatChanged);
                deps.connectionManager.off('heartbeatConfigRemoved', onHeartbeatRemoved);
                deps.connectionManager.off('planChanged', onPlanChanged);
                deps.connectionManager.off('planRemoved', onPlanRemoved);
                deps.connectionManager.off('stepUpdated', onStepUpdated);
                deps.connectionManager.off('pollChanged', onPollChanged);
                deps.connectionManager.off('toolCallChanged', onToolCallChanged);
                deps.connectionManager.off('convMembersChanged', onConvMembersChanged);
                deps.connectionManager.off('convSettingsChanged', onConvSettingsChanged);
                deps.connectionManager.off(
                    'projectTemplateCatalogChanged',
                    onProjectTemplateCatalogChanged,
                );
                deps.connectionManager.off('mediaChanged', onMediaChanged);
                deps.connectionManager.off('modelsRefreshed', onModelsRefreshed);
                deps.connectionManager.off('userMessageQueued', onUserMessageQueued);
                deps.conversationStore.off('changed', onConversationsChanged);
                deps.conversationStore.off('activeChanged', onActiveConvChanged);
                deps.projectStore.off('foldersChanged', onFoldersChanged);
                deps.projectStore.off('membersChanged', onMembersChanged);
                deps.messageStore.off('changed', onMessagesChanged);
                deps.contextFillStore.off('changed', onContextFillChanged);
                deps.messageStore.off('delta', onMessageDelta);
            },
        });
        this.subs.add(deps.bus.onMessage((msg) => this.onInbound(msg)));
    }

    /**
     * Fetches every host catalog the Settings + Chat surfaces depend on
     * and pushes the result envelopes to the webview. Each fetch is
     * isolated — a host that doesn't support `skill.list` (for example)
     * still gets its tools and MCP catalogs through.
     */
    private async seedCatalogs(hostId: string, repository: RemoteRepository): Promise<void> {
        if (this.disposed) return;
        const safe = async <T>(label: string, op: () => Promise<T>): Promise<T | undefined> => {
            try {
                return await op();
            } catch (error) {
                this.deps.logger.warn('WebviewSync: catalog fetch failed', {
                    catalog: label,
                    hostId,
                    error: errorText(error),
                });
                return undefined;
            }
        };
        const [agents, clients, tools, mcp, skills, identity, modelCatalog] = await Promise.all([
            safe('agents', () => repository.listAgents()),
            safe('clients', () => repository.listClients()),
            safe('tools', () => repository.listTools()),
            safe('mcp', () => repository.listMcpServers()),
            safe('skills', () => repository.listSkills()),
            safe('identity', () => repository.authMe()),
            safe('models', () => repository.getModelCatalog()),
        ]);
        if (this.disposed) return;
        if (agents !== undefined) {
            this.deps.bus.post({ type: 'agents.updated', hostId, agents });
        }
        if (clients !== undefined) {
            this.deps.bus.post({ type: 'clients.updated', hostId, clients });
        }
        if (tools !== undefined) {
            this.deps.bus.post({ type: 'tools.updated', hostId, tools });
        }
        if (mcp !== undefined) {
            this.deps.bus.post({ type: 'mcp.updated', hostId, servers: mcp });
        }
        if (skills !== undefined) {
            this.deps.bus.post({ type: 'skills.updated', hostId, skills });
        }
        if (identity !== undefined) {
            this.deps.bus.post({
                type: 'host.identity',
                hostId,
                clientId: identity.client_id,
                clientName: identity.name,
            });
        }
        if (modelCatalog !== undefined) {
            this.deps.bus.post({
                type: 'models.catalog.updated',
                hostId,
                catalog: modelCatalog,
            });
        }
    }

    /**
     * Push a `models.active.changed` envelope so the webview can
     * update the chat-header subtitle + cached catalog without a
     * full catalog refetch. Called by WireSync when the host emits a
     * `models.active_changed` event (any client switched the model).
     */
    pushModelsActiveChanged(hostId: string, activeProvider: string, activeModel: string): void {
        if (this.disposed) return;
        this.deps.bus.post({
            type: 'models.active.changed',
            hostId,
            activeProvider,
            activeModel,
        });
    }

    /**
     * Pushes the full initial state to the webview. Called by the
     * provider once the webview reports `hello`.
     */
    prime(): void {
        if (this.disposed) return;
        this.pushHosts();
        const activeHostId = this.deps.connectionManager.activeHostId();
        if (activeHostId !== undefined) {
            this.pushConversations(activeHostId);
            this.pushFullConversations(activeHostId);
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.subs.dispose();
    }

    private pushHosts(): void {
        if (this.disposed) return;
        const hosts: HostSummaryUi[] = this.deps.hostStore.list().map((h) => ({
            id: h.id,
            name: h.name,
            url: h.url,
            hasTlsPin: h.tlsCertSha256 !== undefined && h.tlsCertSha256.length > 0,
        }));
        const activeHostId = this.deps.connectionManager.activeHostId();
        const defaultRaw = this.deps.hostStore.defaultHostId();
        const defaultHostId = defaultRaw.length > 0 ? defaultRaw : undefined;
        const states = hosts.map((h) => ({
            hostId: h.id,
            state: this.deps.connectionManager.stateOf(h.id),
        }));
        this.deps.bus.post({
            type: 'hosts.updated',
            hosts,
            activeHostId,
            defaultHostId,
            states,
        });
    }

    private pushConversations(hostId: string): void {
        if (this.disposed) return;
        const conversations: RecentConversationUi[] = [
            ...this.deps.conversationStore.byHost(hostId),
        ]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, RECENT_CONVERSATIONS_LIMIT)
            .map((c) => ({
                id: c.id,
                hostId,
                title: c.title,
                isGroup: c.isGroup,
                isPinned: c.isPinned,
                updatedAt: c.updatedAt,
                preview: c.preview ?? '',
            }));
        this.deps.bus.post({
            type: 'conversations.recent.updated',
            hostId,
            conversations,
        });
    }

    private pushMessages(conversationId: string): void {
        if (this.disposed) return;
        const messages = this.deps.messageStore.byConversation(conversationId);
        if (messages.length === 0) return;
        const hostId = this.deps.connectionManager.activeHostId();
        if (hostId === undefined) return;
        // Snapshot push trace: if the user sees two bubbles but this
        // line reports the row only once, the duplication is webview-
        // local (signal/placeholder layer), not store-level.
        this.deps.logger.debug('WebviewSync: messages.updated push', {
            conversationId,
            rows: messages.length,
            tailIds: messages.slice(-3).map((m) => m.id),
        });
        this.deps.bus.post({
            type: 'messages.updated',
            hostId,
            conversationId,
            messages: messages.map(toMessageRow),
        });
    }

    private pushMessageDelta(conversationId: string, messageId: string): void {
        if (this.disposed) return;
        const hostId = this.deps.connectionManager.activeHostId();
        if (hostId === undefined) return;
        const message = this.deps.messageStore
            .byConversation(conversationId)
            .find((m) => m.id === messageId);
        if (message === undefined) return;
        this.deps.bus.post({
            type: 'message.delta',
            hostId,
            conversationId,
            messageId,
            contentDelta: message.content,
            thinkingDelta: message.thinkingContent ?? '',
        });
    }

    /**
     * Re-read a conversation's messages from the host and merge them into
     * the cache. Runs every time a conversation is opened, not only the
     * first time: while another conversation was open this one was
     * unsubscribed, so replies that finished in the meantime never
     * arrived as events.
     */
    private refreshMessages(conversationId: string): void {
        if (this.disposed) return;
        const hostId = this.deps.connectionManager.activeHostId();
        if (hostId === undefined) return;
        const repository = this.deps.connectionManager.repositoryFor(hostId);
        if (repository === undefined) return;
        void repository
            .listMessages(conversationId)
            .then((messages) => {
                if (this.disposed) return;
                this.deps.messageStore.mergeFromHost(conversationId, messages);
            })
            .catch((error: unknown) => {
                this.deps.logger.warn('WebviewSync: listMessages failed', {
                    conversationId,
                    error: errorText(error),
                });
            });
    }

    private pushFolderMembers(hostId: string, folderId: string): void {
        if (this.disposed) return;
        const members = this.deps.projectStore.membersOf(hostId, folderId);
        this.deps.bus.post({
            type: 'folder.members.updated',
            hostId,
            folderId,
            members,
        });
    }

    private pushFullConversations(hostId: string): void {
        if (this.disposed) return;
        const conversations: ConversationFullUi[] = this.deps.conversationStore
            .byHost(hostId)
            .map((c) => ({
                id: c.id,
                hostId,
                title: c.title,
                folderId: c.folderId,
                isGroup: c.isGroup,
                isPinned: c.isPinned,
                primaryAgentId: c.primaryAgentId,
                updatedAt: c.updatedAt,
                preview: c.preview ?? '',
            }));
        const folders: FolderSummaryUi[] = this.deps.projectStore
            .foldersByHost(hostId)
            .map((f) => ({
                id: f.id,
                hostId,
                name: f.name,
                folderType: f.folderType,
                parentId: f.parentId,
                goal: f.goal ?? '',
                description: f.description ?? '',
            }));
        this.deps.bus.post({
            type: 'conversations.full.updated',
            hostId,
            conversations,
            folders,
        });
    }

    private onInbound(msg: WebviewToExtension): void {
        if (this.disposed) return;
        switch (msg.type) {
            case 'hello':
            case 'ping':
                // Handled by VerzetaWebviewProvider itself.
                return;
            case 'host.setActive':
                void this.deps.connectionManager.setActiveHostId(msg.hostId);
                return;
            case 'host.connectRequested':
                void this.deps.connectionManager.connect(msg.hostId);
                return;
            case 'host.disconnectRequested':
                void this.deps.connectionManager.disconnect(msg.hostId);
                return;
            case 'host.commandRequested':
                if (!ALLOWED_COMMANDS.has(msg.commandId)) {
                    this.deps.logger.warn('WebviewSync: rejected command id', {
                        commandId: msg.commandId,
                    });
                    return;
                }
                void vscode.commands.executeCommand(msg.commandId);
                return;
            case 'conversation.openRequested':
                void this.deps.connectionManager.setActiveHostId(msg.hostId);
                this.deps.conversationStore.setActiveConversationId(msg.conversationId);
                return;
            case 'conversation.deleteRequested': {
                const hostId = msg.hostId;
                const convId = msg.conversationId;
                this.deps.logger.info('WebviewSync: conversation.deleteRequested', {
                    hostId,
                    conversationId: convId,
                });
                const repository = this.deps.connectionManager.repositoryFor(hostId);
                // Remove from local store IMMEDIATELY so the UI updates
                // even if the wire takes a moment (or the host never
                // emits conv.deleted because of a subscription race).
                // Snapshot the row before removing so we can revert on
                // failure.
                const snapshot = this.deps.conversationStore.findById(hostId, convId);
                this.deps.conversationStore.removeOne(hostId, convId);
                if (repository === undefined) {
                    this.deps.logger.warn(
                        'WebviewSync: conversation.delete with no repository — reverting',
                        { hostId, convId },
                    );
                    if (snapshot !== undefined) {
                        this.deps.conversationStore.upsertOne(hostId, snapshot);
                    }
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected to host. Cannot delete conversation.',
                    });
                    return;
                }
                void repository.deleteConversation(convId).catch((error: unknown) => {
                    this.deps.logger.warn('WebviewSync: deleteConversation failed — reverting', {
                        conversationId: convId,
                        error: errorText(error),
                    });
                    if (snapshot !== undefined) {
                        this.deps.conversationStore.upsertOne(hostId, snapshot);
                    }
                    this.deps.bus.post({
                        type: 'error',
                        message: `Delete conversation failed: ${errorText(error)}`,
                    });
                });
                return;
            }
            case 'folder.deleteRequested': {
                const hostId = msg.hostId;
                const folderId = msg.folderId;
                this.deps.logger.info('WebviewSync: folder.deleteRequested', { hostId, folderId });
                const repository = this.deps.connectionManager.repositoryFor(hostId);
                const folderSnapshot = this.deps.projectStore
                    .foldersByHost(hostId)
                    .find((f) => f.id === folderId);
                const memberSnapshot = this.deps.projectStore.membersOf(hostId, folderId);
                // The host's folder.delete (conversation-service.cpp:585)
                // ORPHANS contained conversations: it sets
                // folder_id = NULL and emits conv.updated rather than
                // cascading deletes. That left the project's chats as
                // "general" rows on the desktop while the extension's
                // local cascade hid them — exactly the inconsistency
                // the user hit. Fix: delete every child conversation
                // explicitly BEFORE folder.delete so the host actually
                // cascades.
                const convsInFolder = this.deps.conversationStore
                    .byHost(hostId)
                    .filter((c) => c.folderId === folderId);
                this.deps.projectStore.removeFolder(hostId, folderId);
                for (const c of convsInFolder) {
                    this.deps.conversationStore.removeOne(hostId, c.id);
                }
                if (repository === undefined) {
                    this.deps.logger.warn(
                        'WebviewSync: folder.delete with no repository — reverting',
                        { hostId, folderId },
                    );
                    if (folderSnapshot !== undefined) {
                        this.deps.projectStore.upsertFolder(hostId, folderSnapshot);
                        this.deps.projectStore.replaceMembers(hostId, folderId, memberSnapshot);
                    }
                    for (const c of convsInFolder) {
                        this.deps.conversationStore.upsertOne(hostId, c);
                    }
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected to host. Cannot delete folder.',
                    });
                    return;
                }
                const repo = repository;
                void Promise.all(convsInFolder.map((c) => repo.deleteConversation(c.id)))
                    .then(() => repo.deleteFolder(folderId))
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: deleteFolder failed — reverting', {
                            folderId,
                            error: errorText(error),
                        });
                        if (folderSnapshot !== undefined) {
                            this.deps.projectStore.upsertFolder(hostId, folderSnapshot);
                            this.deps.projectStore.replaceMembers(hostId, folderId, memberSnapshot);
                        }
                        for (const c of convsInFolder) {
                            this.deps.conversationStore.upsertOne(hostId, c);
                        }
                        this.deps.bus.post({
                            type: 'error',
                            message: `Delete folder failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'message.send': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.logger.warn('WebviewSync: message.send with no repository', {
                        hostId: msg.hostId,
                    });
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                // Defensive subscribe — most host versions auto-subscribe
                // the sender, but some gate streaming events behind an
                // explicit msg.subscribe per conv. Doing it before
                // sendMessage closes the "no response until reload" race.
                void repository.subscribeMessages(msg.conversationId).catch(() => undefined);
                this.deps.onMessageSent?.(msg.hostId, msg.conversationId);
                void repository
                    .sendMessage(msg.conversationId, msg.text)
                    .then((result) => {
                        // Pre-emptive user-message insert so the bubble
                        // appears the moment the host accepts the op,
                        // instead of waiting for the `message.added`
                        // event to round-trip. If the host did not
                        // return a canonical id we synthesise one;
                        // MessageStore.upsertOne reconciles by
                        // role+content+time when the real `message.added`
                        // arrives, replacing the placeholder in-place
                        // so the user never sees a duplicate.
                        const now = Date.now();
                        const placeholderId =
                            result.userMessageId.length > 0
                                ? result.userMessageId
                                : `optimistic:${now}:${Math.random().toString(36).slice(2, 10)}`;
                        this.deps.logger.debug('WebviewSync: post-ack user insert', {
                            convId: msg.conversationId,
                            placeholderId,
                            canonicalIdReturned: result.userMessageId.length > 0,
                            contentLen: msg.text.length,
                        });
                        this.deps.messageStore.upsertOne(msg.conversationId, {
                            id: placeholderId,
                            conversationId: msg.conversationId,
                            role: 'user',
                            content: msg.text,
                            createdAt: now,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: sendMessage failed', {
                            conversationId: msg.conversationId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Send failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'message.stop': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.stopGeneration().catch((error: unknown) => {
                    this.deps.logger.warn('WebviewSync: stopGeneration failed', {
                        hostId: msg.hostId,
                        error: errorText(error),
                    });
                });
                return;
            }
            case 'message.sendWithAttachments': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.logger.warn(
                        'WebviewSync: message.sendWithAttachments with no repository',
                        { hostId: msg.hostId },
                    );
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                // Same subscribe-before-send pattern as message.send so
                // streaming events flow back through the host's per-conv
                // filter (wire-session.cpp:2607).
                void repository.subscribeMessages(msg.conversationId).catch(() => undefined);
                this.deps.onMessageSent?.(msg.hostId, msg.conversationId);
                void repository
                    .sendMessageWithAttachments(msg.conversationId, msg.text, msg.attachments)
                    .then(() => {
                        // Optimistic user-message insert mirroring the
                        // text-only path. The canonical message.added
                        // event reconciles via MessageStore.upsertOne's
                        // optimistic-prefix branch. We carry the text
                        // only — the attachment metadata lives on the
                        // host once the upload completes and surfaces
                        // back via the message row's attachment list.
                        if (msg.text.length === 0) return;
                        const now = Date.now();
                        const placeholderId = `optimistic:${now}:${Math.random()
                            .toString(36)
                            .slice(2, 10)}`;
                        this.deps.logger.debug('WebviewSync: post-ack user insert (attachments)', {
                            convId: msg.conversationId,
                            placeholderId,
                            contentLen: msg.text.length,
                        });
                        this.deps.messageStore.upsertOne(msg.conversationId, {
                            id: placeholderId,
                            conversationId: msg.conversationId,
                            role: 'user',
                            content: msg.text,
                            createdAt: now,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: sendMessageWithAttachments failed', {
                            conversationId: msg.conversationId,
                            attachmentCount: msg.attachments.length,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Send failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'host.pingRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'host.pingResult',
                        hostId: msg.hostId,
                        ok: false,
                        latencyMs: 0,
                        error: 'Not connected.',
                    });
                    return;
                }
                const t0 = Date.now();
                void repository
                    .ping()
                    .then(() => {
                        this.deps.bus.post({
                            type: 'host.pingResult',
                            hostId: msg.hostId,
                            ok: true,
                            latencyMs: Date.now() - t0,
                            error: '',
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.bus.post({
                            type: 'host.pingResult',
                            hostId: msg.hostId,
                            ok: false,
                            latencyMs: Date.now() - t0,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'host.revokeSelfRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected to this host. Cannot revoke.',
                    });
                    return;
                }
                void repository
                    .revokeSelf()
                    .then(() => {
                        // After the host accepts the revoke we still need
                        // to drop our local token + close the live session
                        // so the user can re-pair cleanly.
                        void this.deps.connectionManager
                            .forgetPairing(msg.hostId)
                            .catch((error: unknown) => {
                                this.deps.logger.warn(
                                    'WebviewSync: disconnect post-revoke failed',
                                    { hostId: msg.hostId, error: errorText(error) },
                                );
                            });
                    })
                    .catch((error: unknown) => {
                        this.deps.bus.post({
                            type: 'error',
                            message: `Revoke failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'workspace.shareRequested': {
                this.deps.onShareRequested?.(msg.hostId, msg.conversationId);
                return;
            }
            case 'convExecMode.requested': {
                const mode: RemoteExecMode =
                    this.deps.execModeStore?.getMode(msg.conversationId) ?? 'off';
                this.deps.bus.post({
                    type: 'convExecMode.updated',
                    hostId: msg.hostId,
                    conversationId: msg.conversationId,
                    mode,
                });
                return;
            }
            case 'exec.confirmResponse': {
                this.deps.onExecConfirmResponse?.(msg.requestId, msg.approved);
                return;
            }
            case 'convExecMode.set': {
                const store = this.deps.execModeStore;
                if (store === undefined) return;
                void store.setMode(msg.conversationId, msg.mode).then(() => {
                    this.deps.bus.post({
                        type: 'convExecMode.updated',
                        hostId: msg.hostId,
                        conversationId: msg.conversationId,
                        mode: store.getMode(msg.conversationId),
                    });
                });
                return;
            }
            case 'conv.settings.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message:
                            'Host is not connected. Connect from Settings to load chat settings.',
                    });
                    return;
                }
                void repository
                    .getConversationSettings(msg.conversationId)
                    .then((settings) => {
                        this.deps.bus.post({
                            type: 'conv.settings.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            settings,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: getConversationSettings failed', {
                            conversationId: msg.conversationId,
                            error: errorText(error),
                        });
                        // Push a default ConvSettingsUi so the sheet stops
                        // showing "Loading…" indefinitely and at least
                        // displays editable defaults the user can save
                        // (the save round-trip will reveal the real
                        // host response shape next).
                        this.deps.bus.post({
                            type: 'conv.settings.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            settings: {
                                systemPrompt: '',
                                temperature: 0.7,
                                maxTokens: 4096,
                                contextWindow: 8192,
                                streaming: true,
                                thinking: false,
                                providerId: '',
                                modelName: '',
                                isGroup: false,
                                folderId: '',
                                primaryAgentId: '',
                                heartbeatAutoSurface: false,
                                autoSurfaceMaxPerDay: 1,
                                agentPattern: 'direct',
                                requireConfirmation: false,
                                toolsEnabled: true,
                                ragEnabled: false,
                                topK: -1,
                                topP: -1,
                                repeatPenalty: -1,
                                presencePenalty: -1,
                                frequencyPenalty: -1,
                                forceAppSampling: true,
                                toolsInSystemPrompt: false,
                                dynamicCompactEnabled: true,
                                compactEveryTurns: 20,
                            },
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Failed to load chat settings (defaults shown): ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'conv.settings.save': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                // The host queues the save and replies at once, so the
                // read-back can still hold old values; overlay the patch.
                void repository
                    .saveConversationSettings(msg.conversationId, msg.patch)
                    .then(() => repository.getConversationSettings(msg.conversationId))
                    .then((settings) => {
                        this.deps.bus.post({
                            type: 'conv.settings.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            settings: overlayWrittenSettings(settings, msg.patch),
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'agent.pattern.set': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .setAgentPattern(msg.conversationId, msg.pattern)
                    .then(() => repository.getConversationSettings(msg.conversationId))
                    .then((settings) => {
                        this.deps.bus.post({
                            type: 'conv.settings.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            settings: overlayWrittenSettings(settings, {
                                agentPattern: msg.pattern,
                            }),
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Change agent pattern', error);
                    });
                return;
            }
            case 'agent.require_confirmation.set': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                // The host's change event carries no conversation id, so
                // push the settings with the new value from here.
                void repository
                    .setRequireConfirmation(msg.conversationId, msg.require)
                    .then(() => repository.getConversationSettings(msg.conversationId))
                    .then((settings) => {
                        this.deps.bus.post({
                            type: 'conv.settings.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            settings: overlayWrittenSettings(settings, {
                                requireConfirmation: msg.require,
                            }),
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Change tool confirmation', error);
                    });
                return;
            }
            case 'tools.enabled.set': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                // Same as above: the change event has no conversation id.
                void repository
                    .setToolsEnabled(msg.conversationId, msg.enabled)
                    .then(() => repository.getConversationSettings(msg.conversationId))
                    .then((settings) => {
                        this.deps.bus.post({
                            type: 'conv.settings.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            settings: overlayWrittenSettings(settings, {
                                toolsEnabled: msg.enabled,
                            }),
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Change tools', error);
                    });
                return;
            }
            case 'conv.primary_agent.set': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .setConversationPrimaryAgent(msg.conversationId, msg.agentId)
                    .then(() => repository.getConversationSettings(msg.conversationId))
                    .then((settings) => {
                        this.deps.bus.post({
                            type: 'conv.settings.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            settings: overlayWrittenSettings(settings, {
                                primaryAgentId: msg.agentId,
                            }),
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Change primary agent', error);
                    });
                return;
            }
            case 'agents.listRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listAgents()
                    .then((agents) => {
                        this.deps.bus.post({
                            type: 'agents.updated',
                            hostId: msg.hostId,
                            agents,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listAgents failed', {
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'clients.listRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listClients()
                    .then((clients) => {
                        this.deps.bus.post({
                            type: 'clients.updated',
                            hostId: msg.hostId,
                            clients,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listClients failed', {
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'clients.revokeRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .revokeClient(msg.clientId)
                    .then(() => repository.listClients())
                    .then((clients) => {
                        this.deps.bus.post({
                            type: 'clients.updated',
                            hostId: msg.hostId,
                            clients,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.bus.post({
                            type: 'error',
                            message: `Revoke client failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'tools.listRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listTools()
                    .then((tools) => {
                        this.deps.bus.post({
                            type: 'tools.updated',
                            hostId: msg.hostId,
                            tools,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listTools failed', {
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'mcp.listRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listMcpServers()
                    .then((servers) => {
                        this.deps.bus.post({
                            type: 'mcp.updated',
                            hostId: msg.hostId,
                            servers,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listMcpServers failed', {
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'skills.listRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listSkills()
                    .then((skills) => {
                        this.deps.bus.post({
                            type: 'skills.updated',
                            hostId: msg.hostId,
                            skills,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listSkills failed', {
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'verifySession.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'verifySession.result',
                        hostId: msg.hostId,
                        ok: false,
                        latencyMs: 0,
                        clientId: '',
                        clientName: '',
                        error: 'Not connected.',
                    });
                    return;
                }
                const t0 = Date.now();
                void Promise.all([repository.ping(), repository.authMe()])
                    .then(([, me]) => {
                        this.deps.bus.post({
                            type: 'verifySession.result',
                            hostId: msg.hostId,
                            ok: true,
                            latencyMs: Date.now() - t0,
                            clientId: me.client_id,
                            clientName: me.name,
                            error: '',
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.bus.post({
                            type: 'verifySession.result',
                            hostId: msg.hostId,
                            ok: false,
                            latencyMs: Date.now() - t0,
                            clientId: '',
                            clientName: '',
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'folder.members.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listFolderMembers(msg.folderId)
                    .then((members) => {
                        // Push directly so the requester sees the response
                        // even if ProjectStore was already in sync. The
                        // replaceMembers call ALSO fires membersChanged
                        // which re-pushes — idempotent.
                        this.deps.projectStore.replaceMembers(msg.hostId, msg.folderId, members);
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listFolderMembers failed', {
                            folderId: msg.folderId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'folder.member.chat.openRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                void repository
                    .openMemberChat(msg.folderId, msg.agentId, msg.alias)
                    .then((convId) => {
                        // Switch the active conv so the chat detail loads.
                        // ConversationStore.activeChanged fires which drives
                        // the WebviewSync subscribe/listMessages flow.
                        this.deps.conversationStore.setActiveConversationId(convId);
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: openMemberChat failed', {
                            folderId: msg.folderId,
                            agentId: msg.agentId,
                            alias: msg.alias,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Open member chat failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'folder.kickoff.groupRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                void repository
                    .kickoffGroupChat(msg.folderId)
                    .then((convId) => {
                        this.deps.conversationStore.setActiveConversationId(convId);
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: kickoffGroupChat failed', {
                            folderId: msg.folderId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Start group chat failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'folder.kickoff.individualRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                void repository.kickoffIndividualChats(msg.folderId).catch((error: unknown) => {
                    this.deps.logger.warn('WebviewSync: kickoffIndividualChats failed', {
                        folderId: msg.folderId,
                        error: errorText(error),
                    });
                    this.deps.bus.post({
                        type: 'error',
                        message: `Start 1:1 chats failed: ${errorText(error)}`,
                    });
                });
                return;
            }
            case 'conversation.createRequested': {
                if (this.deps.connectionManager.repositoryFor(msg.hostId) === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                void createAndActivateConversation(this.deps, msg.hostId)
                    .then((convId) => {
                        // Tell the webview it should switch its own active
                        // conv + flip to the Chat tab. Without this the
                        // user clicks "New chat" and nothing visibly
                        // happens because the webview's
                        // activeConversationId signal never updates.
                        this.deps.bus.post({
                            type: 'conversation.created',
                            hostId: msg.hostId,
                            conversationId: convId,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: createConversation failed', {
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `New chat failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'folder.createRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                // The host's folder.create op takes only a name and
                // reports the type it created (`regular` today). When that
                // differs from the user's pick, or a goal/description was
                // supplied, chain folder.update_metadata so the persisted
                // folder matches the user's intent. The folder.added event
                // flows back via WireSync into ProjectStore automatically,
                // so no local store mutation is needed here.
                const hasRoster = msg.members.length > 0;
                void repository
                    .createFolder(msg.name)
                    .then(async (created) => {
                        const needsMetadataUpdate =
                            msg.folderType !== created.type ||
                            msg.goal.length > 0 ||
                            msg.description.length > 0;
                        if (needsMetadataUpdate) {
                            await repository.updateFolderMetadata(
                                created.id,
                                msg.folderType,
                                msg.goal,
                                msg.description,
                                [],
                            );
                        }
                        // Install the user-chosen roster as a single
                        // atomic set. Coordinator radio-style enforcement
                        // happened client-side in the editor — host
                        // accepts whatever roster shape arrives.
                        if (hasRoster) {
                            await repository.setFolderMembers(created.id, msg.members);
                        }
                        // Tell the webview the folder is live. If
                        // members were attached, the webview will
                        // open the KickoffSheet ("Start chatting with
                        // your team?") — that's the Android-parity
                        // path. The webview does NOT auto-open the
                        // folder in edit mode; user clicks ⚙ Edit on
                        // the rail if they want to tune later.
                        this.deps.bus.post({
                            type: 'folder.created',
                            hostId: msg.hostId,
                            folderId: created.id,
                            folderName: msg.name,
                            memberCount: msg.members.length,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: createFolder failed', {
                            name: msg.name,
                            folderType: msg.folderType,
                            members: msg.members.length,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Folder create failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'models.catalog.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .getModelCatalog()
                    .then((catalog) => {
                        this.deps.bus.post({
                            type: 'models.catalog.updated',
                            hostId: msg.hostId,
                            catalog,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: getModelCatalog failed', {
                            hostId: msg.hostId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'models.setActiveRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                // Fire-and-forget per Android pattern (RemoteRepository.kt:1671).
                // The host emits `models.active_changed` when the switch
                // lands; WireSync forwards that to the webview via the
                // `models.active.changed` envelope.
                void repository
                    .setActiveModel(msg.providerId, msg.modelName)
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setActiveModel failed', {
                            hostId: msg.hostId,
                            providerId: msg.providerId,
                            modelName: msg.modelName,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Switch model failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'search.providers.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .getSearchProviders()
                    .then((catalog) => {
                        this.deps.bus.post({
                            type: 'search.providers.updated',
                            hostId: msg.hostId,
                            catalog,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: getSearchProviders failed', {
                            hostId: msg.hostId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'search.setActiveRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                // The host emits no search event, so re-fetch the catalogue
                // after the switch and push the updated active state back.
                void repository
                    .setActiveSearchProvider(msg.providerId)
                    .then(() => repository.getSearchProviders())
                    .then((catalog) => {
                        this.deps.bus.post({
                            type: 'search.providers.updated',
                            hostId: msg.hostId,
                            catalog,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setActiveSearchProvider failed', {
                            hostId: msg.hostId,
                            providerId: msg.providerId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Switch search provider failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'tool_call.approveRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.approveToolCall(msg.callId).catch((error: unknown) => {
                    this.deps.logger.warn('WebviewSync: approveToolCall failed', {
                        callId: msg.callId,
                        error: errorText(error),
                    });
                    this.deps.bus.post({
                        type: 'error',
                        message: `Tool approve failed: ${errorText(error)}`,
                    });
                });
                return;
            }
            case 'tool_call.denyRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.denyToolCall(msg.callId).catch((error: unknown) => {
                    this.deps.logger.warn('WebviewSync: denyToolCall failed', {
                        callId: msg.callId,
                        error: errorText(error),
                    });
                    this.deps.bus.post({
                        type: 'error',
                        message: `Tool deny failed: ${errorText(error)}`,
                    });
                });
                return;
            }
            case 'folder.members.setRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                void repository
                    .setFolderMembers(msg.folderId, msg.members)
                    .then(() => repository.listFolderMembers(msg.folderId))
                    .then((members) => {
                        this.deps.projectStore.replaceMembers(msg.hostId, msg.folderId, members);
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setFolderMembers failed', {
                            folderId: msg.folderId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save members failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'folder.member.override.setRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                // One member's overrides, saved without touching the rest
                // of the roster. The host answers false when no member of
                // the folder has this alias, which is a failed save.
                void repository
                    .setFolderMemberOverride(msg.folderId, msg.alias, {
                        modelProvider: msg.modelProvider,
                        modelName: msg.modelName,
                        allowedTools: msg.allowedTools,
                    })
                    .then((updated) => {
                        if (!updated) {
                            throw new Error(`no member named ${msg.alias} in this project`);
                        }
                        return repository.listFolderMembers(msg.folderId);
                    })
                    .then((members) => {
                        this.deps.projectStore.replaceMembers(msg.hostId, msg.folderId, members);
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setFolderMemberOverride failed', {
                            folderId: msg.folderId,
                            alias: msg.alias,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save member settings failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'folder.updateRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                // Chain rename (when the name changed) → update_metadata
                // → members.set so the post-save folder reflects every
                // editor field in one atomic flow. Mirrors Android
                // `MainViewModel.updateFolderWithMembers` (line 2841).
                const renamePromise =
                    msg.name !== msg.originalName
                        ? repository.renameFolder(msg.folderId, msg.name)
                        : Promise.resolve();
                void renamePromise
                    .then(() =>
                        repository.updateFolderMetadata(
                            msg.folderId,
                            msg.folderType,
                            msg.goal,
                            msg.description,
                            [],
                        ),
                    )
                    .then(() => repository.setFolderMembers(msg.folderId, msg.members))
                    .then(() => repository.listFolderMembers(msg.folderId))
                    .then((members) => {
                        this.deps.projectStore.replaceMembers(msg.hostId, msg.folderId, members);
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: folder.update failed', {
                            folderId: msg.folderId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save folder failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'heartbeats.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listHeartbeatConfigsForFolder(msg.folderId)
                    .then((configs) => {
                        const key = `${msg.hostId}::${msg.folderId}`;
                        this.heartbeatsByFolder.set(key, configs.slice());
                        this.deps.bus.post({
                            type: 'heartbeats.updated',
                            hostId: msg.hostId,
                            folderId: msg.folderId,
                            configs,
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Load heartbeats', error);
                    });
                return;
            }
            case 'heartbeat.upsertRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                const upsertParams = {
                    agentId: msg.agentId,
                    scopeType: 'folder' as const,
                    scopeId: msg.folderId,
                    alias: msg.alias,
                    enabled: msg.enabled,
                    schedule: msg.schedule,
                    goal: msg.goal,
                    autoSurfaceTargetConversationId: msg.autoSurfaceTargetConversationId,
                    maxRunsPerDay: msg.maxRunsPerDay,
                };
                // The host replaces the whole row on upsert. The editor
                // here has no fields for surface criteria or self-config,
                // so an edit carries the stored values over.
                const cachedList = this.heartbeatsByFolder.get(`${msg.hostId}::${msg.folderId}`);
                const cached = cachedList?.find((c) => c.id === msg.id);
                const loadExisting =
                    msg.id.length === 0
                        ? Promise.resolve(undefined)
                        : cached !== undefined
                          ? Promise.resolve(cached)
                          : repository.getHeartbeatConfigById(msg.id);
                void loadExisting
                    .then((existing) =>
                        repository.upsertHeartbeatConfig(
                            msg.id.length === 0
                                ? upsertParams
                                : {
                                      id: msg.id,
                                      ...upsertParams,
                                      surfaceCriteria: existing?.surfaceCriteria ?? '',
                                      selfConfigAllowed: existing?.selfConfigAllowed ?? false,
                                  },
                        ),
                    )
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: heartbeat.upsert failed', {
                            id: msg.id,
                            folderId: msg.folderId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save heartbeat failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'heartbeat.removeRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.removeHeartbeatConfig(msg.id).catch((error: unknown) => {
                    this.deps.logger.warn('WebviewSync: heartbeat.remove failed', {
                        id: msg.id,
                        error: errorText(error),
                    });
                    this.deps.bus.post({
                        type: 'error',
                        message: `Remove heartbeat failed: ${errorText(error)}`,
                    });
                });
                return;
            }
            case 'heartbeat.runRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.runHeartbeatNow(msg.id).catch((error: unknown) => {
                    this.deps.logger.warn('WebviewSync: heartbeat.run_now failed', {
                        id: msg.id,
                        error: errorText(error),
                    });
                    this.deps.bus.post({
                        type: 'error',
                        message: `Run heartbeat failed: ${errorText(error)}`,
                    });
                });
                return;
            }
            case 'preferredSkills.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void Promise.all([
                    repository.listPreferredSkills(msg.folderId),
                    repository.getExposeOnlyPreferred(msg.folderId),
                ])
                    .then(([skillIds, exposeOnly]) => {
                        this.deps.bus.post({
                            type: 'preferredSkills.updated',
                            hostId: msg.hostId,
                            folderId: msg.folderId,
                            skillIds,
                            exposeOnly,
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Load preferred skills', error);
                    });
                return;
            }
            case 'preferredSkills.setRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                // Save the skill set + expose-only flag, then re-fetch
                // so the webview cache reflects whatever the host
                // canonicalised (e.g. dedup, drop of unknown ids).
                void repository
                    .setPreferredSkills(msg.folderId, msg.skillIds)
                    .then(() => repository.setExposeOnlyPreferred(msg.folderId, msg.exposeOnly))
                    .then(() =>
                        Promise.all([
                            repository.listPreferredSkills(msg.folderId),
                            repository.getExposeOnlyPreferred(msg.folderId),
                        ]),
                    )
                    .then(([skillIds, exposeOnly]) => {
                        this.deps.bus.post({
                            type: 'preferredSkills.updated',
                            hostId: msg.hostId,
                            folderId: msg.folderId,
                            skillIds,
                            exposeOnly,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setPreferredSkills failed', {
                            folderId: msg.folderId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save preferred skills failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'convSkillOverride.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .getOverrideParentFolder(msg.conversationId)
                    .then((override) => {
                        this.deps.bus.post({
                            type: 'convSkillOverride.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            override,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: getOverrideParentFolder failed', {
                            conversationId: msg.conversationId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'convSkillOverride.setRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .setOverrideParentFolder(msg.conversationId, msg.override)
                    .then(() => repository.getOverrideParentFolder(msg.conversationId))
                    .then((override) => {
                        this.deps.bus.post({
                            type: 'convSkillOverride.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            override,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setOverrideParentFolder failed', {
                            conversationId: msg.conversationId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save skill override failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'convPreferredSkills.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listConvPreferredSkills(
                        msg.conversationId,
                        this.isGroupConversation(msg.hostId, msg.conversationId),
                    )
                    .then((skillIds) => {
                        this.deps.bus.post({
                            type: 'convPreferredSkills.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            skillIds,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listConvPreferredSkills failed', {
                            conversationId: msg.conversationId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'convPreferredSkills.setRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                const isGroup = this.isGroupConversation(msg.hostId, msg.conversationId);
                void repository
                    .setConvPreferredSkills(msg.conversationId, msg.skillIds, isGroup)
                    .then(() => repository.listConvPreferredSkills(msg.conversationId, isGroup))
                    .then((skillIds) => {
                        this.deps.bus.post({
                            type: 'convPreferredSkills.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            skillIds,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setConvPreferredSkills failed', {
                            conversationId: msg.conversationId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save conv preferred skills failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'convHeartbeatGate.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .getConvHeartbeatGate(msg.conversationId)
                    .then(({ allow, maxPerDay }) => {
                        this.deps.bus.post({
                            type: 'convHeartbeatGate.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            allow,
                            maxPerDay,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: getConvHeartbeatGate failed', {
                            conversationId: msg.conversationId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'convHeartbeatGate.setRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .setConvHeartbeatGate(msg.conversationId, msg.allow, msg.maxPerDay)
                    .then(() => repository.getConvHeartbeatGate(msg.conversationId))
                    .then(({ allow, maxPerDay }) => {
                        this.deps.bus.post({
                            type: 'convHeartbeatGate.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            allow,
                            maxPerDay,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setConvHeartbeatGate failed', {
                            conversationId: msg.conversationId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save heartbeat gate failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'documents.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listFolderDocuments(msg.folderId)
                    .then((documents) => {
                        this.deps.bus.post({
                            type: 'documents.updated',
                            hostId: msg.hostId,
                            folderId: msg.folderId,
                            documents,
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Load documents', error);
                    });
                return;
            }
            case 'document.uploadRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                void repository
                    .uploadFolderDocument(msg.folderId, msg.fileName, msg.contentBase64)
                    .then(() => repository.listFolderDocuments(msg.folderId))
                    .then((documents) => {
                        this.deps.bus.post({
                            type: 'documents.updated',
                            hostId: msg.hostId,
                            folderId: msg.folderId,
                            documents,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: uploadFolderDocument failed', {
                            folderId: msg.folderId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Upload failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'document.removeRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .removeFolderDocument(msg.folderId, msg.fileName)
                    .then(() => repository.listFolderDocuments(msg.folderId))
                    .then((documents) => {
                        this.deps.bus.post({
                            type: 'documents.updated',
                            hostId: msg.hostId,
                            folderId: msg.folderId,
                            documents,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: removeFolderDocument failed', {
                            folderId: msg.folderId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Remove failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'group.createRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    return;
                }
                void repository
                    .createGroup(msg.title, msg.members)
                    .then((convId) => {
                        // Mark the new group conv as active so the
                        // Chat tab navigates into it. ConversationStore
                        // activeChanged drives WireSync subscribe to
                        // the new conv id; the host's `conv.added`
                        // event flows through automatically.
                        this.deps.conversationStore.setActiveConversationId(convId);
                        this.deps.bus.post({
                            type: 'conversation.created',
                            hostId: msg.hostId,
                            conversationId: convId,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: createGroup failed', {
                            title: msg.title,
                            memberCount: msg.members.length,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `New group failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'plans.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listPlansForConversation(msg.conversationId)
                    .then((plans) => {
                        const key = `${msg.hostId}::${msg.conversationId}`;
                        this.plansByConv.set(key, plans.slice());
                        this.deps.bus.post({
                            type: 'plans.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            plans,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listPlans failed', {
                            convId: msg.conversationId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'task.startRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.startTask(msg.conversationId, msg.goal).catch((error: unknown) => {
                    this.deps.logger.warn('WebviewSync: startTask failed', {
                        convId: msg.conversationId,
                        error: errorText(error),
                    });
                    this.deps.bus.post({
                        type: 'error',
                        message: `Start task failed: ${errorText(error)}`,
                    });
                });
                return;
            }
            case 'plan.stopRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.stopPlan(msg.planId).catch((error: unknown) => {
                    this.reportFailure('Stop plan', error);
                });
                return;
            }
            case 'plan.stopAllRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .stopAllPlansInConversation(msg.conversationId)
                    .catch((error: unknown) => {
                        this.reportFailure('Stop all plans', error);
                    });
                return;
            }
            case 'step.retryRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.retryStep(msg.stepId, msg.notes).catch((error: unknown) => {
                    this.reportFailure('Retry step', error);
                });
                return;
            }
            case 'step.overrideRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.overrideStepDone(msg.stepId).catch((error: unknown) => {
                    this.reportFailure('Mark step done', error);
                });
                return;
            }
            case 'step.skipRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository.skipStep(msg.stepId, msg.reason).catch((error: unknown) => {
                    this.reportFailure('Skip step', error);
                });
                return;
            }
            case 'toolCalls.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listToolCallsForConv(msg.conversationId)
                    .then((toolCalls) => {
                        this.deps.bus.post({
                            type: 'toolCalls.updated',
                            hostId: msg.hostId,
                            conversationId: msg.conversationId,
                            toolCalls,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listToolCalls failed', {
                            convId: msg.conversationId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'activity.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                const fetchPromise =
                    msg.scopeKind === 'project'
                        ? repository.activityForProject(msg.scopeId)
                        : msg.scopeKind === 'conversation'
                          ? repository.activityForConversation(msg.scopeId)
                          : repository.activityByTurn(msg.scopeId);
                void fetchPromise
                    .then((events) => {
                        this.deps.bus.post({
                            type: 'activity.updated',
                            hostId: msg.hostId,
                            scopeKind: msg.scopeKind,
                            scopeId: msg.scopeId,
                            events,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: activity fetch failed', {
                            scopeId: msg.scopeId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'polls.requested': {
                if (this.deps.connectionManager.repositoryFor(msg.hostId) === undefined) return;
                void this.refreshPolls(msg.hostId, msg.conversationId).catch((error: unknown) => {
                    this.reportFailure('Load polls', error);
                });
                return;
            }
            case 'poll.startRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .startPoll(
                        msg.conversationId,
                        msg.question,
                        msg.options,
                        msg.mode,
                        msg.closesInMinutes,
                    )
                    .then(() => this.refreshPolls(msg.hostId, msg.conversationId))
                    .catch((error: unknown) => {
                        this.reportFailure('Start poll', error);
                    });
                return;
            }
            case 'poll.voteRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .castPollVote(msg.pollId, msg.optionId, undefined)
                    .then(() => repository.getPollResults(msg.pollId))
                    .then((poll) => {
                        if (poll !== undefined)
                            this.deps.connectionManager.notifyPollChanged(msg.hostId, poll);
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Vote', error);
                    });
                return;
            }
            case 'poll.closeRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .closePoll(msg.pollId)
                    .then(() => repository.getPollResults(msg.pollId))
                    .then((poll) => {
                        if (poll !== undefined)
                            this.deps.connectionManager.notifyPollChanged(msg.hostId, poll);
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Close poll', error);
                    });
                return;
            }
            case 'media.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void Promise.all([
                    repository.listImagesForConv(msg.conversationId).catch(() => []),
                    repository.listAudioForConv(msg.conversationId).catch(() => []),
                    repository.listArtifactsForConv(msg.conversationId).catch(() => []),
                ]).then(([images, audio, artifacts]) => {
                    this.deps.bus.post({
                        type: 'media.updated',
                        hostId: msg.hostId,
                        conversationId: msg.conversationId,
                        images,
                        audio,
                        artifacts,
                    });
                });
                return;
            }
            case 'mcp.serverTools.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listMcpServerTools(msg.serverName)
                    .then((tools) => {
                        this.deps.bus.post({
                            type: 'mcp.serverTools.updated',
                            hostId: msg.hostId,
                            serverName: msg.serverName,
                            tools,
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Load server tools', error);
                    });
                return;
            }
            case 'skill.detail.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .getSkill(msg.skillId)
                    .then((skill) => {
                        if (skill !== undefined) {
                            this.deps.bus.post({
                                type: 'skill.detail.updated',
                                hostId: msg.hostId,
                                skill,
                            });
                        }
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Load skill', error);
                    });
                return;
            }
            case 'heartbeat.runs.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listRecentHeartbeatRuns(msg.configId)
                    .then((runs) => {
                        this.deps.bus.post({
                            type: 'heartbeat.runs.updated',
                            hostId: msg.hostId,
                            configId: msg.configId,
                            runs,
                        });
                    })
                    .catch((error: unknown) => {
                        this.reportFailure('Load heartbeat runs', error);
                    });
                return;
            }
            case 'projectTemplates.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listLandingProjectTemplates()
                    .then((templates) => {
                        this.deps.bus.post({
                            type: 'projectTemplates.updated',
                            hostId: msg.hostId,
                            templates,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listLandingProjectTemplates failed', {
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'projectTemplate.createProjectRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) {
                    this.deps.bus.post({
                        type: 'error',
                        message: 'Not connected. Open Settings → Connect first.',
                    });
                    // Unlock the Quick Start sheet, which waits for a result.
                    this.deps.bus.post({
                        type: 'projectTemplate.createFailed',
                        hostId: msg.hostId,
                        templateId: msg.templateId,
                        message: 'Not connected to the host.',
                    });
                    return;
                }
                // project_template.create_project stores each member's
                // provider / model / tool overrides itself. (A follow-up
                // folder.members.set must not be used: the host rebuilds
                // the roster from agent / alias / coordinator only, which
                // would wipe those overrides.)
                const customisations = {
                    name: msg.name,
                    goal: msg.goal,
                    description: msg.description,
                    scenario: msg.scenario,
                    members: msg.members.map((m) => ({
                        agentId: m.agentId,
                        alias: m.alias,
                        isCoordinator: m.isCoordinator,
                        modelProvider: m.modelProvider,
                        modelName: m.modelName,
                        allowedTools: m.allowedTools,
                    })),
                };
                const repo = repository;
                void repo
                    .createProjectFromTemplate(msg.templateId, customisations)
                    .then((folderId) => {
                        // Member count is what the user actually
                        // submitted from the Quick Start form. Name
                        // falls back to "New project" if the user
                        // cleared it (host defaults to template name
                        // in that case; the kickoff sheet's copy is
                        // tolerant of either).
                        const folderName = msg.name.length > 0 ? msg.name : 'New project';
                        this.deps.bus.post({
                            type: 'projectTemplate.projectCreated',
                            hostId: msg.hostId,
                            folderId,
                            folderName,
                            memberCount: msg.members.length,
                        });
                        // Eagerly fetch the new folder's members so the
                        // rail / landing show the roster immediately
                        // instead of waiting for the next Chat-tab visit.
                        void repo
                            .listFolderMembers(folderId)
                            .then((members) => {
                                this.deps.projectStore.replaceMembers(
                                    msg.hostId,
                                    folderId,
                                    members,
                                );
                                this.deps.bus.post({
                                    type: 'folder.members.updated',
                                    hostId: msg.hostId,
                                    folderId,
                                    members,
                                });
                            })
                            .catch(() => undefined);
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: createProjectFromTemplate failed', {
                            templateId: msg.templateId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Create from template failed: ${errorText(error)}`,
                        });
                        this.deps.bus.post({
                            type: 'projectTemplate.createFailed',
                            hostId: msg.hostId,
                            templateId: msg.templateId,
                            message: `Create failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'projectTemplates.allRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .listProjectTemplates()
                    .then((templates) => {
                        this.deps.bus.post({
                            type: 'projectTemplates.allUpdated',
                            hostId: msg.hostId,
                            templates,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: listProjectTemplates failed', {
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'template.roster.requested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .getProjectTemplateRoster(msg.templateId)
                    .then((members) => {
                        this.deps.bus.post({
                            type: 'template.roster.updated',
                            hostId: msg.hostId,
                            templateId: msg.templateId,
                            members,
                        });
                    })
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: getProjectTemplateRoster failed', {
                            templateId: msg.templateId,
                            error: errorText(error),
                        });
                    });
                return;
            }
            case 'template.pinRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .setProjectTemplatePinned(msg.templateId, msg.pinned)
                    .then(() => this.refreshTemplateCatalogs(msg.hostId))
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: setProjectTemplatePinned failed', {
                            templateId: msg.templateId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Pin template failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'template.saveAsNewRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .saveAsNewProjectTemplate(msg.sourceTemplateId, {
                        name: msg.name,
                        scenario: msg.scenario,
                        goal: msg.goal,
                        description: msg.description,
                        members: msg.members,
                    })
                    .then(() => this.refreshTemplateCatalogs(msg.hostId))
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: saveAsNewProjectTemplate failed', {
                            sourceTemplateId: msg.sourceTemplateId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Save template failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'template.deleteRequested': {
                const repository = this.deps.connectionManager.repositoryFor(msg.hostId);
                if (repository === undefined) return;
                void repository
                    .deleteUserProjectTemplate(msg.templateId)
                    .then(() => this.refreshTemplateCatalogs(msg.hostId))
                    .catch((error: unknown) => {
                        this.deps.logger.warn('WebviewSync: deleteUserProjectTemplate failed', {
                            templateId: msg.templateId,
                            error: errorText(error),
                        });
                        this.deps.bus.post({
                            type: 'error',
                            message: `Delete template failed: ${errorText(error)}`,
                        });
                    });
                return;
            }
            case 'ide.applyEditRequested':
                // Translate the webview envelope into a regular
                // vscode.commands invocation so the ApplyEditCommand
                // module owns the workspace-edit logic in one place.
                // Without this dispatch the envelope is silently
                // dropped — the user clicks Apply, nothing happens.
                void vscode.commands.executeCommand('verzeta.applyEdit', {
                    targetPath: msg.targetPath,
                    language: msg.language,
                    content: msg.content,
                });
                return;
            case 'ide.openCanvasRequested':
                // Same shape as applyEdit — the webview-facing
                // envelope just unwraps into a command invocation
                // that the CanvasDocumentProvider module owns.
                void vscode.commands.executeCommand('verzeta.openCanvasInEditor', {
                    hostId: msg.hostId,
                    conversationId: msg.conversationId,
                });
                return;
            case 'ide.addContextRequested':
                // "Add Context" from the composer "+" menu — runs the
                // workspace-file quick-pick; the AttachFileCommand module
                // stages the picked files back as attachment chips.
                void vscode.commands.executeCommand('verzeta.addContext');
                return;
            case 'ide.dropUrisRequested':
                // Explorer/editor file-drop on the composer — the
                // AttachFileCommand module reads each URI and stages it.
                void vscode.commands.executeCommand('verzeta.attachUris', msg.uris);
                return;
            default:
                ((_: never) => undefined)(msg);
        }
    }

    /**
     * Log a failed request and show it in the webview's error banner, so
     * a button the host refused does not look like it did nothing.
     *
     * @param action short label, for example "Vote"; shown as "Vote failed: ...".
     * @param error what the request threw.
     */
    private reportFailure(action: string, error: unknown): void {
        this.deps.logger.warn(`WebviewSync: ${action} failed`, { error: errorText(error) });
        this.deps.bus.post({ type: 'error', message: `${action} failed: ${errorText(error)}` });
    }

    /** Re-read a conversation's polls and push them to the webview. */
    private refreshPolls(hostId: string, conversationId: string): Promise<void> {
        const repository = this.deps.connectionManager.repositoryFor(hostId);
        if (repository === undefined) return Promise.resolve();
        return repository.listPollsForConversation(conversationId).then((polls) => {
            this.pollsByConv.set(`${hostId}::${conversationId}`, polls.slice());
            this.deps.bus.post({ type: 'polls.updated', hostId, conversationId, polls });
        });
    }

    /**
     * Whether a cached conversation is a group chat, or `undefined` when
     * it is not cached (the repository then asks the host).
     */
    private isGroupConversation(hostId: string, conversationId: string): boolean | undefined {
        return this.deps.conversationStore.findById(hostId, conversationId)?.isGroup;
    }

    /**
     * Re-fetch BOTH the landing list and the full catalog after any
     * template mutation. Keeps both caches in sync regardless of which
     * UI is currently showing.
     */
    private refreshTemplateCatalogs(hostId: string): void {
        const repository = this.deps.connectionManager.repositoryFor(hostId);
        if (repository === undefined) return;
        void repository
            .listLandingProjectTemplates()
            .then((templates) => {
                this.deps.bus.post({
                    type: 'projectTemplates.updated',
                    hostId,
                    templates,
                });
            })
            .catch(() => undefined);
        void repository
            .listProjectTemplates()
            .then((templates) => {
                this.deps.bus.post({
                    type: 'projectTemplates.allUpdated',
                    hostId,
                    templates,
                });
            })
            .catch(() => undefined);
    }
}

/**
 * Create a conversation on `hostId` and make it the active one, so the
 * wire layer subscribes to its messages. Shared by the webview's New chat
 * button and the `verzeta.newConversation` command; the caller then tells
 * its webview(s) to open the new id.
 *
 * @param deps the connection manager and conversation store.
 * @param hostId the host to create the conversation on.
 * @returns the new conversation id.
 * @throws when the host is not connected or rejects the create.
 */
export async function createAndActivateConversation(
    deps: Pick<WebviewSyncDeps, 'connectionManager' | 'conversationStore'>,
    hostId: string,
): Promise<string> {
    const repository = deps.connectionManager.repositoryFor(hostId);
    if (repository === undefined) throw new Error('Not connected to the host.');
    const convId = await repository.createConversation();
    deps.conversationStore.setActiveConversationId(convId);
    return convId;
}

function toMessageRow(m: MessageUi): MessageRowUi {
    return {
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        thinkingContent: m.thinkingContent ?? '',
        createdAt: m.createdAt,
        modelUsed: m.modelUsed ?? '',
        tokenCount: m.tokenCount ?? 0,
        finishReason: m.finishReason ?? '',
        agentId: m.agentId,
        memberAlias: m.memberAlias,
    };
}

function errorText(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}

/**
 * Allow-list of VS Code commands the webview can invoke. The
 * defence-in-depth check inside `host.commandRequested` prevents a
 * compromised webview from calling arbitrary commands via the bus.
 */
const ALLOWED_COMMANDS = new Set<string>([
    'verzeta.addHost',
    'verzeta.removeHost',
    'verzeta.pair',
    'verzeta.newConversation',
    'verzeta.openOutputChannel',
]);
