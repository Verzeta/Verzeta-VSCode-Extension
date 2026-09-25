// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * RemoteRepository — typed facade over `RemoteSession.send`.
 *
 * Mirrors `Verzeta-Android/.../remote/RemoteRepository.kt`. Each
 * method maps 1:1 to a host wire op and returns a typed shape. The
 * port covers the MVP surface needed to drive the webview UI end to
 * end: auth, conversations, folders, members, messages, agents.
 * Plans / canvas / heartbeat / mcp / skill / poll / project_template
 * land in follow-up commits as the corresponding UI surfaces are
 * built.
 *
 * Convention: kotlinx serialisation maps wire snake_case to camelCase
 * model fields. The TypeScript parsers in `RemoteJson.ts` do the same
 * (e.g. `is_group` -> `isGroup`).
 */

import type {
    AuthMeResponse,
    PairResponse,
    PingResponse,
    TokenAuthResponse,
} from '../../shared/wire-envelope.js';
import type {
    ActivityEventUi,
    AgentPattern,
    AgentSummaryUi,
    ClientUi,
    ConvSettingsPatch,
    ConvSettingsUi,
    ConversationUi,
    FolderUi,
    GeneratedFileUi,
    HeartbeatConfigUi,
    HeartbeatRunUi,
    McpServerUi,
    MemberAddedByKind,
    MemberUi,
    MessageUi,
    ModelCatalogUi,
    OutgoingAttachmentUi,
    PermissionTier,
    PlanUi,
    PollUi,
    ProjectTemplateRosterMemberUi,
    ProjectTemplateUi,
    SearchProvidersCatalogUi,
    SkillUi,
    ToolCallLogUi,
    ToolUi,
} from '../../shared/wire-types.js';
import { RemoteOpError, type RemoteSession } from './RemoteSession.js';
import {
    arrayOf,
    booleanOr,
    isJsonObject,
    optionalString,
    parseAgentSummary,
    parseAuthMeResponse,
    parseClient,
    parseConvSettings,
    parseConversation,
    parseFolder,
    parseActivityEvent,
    parseGeneratedFile,
    parseHeartbeatConfig,
    parseHeartbeatRun,
    parseAddedByKind,
    parseMcpServer,
    parseMember,
    parseMessage,
    parseModelCatalog,
    parsePairResponse,
    parsePingResponse,
    parsePlan,
    parsePoll,
    parseProjectTemplate,
    parseProjectTemplateRosterMember,
    parseSearchProviders,
    parseSkill,
    parseToolCallLog,
    parseTokenAuthResponse,
    parseTool,
} from './RemoteJson.js';

export interface SendMessageResult {
    readonly userMessageId: string;
    readonly assistantPlaceholderId: string | undefined;
}

export class RemoteRepository {
    private readonly session: RemoteSession;

    constructor(session: RemoteSession) {
        this.session = session;
    }

    // === auth ===

