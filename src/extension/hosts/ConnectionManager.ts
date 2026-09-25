// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ConnectionManager — owns per-host RemoteSession + RemoteRepository
 * lifecycles and maps the wire-layer socket lifecycle to the UI-facing
 * `ConnectionState` FSM described in ConnectionState.ts.
 *
 * State mapping:
 *
 *   socket=idle                     → state=disconnected
 *   socket=connecting               → state=connecting
 *   socket=open + auth pending      → state=authenticating
 *   socket=open + auth ok           → state=connected
 *   socket=open + auth rejected     → state=unauthorized
 *   socket=closed                   → state=disconnected
 *   socket=failed                   → state=error
 *
 * Emits:
 *   - stateChanged(hostId, state)
 *   - activeHostChanged(hostId | undefined)
 *   - sessionReady(hostId, repository) — fires after auth.token
 *     succeeds; downstream wire-sync subscribers seed their caches
 *     from this signal.
 */

import * as vscode from 'vscode';
import { DisposableStore, type Disposable } from '../infra/disposables.js';
import { TypedEventEmitter } from '../infra/TypedEventEmitter.js';
import type { Logger } from '../log/Logger.js';
import { CONTEXT_KEY, SETTING } from '../settings/ConfigurationSchema.js';
import type { ConnectionState } from './ConnectionState.js';
import type { HostStore } from './HostStore.js';
import type { SecretStore } from './SecretStore.js';
import { parseEndpoint } from '../wire/RemoteEndpoint.js';
import { RemoteOpError, RemoteSession } from '../wire/RemoteSession.js';
import { RemoteRepository } from '../wire/RemoteRepository.js';
import type {
    AgentRunStateUi,
    AgentStepUi,
    ConvSettingsUi,
    HeartbeatConfigUi,
    MemberUi,
    PendingToolConfirmationUi,
    PlanUi,
    PollUi,
    ToolCallLogUi,
} from '../../shared/wire-types.js';

