// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * WireSync — bridges RemoteSession events to ConversationStore +
 * ProjectStore mutations, and seeds those stores from the host's
 * `conv.list` + `folder.list_all` ops the moment a connection
 * authenticates.
 *
 * One instance per extension activation; it observes every
 * `sessionReady` emission from ConnectionManager and wires up a
 * per-host event subscription. When a host disconnects (and its
 * wire is torn down), the subscription disposes itself naturally
 * because the session that emitted them is gone.
 *
 * Several host events carry only ids (`folder.members.changed`,
 * `step.updated`, `poll.*`). For those, WireSync fetches the current
 * rows and forwards them, rather than trusting a payload that does not
 * hold the data.
 */

import type { Disposable } from '../infra/disposables.js';
import { DisposableStore } from '../infra/disposables.js';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';
import type { Logger } from '../log/Logger.js';
import type { RemoteEvent } from '../../shared/wire-envelope.js';
import type { RemoteRepository } from '../wire/RemoteRepository.js';
import type { ContextFillStore } from './ContextFillStore.js';
import type { ConversationStore } from './ConversationStore.js';
import type { MessageStore } from './MessageStore.js';
import type { ProjectStore } from './ProjectStore.js';
import type { MessageUi } from '../../shared/wire-types.js';
import {
    arrayOf,
    booleanOr,
    isJsonObject,
    optionalString,
    parseAgentRunState,
    parseAgentStep,
    parseConversation,
    parseFolder,
    parseHeartbeatConfig,
    parseMember,
    parseMessage,
    parsePendingToolConfirmation,
    parsePlan,
    parseStep,
    parseStreamingAborted,
    parseStreamingDelta,
    parseStreamingStarted,
    parseToolCallLog,
    stringOr,
} from '../wire/RemoteJson.js';
import type { ConvSettingsUi } from '../../shared/wire-types.js';

export interface WireSyncDeps {
    readonly connectionManager: ConnectionManager;
    readonly conversationStore: ConversationStore;
    readonly projectStore: ProjectStore;
    readonly messageStore: MessageStore;
    readonly contextFillStore: ContextFillStore;
    readonly logger: Logger;
    /**
     * @user mention hook (host event `chat.user_mentioned`). The host
     * deliberately does NOT filter this by the msg.subscribe set — a
     * mention must reach the user when the conversation is closed.
     * Suppression (conversation currently focused) is the consumer's
     * decision, mirroring Android's MentionNotifier seam.
     */
    readonly onUserMentioned?: (
        hostId: string,
        conversationId: string,
        alias: string,
        text: string,
    ) => void;
}

export class WireSync implements Disposable {
    private readonly deps: WireSyncDeps;
    private readonly subs = new DisposableStore();
    private readonly perHost = new Map<string, () => void>();
    private disposed = false;