    async pair(code: string, clientName: string): Promise<PairResponse> {
        const data = await this.session.send('auth.pair', {
            code,
            client_name: clientName,
        });
        const parsed = parsePairResponse(data);
        if (parsed === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'auth.pair returned an unexpected payload',
            });
        }
        return parsed;
    }

    async authenticateToken(token: string): Promise<TokenAuthResponse> {
        const data = await this.session.send('auth.token', {
            token,
            capabilities: ['vfs.execute'],
        });
        const parsed = parseTokenAuthResponse(data);
        if (parsed === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'auth.token returned an unexpected payload',
            });
        }
        return parsed;
    }

    async authMe(): Promise<AuthMeResponse> {
        const data = await this.session.send('auth.me');
        const parsed = parseAuthMeResponse(data);
        if (parsed === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'auth.me returned an unexpected payload',
            });
        }
        return parsed;
    }

    async ping(): Promise<PingResponse> {
        const data = await this.session.send('ping');
        const parsed = parsePingResponse(data);
        if (parsed === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'ping returned an unexpected payload',
            });
        }
        return parsed;
    }

    async revokeSelf(): Promise<void> {
        await this.session.send('auth.revoke_self');
    }

    // === conversations ===

    async listConversations(limit = 200, offset = 0): Promise<readonly ConversationUi[]> {
        const data = await this.session.send('conv.list', { limit, offset });
        return extractList(data, 'conversations', parseConversation);
    }

    async getConversation(id: string): Promise<ConversationUi> {
        const data = await this.session.send('conv.get', { id });
        const parsed = parseConversation(data);
        if (parsed === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'conv.get returned an unexpected payload',
            });
        }
        return parsed;
    }

    async createConversation(title?: string): Promise<string> {
        const params: Record<string, unknown> = title !== undefined ? { title } : {};
        const data = await this.session.send('conv.create', params);
        return extractId(data, 'id');
    }

    async createConversationWithAgent(agentId: string, title?: string): Promise<string> {
        const params: Record<string, unknown> = { agent_id: agentId };
        if (title !== undefined) params['title'] = title;
        const data = await this.session.send('conv.create_with_agent', params);
        return extractId(data, 'id');
    }

    async renameConversation(id: string, title: string): Promise<void> {
        await this.session.send('conv.rename', { id, title });
    }

    async setConversationPinned(id: string, pinned: boolean): Promise<void> {
        await this.session.send('conv.set_pinned', { id, pinned });
    }

    async deleteConversation(id: string): Promise<void> {
        await this.session.send('conv.delete', { id });
    }

    /**
     * Delete a folder (Project / Organization / Regular). Wire op
     * `folder.delete { id }`; host returns a bool that we ignore in
     * favor of the `folder.deleted` event WireSync already pivots
     * the sidebar on.
     */
    async deleteFolder(folderId: string): Promise<void> {
        await this.session.send('folder.delete', { id: folderId });
    }

    async moveConversationToFolder(convId: string, folderId: string): Promise<void> {
        await this.session.send('conv.move_to_folder', {
            conv_id: convId,
            folder_id: folderId,
        });
    }

    /**
     * Single conversation "is this a group?" probe. Mirrors Android
     * `RemoteRepository.isConversationGroup`. Host op `conv.is_group`
     * [wire-session.cpp:917]. Most call sites derive this from the
     * cached row instead — this exists for the edge case where the
     * cache is stale.
     */
    async isConversationGroup(id: string): Promise<boolean> {
        const data = await this.session.send('conv.is_group', { id });
        if (!isJsonObject(data)) return false;
        return booleanOr(data['is_group'], false);
    }

    /**
     * Fetch the member roster for a group conversation. Host op
     * `conv.group_members` [wire-session.cpp:936]. Returns an empty
     * list for non-group conversations.
     */
    async getConversationGroupMembers(id: string): Promise<readonly MemberUi[]> {
        const data = await this.session.send('conv.group_members', { id });
        return extractList(data, 'members', parseMember);
    }

    /**
     * Single conversation -> folder id lookup. Host op `conv.folder_id`
     * [wire-session.cpp:944]. Returns empty string when the conv is at
     * root (not in any folder).
     */
    async getConversationFolderId(id: string): Promise<string> {
        const data = await this.session.send('conv.folder_id', { id });
        if (!isJsonObject(data)) return '';
        return optionalString(data['folder_id']) ?? '';
    }

    /**
     * Mark a conversation as the foreground / open conv for the host's
     * ChatController (does NOT change the active conv in the UI — that
     * stays a per-client decision). Used to pre-load (provider, model)
     * before the user types. Host op `conv.open` [wire-session.cpp:967].
     */
    async openConversation(
        id: string,
    ): Promise<{ readonly provider: string; readonly model: string }> {
        const data = await this.session.send('conv.open', { id });
        if (!isJsonObject(data)) return { provider: '', model: '' };
        return {
            provider: optionalString(data['provider']) ?? '',
            model: optionalString(data['model']) ?? '',
        };
    }

    // === folders ===

    async listAllFolders(): Promise<readonly FolderUi[]> {
        const data = await this.session.send('folder.list_all');
        return extractList(data, 'folders', parseFolder);
    }

    async listProjectFolders(): Promise<readonly FolderUi[]> {
        const data = await this.session.send('folder.list_projects');
        return extractList(data, 'folders', parseFolder);
    }

    async listFolderConversations(folderId: string): Promise<readonly ConversationUi[]> {
        const data = await this.session.send('folder.conversations', {
            folder_id: folderId,
        });
        return extractList(data, 'conversations', parseConversation);
    }

    async listFolderMembers(folderId: string): Promise<readonly MemberUi[]> {
        const data = await this.session.send('folder.members', { folder_id: folderId });
        return extractList(data, 'members', parseMember);
    }

    /**
     * Create a folder. The host's `folder.create` op takes only a name
     * and replies `{id, type}` with the type it created (`regular` on
     * current hosts; older hosts created `project`). Callers that want a
     * different type, or a goal / description, follow up with
     * `updateFolderMetadata` whenever `type` differs from what the user
     * picked.
     *
     * @param name human-readable folder name (non-empty).
     * @returns `{id, type}` where `type` defaults to `'project'` when
     *          the host response omits it (older hosts).
     */
    async createFolder(name: string): Promise<{ readonly id: string; readonly type: string }> {
        const data = await this.session.send('folder.create', { name });
        if (!isJsonObject(data)) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'folder.create returned an unexpected payload',
            });
        }
        const id = optionalString(data['id']);
        if (id === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'folder.create response missing id',
            });
        }
        const type = optionalString(data['type']) ?? 'project';
        return { id, type };
    }

    /**
     * Update a folder's type + metadata. Used by the create-folder
     * workflow immediately after `createFolder` when the user chose a
     * non-default type, or supplied a goal / description. Mirrors
     * Android `RemoteRepository.updateFolderMetadata` (line 356) and
     * the host op `wire-session.cpp::opFolderUpdateMetadata` (line
     * 1062-1076).
     *
     * @param id folder id returned by `createFolder`.
     * @param folderType one of `'regular' | 'project' | 'organization'`.
     * @param goal optional goal text — pass `''` for none.
     * @param description optional description — pass `''` for none.
     * @param agentIds agent ids to seed the folder roster with — pass
     *                 `[]` for none; downstream member editor flow is
     *                 expected to manage these post-create.
     */
    /**
     * Rename an existing folder. Mirrors Android
     * `RemoteRepository.renameFolder`. Host op `folder.rename` emits
     * `folder.renamed` which WireSync routes back into ProjectStore.
     */
    async renameFolder(id: string, name: string): Promise<void> {
        await this.session.send('folder.rename', { id, name });
    }

    /**
     * Single-folder metadata lookup. Host op `folder.info`
     * [wire-session.cpp:1055]. Mirrors Android
     * `RemoteRepository.getFolderInfo`. Used by FolderEditorSheet to
     * refresh its cached row before painting, so the user always sees
     * the latest goal / description / type even if another client
     * mutated them.
     */
    async getFolderInfo(id: string): Promise<FolderUi | undefined> {
        const data = await this.session.send('folder.info', { id });
        return parseFolder(data);
    }

    async updateFolderMetadata(
        id: string,
        folderType: 'regular' | 'project' | 'organization',
        goal: string,
        description: string,
        agentIds: readonly string[],
    ): Promise<void> {
        await this.session.send('folder.update_metadata', {
            id,
            folder_type: folderType,
            goal,
            description,
            agent_ids: agentIds,
        });
    }

    async listConversationMembers(convId: string): Promise<readonly MemberUi[]> {
        const data = await this.session.send('conv.members', { conv_id: convId });
        return extractList(data, 'members', parseMember);
    }

    /**
     * Idempotently open or create the 1:1 chat with the given project
     * member. Mirrors Android `RemoteRepository.openMemberChat`. Host
     * `opFolderMemberChatOpen` (wire-session.cpp:1510) wraps its
     * service result via `asyncInvokeWrapId` with the DEFAULT id key
     * — so the response shape is `{id}`, NOT `{conv_id}`. Extracting
     * the wrong key was returning a "missing conv_id" malformed-
     * response error to the UI.
     */
    async openMemberChat(folderId: string, agentId: string, alias: string): Promise<string> {
        const data = await this.session.send('folder.member.chat.open', {
            folder_id: folderId,
            agent_id: agentId,
            alias,
        });
        return extractId(data, 'id');
    }

    /**
     * "Start group chat with all members of this project." Mirrors
     * Android `RemoteRepository.kickoffGroupChat`. Host
     * `opFolderKickoffGroup` (wire-session.cpp:1503) wraps via
     * `asyncInvokeWrapId` with the DEFAULT id key — so the response
     * shape is `{id}`, NOT `{conv_id}`. Extracting the wrong key was
     * returning a "missing conv_id" malformed-response error to the
     * UI on every kickoff attempt.
     */
    async kickoffGroupChat(folderId: string): Promise<string> {
        const data = await this.session.send('folder.kickoff.group', {
            folder_id: folderId,
        });
        return extractId(data, 'id');
    }

    /**
     * "Create a 1:1 conversation with each member separately."
     * Mirrors Android `RemoteRepository.kickoffIndividualChats`
     * (line 794). Host spawns N direct chats (one per project
     * member) and returns `{created_count}` per
     * wire-session.cpp::opFolderKickoffIndividual [line 1482].
     */
    async kickoffIndividualChats(folderId: string): Promise<number> {
        const data = await this.session.send('folder.kickoff.individual', {
            folder_id: folderId,
        });
        if (!isJsonObject(data)) return 0;
        const raw = data['created_count'];
        return typeof raw === 'number' ? raw : 0;
    }

    /**
     * Create a standalone group chat with the given member set.
     * Mirrors Android `createGroup` (line 1632). Members ship in the
     * snake_case shape the wire protocol uses.
     */
    async createGroup(
        title: string,
        members: readonly {
            readonly agentId: string;
            readonly alias: string;
            readonly isCoordinator: boolean;
        }[],
        folderId?: string,
    ): Promise<string> {
        const params: Record<string, unknown> = {
            title,
            members: members.map((m) => ({
                agent_id: m.agentId,
                alias: m.alias,
                is_coordinator: m.isCoordinator,
            })),
        };
        if (folderId !== undefined && folderId.length > 0) params['folder_id'] = folderId;
        const data = await this.session.send('group.create', params);
        return extractId(data, 'id');
    }

    // === messages ===

    async listMessages(convId: string, limit = 200): Promise<readonly MessageUi[]> {
        const data = await this.session.send('msg.list', { conv_id: convId, limit });
        return extractList(data, 'messages', parseMessage);
    }

    async sendMessage(convId: string, text: string): Promise<SendMessageResult> {
        const data = await this.session.send('msg.send', {
            conv_id: convId,
            text,
        });
        return extractSendResult(data);
    }

    async stopGeneration(): Promise<void> {
        await this.session.send('msg.stop');
    }

    /**
     * Send a message with one-or-more inline attachments. The host
     * dispatches on `msg.send_with_attachments` (wire-session.cpp:587)
     * and re-validates every cap; caller should still enforce the
     * shared wire-limits (MAX_ATTACHMENTS, MAX_CONTENT_BYTES per file
     * and per-message total) client-side so the user gets a fast
     * rejection. Empty text is permitted when
     * `attachments.length > 0` (image-only messages); both empty is
     * `invalid_params`.
     *
     * Wire frame uses snake_case `filename` (NOT `file_name`) per
     * wire-session.cpp::opMsgSendWithAttachments line 2416:
     *   o.value(QStringLiteral("filename")).toString()
     */
    async sendMessageWithAttachments(
        convId: string,
        text: string,
        attachments: readonly OutgoingAttachmentUi[],
    ): Promise<void> {
        await this.session.send('msg.send_with_attachments', {
            conv_id: convId,
            text,
            attachments: attachments.map((a) => ({
                filename: a.fileName,
                mime_type: a.mimeType,
                content_base64: a.contentBase64,
            })),
        });
    }

    async subscribeMessages(convId: string): Promise<void> {
        await this.session.send('msg.subscribe', { conv_id: convId });
    }

    async unsubscribeMessages(convId: string): Promise<void> {
        await this.session.send('msg.unsubscribe', { conv_id: convId });
    }

    // === agent / model catalog ===

    async listAgents(): Promise<readonly AgentSummaryUi[]> {
        const data = await this.session.send('agent.list');
        return extractList(data, 'agents', parseAgentSummary);
    }

    /**
     * Fetch a single agent's full detail map. Used by the Configure
     * Member sheet to drill in on the chosen agent + by the agent
     * picker. Host op `agent.get` [wire-session.cpp:1295]. Mirrors
     * Android `RemoteRepository.getAgent`.
     */
    async getAgent(agentId: string): Promise<AgentSummaryUi | undefined> {
        const data = await this.session.send('agent.get', { id: agentId });
        return parseAgentSummary(data);
    }

    /**
     * Read a conversation's settings (`conv.settings.get`).
     *
     * The RAG flag is taken from the conversation row's stored
     * `llm_config.rag_enabled` (`conv.get`), because the host's
     * `conv.settings.get` reply reports `ragEnabled` as false for every
     * conversation. When `conv.get` fails or carries no config, the
     * settings reply's value is kept.
     *
     * @param convId the conversation id.
     * @returns the parsed settings.
     * @throws RemoteOpError when the settings reply is malformed or the op fails.
     */
    async getConversationSettings(convId: string): Promise<ConvSettingsUi> {
        const [data, ragEnabled] = await Promise.all([
            this.session.send('conv.settings.get', { conv_id: convId }),
            this.getStoredRagEnabled(convId),
        ]);
        const parsed = parseConvSettings(data);
        if (parsed === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'conv.settings.get returned an unexpected payload',
            });
        }
        return ragEnabled === undefined ? parsed : { ...parsed, ragEnabled };
    }

    /**
     * Read the stored per-conversation RAG flag from `conv.get`'s
     * `llm_config`. Returns `undefined` when it cannot be read, so the
     * caller keeps its own value. A conversation with no saved config
     * reports `false`, the host default.
     */
    private async getStoredRagEnabled(convId: string): Promise<boolean | undefined> {
        let data: unknown;
        try {
            data = await this.session.send('conv.get', { id: convId });
        } catch {
            return undefined;
        }
        if (!isJsonObject(data) || !('llm_config' in data)) return undefined;
        const cfg = data['llm_config'];
        if (cfg === null) return false;
        if (!isJsonObject(cfg)) return undefined;
        return booleanOr(cfg['rag_enabled'] ?? cfg['ragEnabled'], false);
    }

    async saveConversationSettings(convId: string, patch: ConvSettingsPatch): Promise<void> {
        // The host's `opConvSettingsSave` (wire-session.cpp:1802) only
        // honors these six fields. Heartbeat-gate fields (W14) go via
        // `conv.heartbeat.gate.set`; provider/model go via
        // `models.set_active`. ConvSettingsPatch's type now reflects
        // that — sending anything else would silently drop.
        const params: Record<string, unknown> = { conv_id: convId };
        if (patch.systemPrompt !== undefined) params['system_prompt'] = patch.systemPrompt;
        if (patch.temperature !== undefined) params['temperature'] = patch.temperature;
        if (patch.maxTokens !== undefined) params['max_tokens'] = patch.maxTokens;
        if (patch.contextWindow !== undefined) params['context_window'] = patch.contextWindow;
        if (patch.streaming !== undefined) params['streaming'] = patch.streaming;
        if (patch.thinking !== undefined) params['thinking'] = patch.thinking;
        if (patch.ragEnabled !== undefined) params['rag_enabled'] = patch.ragEnabled;
        if (patch.topK !== undefined) params['top_k'] = patch.topK;
        if (patch.topP !== undefined) params['top_p'] = patch.topP;
        if (patch.repeatPenalty !== undefined) params['repeat_penalty'] = patch.repeatPenalty;
        if (patch.presencePenalty !== undefined) params['presence_penalty'] = patch.presencePenalty;
        if (patch.frequencyPenalty !== undefined)
            params['frequency_penalty'] = patch.frequencyPenalty;
        if (patch.forceAppSampling !== undefined)
            params['force_app_sampling'] = patch.forceAppSampling;
        if (patch.toolsInSystemPrompt !== undefined)
            params['tools_in_system_prompt'] = patch.toolsInSystemPrompt;
        if (patch.dynamicCompactEnabled !== undefined)
            params['dynamic_compact_enabled'] = patch.dynamicCompactEnabled;
        if (patch.compactEveryTurns !== undefined) {
            // Host clamps to [0, 500]; clamp client-side too so the
            // request stays well-formed (0 = cadence trigger off).
            params['compact_every_turns'] = Math.max(
                0,
                Math.min(500, Math.round(patch.compactEveryTurns)),
            );
        }
        await this.session.send('conv.settings.save', params);
    }

    /**
     * Per-conversation heartbeat-gate state (the auto-surface flag +
     * daily cap that govern whether scheduled heartbeat reports post
     * into the conversation). Read via the dedicated op
     * `conv.heartbeat.gate` (wire-session.cpp:1835) which chains two
     * reads on the host and returns `{ allow, max_per_day }`.
     */
    async getConvHeartbeatGate(
        convId: string,
    ): Promise<{ readonly allow: boolean; readonly maxPerDay: number }> {
        const data = await this.session.send('conv.heartbeat.gate', { conv_id: convId });
        if (!isJsonObject(data)) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'conv.heartbeat.gate returned an unexpected payload',
            });
        }
        const allow = booleanOr(data['allow'], false);
        const maxPerDay = (() => {
            const raw = data['max_per_day'];
            if (typeof raw === 'number' && Number.isFinite(raw))
                return Math.max(1, Math.round(raw));
            return 1;
        })();
        return { allow, maxPerDay };
    }

    /**
     * Set per-conversation heartbeat-gate state via the dedicated
     * `conv.heartbeat.gate.set` op (wire-session.cpp:1862). The host
     * clamps `max_per_day` into [1, 24] internally; we clamp on the
     * client side too so the request stays well-formed.
     */
    async setConvHeartbeatGate(convId: string, allow: boolean, maxPerDay: number): Promise<void> {
        const clamped = Math.max(1, Math.min(24, Math.round(maxPerDay)));
        await this.session.send('conv.heartbeat.gate.set', {
            conv_id: convId,
            allow,
            max_per_day: clamped,
        });
    }

    async getConversationPrimaryAgent(convId: string): Promise<string> {
        const data = await this.session.send('conv.primary_agent', { conv_id: convId });
        if (!isJsonObject(data)) return '';
        return optionalString(data['agent_id']) ?? '';
    }

    async setConversationPrimaryAgent(convId: string, agentId: string): Promise<void> {
        await this.session.send('conv.primary_agent.set', {
            conv_id: convId,
            agent_id: agentId,
        });
    }

    async getAgentPattern(convId: string): Promise<AgentPattern> {
        const data = await this.session.send('agent.pattern', { conv_id: convId });
        if (!isJsonObject(data)) return 'direct';
        const raw = optionalString(data['pattern']) ?? 'direct';
        const allowed: readonly AgentPattern[] = [
            'direct',
            'react',
            'planner',
            'router',
            'multi_agent',
            'memory',
        ];
        return (allowed as readonly string[]).includes(raw) ? (raw as AgentPattern) : 'direct';
    }

    async setAgentPattern(convId: string, pattern: AgentPattern): Promise<void> {
        await this.session.send('agent.pattern.set', { conv_id: convId, pattern });
    }

    async getRequireConfirmation(convId: string): Promise<boolean> {
        const data = await this.session.send('agent.require_confirmation', {
            conv_id: convId,
        });
        if (!isJsonObject(data)) return false;
        // Host returns `{require: bool}` per wire-session.cpp:1947. Older
        // payload variants are tolerated defensively.
        return booleanOr(data['require'] ?? data['require_confirmation'] ?? data['enabled'], false);
    }

    async setRequireConfirmation(convId: string, require: boolean): Promise<void> {
        // Host opAgentRequireConfirmSet reads params.value("require") at
        // wire-session.cpp:1951. Sending `require_confirmation` would be
        // silently dropped — the host always wrote false.
        await this.session.send('agent.require_confirmation.set', {
            conv_id: convId,
            require,
        });
    }

    async getToolsEnabled(convId: string): Promise<boolean> {
        const data = await this.session.send('tools.enabled', { conv_id: convId });
        if (!isJsonObject(data)) return true;
        return booleanOr(data['enabled'], true);
    }

    async setToolsEnabled(convId: string, enabled: boolean): Promise<void> {
        await this.session.send('tools.enabled.set', { conv_id: convId, enabled });
    }

    // RAG has no dedicated op. It is a per-conversation flag carried by
    // conv.settings.{get,save} as `ragEnabled` / `rag_enabled`; the host
    // deleted the old host-global `rag.enabled` and `rag.enabled.set`, which
    // now answer `unknown_op`. Write it through saveConversationSettings.

    async listClients(): Promise<readonly ClientUi[]> {
        const data = await this.session.send('clients.list');
        return extractList(data, 'clients', parseClient);
    }

    async revokeClient(clientId: string): Promise<void> {
        await this.session.send('clients.revoke', { client_id: clientId });
    }

    async listTools(): Promise<readonly ToolUi[]> {
        const data = await this.session.send('tool.list');
        return extractList(data, 'tools', parseTool);
    }

    async listMcpServers(): Promise<readonly McpServerUi[]> {
        const data = await this.session.send('mcp.list');
        return extractList(data, 'servers', parseMcpServer);
    }

    async listSkills(): Promise<readonly SkillUi[]> {
        const data = await this.session.send('skill.list');
        return extractList(data, 'skills', parseSkill);
    }

    /**
     * Fetch the host's provider+model catalog. Mirrors Android
     * `RemoteRepository.getModelCatalog` (line 1661). The host
     * dispatches on `models.catalog` per
     * `wire-session.cpp::opModelsCatalog` around line 1114 and returns
     * `{ providers, active_provider, active_model }`. Empty arrays /
     * strings are valid responses ("no providers configured yet").
     */
    async getModelCatalog(): Promise<ModelCatalogUi> {
        const data = await this.session.send('models.catalog');
        const parsed = parseModelCatalog(data);
        if (parsed === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'models.catalog returned an unexpected payload',
            });
        }
        return parsed;
    }

    /**
     * Switch the host's active provider+model. Fire-and-forget — the
     * host replies `{ queued: true }` and emits a `models.active_changed`
     * event when the switch lands. Mirrors Android
     * `RemoteRepository.setActiveModel` (line 1671).
     */
    async setActiveModel(providerId: string, modelName: string): Promise<void> {
        await this.session.send('models.set_active', {
            provider_id: providerId,
            model_name: modelName,
        });
    }

    /**
     * Read the host's current active {provider, model} pair without
     * triggering a catalog refresh. Mirrors Android
     * `RemoteRepository.getActiveModel`. Host op `models.active`
     * [wire-session.cpp:1245].
     */
    async getActiveModel(): Promise<{ readonly providerId: string; readonly modelName: string }> {
        const data = await this.session.send('models.active');
        if (!isJsonObject(data)) return { providerId: '', modelName: '' };
        return {
            providerId: optionalString(data['provider']) ?? '',
            modelName: optionalString(data['model']) ?? '',
        };
    }

    /**
     * List the models offered by a specific provider — feeds the
     * model picker dropdown when the user switches provider mid-stream
     * (so we don't need to re-pull the full catalog). Mirrors
     * Android `RemoteRepository.getModelsForProvider`. Host op
     * `models.for_provider` [wire-session.cpp:1271].
     */
    async getModelsForProvider(providerId: string): Promise<readonly string[]> {
        const data = await this.session.send('models.for_provider', {
            provider_id: providerId,
        });
        if (Array.isArray(data)) {
            return data.filter((m): m is string => typeof m === 'string');
        }
        if (isJsonObject(data) && Array.isArray(data['models'])) {
            return (data['models'] as unknown[]).filter((m): m is string => typeof m === 'string');
        }
        return [];
    }

    /**
     * Fetch the host's web-search provider catalogue. Host op
     * `search.providers` returns the provider list as a JSON array.
     */
    async getSearchProviders(): Promise<SearchProvidersCatalogUi> {
        const data = await this.session.send('search.providers');
        const parsed = parseSearchProviders(data);
        if (parsed === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'search.providers returned an unexpected payload',
            });
        }
        return parsed;
    }

    /**
     * Switch the host's active web-search provider. Fire-and-forget — the
     * host replies `{ queued: true }`. API keys are host-only and are never
     * sent over the wire. Host op `search.set_active`.
     */
    async setActiveSearchProvider(providerId: string): Promise<void> {
        await this.session.send('search.set_active', { provider_id: providerId });
    }

    // === tool calls (confirmation modal + log surface) ===

    /**
     * Approve a pending tool-call confirmation. Host op
     * `tool_call.approve` per `wire-session.cpp::opToolCallApprove`;
     * mirrors Android `RemoteRepository.approveToolCall` (line 1378).
     * Host responds `{queued: true}` and dispatches the tool
     * synchronously on the originator's chat controller — the
     * `tool_call.completed` event will follow once the tool returns.
     */
    async approveToolCall(callId: string): Promise<void> {
        await this.session.send('tool_call.approve', { call_id: callId });
    }

    /**
     * Deny a pending tool-call confirmation. Host op
     * `tool_call.deny` per `wire-session.cpp::opToolCallDeny`;
     * mirrors Android `RemoteRepository.denyToolCall` (line 1389).
     * The host treats this as a hard refuse — the assistant turn
     * continues with the tool call marked as denied.
     */
    async denyToolCall(callId: string): Promise<void> {
        await this.session.send('tool_call.deny', { call_id: callId });
    }

    // === folder + conversation membership (full MembershipEditor parity) ===

    /**
     * Replace a folder's member roster wholesale. The host op
     * `folder.members.set` rewrites every row, so any per-member field a
     * row does not carry is reset to the host default. To keep a roster
     * save from wiping settings made on the desktop, each row carries the
     * member's model override, tool allowlist and provenance whenever the
     * caller has them. See `folderMemberWireRow` for the exact mapping.
     *
     * @param folderId Project folder id.
     * @param members  Complete roster in camelCase UI shape.
     */
    async setFolderMembers(folderId: string, members: readonly FolderMemberRow[]): Promise<void> {
        await this.session.send('folder.members.set', {
            folder_id: folderId,
            members: members.map(folderMemberWireRow),
        });
    }

    /**
     * Set one project member's provider, model and tool allowlist without
     * replacing the rest of the roster. Host op `folder.member.override.set`.
     * An empty provider, model or tool list clears that override.
     *
     * @param folderId Project folder id.
     * @param alias    The member's saved alias (the host matches on it).
     * @param override Provider, model and tool allowlist to store.
     * @returns true when the host updated a member, false when it answered
     *          anything else (no member with that alias in the folder).
     */
    async setFolderMemberOverride(
        folderId: string,
        alias: string,
        override: {
            readonly modelProvider: string;
            readonly modelName: string;
            readonly allowedTools: readonly string[];
        },
    ): Promise<boolean> {
        const data = await this.session.send('folder.member.override.set', {
            folder_id: folderId,
            alias,
            model_provider: override.modelProvider,
            model_name: override.modelName,
            allowed_tools: [...override.allowedTools],
        });
        return data === true;
    }

    /**
     * Add one member to a folder roster. The host validates the
     * alias is unique within the folder; treat
     * `invalid_params: alias 'X' already exists` as a benign no-op
     * (re-adding an already-rostered member is a noop on the host
     * side too — mirrors Android `rollMembersIntoProjectRoster` at
     * `MainViewModel.kt:3300`).
     */
    async addFolderMember(
        folderId: string,
        agentId: string,
        alias: string,
        isCoordinator = false,
    ): Promise<void> {
        await this.session.send('folder.member.add', {
            folder_id: folderId,
            agent_id: agentId,
            alias,
            is_coordinator: isCoordinator,
        });
    }

    /** Remove one member from a folder roster (by alias). */
    async removeFolderMember(folderId: string, alias: string): Promise<void> {
        await this.session.send('folder.member.remove', {
            folder_id: folderId,
            alias,
        });
    }

    /**
     * Replace a conversation's member roster wholesale (group-chat
     * member management). Mirrors `setFolderMembers` but for the
     * conv-scoped op `conv.members.set`.
     */
    async setConversationMembers(
        convId: string,
        members: readonly {
            readonly agentId: string;
            readonly alias: string;
            readonly isCoordinator: boolean;
        }[],
    ): Promise<void> {
        await this.session.send('conv.members.set', {
            conv_id: convId,
            members: members.map((m) => ({
                agent_id: m.agentId,
                alias: m.alias,
                is_coordinator: m.isCoordinator,
            })),
        });
    }

    async addConversationMember(
        convId: string,
        agentId: string,
        alias: string,
        isCoordinator = false,
    ): Promise<void> {
        await this.session.send('conv.member.add', {
            conv_id: convId,
            agent_id: agentId,
            alias,
            is_coordinator: isCoordinator,
        });
    }

    async removeConversationMember(convId: string, alias: string): Promise<void> {
        await this.session.send('conv.member.remove', {
            conv_id: convId,
            alias,
        });
    }

    /**
     * Promote one alias to coordinator (radio-style — all other
     * members are unmarked). Pass `''` to clear the coordinator.
     */
    async setConversationCoordinator(convId: string, alias: string): Promise<void> {
        await this.session.send('conv.coordinator.set', {
            conv_id: convId,
            alias,
        });
    }

    // === heartbeats (scheduled subagent runs) ===

    /**
     * List heartbeat configs scoped to a folder (project / org).
     * Mirrors Android `RemoteRepository.listHeartbeatConfigsForFolder`
     * (line 1196). Host op `heartbeat.configs_for_folder`.
     */
    async listHeartbeatConfigsForFolder(folderId: string): Promise<readonly HeartbeatConfigUi[]> {
        const data = await this.session.send('heartbeat.configs_for_folder', {
            folder_id: folderId,
        });
        return extractList(data, 'configs', parseHeartbeatConfig);
    }

    /**
     * Per-conversation heartbeat list. Host op
     * `heartbeat.configs_for_conversation` [wire-session.cpp:1601].
     * Mirrors Android `RemoteRepository.listHeartbeatConfigsForConversation`.
     */
    async listHeartbeatConfigsForConversation(
        convId: string,
    ): Promise<readonly HeartbeatConfigUi[]> {
        const data = await this.session.send('heartbeat.configs_for_conversation', {
            conv_id: convId,
        });
        return extractList(data, 'configs', parseHeartbeatConfig);
    }

    /**
     * Single heartbeat config fetch (e.g. after a foreign-client edit
     * fires `heartbeat.config.changed`). Host op `heartbeat.config_by_id`
     * [wire-session.cpp:1608].
     */
    async getHeartbeatConfigById(id: string): Promise<HeartbeatConfigUi | undefined> {
        const data = await this.session.send('heartbeat.config_by_id', { id });
        return parseHeartbeatConfig(data);
    }

    /**
     * Next-fires preview (top-N enabled configs by upcoming fire time).
     * Limit host-clamped to [1,100]. Host op
     * `heartbeat.next_fires_preview` [wire-session.cpp:1661].
     */
    async listHeartbeatNextFiresPreview(
        limit?: number,
    ): Promise<readonly { readonly configId: string; readonly nextFireAtMs: number }[]> {
        const params: Record<string, unknown> = {};
        if (typeof limit === 'number') params['limit'] = limit;
        const data = await this.session.send('heartbeat.next_fires_preview', params);
        if (!isJsonObject(data)) return [];
        const list = data['previews'];
        if (!Array.isArray(list)) return [];
        return list.flatMap((row): { configId: string; nextFireAtMs: number }[] => {
            if (!isJsonObject(row)) return [];
            const configId = optionalString(row['config_id']) ?? optionalString(row['configId']);
            const ms =
                typeof row['next_fire_at_ms'] === 'number'
                    ? row['next_fire_at_ms']
                    : typeof row['nextFireAtMs'] === 'number'
                      ? row['nextFireAtMs']
                      : null;
            if (configId === undefined || ms === null) return [];
            return [{ configId, nextFireAtMs: ms }];
        });
    }

    /**
     * Recent heartbeat-config changes audit log. Limit clamped
     * [1,500]. Host op `heartbeat.recent_config_changes`
     * [wire-session.cpp:1668].
     */
    async listHeartbeatRecentConfigChanges(limit?: number): Promise<
        readonly {
            readonly id: string;
            readonly configId: string;
            readonly changedAtMs: number;
            readonly field: string;
            readonly oldValue: string;
            readonly newValue: string;
            readonly source: string;
            readonly alias: string;
            readonly agentId: string;
        }[]
    > {
        const params: Record<string, unknown> = {};
        if (typeof limit === 'number') params['limit'] = limit;
        const data = await this.session.send('heartbeat.recent_config_changes', params);
        if (!isJsonObject(data)) return [];
        const list = data['changes'];
        if (!Array.isArray(list)) return [];
        return list.flatMap((row) => {
            if (!isJsonObject(row)) return [];
            return [
                {
                    id: optionalString(row['id']) ?? '',
                    configId: optionalString(row['config_id'] ?? row['configId']) ?? '',
                    changedAtMs:
                        typeof row['changed_at_ms'] === 'number'
                            ? row['changed_at_ms']
                            : typeof row['changedAtMs'] === 'number'
                              ? row['changedAtMs']
                              : 0,
                    field: optionalString(row['field']) ?? '',
                    oldValue: optionalString(row['old_value'] ?? row['oldValue']) ?? '',
                    newValue: optionalString(row['new_value'] ?? row['newValue']) ?? '',
                    source: optionalString(row['source']) ?? '',
                    alias: optionalString(row['alias']) ?? '',
                    agentId: optionalString(row['agent_id'] ?? row['agentId']) ?? '',
                },
            ];
        });
    }

    /**
     * Suggested auto-surface cap for a specific conversation. Host op
     * `heartbeat.suggested_cap_for_conv` [wire-session.cpp:1697].
     */
    async getSuggestedHeartbeatCapForConv(convId: string): Promise<number> {
        const data = await this.session.send('heartbeat.suggested_cap_for_conv', {
            conv_id: convId,
        });
        if (!isJsonObject(data)) return 0;
        const cap = data['cap'];
        return typeof cap === 'number' ? cap : 0;
    }

    /**
     * Suggested auto-surface cap for a folder. Host op
     * `heartbeat.suggested_cap_for_folder` [wire-session.cpp:1715].
     */
    async getSuggestedHeartbeatCapForFolder(folderId: string): Promise<number> {
        const data = await this.session.send('heartbeat.suggested_cap_for_folder', {
            folder_id: folderId,
        });
        if (!isJsonObject(data)) return 0;
        const cap = data['cap'];
        return typeof cap === 'number' ? cap : 0;
    }

    /**
     * Insert or update a heartbeat config. Omit `id` to insert; pass
     * the existing id to update. The host replaces the whole row, so
     * `surfaceCriteria` and `selfConfigAllowed` must carry the current
     * values when editing, or they are cleared. The host replies with
     * the id as a bare string and emits `heartbeat.config.changed`.
     *
     * `schedule` empty = manual fire only. `enabled` toggles whether
     * the cron fires; manual runs bypass the flag.
     *
     * @returns the config id.
     */
    async upsertHeartbeatConfig(input: {
        readonly id?: string;
        readonly agentId: string;
        readonly scopeType: 'folder' | 'conversation';
        readonly scopeId: string;
        readonly alias: string;
        readonly enabled: boolean;
        readonly schedule: string;
        readonly goal: string;
        readonly autoSurfaceTargetConversationId?: string;
        readonly maxRunsPerDay?: number;
        readonly surfaceCriteria?: string;
        readonly selfConfigAllowed?: boolean;
    }): Promise<string> {
        const params: Record<string, unknown> = {
            agent_id: input.agentId,
            scope_type: input.scopeType,
            scope_id: input.scopeId,
            alias: input.alias,
            enabled: input.enabled,
            schedule: input.schedule,
            goal: input.goal,
            surface_criteria: input.surfaceCriteria ?? '',
            max_runs_per_day: input.maxRunsPerDay ?? 0,
            auto_surface_target_conversation_id: input.autoSurfaceTargetConversationId ?? '',
            self_config_allowed: input.selfConfigAllowed ?? false,
        };
        if (input.id !== undefined && input.id.length > 0) {
            params['id'] = input.id;
        }
        const data = await this.session.send('heartbeat.upsert', params);
        return extractIdOrString(data, 'id');
    }

    /** Delete a heartbeat config. Host op `heartbeat.remove`. */
    async removeHeartbeatConfig(id: string): Promise<void> {
        await this.session.send('heartbeat.remove', { id });
    }

    /**
     * Fire a heartbeat immediately, bypassing its cron schedule.
     * Returns the run id so the caller can correlate with the
     * follow-up message events on the target conversation.
     */
    async runHeartbeatNow(id: string): Promise<string> {
        const data = await this.session.send('heartbeat.run_now', { id });
        if (!isJsonObject(data)) return '';
        return optionalString(data['run_id']) ?? '';
    }

    // === preferred skills (per-folder allowlist) ===

    /**
     * List preferred-skill ids for a folder. Empty list = "no
     * preference; all skills available".
     */
    async listPreferredSkills(folderId: string): Promise<readonly string[]> {
        const data = await this.session.send('skill.preferred.list', {
            scope_type: 'folder',
            scope_id: folderId,
        });
        return parseSkillIds(data);
    }

    /** Replace the preferred-skill set for a folder. */
    async setPreferredSkills(folderId: string, skillIds: readonly string[]): Promise<void> {
        await this.session.send('skill.preferred.set', {
            scope_type: 'folder',
            scope_id: folderId,
            skill_ids: skillIds,
        });
    }

    /**
     * Read the "expose only preferred" flag for a folder. When true,
     * non-preferred skills are hidden from the assistant entirely on
     * conversations under this folder. When false, prefs are a hint
     * — non-preferred skills remain available.
     */
    async getExposeOnlyPreferred(folderId: string): Promise<boolean> {
        const data = await this.session.send('skill.expose_only_preferred', {
            scope_type: 'folder',
            scope_id: folderId,
        });
        if (!isJsonObject(data)) return false;
        return booleanOr(data['expose_only'] ?? data['exposeOnly'], false);
    }

    async setExposeOnlyPreferred(folderId: string, exposeOnly: boolean): Promise<void> {
        await this.session.send('skill.set_expose_only_preferred', {
            scope_type: 'folder',
            scope_id: folderId,
            expose_only: exposeOnly,
        });
    }

    // === project documents ===

    /**
     * List uploaded project documents for a folder. Mirrors Android
     * `RemoteRepository.listFolderDocuments`. Empty list when no
     * documents have been uploaded yet.
     */
    async listFolderDocuments(
        folderId: string,
    ): Promise<readonly { readonly name: string; readonly size: number }[]> {
        const data = await this.session.send('folder.documents', {
            folder_id: folderId,
        });
        // The host replies with a bare array of `{name, path, size}`.
        const raw = Array.isArray(data)
            ? data
            : isJsonObject(data)
              ? (data['documents'] ?? data['files'])
              : undefined;
        if (!Array.isArray(raw)) return [];
        const out: { name: string; size: number }[] = [];
        for (const item of raw) {
            if (item === null || typeof item !== 'object') continue;
            const o = item as Record<string, unknown>;
            const name = optionalString(o['name'] ?? o['file_name'] ?? o['fileName']);
            if (name === undefined) continue;
            const sizeRaw = o['size'];
            const size = typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) ? sizeRaw : 0;
            out.push({ name, size });
        }
        return out;
    }

    /**
     * Upload a base64-encoded document to a folder. The host bounds the
     * decoded payload by the shared content cap (kMaxContentBytes) →
     * caller should reject sources larger than MAX_CONTENT_BYTES.
     * Filename safety (no `/`, `\`, `..`, leading `.`) mirrors
     * `MembershipEditor`'s validation.
     */
    async uploadFolderDocument(
        folderId: string,
        fileName: string,
        contentBase64: string,
    ): Promise<void> {
        await this.session.send('folder.documents.upload', {
            folder_id: folderId,
            file_name: fileName,
            content_base64: contentBase64,
        });
    }

    async removeFolderDocument(folderId: string, fileName: string): Promise<void> {
        await this.session.send('folder.documents.remove', {
            folder_id: folderId,
            file_name: fileName,
        });
    }

    // === plans / tasks / steps ===

    async listPlansForConversation(convId: string): Promise<readonly PlanUi[]> {
        const data = await this.session.send('plan.list_for_conv', { conv_id: convId });
        return extractList(data, 'plans', parsePlan);
    }

    async getPlan(id: string): Promise<PlanUi | undefined> {
        const data = await this.session.send('plan.get', { id });
        return parsePlan(data);
    }

    async startTask(convId: string, goal: string): Promise<void> {
        await this.session.send('task.start', { conv_id: convId, goal });
    }

    /** Stop one plan. Throws when the host refuses (for example, an unknown plan). */
    async stopPlan(id: string, reason = 'Stopped by user'): Promise<void> {
        expectAccepted(await this.session.send('plan.stop', { plan_id: id, reason }), 'plan.stop');
    }

    async stopAllPlansInConversation(convId: string): Promise<number> {
        const data = await this.session.send('plan.stop_all_in_conv', { conv_id: convId });
        if (!isJsonObject(data)) return 0;
        const n = data['stopped_count'] ?? data['stoppedCount'];
        return typeof n === 'number' && Number.isFinite(n) ? n : 0;
    }

    /** Retry a plan step. Throws when the host refuses. */
    async retryStep(stepId: string, notes = ''): Promise<void> {
        expectAccepted(
            await this.session.send('step.retry', { step_id: stepId, notes }),
            'step.retry',
        );
    }

    /** Mark a plan step done. Throws when the host refuses. */
    async overrideStepDone(stepId: string): Promise<void> {
        expectAccepted(
            await this.session.send('step.override_done', { step_id: stepId }),
            'step.override_done',
        );
    }

    /** Skip a plan step. Throws when the host refuses. */
    async skipStep(stepId: string, reason = 'Skipped by user'): Promise<void> {
        expectAccepted(
            await this.session.send('step.skip', { step_id: stepId, reason }),
            'step.skip',
        );
    }

    // === tool call log ===

    async listToolCallsForConv(convId: string): Promise<readonly ToolCallLogUi[]> {
        const data = await this.session.send('tool_call.list_for_conv', { conv_id: convId });
        return extractList(data, 'tool_calls', parseToolCallLog);
    }

    async listToolCallsForMessage(messageId: string): Promise<readonly ToolCallLogUi[]> {
        const data = await this.session.send('tool_call.list_for_message', {
            message_id: messageId,
        });
        return extractList(data, 'tool_calls', parseToolCallLog);
    }

    async getToolCall(id: string): Promise<ToolCallLogUi | undefined> {
        const data = await this.session.send('tool_call.get', { id });
        return parseToolCallLog(data);
    }

    // === activity log ===

    async activityForProject(folderId: string, limit = 100): Promise<readonly ActivityEventUi[]> {
        const data = await this.session.send('activity.for_project', {
            folder_id: folderId,
            limit,
        });
        return extractList(data, 'events', parseActivityEvent);
    }

    async activityForConversation(
        convId: string,
        limit = 100,
    ): Promise<readonly ActivityEventUi[]> {
        const data = await this.session.send('activity.for_conversation', {
            conv_id: convId,
            limit,
        });
        return extractList(data, 'events', parseActivityEvent);
    }

    async activityByTurn(turnId: string): Promise<readonly ActivityEventUi[]> {
        const data = await this.session.send('activity.by_turn', { turn_id: turnId });
        return extractList(data, 'events', parseActivityEvent);
    }

    // === polls ===

    async listPollsForConversation(convId: string, openOnly = false): Promise<readonly PollUi[]> {
        const data = await this.session.send('poll.list', {
            conv_id: convId,
            open_only: openOnly,
        });
        return extractList(data, 'polls', parsePoll);
    }

    async getPollResults(pollId: string): Promise<PollUi | undefined> {
        const data = await this.session.send('poll.results', { poll_id: pollId });
        return parsePoll(data);
    }

    async startPoll(
        convId: string,
        question: string,
        options: readonly string[],
        mode: 'single' | 'multi' = 'single',
        closesInMinutes = 0,
    ): Promise<string> {
        const data = await this.session.send('poll.start', {
            conv_id: convId,
            question,
            options,
            mode,
            closes_in_minutes: closesInMinutes,
        });
        return extractId(data, 'poll_id');
    }

    async castPollVote(
        pollId: string,
        optionId: string | undefined,
        optionText: string | undefined,
    ): Promise<void> {
        const params: Record<string, unknown> = { poll_id: pollId };
        if (optionId !== undefined && optionId.length > 0) params['option_id'] = optionId;
        if (optionText !== undefined && optionText.length > 0) params['option_text'] = optionText;
        // The host answers `false` when the vote is refused, for example
        // on a closed poll.
        expectAccepted(await this.session.send('poll.vote', params), 'poll.vote');
    }

    /** Close a poll. Throws when the host refuses. */
    async closePoll(pollId: string): Promise<void> {
        expectAccepted(await this.session.send('poll.close', { poll_id: pollId }), 'poll.close');
    }

    // === media + artifacts ===

    async listImagesForConv(convId: string): Promise<readonly GeneratedFileUi[]> {
        const data = await this.session.send('image.list_for_conv', { conv_id: convId });
        return extractList(data, 'images', parseGeneratedFile);
    }

    async listAudioForConv(convId: string): Promise<readonly GeneratedFileUi[]> {
        const data = await this.session.send('audio.list_for_conv', { conv_id: convId });
        return extractList(data, 'audios', parseGeneratedFile);
    }

    async listArtifactsForConv(convId: string): Promise<readonly GeneratedFileUi[]> {
        const data = await this.session.send('artifact.list_for_conv', { conv_id: convId });
        return extractList(data, 'artifacts', parseGeneratedFile);
    }

    // === MCP server tools detail ===

    async listMcpServerTools(serverName: string): Promise<readonly ToolUi[]> {
        const data = await this.session.send('mcp.server_tools', { server_name: serverName });
        return extractList(data, 'tools', parseTool);
    }

    // === skill detail ===

    async getSkill(id: string): Promise<SkillUi | undefined> {
        const data = await this.session.send('skill.get', { id });
        return parseSkill(data);
    }

    // === conv-scope skill override ===

    async getOverrideParentFolder(convId: string): Promise<boolean> {
        const data = await this.session.send('skill.override_parent_folder', { conv_id: convId });
        if (!isJsonObject(data)) return false;
        return booleanOr(data['override'], false);
    }

    async setOverrideParentFolder(convId: string, override: boolean): Promise<void> {
        await this.session.send('skill.set_override_parent_folder', {
            conv_id: convId,
            override,
        });
    }

    // === conv-scope preferred skills ===

    /**
     * List a chat's preferred-skill ids. The host keys chat preferences
     * by `conversation_group` or `conversation_1to1`, matching the
     * conversation type.
     *
     * @param convId the conversation id.
     * @param isGroup whether the chat is a group; looked up with
     *        `conv.is_group` when not known.
     */
    async listConvPreferredSkills(convId: string, isGroup?: boolean): Promise<readonly string[]> {
        const data = await this.session.send('skill.preferred.list', {
            scope_type: await this.convSkillScope(convId, isGroup),
            scope_id: convId,
        });
        return parseSkillIds(data);
    }

    /**
     * Replace a chat's preferred-skill set, under the scope the host's
     * skill resolver reads for that conversation type.
     *
     * @param convId the conversation id.
     * @param skillIds the new preferred set.
     * @param isGroup whether the chat is a group; looked up when not known.
     */
    async setConvPreferredSkills(
        convId: string,
        skillIds: readonly string[],
        isGroup?: boolean,
    ): Promise<void> {
        await this.session.send('skill.preferred.set', {
            scope_type: await this.convSkillScope(convId, isGroup),
            scope_id: convId,
            skill_ids: skillIds,
        });
    }

    private async convSkillScope(convId: string, isGroup: boolean | undefined): Promise<string> {
        const group = isGroup ?? (await this.isConversationGroup(convId));
        return group ? 'conversation_group' : 'conversation_1to1';
    }

    // === heartbeat ancillaries ===

    async getHeartbeatConfigStatus(id: string): Promise<{
        readonly status: string;
        readonly lastRunAt: number;
    }> {
        const data = await this.session.send('heartbeat.config_status', { id });
        if (!isJsonObject(data)) return { status: 'unknown', lastRunAt: 0 };
        return {
            status: optionalString(data['status']) ?? 'unknown',
            lastRunAt:
                typeof data['last_run_at'] === 'number' && Number.isFinite(data['last_run_at'])
                    ? data['last_run_at']
                    : typeof data['lastRunAt'] === 'number' && Number.isFinite(data['lastRunAt'])
                      ? data['lastRunAt']
                      : 0,
        };
    }

    async cancelHeartbeatRun(runId: string): Promise<void> {
        await this.session.send('heartbeat.cancel_run', { run_id: runId });
    }

    async manualPostHeartbeatReport(reportId: string, targetConvId: string): Promise<void> {
        await this.session.send('heartbeat.manual_post', {
            report_id: reportId,
            target_conv_id: targetConvId,
        });
    }

    async manualDismissHeartbeatReport(reportId: string): Promise<void> {
        await this.session.send('heartbeat.manual_dismiss', { report_id: reportId });
    }

    /**
     * Recent runs of one heartbeat. The host's `heartbeat.recent_runs`
     * ignores `id` and returns the latest runs of every heartbeat, so
     * this asks for the host's maximum and keeps only this config's rows.
     *
     * @param id the heartbeat config id.
     * @param limit how many recent runs (of all heartbeats) to scan.
     * @returns this heartbeat's runs, newest first.
     */
    async listRecentHeartbeatRuns(id: string, limit = 200): Promise<readonly HeartbeatRunUi[]> {
        const data = await this.session.send('heartbeat.recent_runs', { id, limit });
        return extractList(data, 'runs', parseHeartbeatRun).filter((r) => r.configId === id);
    }

    // === project templates ===

    /**
     * Full catalog (built-ins + user-saved). Mirrors Android
     * `RemoteRepository.listProjectTemplates`.
     */
    async listProjectTemplates(): Promise<readonly ProjectTemplateUi[]> {
        const data = await this.session.send('project_template.list');
        return extractList(data, 'templates', parseProjectTemplate);
    }

    /**
     * Landing-screen subset: built-ins + user-pinned user templates.
     * Mirrors Android `listLandingProjectTemplates`.
     */
    async listLandingProjectTemplates(): Promise<readonly ProjectTemplateUi[]> {
        const data = await this.session.send('project_template.list_landing');
        return extractList(data, 'templates', parseProjectTemplate);
    }

    /**
     * Spin up a new project folder from a template. Customisations
     * override template defaults (name / scenario / goal /
     * description / members / seed_documents). Empty
     * `customisations` keeps every template default. Host returns
     * `{folder_id}` and emits `folder.added` so WireSync picks the
     * folder up automatically. Mirrors Android
     * `createProjectFromTemplate` (line 1456).
     */
    async createProjectFromTemplate(
        templateId: string,
        customisations: {
            readonly name?: string;
            readonly goal?: string;
            readonly description?: string;
            readonly scenario?: string;
            readonly members?: readonly {
                readonly agentId: string;
                readonly alias: string;
                readonly isCoordinator: boolean;
                readonly modelProvider?: string;
                readonly modelName?: string;
                readonly allowedTools?: readonly string[];
            }[];
        } = {},
    ): Promise<string> {
        const payload: Record<string, unknown> = {};
        if (customisations.name !== undefined && customisations.name.length > 0)
            payload['name'] = customisations.name;
        if (customisations.goal !== undefined && customisations.goal.length > 0)
            payload['goal'] = customisations.goal;
        if (customisations.description !== undefined && customisations.description.length > 0)
            payload['description'] = customisations.description;
        if (customisations.scenario !== undefined && customisations.scenario.length > 0)
            payload['scenario'] = customisations.scenario;
        if (customisations.members !== undefined) {
            // create_project stores each member's provider / model /
            // tool overrides (ProjectTemplateService reads modelProvider,
            // modelName and allowedTools per member). Only non-empty
            // values are sent.
            payload['members'] = customisations.members.map((m) => ({
                agentId: m.agentId,
                alias: m.alias,
                isCoordinator: m.isCoordinator,
                ...(m.modelProvider !== undefined && m.modelProvider.length > 0
                    ? { modelProvider: m.modelProvider }
                    : {}),
                ...(m.modelName !== undefined && m.modelName.length > 0
                    ? { modelName: m.modelName }
                    : {}),
                ...(m.allowedTools !== undefined && m.allowedTools.length > 0
                    ? { allowedTools: [...m.allowedTools] }
                    : {}),
            }));
        }
        const data = await this.session.send('project_template.create_project', {
            id: templateId,
            customisations: payload,
        });
        if (!isJsonObject(data)) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'project_template.create_project returned an unexpected payload',
            });
        }
        const folderId = optionalString(data['folder_id']) ?? optionalString(data['folderId']);
        if (folderId === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'project_template.create_project response missing folder_id',
            });
        }
        return folderId;
    }

    /**
     * Pin (or unpin) a template into the user's landing-screen list.
     * Mirrors Android `setProjectTemplatePinned` (line 692). Host op
     * `project_template.pin_user`.
     */
    async setProjectTemplatePinned(templateId: string, pinned: boolean): Promise<void> {
        await this.session.send('project_template.pin_user', { id: templateId, pinned });
    }

    /**
     * Save the template as a new USER-template. When `sourceTemplateId`
     * is non-empty the new template inherits the source's roster +
     * scenario + goal + description, overlaid by any non-empty `edits`
     * field. When `sourceTemplateId` is empty the host seeds neutral
     * defaults. Mirrors Android `saveAsNewProjectTemplate` (line 712).
     * Host op `project_template.save_as_new`. Returns the new
     * user-template id.
     */
    async saveAsNewProjectTemplate(
        sourceTemplateId: string,
        edits: {
            readonly name?: string;
            readonly scenario?: string;
            readonly goal?: string;
            readonly description?: string;
            readonly members?: readonly {
                readonly agentId: string;
                readonly alias: string;
                readonly isCoordinator: boolean;
                readonly modelProvider?: string;
                readonly modelName?: string;
                readonly allowedTools?: readonly string[];
            }[];
        },
    ): Promise<string> {
        const editsPayload: Record<string, unknown> = {};
        if (edits.name !== undefined && edits.name.length > 0) editsPayload['name'] = edits.name;
        if (edits.scenario !== undefined && edits.scenario.length > 0)
            editsPayload['scenario'] = edits.scenario;
        if (edits.goal !== undefined && edits.goal.length > 0) editsPayload['goal'] = edits.goal;
        if (edits.description !== undefined && edits.description.length > 0)
            editsPayload['description'] = edits.description;
        if (edits.members !== undefined) {
            // The host keeps each member's provider / model / tool
            // overrides in the saved template; send only what is set.
            editsPayload['members'] = edits.members.map((m) => ({
                agentId: m.agentId,
                alias: m.alias,
                isCoordinator: m.isCoordinator,
                ...(m.modelProvider !== undefined && m.modelProvider.length > 0
                    ? { modelProvider: m.modelProvider }
                    : {}),
                ...(m.modelName !== undefined && m.modelName.length > 0
                    ? { modelName: m.modelName }
                    : {}),
                ...(m.allowedTools !== undefined && m.allowedTools.length > 0
                    ? { allowedTools: [...m.allowedTools] }
                    : {}),
            }));
        }
        const data = await this.session.send('project_template.save_as_new', {
            source_template_id: sourceTemplateId,
            edits: editsPayload,
        });
        if (!isJsonObject(data)) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'project_template.save_as_new returned an unexpected payload',
            });
        }
        const newId = optionalString(data['template_id']) ?? optionalString(data['templateId']);
        if (newId === undefined) {
            throw new RemoteOpError({
                kind: 'malformed_response',
                detail: 'project_template.save_as_new response missing template_id',
            });
        }
        return newId;
    }

    /**
     * Remove a user-saved template. Built-in templates are immune; the
     * host returns false in that case. Mirrors Android
     * `deleteUserProjectTemplate` (line 745). Host op
     * `project_template.delete_user`.
     */
    async deleteUserProjectTemplate(templateId: string): Promise<void> {
        await this.session.send('project_template.delete_user', { id: templateId });
    }

    /**
     * Fetch one template's full roster (members) — used by the
     * Read-More detail sheet. Host op `project_template.roster`.
     */
    async getProjectTemplateRoster(
        templateId: string,
    ): Promise<readonly ProjectTemplateRosterMemberUi[]> {
        const data = await this.session.send('project_template.roster', { id: templateId });
        return extractList(data, 'members', parseProjectTemplateRosterMember);
    }

    /**
     * Return the active canvas's content for a conversation, or an
     * empty string if none is open. Host op
     * `canvas.active_for_conv` returns the full canvas record
     * (id / filename / language / content / source_msg_id); we
     * surface only `content` here — the rest is sourced through
     * `suggestedCanvasExportName` and event payloads as needed.
     */
    async getActiveCanvasForConv(convId: string): Promise<string> {
        const data = await this.session.send('canvas.active_for_conv', { conv_id: convId });
        if (!isJsonObject(data)) return '';
        return optionalString(data['content']) ?? '';
    }

    /**
     * Suggest a filename the user would naturally export the active
     * canvas as (e.g. `main.py`, `notes.md`). Host op
     * `canvas.suggested_export_name`. Returns an empty string when
     * the host has nothing better than the default.
     */
    async suggestedCanvasExportName(convId: string): Promise<string> {
        const data = await this.session.send('canvas.suggested_export_name', {
            conv_id: convId,
        });
        if (!isJsonObject(data)) return '';
        return optionalString(data['file_name']) ?? '';
    }

    /**
     * Push an edit back into the active canvas. Wire op
     * `canvas.edit` accepts `{ conv_id, content }`; the host rejects
     * content above its content cap. The canvas editor tab is
     * read-only, so nothing in the extension calls this yet.
     */
    async editCanvas(convId: string, content: string): Promise<void> {
        await this.session.send('canvas.edit', { conv_id: convId, content });
    }

    // === workspace mounts ===

    /**
     * Registers a client-owned workspace mount against the project
     * folder. The host's `FolderMountRegistry` is the source of
     * truth — the host pins `client_id` to the authenticated
     * session identity at dispatch time, so the parameter list does
     * not include it (foreign-client smuggling is rejected on the
     * host side regardless).
     *
     * `treeJson` is the shallow capability hint manifest, not an
     * authoritative listing. Bytes flow on demand via the inbound
     * `vfs.*` RPCs the host fires in response to agent file ops.
     *
     * Optional fields default to host-side defaults: empty
     * blocklist (default deny-list still applies), empty allowlist
     * (every manifest-listed path accessible), `permission_tier =
     * 'ask'`, empty options.
     *
     * The host reports a refused mount (for example an owner label that
     * is too long) as `{ok: false, error}` inside a successful reply;
     * that is thrown as a `RemoteOpError` of kind `mount_rejected`.
     */
    async registerWorkspaceMount(params: {
        readonly folderId: string;
        readonly mountId: string;
        readonly ownerLabel: string;
        readonly treeJson: string;
        readonly blocklistJson?: string | undefined;
        readonly allowlistJson?: string | undefined;
        readonly permissionTier?: PermissionTier | undefined;
        readonly optionsJson?: string | undefined;
    }): Promise<void> {
        const body: Record<string, unknown> = {
            folder_id: params.folderId,
            mount_id: params.mountId,
            owner_label: params.ownerLabel,
            tree_json: params.treeJson,
        };
        if (params.blocklistJson !== undefined) body['blocklist_json'] = params.blocklistJson;
        if (params.allowlistJson !== undefined) body['allowlist_json'] = params.allowlistJson;
        if (params.permissionTier !== undefined) body['permission_tier'] = params.permissionTier;
        if (params.optionsJson !== undefined) body['options_json'] = params.optionsJson;
        expectMountOk(await this.session.send('workspace.mount.register', body));
    }

    /**
     * Releases the workspace mount for `folderId`. A refusal from the
     * host is thrown as `RemoteOpError`. When the host holds no mount
     * for this folder and client, there is nothing left to release, so
     * that reply counts as success.
     */
    async unregisterWorkspaceMount(folderId: string): Promise<void> {
        const data = await this.session.send('workspace.mount.unregister', {
            folder_id: folderId,
        });
        if (isJsonObject(data) && data['error'] === MOUNT_NOT_REGISTERED) return;
        expectMountOk(data);
    }

    async updateWorkspaceMountTree(folderId: string, treeJson: string): Promise<void> {
        expectMountOk(
            await this.session.send('workspace.mount.update_tree', {
                folder_id: folderId,
                tree_json: treeJson,
            }),
        );
    }

    /**
     * Changes the permission tier the host records for the mount on
     * `folderId`, so the desktop and other clients show the same tier.
     * A refusal is thrown as `RemoteOpError`.
     */
    async updateWorkspaceMountTier(folderId: string, tier: PermissionTier): Promise<void> {
        expectMountOk(
            await this.session.send('workspace.mount.update_tier', {
                folder_id: folderId,
                permission_tier: tier,
            }),
        );
    }
}

