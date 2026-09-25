// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * MessageBus — typed wrapper around vscode.Webview's postMessage +
 * onDidReceiveMessage pair. The extension host owns one bus per
 * resolved webview view; it forwards typed envelopes both ways
 * using the discriminated unions defined in
 * `src/shared/webview-protocol.ts`.
 *
 * The bus is intentionally thin — it does NOT subscribe to host
 * services or fan out events. Each higher-level subsystem (host
 * picker → HostStore, conversation list → ConversationStore, chat
 * stream → wire client) wires itself to the bus via dedicated
 * adapters that land in the relevant phase.
 */

import type * as vscode from 'vscode';
import type { Disposable } from '../infra/disposables.js';
import type { Logger } from '../log/Logger.js';
import type { ExtensionToWebview, WebviewToExtension } from '../../shared/webview-protocol.js';
import {
    MAX_ATTACHMENTS,
    MAX_CONTENT_BYTES,
    isSafeUploadFileName,
} from '../../shared/wire-limits.js';
import type {
    AgentPattern,
    ConvSettingsPatch,
    MemberAddedByKind,
    OutgoingAttachmentUi,
} from '../../shared/wire-types.js';

export type WebviewMessageHandler = (msg: WebviewToExtension) => void;

export class MessageBus implements Disposable {
    private readonly webview: vscode.Webview;
    private readonly logger: Logger;
    private readonly receiveSubscription: vscode.Disposable;
    private readonly handlers = new Set<WebviewMessageHandler>();
    private disposed = false;

    constructor(webview: vscode.Webview, logger: Logger) {
        this.webview = webview;
        this.logger = logger;
        this.receiveSubscription = webview.onDidReceiveMessage((raw: unknown) => this.onRaw(raw));
    }

    /**
     * Subscribes a handler to inbound webview messages. The returned
     * Disposable removes the handler when disposed; the bus itself
     * is unaffected.
     */
    onMessage(handler: WebviewMessageHandler): Disposable {
        this.handlers.add(handler);
        return {
            dispose: () => {
                this.handlers.delete(handler);
            },
        };
    }

    /** Sends a typed envelope to the webview. No-op if disposed. */
    post(message: ExtensionToWebview): void {
        if (this.disposed) return;
        void this.webview.postMessage(message);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.handlers.clear();
        this.receiveSubscription.dispose();
    }

    private onRaw(raw: unknown): void {
        const validated = validateInbound(raw);
        if (validated === undefined) {
            this.logger.warn('MessageBus: dropping malformed inbound message', { raw });
            return;
        }
        for (const handler of this.handlers) {
            try {
                handler(validated);
            } catch (error) {
                this.logger.error('MessageBus: handler threw', { error });
            }
        }
    }
}

/**
 * Narrow an unknown postMessage payload to one of the typed
 * inbound variants. Returns undefined for anything that does not
 * match. Defensive — the webview is untrusted-by-default per
 * VS Code's security model.
 */