    constructor(deps: WireSyncDeps) {
        this.deps = deps;
        const onReady = (hostId: string, repository: RemoteRepository): void => {
            this.attachHost(hostId, repository);
        };
        const onState = (hostId: string, state: string): void => {
            if (state === 'disconnected' || state === 'error' || state === 'unauthorized') {
                this.detachHost(hostId);
            }
        };
        deps.connectionManager.on('sessionReady', onReady);
        deps.connectionManager.on('stateChanged', onState);
        this.subs.add({
            dispose: () => {
                deps.connectionManager.off('sessionReady', onReady);
                deps.connectionManager.off('stateChanged', onState);
            },
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const unsubscribe of this.perHost.values()) {
            unsubscribe();
        }
        this.perHost.clear();
        this.subs.dispose();
    }

    private attachHost(hostId: string, repository: RemoteRepository): void {
        if (this.disposed) return;
        // Drop any previous subscription for the same host.
        this.detachHost(hostId);
        const session = this.deps.connectionManager.sessionFor(hostId);
        if (session === undefined) {
            this.deps.logger.warn('WireSync: session missing on sessionReady', { hostId });
            return;
        }
        const unsubEvent = session.onEvent((event) => {
            this.dispatch(hostId, event);
        });
        this.perHost.set(hostId, unsubEvent);
        void this.seedHost(hostId, repository);
    }

    private detachHost(hostId: string): void {
        const unsub = this.perHost.get(hostId);
        if (unsub === undefined) return;
        this.perHost.delete(hostId);
        unsub();
    }

    private async seedHost(hostId: string, repository: RemoteRepository): Promise<void> {
        try {
            const [convs, folders] = await Promise.all([
                repository.listConversations(),
                repository.listAllFolders(),
            ]);
            this.deps.conversationStore.replace(hostId, convs);
            this.deps.projectStore.replaceFolders(hostId, folders);
            this.deps.logger.info('WireSync: host seeded', {
                hostId,
                conversations: convs.length,
                folders: folders.length,
            });
            // Mirrors Android `MainViewModel.primeProjectFoldersForSidebar`
            // (lines 1209-1230): every project / organization folder gets
            // its members loaded on connect so the sidebar's TEAM MEMBERS
            // subsection renders without a per-row lazy fetch. Failures
            // per-folder do not block the others (Promise.allSettled).
            const projectFolders = folders.filter((f) => f.folderType !== 'regular');
            await Promise.allSettled(
                projectFolders.map(async (folder) => {
                    try {
                        const members = await repository.listFolderMembers(folder.id);
                        this.deps.projectStore.replaceMembers(hostId, folder.id, members);
                    } catch (error) {
                        this.deps.logger.debug('WireSync: folder.members load failed', {
                            hostId,
                            folderId: folder.id,
                            error: errorText(error),
                        });
                    }
                }),
            );
        } catch (error) {
            this.deps.logger.warn('WireSync: seed failed', {
                hostId,
                error: errorText(error),
            });
        }
    }

    /** Re-read a folder roster and store it. Failures are logged. */
    private refreshFolderMembers(hostId: string, folderId: string): void {
        const repo = this.deps.connectionManager.repositoryFor(hostId);
        if (repo === undefined) return;
        void repo
            .listFolderMembers(folderId)
            .then((members) => {
                this.deps.projectStore.replaceMembers(hostId, folderId, members);
            })
            .catch((error: unknown) => {
                this.deps.logger.warn('WireSync: folder.members refresh failed', {
                    hostId,
                    folderId,
                    error: errorText(error),
                });
            });
    }

    /** Fetch one poll with its tallies and forward it. Failures are logged. */
    private refreshPoll(hostId: string, pollId: string): void {
        const repo = this.deps.connectionManager.repositoryFor(hostId);
        if (repo === undefined) return;
        void repo
            .getPollResults(pollId)
            .then((poll) => {
                if (poll !== undefined) this.deps.connectionManager.notifyPollChanged(hostId, poll);
            })
            .catch((error: unknown) => {
                this.deps.logger.warn('WireSync: poll refresh failed', {
                    hostId,
                    pollId,
                    error: errorText(error),
                });
            });
    }

    private dispatch(hostId: string, event: RemoteEvent): void {
        // Log every event at info level so the user can confirm
        // streaming events are reaching us. The previous "messages
        // don't appear until reload" symptom was diagnosed largely by
        // the absence of these lines in the Verzeta output channel.
        this.deps.logger.info('WireSync: event', {
            hostId,
            event: event.event,
        });
        switch (event.event) {
            case 'conv.added':
            case 'conv.updated': {
                const conv = parseConversation(event.data);
                if (conv !== undefined) {
                    this.deps.conversationStore.upsertOne(hostId, conv);
                }
                return;
            }
            case 'conv.renamed': {
                if (!isJsonObject(event.data)) return;
                // Host's enrichConvEvent injects the full row INTO the
                // raw args, so both `conv_id` (canonical from args) and
                // `id` (from the enriched conversations row) end up
                // present. Prefer the canonical key but accept either.
                const id =
                    optionalString(event.data['conv_id']) ?? optionalString(event.data['id']);
                if (id === undefined) return;
                const existing = this.deps.conversationStore.findById(hostId, id);
                if (existing === undefined) return;
                const title = stringOr(event.data['title'], existing.title);
                this.deps.conversationStore.upsertOne(hostId, { ...existing, title });
                return;
            }
            case 'conv.deleted': {
                if (!isJsonObject(event.data)) return;
                // Host sends raw `args = {conv_id}` for ConversationDeleted
                // — no enrichConvEvent here (the row is already gone),
                // so the only key on the payload is `conv_id`. Reading
                // `id` returned undefined and the local store kept the
                // ghost row around. Accept either key for robustness.
                const id =
                    optionalString(event.data['conv_id']) ?? optionalString(event.data['id']);
                if (id !== undefined) {
                    this.deps.conversationStore.removeOne(hostId, id);
                }
                return;
            }
            case 'folder.added':
            case 'folder.updated':
            case 'folder.renamed': {
                const folder = parseFolder(event.data);
                if (folder !== undefined) {
                    this.deps.projectStore.upsertFolder(hostId, folder);
                    // Auto-fetch members for project / organization
                    // folders so the rail and Project Rooms landing
                    // can show the roster immediately. The host emits
                    // folder.members.changed too but only after the
                    // first explicit fetch on most paths; this makes
                    // the UI feel instant rather than empty-on-first-
                    // view.
                    if (
                        event.event === 'folder.added' &&
                        (folder.folderType === 'project' || folder.folderType === 'organization')
                    ) {
                        const repo = this.deps.connectionManager.repositoryFor(hostId);
                        if (repo !== undefined) {
                            void repo
                                .listFolderMembers(folder.id)
                                .then((members) => {
                                    this.deps.projectStore.replaceMembers(
                                        hostId,
                                        folder.id,
                                        members,
                                    );
                                })
                                .catch((error: unknown) => {
                                    this.deps.logger.warn('WireSync: auto-fetch members failed', {
                                        folderId: folder.id,
                                        error:
                                            error instanceof Error ? error.message : String(error),
                                    });
                                });
                        }
                    }
                }
                return;
            }
            case 'folder.deleted': {
                if (!isJsonObject(event.data)) return;
                // Host sends raw `args = {folder_id}` for FolderDeleted
                // — same shape as conv.deleted. Reading `id` returned
                // undefined and the project store kept the deleted
                // folder around. Accept either key.
                const id =
                    optionalString(event.data['folder_id']) ?? optionalString(event.data['id']);
                if (id !== undefined) {
                    this.deps.projectStore.removeFolder(hostId, id);
                }
                return;
            }
            case 'folder.members.changed': {
                // The host sends only `{folder_id}`, so re-read the roster.
                // Storing the (absent) payload list would wipe the roster.
                if (!isJsonObject(event.data)) return;
                const folderId = optionalString(event.data['folder_id']);
                if (folderId === undefined) return;
                this.refreshFolderMembers(hostId, folderId);
                return;
            }
            case 'message.added':
            case 'message.updated':
            case 'msg.added':
            case 'msg.updated': {
                const msg = parseMessage(event.data);
                if (msg !== undefined) {
                    this.deps.logger.debug(`WireSync: ${event.event} received`, {
                        hostId,
                        convId: msg.conversationId,
                        msgId: msg.id,
                        role: msg.role,
                        turnId: msg.turnId,
                        contentLen: msg.content.length,
                        contentHead: msg.content.slice(0, 32),
                    });
                    this.deps.messageStore.upsertOne(msg.conversationId, msg);
                } else {
                    this.deps.logger.warn(`WireSync: ${event.event} — could not parse`, { hostId });
                }
                return;
            }
            case 'message.deleted':
            case 'msg.deleted': {
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conversation_id']) ??
                    optionalString(event.data['conv_id']);
                const msgId =
                    optionalString(event.data['message_id']) ?? optionalString(event.data['id']);
                if (convId !== undefined && msgId !== undefined) {
                    this.deps.messageStore.removeOne(convId, msgId);
                }
                return;
            }
            case 'message.streaming.started':
            case 'msg.streaming.started':
            case 'streaming.started': {
                const payload = parseStreamingStarted(event.data);
                if (payload === undefined) {
                    this.deps.logger.warn('WireSync: streaming.started — could not parse', {
                        data: event.data,
                    });
                    return;
                }
                const placeholder: MessageUi = {
                    id: payload.messageId,
                    conversationId: payload.conversationId,
                    role: 'assistant',
                    content: '',
                    createdAt: Date.now(),
                    finishReason: '',
                    agentId: payload.agentId,
                    memberAlias: payload.memberAlias,
                    turnId: payload.turnId,
                    thinkingContent: '',
                };
                this.deps.messageStore.upsertPlaceholder(payload.conversationId, placeholder);
                return;
            }
            case 'message.streaming.delta':
            case 'msg.streaming.delta':
            case 'streaming.delta': {
                const payload = parseStreamingDelta(event.data);
                if (payload === undefined) {
                    this.deps.logger.warn('WireSync: streaming.delta — could not parse', {
                        data: event.data,
                    });
                    return;
                }
                this.deps.messageStore.appendDelta(
                    payload.conversationId,
                    payload.messageId,
                    payload.delta,
                    payload.thinkingDelta,
                );
                return;
            }
            case 'message.streaming.aborted':
            case 'msg.streaming.aborted':
            case 'streaming.aborted': {
                const payload = parseStreamingAborted(event.data);
                if (payload === undefined) return;
                this.deps.messageStore.markFinalized(
                    payload.conversationId,
                    payload.messageId,
                    payload.reason,
                );
                return;
            }
            case 'chat.context_fill.changed': {
                // Context-gauge feed — host measures the prompt's
                // context-window fill at each request build.
                if (!isJsonObject(event.data)) return;
                const convId = optionalString(event.data['conv_id']);
                const rawPercent = event.data['percent'];
                if (convId === undefined || typeof rawPercent !== 'number') return;
                this.deps.contextFillStore.set(hostId, convId, rawPercent);
                return;
            }
            case 'chat.user_mentioned': {
                // Host pushes this UNFILTERED by msg.subscribe on
                // purpose; suppression is ours. See WireSyncDeps.
                if (!isJsonObject(event.data)) return;
                const convId = optionalString(event.data['conv_id']);
                if (convId === undefined) return;
                const alias = stringOr(event.data['alias'], '');
                const text = stringOr(event.data['text'], '');
                this.deps.onUserMentioned?.(hostId, convId, alias, text);
                return;
            }
            case 'heartbeat.config.changed': {
                // Host emits when ANY client upserts a heartbeat config.
                // We re-route through ConnectionManager so WebviewSync
                // can patch the cached heartbeat list without a full
                // refetch. Scope id (folderId) lives on the config row.
                const config = parseHeartbeatConfig(event.data);
                if (config === undefined) return;
                this.deps.connectionManager.notifyHeartbeatConfigChanged(hostId, config);
                return;
            }
            case 'heartbeat.config.removed': {
                if (!isJsonObject(event.data)) return;
                const id =
                    optionalString(event.data['id']) ??
                    optionalString(event.data['heartbeat_id']) ??
                    optionalString(event.data['config_id']);
                if (id === undefined) return;
                const scopeId = stringOr(event.data['scope_id'] ?? event.data['folder_id'], '');
                this.deps.connectionManager.notifyHeartbeatConfigRemoved(hostId, id, scopeId);
                return;
            }
            case 'plan.created':
            case 'plan.updated': {
                const plan = parsePlan(event.data);
                if (plan === undefined) return;
                this.deps.connectionManager.notifyPlanChanged(hostId, plan);
                return;
            }
            case 'plan.deleted': {
                if (!isJsonObject(event.data)) return;
                const id = optionalString(event.data['id']);
                const convId =
                    optionalString(event.data['conversation_id']) ??
                    optionalString(event.data['conv_id']) ??
                    '';
                if (id === undefined) return;
                this.deps.connectionManager.notifyPlanRemoved(hostId, id, convId);
                return;
            }
            case 'step.updated': {
                // Host payload is `{step_id, plan_id}`; the plan id is what
                // the refetch needs.
                if (!isJsonObject(event.data)) return;
                const planId =
                    optionalString(event.data['plan_id']) ??
                    optionalString(event.data['planId']) ??
                    parseStep(event.data)?.planId;
                if (planId === undefined || planId.length === 0) return;
                this.deps.connectionManager.notifyStepUpdated(hostId, planId);
                return;
            }
            case 'poll.created':
            case 'poll.updated':
            case 'poll.closed':
            case 'poll.vote_cast': {
                // Host payload is `{conv_id, poll_id, ...}` with no poll
                // body, so fetch the current poll with its tallies.
                if (!isJsonObject(event.data)) return;
                const pollId =
                    optionalString(event.data['poll_id']) ?? optionalString(event.data['id']);
                if (pollId === undefined) return;
                this.refreshPoll(hostId, pollId);
                return;
            }
            case 'tool_call.requested': {
                // Host wants the user to confirm a tool call before
                // execution (per-conv `agent.require_confirmation`).
                // Mirrors Android `handleToolCallRequested`
                // (MainViewModel.kt:3839). Modal is host-level — it
                // surfaces regardless of which conv is foregrounded.
                const pending = parsePendingToolConfirmation(event.data);
                if (pending === undefined) return;
                this.deps.connectionManager.notifyToolCallRequested(hostId, pending);
                return;
            }
            case 'tool_call.completed': {
                if (!isJsonObject(event.data)) return;
                const callId =
                    optionalString(event.data['call_id']) ??
                    optionalString(event.data['callId']) ??
                    optionalString(event.data['id']);
                if (callId === undefined) return;
                this.deps.connectionManager.notifyToolCallCompleted(hostId, callId);
                return;
            }
            case 'agent.step.started':
            case 'agent.step.completed': {
                // Two events drive one banner row each. Started → the
                // step appears with status=running. Completed →
                // its status flips to success/error. Mirrors
                // Android `handleAgentStepStarted` /
                // `handleAgentStepCompleted` (MainViewModel.kt:3869, 3883).
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conversation_id']) ??
                    optionalString(event.data['conv_id']) ??
                    '';
                const step = parseAgentStep(event.data, convId);
                if (step === undefined) return;
                // Started always means running. Completed reads the host's
                // `success` bool, or a `status` string when present.
                let finalStatus: typeof step.status;
                if (event.event === 'agent.step.started') {
                    finalStatus = 'running';
                } else {
                    finalStatus = agentStepSucceeded(event.data) ? 'success' : 'error';
                }
                this.deps.connectionManager.notifyAgentStepUpdated(hostId, {
                    ...step,
                    status: finalStatus,
                });
                return;
            }
            case 'agent.run.state': {
                const runState = parseAgentRunState(event.data);
                if (runState === undefined) return;
                this.deps.connectionManager.notifyAgentRunStateChanged(hostId, runState);
                return;
            }
            case 'models.active_changed':
            case 'models.activeChanged': {
                // Host fired when ANY paired client (mobile, desktop,
                // other VS Code) switched the active provider+model.
                // Forward through ConnectionManager so WebviewSync(s)
                // can update the cached catalog + chat-header subtitle.
                if (!isJsonObject(event.data)) return;
                const activeProvider = stringOr(
                    event.data['active_provider'] ?? event.data['activeProvider'],
                    '',
                );
                const activeModel = stringOr(
                    event.data['active_model'] ?? event.data['activeModel'],
                    '',
                );
                this.deps.connectionManager.notifyModelsActiveChanged(
                    hostId,
                    activeProvider,
                    activeModel,
                );
                return;
            }
            case 'tool_call.added':
            case 'tool_call.updated': {
                // Live tool-call card refresh during streaming. Host
                // sends the enriched row (matches `tool_call.get`
                // shape). Forward through ConnectionManager so
                // WebviewSync can patch the cached per-conv list.
                const toolCall = parseToolCallLog(event.data);
                if (toolCall !== undefined) {
                    this.deps.connectionManager.notifyToolCallChanged(hostId, toolCall);
                }
                return;
            }
            case 'conv.members.changed': {
                // Chat-header member list refresh after a roster edit
                // from any client. Host payload mirrors
                // `folder.members.changed` but with `conv_id`.
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conv_id']) ??
                    optionalString(event.data['conversation_id']);
                if (convId === undefined) return;
                const members = arrayOf(event.data['members'], parseMember);
                this.deps.connectionManager.notifyConvMembersChanged(hostId, convId, members);
                return;
            }
            case 'conv.settings.changed': {
                // The host's activeConversationSettingsChanged signal is
                // PARAMETERLESS, so the bridge forwards this event with an
                // empty payload — no conv_id, no values. We therefore
                // cannot read which conversation changed from the event.
                // Fall back to the conversation THIS client is currently
                // viewing and let WebviewSync.onConvSettingsChanged
                // refetch its full settings. If the desktop changed the
                // same conversation we're viewing — the case the user
                // cares about — the pills + settings sheet update live;
                // if it changed a different one, refetching ours is a
                // harmless no-op. (Pure wire-client behaviour; no host
                // change.)
                const payload = isJsonObject(event.data) ? event.data : {};
                const convId =
                    optionalString(payload['conv_id']) ??
                    optionalString(payload['conversation_id']) ??
                    this.deps.conversationStore.activeConversationId();
                if (convId === undefined) return;
                // ConvSettingsUi is fully `readonly`; build the partial
                // as a fresh object literal rather than property
                // assignment to keep the immutability contract.
                const sp = optionalString(payload['systemPrompt']);
                const temp = payload['temperature'];
                const mt = payload['maxTokens'];
                const cw = payload['contextWindow'];
                const st = payload['streaming'];
                const th = payload['thinking'];
                const partial: Partial<ConvSettingsUi> = {
                    ...(sp !== undefined ? { systemPrompt: sp } : {}),
                    ...(typeof temp === 'number' ? { temperature: temp } : {}),
                    ...(typeof mt === 'number' ? { maxTokens: mt } : {}),
                    ...(typeof cw === 'number' ? { contextWindow: cw } : {}),
                    ...(typeof st === 'boolean' ? { streaming: st } : {}),
                    ...(typeof th === 'boolean' ? { thinking: th } : {}),
                };
                this.deps.connectionManager.notifyConvSettingsChanged(hostId, convId, partial);
                return;
            }
            case 'agent.pattern.changed': {
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conv_id']) ??
                    optionalString(event.data['conversation_id']);
                if (convId === undefined) return;
                const pattern = optionalString(event.data['pattern']) ?? 'direct';
                const validPatterns = [
                    'direct',
                    'react',
                    'planner',
                    'router',
                    'multi_agent',
                    'memory',
                ] as const;
                const cast = (validPatterns as readonly string[]).includes(pattern)
                    ? (pattern as (typeof validPatterns)[number])
                    : 'direct';
                this.deps.connectionManager.notifyConvSettingsChanged(hostId, convId, {
                    agentPattern: cast,
                });
                return;
            }
            case 'agent.require_confirmation.changed': {
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conv_id']) ??
                    optionalString(event.data['conversation_id']);
                if (convId === undefined) return;
                // Host envelope shape is `{require}` not `{require_confirmation}` (contract #10).
                const require = booleanOr(event.data['require'], false);
                this.deps.connectionManager.notifyConvSettingsChanged(hostId, convId, {
                    requireConfirmation: require,
                });
                return;
            }
            case 'tools.enabled.changed': {
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conv_id']) ??
                    optionalString(event.data['conversation_id']);
                if (convId === undefined) return;
                const enabled = booleanOr(event.data['enabled'], true);
                this.deps.connectionManager.notifyConvSettingsChanged(hostId, convId, {
                    toolsEnabled: enabled,
                });
                return;
            }
            // No `rag.enabled.changed` case: the host stopped emitting that event
            // when RAG became per-conversation, and the handler that lived here
            // fanned one flip across every cached conversation — the wrong model
            // now. Changes arrive on `conv.settings.changed`, scoped to one chat.
            case 'project_template.catalog_changed':
            case 'project_template.catalogChanged': {
                // Some client pinned / saved / deleted a template; the
                // template library + landing list should refresh so
                // every connected client stays in sync.
                this.deps.connectionManager.notifyProjectTemplateCatalogChanged(hostId);
                return;
            }
            case 'project_template.project_created':
            case 'project_template.projectCreated': {
                // The webview already drives KickoffSheet from the
                // create response (richer payload). The broadcast
                // event is logged but not re-emitted — would double-
                // open the kickoff sheet on the originating client.
                return;
            }
            case 'artifact.added': {
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conv_id']) ??
                    optionalString(event.data['conversation_id']);
                if (convId === undefined) return;
                this.deps.connectionManager.notifyMediaChanged(hostId, convId, 'artifact');
                return;
            }
            case 'image.generated': {
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conv_id']) ??
                    optionalString(event.data['conversation_id']);
                if (convId === undefined) return;
                this.deps.connectionManager.notifyMediaChanged(hostId, convId, 'image');
                return;
            }
            case 'audio.generated': {
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conv_id']) ??
                    optionalString(event.data['conversation_id']);
                if (convId === undefined) return;
                this.deps.connectionManager.notifyMediaChanged(hostId, convId, 'audio');
                return;
            }
            case 'models.refreshed': {
                this.deps.connectionManager.notifyModelsRefreshed(hostId);
                return;
            }
            case 'user.message.queued': {
                // The host only sends this to the client that sent the
                // message, so the notice always belongs to this user.
                this.deps.logger.debug('WireSync: user.message.queued', { hostId });
                this.deps.connectionManager.notifyUserMessageQueued(hostId);
                return;
            }
            case 'canvas.opened':
            case 'canvas.updated': {
                // Refresh any canvas editor tab open for this chat. The
                // host sends these only for conversations this client
                // subscribed to (the chat open in the view).
                if (!isJsonObject(event.data)) return;
                const convId =
                    optionalString(event.data['conv_id']) ??
                    optionalString(event.data['conversationId']);
                if (convId === undefined) return;
                this.deps.connectionManager.notifyCanvasChanged(hostId, convId);
                return;
            }
            case 'canvas.closed':
            case 'canvas.error':
            case 'canvas.run.state':
            case 'canvas.run.line': {
                // The editor tab shows content only; run output and
                // close state are not shown there. Logged for visibility.
                this.deps.logger.debug('WireSync: canvas event', {
                    hostId,
                    event: event.event,
                });
                return;
            }
            case 'hello':
            case 'error':
                // 'hello' is information only (host metadata); 'error'
                // is surfaced through RemoteSession.onError.
                return;
            default:
                // Unknown event types are tolerated silently (forward
                // compat). Log at debug for visibility during dev.
                this.deps.logger.debug('WireSync: ignoring event', { event: event.event });
        }
    }
}

/**
 * Whether an `agent.step.completed` payload reports success. The host
 * sends `success: bool`; a `status: 'error'` string is also honoured.
 */
export function agentStepSucceeded(data: Record<string, unknown>): boolean {
    const success = data['success'];
    if (typeof success === 'boolean') return success;
    return stringOr(data['status'], 'success') !== 'error';
}

function errorText(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}