// === envelope unwrap helpers ===

function extractList<T>(
    data: unknown,
    key: string,
    parser: (item: unknown) => T | undefined,
): readonly T[] {
    if (isJsonObject(data)) {
        const inner = data[key];
        if (inner !== undefined) return arrayOf(inner, parser);
    }
    return arrayOf(data, parser);
}

function extractId(data: unknown, key: string): string {
    if (!isJsonObject(data)) {
        throw new RemoteOpError({
            kind: 'malformed_response',
            detail: `expected object containing ${key}`,
        });
    }
    const id = optionalString(data[key]);
    if (id === undefined) {
        throw new RemoteOpError({
            kind: 'malformed_response',
            detail: `response missing ${key}`,
        });
    }
    return id;
}

/**
 * The registry's reply when this client holds no mount for a folder
 * (`folder-mount-registry.cpp`, `unregisterMount`).
 */
const MOUNT_NOT_REGISTERED = 'no mount registered for folder/client';

/**
 * Throws when a workspace-mount op replied `{ok: false, error}`. The
 * mount registry reports refusals that way inside a successful reply.
 */
function expectMountOk(data: unknown): void {
    if (isJsonObject(data) && data['ok'] === false) {
        throw new RemoteOpError({
            kind: 'mount_rejected',
            detail: optionalString(data['error']) ?? 'the host refused the request',
        });
    }
}