export function validateInbound(raw: unknown): WebviewToExtension | undefined {
    if (raw === null || typeof raw !== 'object') return undefined;
    const value = raw as Record<string, unknown>;
    const type = value['type'];
    if (typeof type !== 'string') return undefined;
    switch (type) {
        case 'hello':
            return { type: 'hello' };
        case 'ping': {
            const seq = value['seq'];
            if (typeof seq !== 'number' || !Number.isFinite(seq)) return undefined;
            return { type: 'ping', seq };
        }
        case 'host.setActive': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'host.setActive', hostId };
        }
        case 'host.connectRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'host.connectRequested', hostId };
        }
        case 'host.disconnectRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'host.disconnectRequested', hostId };
        }
        case 'host.commandRequested': {
            const commandId = value['commandId'];
            if (typeof commandId !== 'string' || commandId.length === 0) return undefined;
            return { type: 'host.commandRequested', commandId };
        }
        case 'conversation.openRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'conversation.openRequested', hostId, conversationId };
        }
        case 'conversation.deleteRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'conversation.deleteRequested', hostId, conversationId };
        }
        case 'folder.deleteRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0
            ) {
                return undefined;
            }
            return { type: 'folder.deleteRequested', hostId, folderId };
        }
        case 'message.send': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const text = value['text'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof text !== 'string'
            ) {
                return undefined;
            }
            return { type: 'message.send', hostId, conversationId, text };
        }
        case 'message.sendWithAttachments': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const text = value['text'];
            const raw = value['attachments'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof text !== 'string' ||
                !Array.isArray(raw)
            ) {
                return undefined;
            }
            const attachments = validateAttachments(raw);
            if (attachments === undefined) return undefined;
            return {
                type: 'message.sendWithAttachments',
                hostId,
                conversationId,
                text,
                attachments,
            };
        }
        case 'message.stop': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'message.stop', hostId };
        }
        case 'host.pingRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'host.pingRequested', hostId };
        }
        case 'host.revokeSelfRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'host.revokeSelfRequested', hostId };
        }
        case 'conv.settings.requested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'conv.settings.requested', hostId, conversationId };
        }
        case 'convExecMode.requested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'convExecMode.requested', hostId, conversationId };
        }
        case 'convExecMode.set': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const mode = value['mode'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                (mode !== 'off' && mode !== 'ask' && mode !== 'allow')
            ) {
                return undefined;
            }
            return { type: 'convExecMode.set', hostId, conversationId, mode };
        }
        case 'exec.confirmResponse': {
            const hostId = value['hostId'];
            const requestId = value['requestId'];
            const approved = value['approved'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof requestId !== 'string' ||
                requestId.length === 0 ||
                typeof approved !== 'boolean'
            ) {
                return undefined;
            }
            return { type: 'exec.confirmResponse', hostId, requestId, approved };
        }
        case 'workspace.shareRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'workspace.shareRequested', hostId, conversationId };
        }
        case 'conv.settings.save': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const patch = value['patch'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                patch === null ||
                typeof patch !== 'object'
            ) {
                return undefined;
            }
            return {
                type: 'conv.settings.save',
                hostId,
                conversationId,
                patch: patch as ConvSettingsPatch,
            };
        }
        case 'agent.pattern.set': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const pattern = value['pattern'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof pattern !== 'string'
            ) {
                return undefined;
            }
            const allowed = ['direct', 'react', 'planner', 'router', 'multi_agent', 'memory'];
            if (!allowed.includes(pattern)) return undefined;
            return {
                type: 'agent.pattern.set',
                hostId,
                conversationId,
                pattern: pattern as AgentPattern,
            };
        }
        case 'agent.require_confirmation.set': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const require = value['require'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof require !== 'boolean'
            ) {
                return undefined;
            }
            return { type: 'agent.require_confirmation.set', hostId, conversationId, require };
        }
        case 'tools.enabled.set': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const enabled = value['enabled'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof enabled !== 'boolean'
            ) {
                return undefined;
            }
            return { type: 'tools.enabled.set', hostId, conversationId, enabled };
        }
        case 'conv.primary_agent.set': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const agentId = value['agentId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof agentId !== 'string'
            ) {
                return undefined;
            }
            return { type: 'conv.primary_agent.set', hostId, conversationId, agentId };
        }
        case 'agents.listRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'agents.listRequested', hostId };
        }
        case 'clients.listRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'clients.listRequested', hostId };
        }
        case 'clients.revokeRequested': {
            const hostId = value['hostId'];
            const clientId = value['clientId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof clientId !== 'string' ||
                clientId.length === 0
            ) {
                return undefined;
            }
            return { type: 'clients.revokeRequested', hostId, clientId };
        }
        case 'tools.listRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'tools.listRequested', hostId };
        }
        case 'mcp.listRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'mcp.listRequested', hostId };
        }
        case 'skills.listRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'skills.listRequested', hostId };
        }
        case 'verifySession.requested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'verifySession.requested', hostId };
        }
        case 'folder.members.requested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0
            ) {
                return undefined;
            }
            return { type: 'folder.members.requested', hostId, folderId };
        }
        case 'folder.member.chat.openRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            const agentId = value['agentId'];
            const alias = value['alias'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0 ||
                typeof agentId !== 'string' ||
                agentId.length === 0 ||
                typeof alias !== 'string' ||
                alias.length === 0
            ) {
                return undefined;
            }
            return {
                type: 'folder.member.chat.openRequested',
                hostId,
                folderId,
                agentId,
                alias,
            };
        }
        case 'folder.kickoff.groupRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0
            ) {
                return undefined;
            }
            return { type: 'folder.kickoff.groupRequested', hostId, folderId };
        }
        case 'folder.kickoff.individualRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0
            ) {
                return undefined;
            }
            return { type: 'folder.kickoff.individualRequested', hostId, folderId };
        }
        case 'conversation.createRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'conversation.createRequested', hostId };
        }
        case 'folder.createRequested': {
            const hostId = value['hostId'];
            const name = value['name'];
            const folderType = value['folderType'];
            const goal = value['goal'];
            const description = value['description'];
            const rawMembers = value['members'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof name !== 'string' ||
                name.length === 0 ||
                typeof folderType !== 'string' ||
                typeof goal !== 'string' ||
                typeof description !== 'string'
            ) {
                return undefined;
            }
            if (
                folderType !== 'regular' &&
                folderType !== 'project' &&
                folderType !== 'organization'
            ) {
                return undefined;
            }
            // Members is optional — empty roster is the legacy
            // create-without-team shape. Reject malformed shape.
            const members =
                rawMembers === undefined
                    ? ([] as const)
                    : Array.isArray(rawMembers)
                      ? validateMembershipRows(rawMembers)
                      : undefined;
            if (members === undefined) return undefined;
            return {
                type: 'folder.createRequested',
                hostId,
                name,
                folderType,
                goal,
                description,
                members,
            };
        }
        case 'models.catalog.requested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'models.catalog.requested', hostId };
        }
        case 'models.setActiveRequested': {
            const hostId = value['hostId'];
            const providerId = value['providerId'];
            const modelName = value['modelName'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof providerId !== 'string' ||
                providerId.length === 0 ||
                typeof modelName !== 'string' ||
                modelName.length === 0
            ) {
                return undefined;
            }
            return { type: 'models.setActiveRequested', hostId, providerId, modelName };
        }
        case 'search.providers.requested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'search.providers.requested', hostId };
        }
        case 'search.setActiveRequested': {
            const hostId = value['hostId'];
            const providerId = value['providerId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof providerId !== 'string' ||
                providerId.length === 0
            ) {
                return undefined;
            }
            return { type: 'search.setActiveRequested', hostId, providerId };
        }
        case 'tool_call.approveRequested':
        case 'tool_call.denyRequested': {
            const hostId = value['hostId'];
            const callId = value['callId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof callId !== 'string' ||
                callId.length === 0
            ) {
                return undefined;
            }
            return type === 'tool_call.approveRequested'
                ? { type: 'tool_call.approveRequested', hostId, callId }
                : { type: 'tool_call.denyRequested', hostId, callId };
        }
        case 'folder.members.setRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            const rawMembers = value['members'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0 ||
                !Array.isArray(rawMembers)
            ) {
                return undefined;
            }
            const members = validateMembershipRows(rawMembers);
            if (members === undefined) return undefined;
            return { type: 'folder.members.setRequested', hostId, folderId, members };
        }
        case 'folder.member.override.setRequested':
            return validateMemberOverride(value);
        case 'folder.updateRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            const originalName = value['originalName'];
            const name = value['name'];
            const folderType = value['folderType'];
            const goal = value['goal'];
            const description = value['description'];
            const rawMembers = value['members'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0 ||
                typeof originalName !== 'string' ||
                typeof name !== 'string' ||
                name.length === 0 ||
                typeof folderType !== 'string' ||
                typeof goal !== 'string' ||
                typeof description !== 'string' ||
                !Array.isArray(rawMembers)
            ) {
                return undefined;
            }
            if (
                folderType !== 'regular' &&
                folderType !== 'project' &&
                folderType !== 'organization'
            ) {
                return undefined;
            }
            const members = validateMembershipRows(rawMembers);
            if (members === undefined) return undefined;
            return {
                type: 'folder.updateRequested',
                hostId,
                folderId,
                originalName,
                name,
                folderType,
                goal,
                description,
                members,
            };
        }
        case 'heartbeats.requested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0
            ) {
                return undefined;
            }
            return { type: 'heartbeats.requested', hostId, folderId };
        }
        case 'heartbeat.upsertRequested': {
            const hostId = value['hostId'];
            const id = value['id'];
            const folderId = value['folderId'];
            const agentId = value['agentId'];
            const alias = value['alias'];
            const schedule = value['schedule'];
            const goal = value['goal'];
            const enabled = value['enabled'];
            const maxRunsPerDay = value['maxRunsPerDay'];
            const autoSurfaceTargetConversationId = value['autoSurfaceTargetConversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof id !== 'string' ||
                typeof folderId !== 'string' ||
                folderId.length === 0 ||
                typeof agentId !== 'string' ||
                agentId.length === 0 ||
                typeof alias !== 'string' ||
                alias.length === 0 ||
                typeof schedule !== 'string' ||
                typeof goal !== 'string' ||
                typeof enabled !== 'boolean' ||
                typeof maxRunsPerDay !== 'number' ||
                !Number.isFinite(maxRunsPerDay) ||
                typeof autoSurfaceTargetConversationId !== 'string'
            ) {
                return undefined;
            }
            return {
                type: 'heartbeat.upsertRequested',
                hostId,
                id,
                folderId,
                agentId,
                alias,
                schedule,
                goal,
                enabled,
                maxRunsPerDay,
                autoSurfaceTargetConversationId,
            };
        }
        case 'heartbeat.removeRequested': {
            const hostId = value['hostId'];
            const id = value['id'];
            const folderId = value['folderId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof id !== 'string' ||
                id.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0
            ) {
                return undefined;
            }
            return { type: 'heartbeat.removeRequested', hostId, id, folderId };
        }
        case 'heartbeat.runRequested': {
            const hostId = value['hostId'];
            const id = value['id'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof id !== 'string' ||
                id.length === 0
            ) {
                return undefined;
            }
            return { type: 'heartbeat.runRequested', hostId, id };
        }
        case 'preferredSkills.requested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0
            ) {
                return undefined;
            }
            return { type: 'preferredSkills.requested', hostId, folderId };
        }
        case 'preferredSkills.setRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            const rawIds = value['skillIds'];
            const exposeOnly = value['exposeOnly'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0 ||
                !Array.isArray(rawIds) ||
                typeof exposeOnly !== 'boolean'
            ) {
                return undefined;
            }
            const skillIds: string[] = [];
            for (const id of rawIds) {
                if (typeof id !== 'string') return undefined;
                skillIds.push(id);
            }
            return { type: 'preferredSkills.setRequested', hostId, folderId, skillIds, exposeOnly };
        }
        case 'convSkillOverride.requested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'convSkillOverride.requested', hostId, conversationId };
        }
        case 'convSkillOverride.setRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const override = value['override'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof override !== 'boolean'
            ) {
                return undefined;
            }
            return { type: 'convSkillOverride.setRequested', hostId, conversationId, override };
        }
        case 'convPreferredSkills.requested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'convPreferredSkills.requested', hostId, conversationId };
        }
        case 'convPreferredSkills.setRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const rawIds = value['skillIds'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                !Array.isArray(rawIds)
            ) {
                return undefined;
            }
            const skillIds: string[] = [];
            for (const id of rawIds) {
                if (typeof id !== 'string') return undefined;
                skillIds.push(id);
            }
            return { type: 'convPreferredSkills.setRequested', hostId, conversationId, skillIds };
        }
        case 'convHeartbeatGate.requested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'convHeartbeatGate.requested', hostId, conversationId };
        }
        case 'convHeartbeatGate.setRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const allow = value['allow'];
            const maxPerDay = value['maxPerDay'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof allow !== 'boolean' ||
                typeof maxPerDay !== 'number' ||
                !Number.isFinite(maxPerDay)
            ) {
                return undefined;
            }
            return {
                type: 'convHeartbeatGate.setRequested',
                hostId,
                conversationId,
                allow,
                maxPerDay: Math.max(1, Math.min(24, Math.round(maxPerDay))),
            };
        }
        case 'documents.requested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0
            ) {
                return undefined;
            }
            return { type: 'documents.requested', hostId, folderId };
        }
        case 'document.uploadRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            const fileName = value['fileName'];
            const contentBase64 = value['contentBase64'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0 ||
                typeof fileName !== 'string' ||
                fileName.length === 0 ||
                typeof contentBase64 !== 'string' ||
                contentBase64.length === 0
            ) {
                return undefined;
            }
            // Filename safety mirrors host validation in
            // wire-session.cpp::opFolderDocumentsUpload.
            if (!isSafeUploadFileName(fileName)) {
                return undefined;
            }
            return {
                type: 'document.uploadRequested',
                hostId,
                folderId,
                fileName,
                contentBase64,
            };
        }
        case 'document.removeRequested': {
            const hostId = value['hostId'];
            const folderId = value['folderId'];
            const fileName = value['fileName'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof folderId !== 'string' ||
                folderId.length === 0 ||
                typeof fileName !== 'string' ||
                fileName.length === 0
            ) {
                return undefined;
            }
            return { type: 'document.removeRequested', hostId, folderId, fileName };
        }
        case 'group.createRequested': {
            const hostId = value['hostId'];
            const title = value['title'];
            const rawMembers = value['members'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof title !== 'string' ||
                title.length === 0 ||
                !Array.isArray(rawMembers) ||
                rawMembers.length === 0
            ) {
                return undefined;
            }
            const members = validateMembershipRows(rawMembers);
            if (members === undefined) return undefined;
            return { type: 'group.createRequested', hostId, title, members };
        }
        case 'plans.requested':
        case 'toolCalls.requested':
        case 'polls.requested':
        case 'media.requested':
        case 'plan.stopAllRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return type === 'plans.requested'
                ? { type, hostId, conversationId }
                : type === 'toolCalls.requested'
                  ? { type, hostId, conversationId }
                  : type === 'polls.requested'
                    ? { type, hostId, conversationId }
                    : type === 'media.requested'
                      ? { type, hostId, conversationId }
                      : { type: 'plan.stopAllRequested', hostId, conversationId };
        }
        case 'task.startRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const goal = value['goal'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof goal !== 'string' ||
                goal.length === 0
            ) {
                return undefined;
            }
            return { type: 'task.startRequested', hostId, conversationId, goal };
        }
        case 'plan.stopRequested': {
            const hostId = value['hostId'];
            const planId = value['planId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof planId !== 'string' ||
                planId.length === 0
            ) {
                return undefined;
            }
            return { type: 'plan.stopRequested', hostId, planId };
        }
        case 'step.retryRequested':
        case 'step.skipRequested': {
            const hostId = value['hostId'];
            const stepId = value['stepId'];
            const extra = type === 'step.retryRequested' ? value['notes'] : value['reason'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof stepId !== 'string' ||
                stepId.length === 0 ||
                typeof extra !== 'string'
            ) {
                return undefined;
            }
            return type === 'step.retryRequested'
                ? { type, hostId, stepId, notes: extra }
                : { type: 'step.skipRequested', hostId, stepId, reason: extra };
        }
        case 'step.overrideRequested': {
            const hostId = value['hostId'];
            const stepId = value['stepId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof stepId !== 'string' ||
                stepId.length === 0
            ) {
                return undefined;
            }
            return { type: 'step.overrideRequested', hostId, stepId };
        }
        case 'activity.requested': {
            const hostId = value['hostId'];
            const scopeKind = value['scopeKind'];
            const scopeId = value['scopeId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof scopeKind !== 'string' ||
                (scopeKind !== 'project' && scopeKind !== 'conversation' && scopeKind !== 'turn') ||
                typeof scopeId !== 'string' ||
                scopeId.length === 0
            ) {
                return undefined;
            }
            return { type: 'activity.requested', hostId, scopeKind, scopeId };
        }
        case 'poll.startRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            const question = value['question'];
            const rawOptions = value['options'];
            const mode = value['mode'];
            const closesInMinutes = value['closesInMinutes'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0 ||
                typeof question !== 'string' ||
                question.length === 0 ||
                !Array.isArray(rawOptions) ||
                rawOptions.length < 2 ||
                (mode !== 'single' && mode !== 'multi') ||
                typeof closesInMinutes !== 'number' ||
                !Number.isFinite(closesInMinutes)
            ) {
                return undefined;
            }
            const options: string[] = [];
            for (const o of rawOptions) {
                if (typeof o !== 'string' || o.length === 0) return undefined;
                options.push(o);
            }
            return {
                type: 'poll.startRequested',
                hostId,
                conversationId,
                question,
                options,
                mode,
                closesInMinutes,
            };
        }
        case 'poll.voteRequested': {
            const hostId = value['hostId'];
            const pollId = value['pollId'];
            const optionId = value['optionId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof pollId !== 'string' ||
                pollId.length === 0 ||
                typeof optionId !== 'string' ||
                optionId.length === 0
            ) {
                return undefined;
            }
            return { type: 'poll.voteRequested', hostId, pollId, optionId };
        }
        case 'poll.closeRequested': {
            const hostId = value['hostId'];
            const pollId = value['pollId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof pollId !== 'string' ||
                pollId.length === 0
            ) {
                return undefined;
            }
            return { type: 'poll.closeRequested', hostId, pollId };
        }
        case 'mcp.serverTools.requested': {
            const hostId = value['hostId'];
            const serverName = value['serverName'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof serverName !== 'string' ||
                serverName.length === 0
            ) {
                return undefined;
            }
            return { type: 'mcp.serverTools.requested', hostId, serverName };
        }
        case 'skill.detail.requested': {
            const hostId = value['hostId'];
            const skillId = value['skillId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof skillId !== 'string' ||
                skillId.length === 0
            ) {
                return undefined;
            }
            return { type: 'skill.detail.requested', hostId, skillId };
        }
        case 'heartbeat.runs.requested': {
            const hostId = value['hostId'];
            const configId = value['configId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof configId !== 'string' ||
                configId.length === 0
            ) {
                return undefined;
            }
            return { type: 'heartbeat.runs.requested', hostId, configId };
        }
        case 'projectTemplates.requested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'projectTemplates.requested', hostId };
        }
        case 'projectTemplate.createProjectRequested': {
            const hostId = value['hostId'];
            const templateId = value['templateId'];
            const name = value['name'];
            const goal = value['goal'];
            const description = value['description'];
            const scenario = value['scenario'];
            const rawMembers = value['members'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof templateId !== 'string' ||
                templateId.length === 0 ||
                typeof name !== 'string' ||
                typeof goal !== 'string' ||
                typeof description !== 'string' ||
                typeof scenario !== 'string' ||
                !Array.isArray(rawMembers)
            ) {
                return undefined;
            }
            const members = validateMembershipRows(rawMembers);
            if (members === undefined) return undefined;
            return {
                type: 'projectTemplate.createProjectRequested',
                hostId,
                templateId,
                name,
                goal,
                description,
                scenario,
                members,
            };
        }
        case 'projectTemplates.allRequested': {
            const hostId = value['hostId'];
            if (typeof hostId !== 'string' || hostId.length === 0) return undefined;
            return { type: 'projectTemplates.allRequested', hostId };
        }
        case 'template.roster.requested': {
            const hostId = value['hostId'];
            const templateId = value['templateId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof templateId !== 'string' ||
                templateId.length === 0
            ) {
                return undefined;
            }
            return { type: 'template.roster.requested', hostId, templateId };
        }
        case 'template.pinRequested': {
            const hostId = value['hostId'];
            const templateId = value['templateId'];
            const pinned = value['pinned'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof templateId !== 'string' ||
                templateId.length === 0 ||
                typeof pinned !== 'boolean'
            ) {
                return undefined;
            }
            return { type: 'template.pinRequested', hostId, templateId, pinned };
        }
        case 'template.saveAsNewRequested': {
            const hostId = value['hostId'];
            const sourceTemplateId = value['sourceTemplateId'];
            const name = value['name'];
            const scenario = value['scenario'];
            const goal = value['goal'];
            const description = value['description'];
            const rawMembers = value['members'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof sourceTemplateId !== 'string' ||
                typeof name !== 'string' ||
                typeof scenario !== 'string' ||
                typeof goal !== 'string' ||
                typeof description !== 'string' ||
                !Array.isArray(rawMembers)
            ) {
                return undefined;
            }
            const members: {
                agentId: string;
                alias: string;
                isCoordinator: boolean;
                modelProvider: string;
                modelName: string;
                allowedTools: readonly string[];
            }[] = [];
            for (const raw of rawMembers) {
                if (raw === null || typeof raw !== 'object') return undefined;
                const obj = raw as Record<string, unknown>;
                const agentId = obj['agentId'];
                const alias = obj['alias'];
                const isCoordinator = obj['isCoordinator'];
                if (
                    typeof agentId !== 'string' ||
                    agentId.length === 0 ||
                    typeof alias !== 'string' ||
                    typeof isCoordinator !== 'boolean'
                ) {
                    return undefined;
                }
                // Optional per-member overrides; missing or wrongly typed
                // values mean "inherit", as in validateMembershipRows.
                const modelProvider =
                    typeof obj['modelProvider'] === 'string' ? obj['modelProvider'] : '';
                const modelName = typeof obj['modelName'] === 'string' ? obj['modelName'] : '';
                const rawAllowed = obj['allowedTools'];
                const allowedTools = Array.isArray(rawAllowed)
                    ? rawAllowed.filter((t): t is string => typeof t === 'string')
                    : [];
                members.push({
                    agentId,
                    alias,
                    isCoordinator,
                    modelProvider,
                    modelName,
                    allowedTools,
                });
            }
            return {
                type: 'template.saveAsNewRequested',
                hostId,
                sourceTemplateId,
                name,
                scenario,
                goal,
                description,
                members,
            };
        }
        case 'template.deleteRequested': {
            const hostId = value['hostId'];
            const templateId = value['templateId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof templateId !== 'string' ||
                templateId.length === 0
            ) {
                return undefined;
            }
            return { type: 'template.deleteRequested', hostId, templateId };
        }
        case 'ide.applyEditRequested': {
            const targetPath = value['targetPath'];
            const language = value['language'];
            const content = value['content'];
            if (
                typeof targetPath !== 'string' ||
                targetPath.length === 0 ||
                typeof language !== 'string' ||
                typeof content !== 'string'
            ) {
                return undefined;
            }
            return { type: 'ide.applyEditRequested', targetPath, language, content };
        }
        case 'ide.openCanvasRequested': {
            const hostId = value['hostId'];
            const conversationId = value['conversationId'];
            if (
                typeof hostId !== 'string' ||
                hostId.length === 0 ||
                typeof conversationId !== 'string' ||
                conversationId.length === 0
            ) {
                return undefined;
            }
            return { type: 'ide.openCanvasRequested', hostId, conversationId };
        }
        case 'ide.addContextRequested':
            return { type: 'ide.addContextRequested' };
        case 'ide.dropUrisRequested': {
            const uris = value['uris'];
            if (!Array.isArray(uris)) return undefined;
            const clean = uris.filter((u): u is string => typeof u === 'string' && u.length > 0);
            if (clean.length === 0) return undefined;
            return { type: 'ide.dropUrisRequested', uris: clean };
        }
        default:
            return undefined;
    }
}