interface ConnectionManagerEvents extends Record<string, readonly unknown[]> {
    readonly stateChanged: readonly [hostId: string, state: ConnectionState];
    readonly activeHostChanged: readonly [hostId: string | undefined];
    readonly sessionReady: readonly [hostId: string, repository: RemoteRepository];
    /**
     * Emitted when WireSync sees a host-side `models.active_changed`
     * event. Carries the new active provider+model so WebviewSync
     * can push the canonical envelope to every resolved view without
     * a catalog refetch.
     */
    readonly modelsActiveChanged: readonly [
        hostId: string,
        activeProvider: string,
        activeModel: string,
    ];
    /**
     * Emitted when the host requests a tool-call confirmation. The
     * webview surfaces a modal — Approve / Deny route back through
     * the bus to `tool_call.approveRequested` / `denyRequested`.
     */
    readonly toolCallRequested: readonly [hostId: string, pending: PendingToolConfirmationUi];
    /** Emitted when a previously-pending tool call has been completed. */
    readonly toolCallCompleted: readonly [hostId: string, callId: string];
    /** Emitted on `agent.step.started` / `agent.step.completed` events. */
    readonly agentStepUpdated: readonly [hostId: string, step: AgentStepUi];
    /** Emitted on `agent.run.state` events. */
    readonly agentRunStateChanged: readonly [hostId: string, runState: AgentRunStateUi];
    /** Emitted on `heartbeat.config.changed` events. */
    readonly heartbeatConfigChanged: readonly [hostId: string, config: HeartbeatConfigUi];
    /**
     * Emitted on `heartbeat.config.removed` events. `scopeId` is the
     * folder id when known so the cache can drop the row from the
     * right per-folder bucket without a full refetch.
     */
    readonly heartbeatConfigRemoved: readonly [hostId: string, configId: string, scopeId: string];
    readonly planChanged: readonly [hostId: string, plan: PlanUi];
    readonly planRemoved: readonly [hostId: string, planId: string, convId: string];
    /** Emitted on `step.updated`; carries the id of the plan whose step changed. */
    readonly stepUpdated: readonly [hostId: string, planId: string];
    readonly pollChanged: readonly [hostId: string, poll: PollUi];
    /** Emitted on `tool_call.added` / `tool_call.updated` events — drives live tool-call card refreshes. */
    readonly toolCallChanged: readonly [hostId: string, toolCall: ToolCallLogUi];
    /** Emitted on `conv.members.changed` events — drives chat-header member list refreshes. */
    readonly convMembersChanged: readonly [
        hostId: string,
        conversationId: string,
        members: readonly MemberUi[],
    ];
    /**
     * Emitted on `conv.settings.changed` and the four per-conv setting
     * fan-out events (`agent.pattern.changed`,
     * `agent.require_confirmation.changed`, `tools.enabled.changed`,
     * `rag.enabled.changed`). When a partial settings payload arrives we
     * pass it through; downstream WebviewSync may refetch the full
     * settings map to populate fields the partial didn't cover.
     */
    readonly convSettingsChanged: readonly [
        hostId: string,
        conversationId: string,
        partial: Partial<ConvSettingsUi>,
    ];
    /** Emitted on `project_template.catalog_changed` — triggers a template list refetch. */
    readonly projectTemplateCatalogChanged: readonly [hostId: string];
    /** Emitted on `artifact.added` / `image.generated` / `audio.generated` events — drives media-panel refetches. */
    readonly mediaChanged: readonly [
        hostId: string,
        conversationId: string,
        kind: 'artifact' | 'image' | 'audio',
    ];
    /** Emitted on `models.refreshed` — host fired when the provider catalog changes (rare). */
    readonly modelsRefreshed: readonly [hostId: string];
    /** Emitted on `user.message.queued`: a message this client sent is waiting for the current reply. */
    readonly userMessageQueued: readonly [hostId: string];
    /** Emitted on `canvas.opened` / `canvas.updated`: a conversation's canvas content changed. */
    readonly canvasChanged: readonly [hostId: string, conversationId: string];
}

interface PerHostWire {
    readonly session: RemoteSession;
    readonly repository: RemoteRepository;
    /** Disposes the session-listener subscriptions for this host. */
    readonly unsubscribe: () => void;
}