/**
 * Throws when a host op that replies with a bare bool answered `false`,
 * which is how those ops report a refused request.
 */
function expectAccepted(data: unknown, op: string): void {
    if (data === false) {
        throw new RemoteOpError({
            kind: 'rejected',
            detail: `the host did not accept the request (${op})`,
        });
    }
}

/**
 * Reads an id from a reply that is either a bare string (ops the host
 * answers with a plain `QString`) or an object holding `key`.
 */
function extractIdOrString(data: unknown, key: string): string {
    if (typeof data === 'string') {
        if (data.length > 0) return data;
        throw new RemoteOpError({ kind: 'malformed_response', detail: `response missing ${key}` });
    }
    return extractId(data, key);
}

/**
 * Parses a preferred-skill list. The host replies with a bare array of
 * ids; an object holding `skill_ids` is also accepted.
 */
function parseSkillIds(data: unknown): readonly string[] {
    const raw = Array.isArray(data)
        ? data
        : isJsonObject(data)
          ? (data['skill_ids'] ?? data['skillIds'])
          : undefined;
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is string => typeof s === 'string');
}

function extractSendResult(data: unknown): SendMessageResult {
    // Be permissive: the host's `msg.send` response shape has varied
    // across releases (snake_case vs camelCase, top-level id vs nested,
    // sometimes just `{queued: true}`). The optimistic insert in
    // WebviewSync generates a synthetic id when the host doesn't
    // return one — the canonical `message.added` event that follows
    // reconciles in MessageStore by matching role+content+time.
    if (!isJsonObject(data)) {
        return { userMessageId: '', assistantPlaceholderId: undefined };
    }
    const userMessageId =
        optionalString(data['user_message_id']) ??
        optionalString(data['userMessageId']) ??
        optionalString(data['id']) ??
        optionalString(data['message_id']) ??
        optionalString(data['messageId']) ??
        '';
    const assistantPlaceholderId =
        optionalString(data['assistant_placeholder_id']) ??
        optionalString(data['assistantPlaceholderId']) ??
        optionalString(data['assistant_id']) ??
        optionalString(data['assistantId']);
    return { userMessageId, assistantPlaceholderId };
}