/**
 * Narrow an unknown members[] payload to the typed roster shape used
 * by `folder.members.setRequested`. Returns undefined on any malformed
 * row — caller drops the envelope rather than partially applying.
 *
 * Coordinator enforcement is OUT of scope here (the host accepts any
 * roster shape the webview sends; UI must guarantee radio-style
 * exclusivity).
 */
function validateMembershipRows(raw: readonly unknown[]):
    | readonly {
          readonly agentId: string;
          readonly alias: string;
          readonly isCoordinator: boolean;
          readonly modelProvider: string;
          readonly modelName: string;
          readonly allowedTools: readonly string[];
          readonly addedByKind?: MemberAddedByKind;
          readonly addedByAgentId?: string;
      }[]
    | undefined {
    const out: {
        agentId: string;
        alias: string;
        isCoordinator: boolean;
        modelProvider: string;
        modelName: string;
        allowedTools: readonly string[];
        addedByKind?: MemberAddedByKind;
        addedByAgentId?: string;
    }[] = [];
    for (const item of raw) {
        if (item === null || typeof item !== 'object') return undefined;
        const o = item as Record<string, unknown>;
        const agentId = o['agentId'];
        const alias = o['alias'];
        const isCoordinator = o['isCoordinator'];
        if (
            typeof agentId !== 'string' ||
            agentId.length === 0 ||
            typeof alias !== 'string' ||
            alias.length === 0 ||
            typeof isCoordinator !== 'boolean'
        ) {
            return undefined;
        }
        // Per-member override fields. Empty strings + empty array
        // mean "inherit". Reject only when present with the wrong
        // type so a malformed row drops the whole envelope.
        const modelProvider = typeof o['modelProvider'] === 'string' ? o['modelProvider'] : '';
        const modelName = typeof o['modelName'] === 'string' ? o['modelName'] : '';
        const rawAllowed = o['allowedTools'];
        let allowedTools: readonly string[] = [];
        if (Array.isArray(rawAllowed)) {
            for (const t of rawAllowed) {
                if (typeof t !== 'string') return undefined;
            }
            allowedTools = rawAllowed as readonly string[];
        } else if (rawAllowed !== undefined) {
            return undefined;
        }
        // Provenance is optional. When present it must be one of the two
        // kinds the host accepts, since the host rejects the whole roster
        // for any other value.
        const rawKind = o['addedByKind'];
        const rawAddedBy = o['addedByAgentId'];
        if (rawKind !== undefined && rawKind !== 'user' && rawKind !== 'agent') {
            return undefined;
        }
        if (rawAddedBy !== undefined && typeof rawAddedBy !== 'string') return undefined;
        out.push({
            agentId,
            alias,
            isCoordinator,
            modelProvider,
            modelName,
            allowedTools,
            ...(rawKind !== undefined ? { addedByKind: rawKind } : {}),
            ...(rawAddedBy !== undefined && rawAddedBy.length > 0
                ? { addedByAgentId: rawAddedBy }
                : {}),
        });
    }
    return out;
}