export class ConnectionManager
    extends TypedEventEmitter<ConnectionManagerEvents>
    implements Disposable
{
    private readonly hostStore: HostStore;
    private readonly secretStore: SecretStore;
    private readonly logger: Logger;
    private readonly subs = new DisposableStore();

    private readonly wires = new Map<string, PerHostWire>();
    private readonly states = new Map<string, ConnectionState>();
    private readonly inFlight = new Set<string>();
    /**
     * Hosts the user explicitly asked to disconnect via the UI. Set
     * by `disconnect()` so the auto-reconnect path on the next socket
     * `closed` event can tell "user pressed Disconnect" from "the
     * wire dropped on its own". Cleared on the next successful
     * `connect()`. Mirrors Android's `attemptSilentReconnect` guard
     * at `MainViewModel.kt:660`.
     */
    private readonly userDisconnected = new Set<string>();
    /**
     * Pending silent-reconnect timer handles. Keyed by hostId; cleared
     * when the attempt fires or the host is disposed. Stored as raw
     * `setTimeout` handles since we need to `clearTimeout` from a
     * different code path than the one that scheduled them.
     */
    private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private activeHost: string | undefined;
    private disposed = false;

    constructor(hostStore: HostStore, secretStore: SecretStore, logger: Logger) {
        super();
        this.hostStore = hostStore;
        this.secretStore = secretStore;
        this.logger = logger;
        this.subs.add({
            dispose: () => {
                hostStore.off('changed', this.onHostsChanged);
            },
        });
        hostStore.on('changed', this.onHostsChanged);

        for (const host of hostStore.list()) {
            this.states.set(host.id, 'disconnected');
        }
        const defaultId = hostStore.defaultHostId();
        if (defaultId.length > 0 && this.states.has(defaultId)) {
            this.activeHost = defaultId;
        } else {
            this.activeHost = hostStore.list()[0]?.id;
        }
        void this.refreshContextKeys();
    }

    stateOf(hostId: string): ConnectionState {
        return this.states.get(hostId) ?? 'disconnected';
    }

    activeHostId(): string | undefined {
        return this.activeHost;
    }

    async setActiveHostId(hostId: string | undefined): Promise<void> {
        if (this.activeHost === hostId) return;
        this.activeHost = hostId;
        this.emit('activeHostChanged', hostId);
        await this.refreshContextKeys();
        // Auto-connect on host switch — matches the user's mental
        // model that picking a host in the dropdown means "go there".
        if (hostId !== undefined && this.stateOf(hostId) === 'disconnected') {
            void this.connect(hostId);
        }
    }

    repositoryFor(hostId: string): RemoteRepository | undefined {
        return this.wires.get(hostId)?.repository;
    }

    sessionFor(hostId: string): RemoteSession | undefined {
        return this.wires.get(hostId)?.session;
    }

    /**
     * Re-emit a model-active-change observation. Called by WireSync
     * whenever a host emits `models.active_changed`. Decoupled from
     * the wire layer so other subsystems (WebviewSync, future
     * persisted-cache layers) can listen without taking a WireSync
     * dependency.
     */
    notifyModelsActiveChanged(hostId: string, activeProvider: string, activeModel: string): void {
        if (this.disposed) return;
        this.emit('modelsActiveChanged', hostId, activeProvider, activeModel);
    }

    /** Re-emit a tool-call confirmation request observed by WireSync. */
    notifyToolCallRequested(hostId: string, pending: PendingToolConfirmationUi): void {
        if (this.disposed) return;
        this.emit('toolCallRequested', hostId, pending);
    }

    /** Re-emit a tool-call completion observed by WireSync. */
    notifyToolCallCompleted(hostId: string, callId: string): void {
        if (this.disposed) return;
        this.emit('toolCallCompleted', hostId, callId);
    }

    /** Re-emit an agent step update observed by WireSync. */
    notifyAgentStepUpdated(hostId: string, step: AgentStepUi): void {
        if (this.disposed) return;
        this.emit('agentStepUpdated', hostId, step);
    }

    /** Re-emit an agent run-state change observed by WireSync. */
    notifyAgentRunStateChanged(hostId: string, runState: AgentRunStateUi): void {
        if (this.disposed) return;
        this.emit('agentRunStateChanged', hostId, runState);
    }

    /** Re-emit a heartbeat-config change observed by WireSync. */
    notifyHeartbeatConfigChanged(hostId: string, config: HeartbeatConfigUi): void {
        if (this.disposed) return;
        this.emit('heartbeatConfigChanged', hostId, config);
    }

    /** Re-emit a heartbeat-config removal observed by WireSync. */
    notifyHeartbeatConfigRemoved(hostId: string, configId: string, scopeId: string): void {
        if (this.disposed) return;
        this.emit('heartbeatConfigRemoved', hostId, configId, scopeId);
    }

    notifyPlanChanged(hostId: string, plan: PlanUi): void {
        if (this.disposed) return;
        this.emit('planChanged', hostId, plan);
    }

    notifyPlanRemoved(hostId: string, planId: string, convId: string): void {
        if (this.disposed) return;
        this.emit('planRemoved', hostId, planId, convId);
    }

    notifyStepUpdated(hostId: string, planId: string): void {
        if (this.disposed) return;
        this.emit('stepUpdated', hostId, planId);
    }

    notifyPollChanged(hostId: string, poll: PollUi): void {
        if (this.disposed) return;
        this.emit('pollChanged', hostId, poll);
    }

    notifyToolCallChanged(hostId: string, toolCall: ToolCallLogUi): void {
        if (this.disposed) return;
        this.emit('toolCallChanged', hostId, toolCall);
    }

    notifyConvMembersChanged(
        hostId: string,
        conversationId: string,
        members: readonly MemberUi[],
    ): void {
        if (this.disposed) return;
        this.emit('convMembersChanged', hostId, conversationId, members);
    }

    notifyConvSettingsChanged(
        hostId: string,
        conversationId: string,
        partial: Partial<ConvSettingsUi>,
    ): void {
        if (this.disposed) return;
        this.emit('convSettingsChanged', hostId, conversationId, partial);
    }

    notifyProjectTemplateCatalogChanged(hostId: string): void {
        if (this.disposed) return;
        this.emit('projectTemplateCatalogChanged', hostId);
    }

    notifyMediaChanged(
        hostId: string,
        conversationId: string,
        kind: 'artifact' | 'image' | 'audio',
    ): void {
        if (this.disposed) return;
        this.emit('mediaChanged', hostId, conversationId, kind);
    }

    notifyCanvasChanged(hostId: string, conversationId: string): void {
        if (this.disposed) return;
        this.emit('canvasChanged', hostId, conversationId);
    }

    notifyUserMessageQueued(hostId: string): void {
        if (this.disposed) return;
        this.emit('userMessageQueued', hostId);
    }

    notifyModelsRefreshed(hostId: string): void {
        if (this.disposed) return;
        this.emit('modelsRefreshed', hostId);
    }

    /**
     * Opens (or reuses) the WebSocket for `hostId` and authenticates
     * with the stored bearer token. The state transitions are emitted
     * via `stateChanged`; once `connected` fires, `sessionReady` also
     * fires with the typed RemoteRepository.
     */
    async connect(hostId: string): Promise<void> {
        if (this.disposed) {
            this.logger.info('connect: skipped — manager disposed', { hostId });
            return;
        }
        if (this.inFlight.has(hostId)) {
            this.logger.info('connect: skipped — already in flight', { hostId });
            return;
        }
        const host = this.hostStore.findById(hostId);
        if (host === undefined) {
            this.logger.warn('connect: skipped — unknown host', { hostId });
            return;
        }

        const current = this.wires.get(hostId);
        if (current !== undefined) {
            const state = this.stateOf(hostId);
            if (state === 'connected' || state === 'connecting' || state === 'authenticating') {
                this.logger.info('connect: skipped — wire already active', { hostId, state });
                return;
            }
            await this.disposeWire(hostId);
        }
        this.logger.info('connect: starting', { hostId, url: host.url });

        let endpoint;
        try {
            endpoint = parseEndpoint(host.url);
        } catch (error) {
            this.logger.warn('connect: invalid endpoint', {
                hostId,
                error: errorText(error),
            });
            this.setState(hostId, 'error');
            return;
        }

        // Clear any user-disconnected flag — explicit connect intent
        // resets the gate so the next socket close decides freshly.
        this.userDisconnected.delete(hostId);
        this.cancelPendingReconnect(hostId);
        this.inFlight.add(hostId);
        try {
            const session = new RemoteSession({ logger: this.logger });
            const repository = new RemoteRepository(session);

            const unsubState = session.onStateChanged((next) => {
                if (next === 'closed') {
                    // If we were `connected` and the user didn't ask
                    // to disconnect, this is an unexpected wire drop —
                    // attempt one silent reconnect after a short delay
                    // so the user doesn't have to manually click
                    // Connect every time the host blips. Mirrors
                    // Android `attemptSilentReconnect`
                    // (MainViewModel.kt:660).
                    const prev = this.stateOf(hostId);
                    const userWantsOff = this.userDisconnected.has(hostId);
                    this.purgeWire(hostId);
                    if (prev === 'connected' && !userWantsOff) {
                        this.setState(hostId, 'reconnecting');
                        this.scheduleSilentReconnect(hostId);
                    } else {
                        this.setState(hostId, 'disconnected');
                    }
                } else if (next === 'failed') {
                    this.setState(hostId, 'error');
                    this.purgeWire(hostId);
                }
            });
            const unsubError = session.onError((error) => {
                this.logger.warn('wire: host emitted error', {
                    hostId,
                    kind: error.kind,
                    detail: error.detail,
                });
            });
            const wire: PerHostWire = {
                session,
                repository,
                unsubscribe: () => {
                    unsubState();
                    unsubError();
                },
            };
            this.wires.set(hostId, wire);

            this.setState(hostId, 'connecting');
            try {
                await session.connect(endpoint, host.tlsCertSha256);
            } catch (error) {
                this.logger.warn('connect: WebSocket open failed', {
                    hostId,
                    error: errorText(error),
                });
                await this.disposeWire(hostId);
                this.setState(hostId, 'error');
                return;
            }

            this.setState(hostId, 'authenticating');
            const token = await this.secretStore.getToken(hostId);
            if (token === undefined || token.length === 0) {
                this.logger.info('connect: no stored token', { hostId });
                await this.disposeWire(hostId);
                this.setState(hostId, 'unauthorized');
                return;
            }

            try {
                await repository.authenticateToken(token);
            } catch (error) {
                const state = mapAuthError(error);
                this.logger.warn('connect: auth.token failed', {
                    hostId,
                    state,
                    error: errorText(error),
                });
                await this.disposeWire(hostId);
                this.setState(hostId, state);
                return;
            }

            this.setState(hostId, 'connected');
            await this.refreshContextKeys();
            this.logger.info('connect: ready', { hostId });
            this.emit('sessionReady', hostId, repository);
        } finally {
            this.inFlight.delete(hostId);
        }
    }

    /**
     * Disconnect from `hostId` and delete its stored token. Used after
     * this client revoked its own pairing, so Connect then reports the
     * host as not paired instead of retrying a dead token.
     *
     * @param hostId the host to forget the token for.
     */
    async forgetPairing(hostId: string): Promise<void> {
        await this.disconnect(hostId);
        await this.secretStore.deleteToken(hostId);
    }

    async disconnect(hostId: string): Promise<void> {
        if (this.disposed) return;
        // Mark the host as user-disconnected so the socket-close
        // listener inside `connect()` doesn't trigger a silent
        // reconnect. Cleared when the user (or auto-flow) calls
        // `connect()` again.
        this.userDisconnected.add(hostId);
        this.cancelPendingReconnect(hostId);
        await this.disposeWire(hostId);
        this.setState(hostId, 'disconnected');
    }

    /**
     * Schedule a single silent-reconnect attempt for `hostId`. Mirrors
     * Android `MainViewModel.attemptSilentReconnect` at line 660:
     *
     *   - 1-second delay so a transient blip doesn't trigger an
     *     immediate retry storm.
     *   - Only one attempt — if it fails, the wire is left in
     *     `disconnected` for the user to click Connect manually.
     *     This matches Android's "best-effort one shot" behaviour
     *     and avoids hammering a host that is genuinely down.
     *   - Guarded by the userDisconnected set, so a user pressing
     *     Disconnect during the 1s window cancels the attempt.
     */
    private scheduleSilentReconnect(hostId: string): void {
        if (this.disposed) return;
        this.cancelPendingReconnect(hostId);
        const handle = setTimeout(() => {
            this.reconnectTimers.delete(hostId);
            if (this.disposed) return;
            if (this.userDisconnected.has(hostId)) {
                // User cancelled during the delay; drop the attempt.
                this.setState(hostId, 'disconnected');
                return;
            }
            this.logger.info('silent reconnect: attempting', { hostId });
            void this.connect(hostId).catch((error: unknown) => {
                this.logger.warn('silent reconnect: failed', {
                    hostId,
                    error: errorText(error),
                });
            });
        }, reconnectDelayMs());
        this.reconnectTimers.set(hostId, handle);
    }

    private cancelPendingReconnect(hostId: string): void {
        const handle = this.reconnectTimers.get(hostId);
        if (handle === undefined) return;
        clearTimeout(handle);
        this.reconnectTimers.delete(hostId);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.subs.dispose();
        for (const handle of this.reconnectTimers.values()) {
            clearTimeout(handle);
        }
        this.reconnectTimers.clear();
        this.userDisconnected.clear();
        for (const hostId of [...this.wires.keys()]) {
            // Best-effort: drop sessions without awaiting in dispose.
            void this.disposeWire(hostId);
        }
        this.wires.clear();
        this.states.clear();
        this.removeAllListeners();
    }

    private async disposeWire(hostId: string): Promise<void> {
        const wire = this.wires.get(hostId);
        if (wire === undefined) return;
        this.wires.delete(hostId);
        wire.unsubscribe();
        try {
            await wire.session.dispose();
        } catch (error) {
            this.logger.warn('disposeWire: session dispose threw', {
                hostId,
                error: errorText(error),
            });
        }
    }

    private purgeWire(hostId: string): void {
        // Called from socket-state listener; we drop the wire without
        // awaiting dispose (the session already closed itself).
        const wire = this.wires.get(hostId);
        if (wire === undefined) return;
        this.wires.delete(hostId);
        wire.unsubscribe();
    }

    private readonly onHostsChanged = (hosts: readonly { id: string }[]): void => {
        if (this.disposed) return;
        const validIds = new Set(hosts.map((h) => h.id));
        for (const id of [...this.states.keys()]) {
            if (!validIds.has(id)) {
                this.states.delete(id);
                this.emit('stateChanged', id, 'disconnected');
                void this.disposeWire(id);
            }
        }
        for (const host of hosts) {
            if (!this.states.has(host.id)) {
                this.states.set(host.id, 'disconnected');
            }
        }
        if (this.activeHost !== undefined && !validIds.has(this.activeHost)) {
            this.activeHost = hosts[0]?.id;
            this.emit('activeHostChanged', this.activeHost);
        } else if (this.activeHost === undefined && hosts.length > 0) {
            const defaultId = this.hostStore.defaultHostId();
            this.activeHost =
                defaultId.length > 0 && validIds.has(defaultId) ? defaultId : hosts[0]?.id;
            this.emit('activeHostChanged', this.activeHost);
        }
        void this.refreshContextKeys();
    };

    private setState(hostId: string, state: ConnectionState): void {
        const prev = this.states.get(hostId);
        if (prev === state) return;
        this.states.set(hostId, state);
        this.emit('stateChanged', hostId, state);
        void this.refreshContextKeys();
    }

    private async refreshContextKeys(): Promise<void> {
        const anyConnected = [...this.states.values()].some((s) => s === 'connected');
        try {
            await vscode.commands.executeCommand('setContext', CONTEXT_KEY.CONNECTED, anyConnected);
        } catch (error) {
            void error;
        }
    }
}

function mapAuthError(error: unknown): ConnectionState {
    if (error instanceof RemoteOpError) {
        const kind = error.kind.toLowerCase();
        if (kind === 'unauthorized' || kind === 'invalid_token' || kind === 'auth_failed') {
            return 'unauthorized';
        }
    }
    return 'error';
}

function errorText(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}

/**
 * Delay before the single silent reconnect attempt, from the
 * `verzeta.reconnect.backoffMs` setting (default 1000 ms, clamped to
 * 250..60000 ms).
 */
function reconnectDelayMs(): number {
    const raw = vscode.workspace
        .getConfiguration('verzeta')
        .get<number>(SETTING.RECONNECT_BACKOFF_MS, 1000);
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1000;
    return Math.min(60000, Math.max(250, value));
}