/**
 * One roster row as the extension holds it (camelCase). The override and
 * provenance fields are optional; an absent field is not sent.
 */
export interface FolderMemberRow {
    readonly agentId: string;
    readonly alias: string;
    readonly isCoordinator: boolean;
    readonly modelProvider?: string | undefined;
    readonly modelName?: string | undefined;
    readonly allowedTools?: readonly string[] | undefined;
    readonly addedByKind?: MemberAddedByKind | undefined;
    readonly addedByAgentId?: string | undefined;
}

/**
 * Maps one roster row to the snake_case member object `folder.members.set`
 * reads. Provider, model and tools are sent whenever the row has them,
 * empty values included, since an empty value is how a cleared override is
 * written. Provenance is sent only when it is a kind the host accepts: the
 * host rejects the whole call for any other `added_by_kind`, and an empty
 * agent id carries nothing.
 *
 * @param m Roster row.
 * @returns The wire member object.
 */
export function folderMemberWireRow(m: FolderMemberRow): Record<string, unknown> {
    const row: Record<string, unknown> = {
        agent_id: m.agentId,
        alias: m.alias,
        is_coordinator: m.isCoordinator,
    };
    if (m.modelProvider !== undefined) row['model_provider'] = m.modelProvider;
    if (m.modelName !== undefined) row['model_name'] = m.modelName;
    if (m.allowedTools !== undefined) row['allowed_tools'] = [...m.allowedTools];
    const kind = parseAddedByKind(m.addedByKind);
    if (kind !== undefined) row['added_by_kind'] = kind;
    if (m.addedByAgentId !== undefined && m.addedByAgentId.length > 0) {
        row['added_by_agent_id'] = m.addedByAgentId;
    }
    return row;
}