/** Upper bound on one member's tool allowlist; matches the host's limit. */
export const MAX_MEMBER_ALLOWED_TOOLS = 512;

/**
 * Narrow the payload of `folder.member.override.setRequested`. Every id and
 * the alias must be non-empty; provider and model must be strings (empty
 * clears the override); the tool list must hold non-empty strings and stay
 * within the host's limit.
 *
 * @param value Raw envelope from the webview.
 * @returns The typed message, or undefined when any field is malformed.
 */
function validateMemberOverride(value: Record<string, unknown>): WebviewToExtension | undefined {
    const hostId = value['hostId'];
    const folderId = value['folderId'];
    const alias = value['alias'];
    const modelProvider = value['modelProvider'];
    const modelName = value['modelName'];
    const rawTools = value['allowedTools'];
    if (
        typeof hostId !== 'string' ||
        hostId.length === 0 ||
        typeof folderId !== 'string' ||
        folderId.length === 0 ||
        typeof alias !== 'string' ||
        alias.trim().length === 0 ||
        typeof modelProvider !== 'string' ||
        typeof modelName !== 'string' ||
        !Array.isArray(rawTools) ||
        rawTools.length > MAX_MEMBER_ALLOWED_TOOLS
    ) {
        return undefined;
    }
    const allowedTools: string[] = [];
    for (const t of rawTools) {
        if (typeof t !== 'string' || t.length === 0) return undefined;
        allowedTools.push(t);
    }
    return {
        type: 'folder.member.override.setRequested',
        hostId,
        folderId,
        alias,
        modelProvider,
        modelName,
        allowedTools,
    };
}

/**
 * Validate an attachment array shipped by the webview. Mirrors the caps
 * the host re-enforces in wire-session.cpp (per-attachment + total bound
 * by kMaxContentBytes, at most MAX_ATTACHMENTS files). Returning undefined
 * causes the envelope to be dropped silently — the webview is expected
 * to surface its own UX error before reaching this point. The caps come
 * from the shared wire-limits module so host and webview never diverge.
 */
function validateAttachments(raw: readonly unknown[]): readonly OutgoingAttachmentUi[] | undefined {
    if (raw.length === 0 || raw.length > MAX_ATTACHMENTS) return undefined;
    const out: OutgoingAttachmentUi[] = [];
    let totalBytes = 0;
    for (const item of raw) {
        if (item === null || typeof item !== 'object') return undefined;
        const o = item as Record<string, unknown>;
        const fileName = o['fileName'];
        const mimeType = o['mimeType'];
        const rawBytes = o['rawBytes'];
        const contentBase64 = o['contentBase64'];
        if (
            typeof fileName !== 'string' ||
            fileName.length === 0 ||
            typeof mimeType !== 'string' ||
            typeof rawBytes !== 'number' ||
            !Number.isFinite(rawBytes) ||
            rawBytes <= 0 ||
            rawBytes > MAX_CONTENT_BYTES ||
            typeof contentBase64 !== 'string' ||
            contentBase64.length === 0
        ) {
            return undefined;
        }
        // Filename safety mirrors host wire-session.cpp::stageBase64Upload.
        if (!isSafeUploadFileName(fileName)) {
            return undefined;
        }
        totalBytes += rawBytes;
        if (totalBytes > MAX_CONTENT_BYTES) return undefined;
        out.push({ fileName, mimeType, rawBytes, contentBase64 });
    }
    return out;
}
