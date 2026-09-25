// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * RemoteJson — typed narrowing helpers + payload parsers used by
 * the wire layer to turn arbitrary host JSON into typed shapes.
 *
 * The Kotlin client uses `kotlinx.serialization` with
 * `ignoreUnknownKeys = true`. TypeScript has no such facility, so
 * we hand-walk every payload through `isJsonObject` /
 * `stringOr` / `numberOr` etc. The cost is verbose parsers; the
 * benefit is that the wire layer NEVER leaks `any` into the rest
 * of the codebase and forward-compat with new host fields is
 * automatic (unknown fields are simply ignored).
 */

import type {
    AuthMeResponse,
    ClientRequest,
    PairResponse,
    PingResponse,
    RemoteError,
    RemoteEvent,
    RemoteResponse,
    TokenAuthResponse,
} from '../../shared/wire-envelope.js';
import type {
    ActivityEventUi,
    AgentPattern,
    AgentRunStateUi,
    AgentStepStatus,
    AgentStepUi,
    AgentSummaryUi,
    ClientUi,
    ConvSettingsUi,
    ConversationUi,
    FinishReason,
    FolderKind,
    FolderUi,
    GeneratedFileUi,
    HeartbeatConfigUi,
    HeartbeatRunUi,
    McpServerUi,
    MemberAddedByKind,
    MemberUi,
    MessageRole,
    MessageUi,
    ModelCatalogUi,
    PendingToolConfirmationUi,
    PlanStatus,
    PlanUi,
    PollOptionUi,
    PollUi,
    ProjectTemplateRosterMemberUi,
    ProjectTemplateUi,
    ProviderUi,
    SearchProviderUi,
    SearchProvidersCatalogUi,
    SkillUi,
    StepStatus,
    StepUi,
    TemplateGeometryKind,
    ToolCallLogUi,
    ToolUi,
} from '../../shared/wire-types.js';

// === Type-guard primitives ===

export function isJsonObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isJsonArray(v: unknown): v is readonly unknown[] {
    return Array.isArray(v);
}

export function isJsonString(v: unknown): v is string {
    return typeof v === 'string';
}

export function isJsonNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

export function isJsonBoolean(v: unknown): v is boolean {
    return typeof v === 'boolean';
}

export function stringOr(v: unknown, fallback: string): string {
    return isJsonString(v) ? v : fallback;
}

export function optionalString(v: unknown): string | undefined {
    return isJsonString(v) && v.length > 0 ? v : undefined;
}

export function numberOr(v: unknown, fallback: number): number {
    return isJsonNumber(v) ? v : fallback;
}

export function optionalNumber(v: unknown): number | undefined {
    return isJsonNumber(v) ? v : undefined;
}

/**
 * Reads a timestamp in epoch milliseconds. The host sends some timestamps
 * as numbers and others as ISO-8601 strings (for example `conv.list` and
 * `msg.list` rows, poll rows and activity rows), so both are accepted.
 *
 * @param v the raw JSON value.
 * @param fallback returned when `v` is neither a finite number nor a
 *        parseable date string.
 * @returns epoch milliseconds, or `fallback`.
 */
export function timestampOr(v: unknown, fallback: number): number {
    if (isJsonNumber(v)) return v;
    if (isJsonString(v) && v.length > 0) {
        const ms = Date.parse(v);
        if (Number.isFinite(ms)) return ms;
    }
    return fallback;
}

export function booleanOr(v: unknown, fallback: boolean): boolean {
    return isJsonBoolean(v) ? v : fallback;
}

export function arrayOf<T>(v: unknown, parser: (item: unknown) => T | undefined): readonly T[] {
    if (!isJsonArray(v)) return [];
    const out: T[] = [];
    for (const item of v) {
        const parsed = parser(item);
        if (parsed !== undefined) out.push(parsed);
    }
    return out;
}

export function stringArray(v: unknown): readonly string[] {
    return arrayOf(v, (item) => (isJsonString(item) ? item : undefined));
}

// === Envelope parsers ===

/**
 * Parses raw text from the WebSocket into a typed envelope. Throws
 * on malformed JSON. Returns `undefined` for an envelope that is
 * valid JSON but doesn't match any known frame type.
 *
 * Recognises four envelope types — `response`, `event`,
 * `client_response`, and `request`. The `client_response` case is
 * outbound-only on the extension side (we send these, we don't
 * receive them) — included here so the type guard stays exhaustive
 * if a future protocol revision reflects them back.
 */
export function parseFrame(text: string): RemoteResponse | RemoteEvent | ClientRequest | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('Host frame is not valid JSON');
    }
    if (!isJsonObject(parsed)) return undefined;
    const type = parsed['type'];
    if (type === 'response') return parseResponse(parsed);
    if (type === 'event') return parseEvent(parsed);
    if (type === 'request') return parseClientRequest(parsed);
    return undefined;
}

function parseResponse(raw: Record<string, unknown>): RemoteResponse | undefined {
    const requestId = optionalString(raw['request_id']);
    if (requestId === undefined) return undefined;
    const ok = booleanOr(raw['ok'], false);
    const data = raw['data'];
    const error = parseRemoteError(raw['error']);
    return {
        type: 'response',
        request_id: requestId,
        ok,
        data,
        error,
    };
}

function parseEvent(raw: Record<string, unknown>): RemoteEvent | undefined {
    const event = optionalString(raw['event']);
    if (event === undefined) return undefined;
    return {
        type: 'event',
        event,
        data: raw['data'],
    };
}

/**
 * Parses a host-initiated `request` envelope. Requires both
 * `request_id` and `op`; an envelope missing either is treated as
 * unknown and the caller emits a `malformed_frame` error so the
 * session stays alive (forward-compat with future envelope
 * variants).
 */
function parseClientRequest(raw: Record<string, unknown>): ClientRequest | undefined {
    const requestId = optionalString(raw['request_id']);
    if (requestId === undefined) return undefined;
    const op = optionalString(raw['op']);
    if (op === undefined) return undefined;
    const argsRaw = raw['args'];
    const args = isJsonObject(argsRaw) ? argsRaw : undefined;
    return {
        type: 'request',
        request_id: requestId,
        op,
        args,
    };
}

export function parseRemoteError(v: unknown): RemoteError | undefined {
    if (!isJsonObject(v)) return undefined;
    return {
        kind: stringOr(v['kind'], 'unknown'),
        detail: stringOr(v['detail'], ''),
    };
}

// === Auth response parsers ===

export function parsePairResponse(v: unknown): PairResponse | undefined {
    if (!isJsonObject(v)) return undefined;
    const token = optionalString(v['token']);
    const clientId = optionalString(v['client_id']);
    if (token === undefined || clientId === undefined) return undefined;
    return {
        token,
        client_id: clientId,
        name: stringOr(v['name'], ''),
    };
}

export function parseTokenAuthResponse(v: unknown): TokenAuthResponse | undefined {
    if (!isJsonObject(v)) return undefined;
    const clientId = optionalString(v['client_id']);
    if (clientId === undefined) return undefined;
    return {
        client_id: clientId,
        name: stringOr(v['name'], ''),
        last_seen_at: optionalNumber(v['last_seen_at']),
    };
}

export function parseAuthMeResponse(v: unknown): AuthMeResponse | undefined {
    return parseTokenAuthResponse(v);
}

export function parsePingResponse(v: unknown): PingResponse | undefined {
    if (!isJsonObject(v)) return undefined;
    return { time_ms: numberOr(v['time_ms'], 0) };
}

// === Data parsers — conversations, folders, members, messages ===

const MESSAGE_ROLES: ReadonlySet<MessageRole> = new Set(['user', 'assistant', 'system', 'tool']);
const FINISH_REASONS: ReadonlySet<FinishReason> = new Set([
    'stop',
    'length',
    'tool_calls',
    'error',
    'user_interrupted',
    '',
]);
const FOLDER_KINDS: ReadonlySet<FolderKind> = new Set(['regular', 'project', 'organization']);

export function parseConversation(v: unknown): ConversationUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    return {
        id,
        title: stringOr(v['title'], 'Untitled'),
        folderId: optionalString(v['folder_id']),
        createdAt: timestampOr(v['created_at'], 0),
        updatedAt: timestampOr(v['updated_at'], 0),
        isGroup: booleanOr(v['is_group'], false),
        isPinned: booleanOr(v['is_pinned'], false),
        primaryAgentId: optionalString(v['primary_agent_id']),
        memberAlias: optionalString(v['member_alias']),
        preview: optionalString(v['preview']),
    };
}

export function parseFolder(v: unknown): FolderUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    const rawKind = stringOr(v['folder_type'], 'regular');
    const folderType: FolderKind = FOLDER_KINDS.has(rawKind as FolderKind)
        ? (rawKind as FolderKind)
        : 'regular';
    return {
        id,
        name: stringOr(v['name'], 'Untitled'),
        parentId: optionalString(v['parent_id']),
        folderType,
        goal: optionalString(v['goal']),
        description: optionalString(v['description']),
    };
}

export function parseMember(v: unknown): MemberUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const agentId = optionalString(v['agent_id']) ?? optionalString(v['agentId']);
    const alias = optionalString(v['alias']);
    if (agentId === undefined || alias === undefined) return undefined;
    const id = stringOr(v['id'], `${agentId}:${alias}`);
    return {
        id,
        agentId,
        alias,
        isCoordinator:
            booleanOr(v['is_coordinator'], false) || booleanOr(v['isCoordinator'], false),
        modelProvider: optionalString(v['model_provider']) ?? optionalString(v['modelProvider']),
        modelName: optionalString(v['model_name']) ?? optionalString(v['modelName']),
        allowedTools: stringArray(v['allowed_tools'] ?? v['allowedTools']),
        addedByKind: parseAddedByKind(v['added_by_kind'] ?? v['addedByKind']),
        addedByAgentId:
            optionalString(v['added_by_agent_id']) ?? optionalString(v['addedByAgentId']),
    };
}

/**
 * Narrows a member provenance value to the two kinds the host accepts.
 * Anything else reads as undefined, so it is never sent back on a roster
 * save (the host rejects the whole call for an unknown kind).
 */
export function parseAddedByKind(v: unknown): MemberAddedByKind | undefined {
    return v === 'user' || v === 'agent' ? v : undefined;
}

export function parseMessage(v: unknown): MessageUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    const conversationId = optionalString(v['conversation_id']) ?? optionalString(v['conv_id']);
    if (id === undefined || conversationId === undefined) return undefined;
    const rawRole = stringOr(v['role'], 'assistant');
    const role: MessageRole = MESSAGE_ROLES.has(rawRole as MessageRole)
        ? (rawRole as MessageRole)
        : 'assistant';
    const rawFinish = stringOr(v['finish_reason'], '');
    const finishReason: FinishReason = FINISH_REASONS.has(rawFinish as FinishReason)
        ? (rawFinish as FinishReason)
        : '';
    return {
        id,
        conversationId,
        role,
        content: stringOr(v['content'] ?? v['text'], ''),
        createdAt: timestampOr(v['created_at'], 0),
        tokenCount: optionalNumber(v['token_count']),
        modelUsed: optionalString(v['model_used']),
        finishReason,
        agentId: optionalString(v['agent_id']),
        memberAlias: optionalString(v['member_alias']),
        turnId: optionalString(v['turn_id']),
        thinkingContent: optionalString(v['thinking_content']),
    };
}

export function parseAgentSummary(v: unknown): AgentSummaryUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    const name = optionalString(v['name']);
    if (id === undefined || name === undefined) return undefined;
    return {
        id,
        name,
        description: optionalString(v['description']),
        iconName: optionalString(v['icon_name']) ?? optionalString(v['iconName']),
        isBuiltin: booleanOr(v['is_builtin'] ?? v['isBuiltIn'] ?? v['isBuiltin'], false),
        isCoordinator: booleanOr(v['is_coordinator'] ?? v['isCoordinator'], false),
    };
}

// === Streaming-event payload parsers ===

export interface StreamingStartedPayload {
    readonly conversationId: string;
    readonly messageId: string;
    readonly turnId?: string | undefined;
    readonly agentId?: string | undefined;
    readonly memberAlias?: string | undefined;
}

export interface StreamingDeltaPayload {
    readonly conversationId: string;
    readonly messageId: string;
    readonly delta: string;
    readonly thinkingDelta?: string | undefined;
}

export interface StreamingAbortedPayload {
    readonly conversationId: string;
    readonly messageId: string;
    readonly reason: string;
}

export function parseStreamingStarted(v: unknown): StreamingStartedPayload | undefined {
    if (!isJsonObject(v)) return undefined;
    const conversationId = extractConvId(v);
    const messageId = extractMsgId(v);
    if (conversationId === undefined || messageId === undefined) return undefined;
    return {
        conversationId,
        messageId,
        turnId: optionalString(v['turn_id']) ?? optionalString(v['turnId']),
        agentId: optionalString(v['agent_id']) ?? optionalString(v['agentId']),
        memberAlias: optionalString(v['member_alias']) ?? optionalString(v['memberAlias']),
    };
}

export function parseStreamingDelta(v: unknown): StreamingDeltaPayload | undefined {
    if (!isJsonObject(v)) return undefined;
    const conversationId = extractConvId(v);
    const messageId = extractMsgId(v);
    if (conversationId === undefined || messageId === undefined) return undefined;
    return {
        conversationId,
        messageId,
        delta: stringOr(
            v['delta'] ?? v['content_delta'] ?? v['contentDelta'] ?? v['content'] ?? v['chunk'],
            '',
        ),
        thinkingDelta: optionalString(
            v['thinking_delta'] ?? v['thinkingDelta'] ?? v['thinking_content_delta'],
        ),
    };
}

export function parseStreamingAborted(v: unknown): StreamingAbortedPayload | undefined {
    if (!isJsonObject(v)) return undefined;
    const conversationId = extractConvId(v);
    const messageId = extractMsgId(v);
    if (conversationId === undefined || messageId === undefined) return undefined;
    return {
        conversationId,
        messageId,
        reason: stringOr(v['reason'], ''),
    };
}

function extractConvId(v: Record<string, unknown>): string | undefined {
    return (
        optionalString(v['conversation_id']) ??
        optionalString(v['conv_id']) ??
        optionalString(v['conversationId']) ??
        optionalString(v['convId'])
    );
}

function extractMsgId(v: Record<string, unknown>): string | undefined {
    return (
        optionalString(v['message_id']) ??
        optionalString(v['msg_id']) ??
        optionalString(v['messageId']) ??
        optionalString(v['msgId']) ??
        optionalString(v['id'])
    );
}

const AGENT_PATTERNS: ReadonlySet<AgentPattern> = new Set([
    'direct',
    'react',
    'planner',
    'router',
    'multi_agent',
    'memory',
]);

export function parseConvSettings(v: unknown): ConvSettingsUi | undefined {
    // Some host versions wrap the payload in `{ settings: {...} }`;
    // peel it off so the rest of the parser is shape-agnostic.
    let unwrapped = v;
    if (isJsonObject(unwrapped) && 'settings' in unwrapped && isJsonObject(unwrapped['settings'])) {
        unwrapped = unwrapped['settings'];
    }
    const v_ = unwrapped;
    if (!isJsonObject(v_)) return undefined;
    return parseConvSettingsObject(v_);
}

function parseConvSettingsObject(v: Record<string, unknown>): ConvSettingsUi | undefined {
    const rawPattern = stringOr(v['agentPattern'] ?? v['agent_pattern'], 'direct');
    const agentPattern: AgentPattern = AGENT_PATTERNS.has(rawPattern as AgentPattern)
        ? (rawPattern as AgentPattern)
        : 'direct';
    return {
        systemPrompt: stringOr(v['systemPrompt'] ?? v['system_prompt'], ''),
        temperature: numberOr(v['temperature'], 0.7),
        maxTokens: numberOr(v['maxTokens'] ?? v['max_tokens'], 4096),
        contextWindow: numberOr(v['contextWindow'] ?? v['context_window'], 8192),
        streaming: booleanOr(v['streaming'], true),
        thinking: booleanOr(v['thinking'], false),
        providerId: stringOr(v['providerId'] ?? v['provider_id'], ''),
        modelName: stringOr(v['modelName'] ?? v['model_name'], ''),
        isGroup: booleanOr(v['isGroup'] ?? v['is_group'], false),
        folderId: stringOr(v['folderId'] ?? v['folder_id'], ''),
        primaryAgentId: stringOr(v['primaryAgentId'] ?? v['primary_agent_id'], ''),
        heartbeatAutoSurface: booleanOr(
            v['heartbeatAutoSurface'] ?? v['heartbeat_auto_surface'],
            false,
        ),
        autoSurfaceMaxPerDay: numberOr(
            v['autoSurfaceMaxPerDay'] ?? v['auto_surface_max_per_day'],
            1,
        ),
        agentPattern,
        requireConfirmation: booleanOr(
            v['requireConfirmation'] ?? v['require_confirmation'],
            false,
        ),
        toolsEnabled: booleanOr(v['toolsEnabled'] ?? v['tools_enabled'], true),
        ragEnabled: booleanOr(v['ragEnabled'] ?? v['rag_enabled'], false),
        topK: numberOr(v['topK'] ?? v['top_k'], -1),
        topP: numberOr(v['topP'] ?? v['top_p'], -1),
        repeatPenalty: numberOr(v['repeatPenalty'] ?? v['repeat_penalty'], -1),
        presencePenalty: numberOr(v['presencePenalty'] ?? v['presence_penalty'], -1),
        frequencyPenalty: numberOr(v['frequencyPenalty'] ?? v['frequency_penalty'], -1),
        forceAppSampling: booleanOr(v['forceAppSampling'] ?? v['force_app_sampling'], true),
        toolsInSystemPrompt: booleanOr(
            v['toolsInSystemPrompt'] ?? v['tools_in_system_prompt'],
            false,
        ),
        dynamicCompactEnabled: booleanOr(
            v['dynamicCompactEnabled'] ?? v['dynamic_compact_enabled'],
            true,
        ),
        compactEveryTurns: numberOr(v['compactEveryTurns'] ?? v['compact_every_turns'], 20),
    };
}

export function parseClient(v: unknown): ClientUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    return {
        id,
        name: stringOr(v['name'], 'Unnamed client'),
        current: booleanOr(v['current'], false),
        revoked: booleanOr(v['revoked'], false),
        lastSeenAt: timestampOr(v['last_seen_at'] ?? v['lastSeenAt'], 0),
        firstPairedAt: timestampOr(
            v['first_paired_at'] ?? v['firstPairedAt'] ?? v['created_at'] ?? v['createdAt'],
            0,
        ),
    };
}

const TOOL_KINDS = new Set(['built_in', 'custom', 'mcp']);

export function parseTool(v: unknown): ToolUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const name = optionalString(v['name']);
    if (name === undefined) return undefined;
    const rawKind = stringOr(v['kind'], 'built_in');
    const kind = (TOOL_KINDS.has(rawKind) ? rawKind : 'built_in') as ToolUi['kind'];
    return {
        name,
        description: stringOr(v['description'], ''),
        enabled: booleanOr(v['enabled'], true),
        isBuiltIn: booleanOr(v['is_built_in'] ?? v['isBuiltIn'], false),
        kind,
        mcpServer: stringOr(v['mcp_server'] ?? v['mcpServer'], ''),
        shortName: stringOr(v['short_name'] ?? v['shortName'], ''),
    };
}

export function parseMcpServer(v: unknown): McpServerUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const name = optionalString(v['name']);
    if (name === undefined) return undefined;
    return {
        name,
        type: stringOr(v['type'], ''),
        disabled: booleanOr(v['disabled'], false),
        status: stringOr(v['status'], 'unknown'),
        errorMessage: stringOr(v['error_message'] ?? v['errorMessage'], ''),
        toolCount: numberOr(v['tool_count'] ?? v['toolCount'], 0),
    };
}

/**
 * Parse one provider entry from the `models.catalog` response. The
 * host wires the per-capability booleans as snake_case
 * (`supports_streaming` / `supports_tool_calling` / `supports_vision`)
 * per `wire-session.cpp::opModelsCatalog` around line 1114. Returns
 * `undefined` when the provider id is missing — required to dedupe
 * picker rows.
 */
export function parseProvider(v: unknown): ProviderUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const providerId = optionalString(v['provider_id']) ?? optionalString(v['providerId']);
    if (providerId === undefined) return undefined;
    return {
        providerId,
        displayName: stringOr(v['display_name'] ?? v['displayName'], providerId),
        supportsStreaming: booleanOr(v['supports_streaming'] ?? v['supportsStreaming'], false),
        supportsToolCalling: booleanOr(
            v['supports_tool_calling'] ?? v['supportsToolCalling'],
            false,
        ),
        supportsVision: booleanOr(v['supports_vision'] ?? v['supportsVision'], false),
        models: stringArray(v['models']),
    };
}

/**
 * Parse the full `models.catalog` host response. Always returns a
 * shape — an empty provider list with empty `activeProvider` /
 * `activeModel` is a valid "host has no providers configured yet"
 * state. Tolerates `providers` absent or non-array (treated as []).
 */
export function parseModelCatalog(v: unknown): ModelCatalogUi | undefined {
    if (!isJsonObject(v)) return undefined;
    return {
        providers: arrayOf(v['providers'], parseProvider),
        activeProvider: stringOr(v['active_provider'] ?? v['activeProvider'], ''),
        activeModel: stringOr(v['active_model'] ?? v['activeModel'], ''),
    };
}

function parseSearchProvider(v: unknown): SearchProviderUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = stringOr(v['id'], '');
    if (id.length === 0) return undefined;
    return {
        id,
        displayName: stringOr(v['displayName'], id),
        requiresApiKey: booleanOr(v['requiresApiKey'], false),
        hasKey: booleanOr(v['hasKey'], false),
        active: booleanOr(v['active'], false),
        baseUrl: stringOr(v['baseUrl'], ''),
    };
}

/**
 * Parse a `search.providers` reply. The host op returns the provider list
 * directly as a JSON array (QVariantList); an object wrapper with a
 * `providers` array is accepted defensively.
 */
export function parseSearchProviders(v: unknown): SearchProvidersCatalogUi | undefined {
    if (isJsonArray(v)) return { providers: arrayOf(v, parseSearchProvider) };
    if (isJsonObject(v)) return { providers: arrayOf(v['providers'], parseSearchProvider) };
    return undefined;
}

// === Tool-call confirmation + agent progress parsers ===

/**
 * Parse a `tool_call.requested` event into a PendingToolConfirmationUi.
 * The host shape is `{call_id, tool_name, arguments, message_id,
 * conv_id, agent_id?, member_alias?}` per `wire-session.cpp::emit
 * tool_call.requested`. `arguments` may arrive as either a JSON
 * object (host stringifies it for us) or a raw string — we
 * normalise to a pretty-printed string for the modal's <pre>.
 */
export function parsePendingToolConfirmation(v: unknown): PendingToolConfirmationUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const callId = optionalString(v['call_id']) ?? optionalString(v['callId']);
    if (callId === undefined) return undefined;
    const rawArgs = v['arguments'];
    const argumentsString =
        typeof rawArgs === 'string'
            ? prettyPrintIfJson(rawArgs)
            : rawArgs === undefined || rawArgs === null
              ? ''
              : safeStringify(rawArgs);
    return {
        callId,
        toolName: stringOr(v['tool_name'] ?? v['toolName'], 'tool'),
        arguments: argumentsString,
        conversationId: extractConvId(v) ?? '',
        messageId: extractMsgId(v) ?? '',
        agentId: stringOr(v['agent_id'] ?? v['agentId'], ''),
        memberAlias: stringOr(v['member_alias'] ?? v['memberAlias'], ''),
    };
}

function prettyPrintIfJson(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

const AGENT_STEP_STATUSES: ReadonlySet<AgentStepStatus> = new Set([
    'running',
    'success',
    'error',
    'pending',
]);

/**
 * Parse an `agent.step.started` or `agent.step.completed` event into
 * an AgentStepUi. `fallbackConv` carries the conv id the event was
 * routed to so the step's `conversationId` is always populated even
 * if the host omitted it. The reducer in the webview key-pairs steps
 * by (iteration + description) to detect "the started step that just
 * completed".
 */
export function parseAgentStep(v: unknown, fallbackConv: string): AgentStepUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const rawStatus = stringOr(v['status'], 'running');
    const status: AgentStepStatus = AGENT_STEP_STATUSES.has(rawStatus as AgentStepStatus)
        ? (rawStatus as AgentStepStatus)
        : 'running';
    return {
        iteration: numberOr(v['iteration'] ?? v['step'], 0),
        description: stringOr(v['description'], ''),
        status,
        conversationId: extractConvId(v) ?? fallbackConv,
    };
}

/**
 * Parse an `agent.run.state` event into an AgentRunStateUi. Same
 * shape Android consumes (`MainViewModel.handleAgentRunState`).
 */
export function parseAgentRunState(v: unknown): AgentRunStateUi | undefined {
    if (!isJsonObject(v)) return undefined;
    return {
        conversationId: extractConvId(v) ?? '',
        isRunning: booleanOr(v['is_running'] ?? v['isRunning'] ?? v['running'], false),
        currentIteration: numberOr(
            v['current_iteration'] ?? v['currentIteration'] ?? v['iteration'],
            0,
        ),
        maxIterations: numberOr(v['max_iterations'] ?? v['maxIterations'], 0),
    };
}

/**
 * Parse a HeartbeatConfigUi row from `heartbeat.configs_for_folder`
 * or `heartbeat.config_by_id`. Mirrors the Android parser
 * (data/heartbeat/HeartbeatConfigUi.kt). Tolerates camelCase or
 * snake_case keys defensively.
 */
export function parseHeartbeatConfig(v: unknown): HeartbeatConfigUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    // The host names conversation scopes `conversation_1to1` and
    // `conversation_group`; both are conversation-scoped here.
    const rawScope = stringOr(v['scope_type'] ?? v['scopeType'], 'folder');
    const scopeType: 'folder' | 'conversation' = rawScope.startsWith('conversation')
        ? 'conversation'
        : 'folder';
    return {
        id,
        agentId: stringOr(v['agent_id'] ?? v['agentId'], ''),
        scopeType,
        scopeId: stringOr(v['scope_id'] ?? v['scopeId'], ''),
        alias: stringOr(v['alias'], ''),
        schedule: stringOr(v['schedule'], ''),
        goal: stringOr(v['goal'], ''),
        enabled: booleanOr(v['enabled'], true),
        autoSurfaceTargetConversationId: stringOr(
            v['auto_surface_target_conversation_id'] ?? v['autoSurfaceTargetConversationId'],
            '',
        ),
        maxRunsPerDay: numberOr(v['max_runs_per_day'] ?? v['maxRunsPerDay'], 0),
        lastFireOutcome: stringOr(v['last_fire_outcome'] ?? v['lastFireOutcome'], ''),
        surfaceCriteria: stringOr(v['surface_criteria'] ?? v['surfaceCriteria'], ''),
        selfConfigAllowed: booleanOr(v['self_config_allowed'] ?? v['selfConfigAllowed'], false),
    };
}

const GEOMETRY_KINDS: ReadonlySet<TemplateGeometryKind> = new Set([
    'circles',
    'grid',
    'triangle',
    'wave',
    'bars',
    'arrows',
    'spiral',
    'dots',
]);

/**
 * Parse one ProjectTemplateUi row. Mirrors Android
 * `data/project/ProjectTemplateUi.kt`. Tolerates the catalog being
 * defined with either snake_case (built-ins ship from JSON files on
 * the host) or camelCase keys.
 */
export function parseProjectTemplate(v: unknown): ProjectTemplateUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    const rawGeometry = stringOr(v['geometry_kind'] ?? v['geometryKind'], 'circles');
    const geometryKind: TemplateGeometryKind = GEOMETRY_KINDS.has(
        rawGeometry as TemplateGeometryKind,
    )
        ? (rawGeometry as TemplateGeometryKind)
        : 'circles';
    return {
        id,
        name: stringOr(v['name'], 'Untitled'),
        tagLabel: stringOr(v['tag_label'] ?? v['tagLabel'], ''),
        category: stringOr(v['category'], ''),
        geometryKind,
        baseHue: numberOr(v['base_hue'] ?? v['baseHue'], 210),
        scenario: stringOr(v['scenario'], ''),
        goal: stringOr(v['goal'], ''),
        description: stringOr(v['description'], ''),
        isUserSaved: booleanOr(v['is_user_saved'] ?? v['isUserSaved'], false),
        isPinned: booleanOr(v['is_pinned'] ?? v['isPinned'], false),
    };
}

/**
 * Parse one ProjectTemplateRosterMemberUi row from
 * `project_template.roster`. Mirrors the host's `templateRoster`
 * member-row shape (project-template-service.cpp:312-327).
 */
export function parseProjectTemplateRosterMember(
    v: unknown,
): ProjectTemplateRosterMemberUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const agentId = optionalString(v['agentId'] ?? v['agent_id']);
    const alias = optionalString(v['alias']);
    if (agentId === undefined || alias === undefined || alias.length === 0) {
        return undefined;
    }
    const rawTools = v['allowedTools'] ?? v['allowed_tools'];
    const allowedTools: string[] = [];
    if (Array.isArray(rawTools)) {
        for (const t of rawTools) {
            if (typeof t === 'string' && t.length > 0) allowedTools.push(t);
        }
    }
    return {
        agentId,
        alias,
        isCoordinator: booleanOr(v['isCoordinator'] ?? v['is_coordinator'], false),
        agentName: stringOr(v['agentName'] ?? v['agent_name'], ''),
        iconName: stringOr(v['iconName'] ?? v['icon_name'], ''),
        modelProvider: stringOr(v['modelProvider'] ?? v['model_provider'], ''),
        modelName: stringOr(v['modelName'] ?? v['model_name'], ''),
        allowedTools,
    };
}

const PLAN_STATUSES: ReadonlySet<PlanStatus> = new Set([
    'queued',
    'running',
    'blocked',
    'complete',
    'abandoned',
    'error',
]);
const STEP_STATUSES: ReadonlySet<StepStatus> = new Set([
    'queued',
    'running',
    'success',
    'error',
    'skipped',
    'done',
]);

/**
 * Host plan statuses (`agent-plan.cpp`) mapped onto the client vocabulary.
 * Planning, executing and critiquing are all live work.
 */
const HOST_PLAN_STATUS: Readonly<Record<string, PlanStatus>> = {
    planning: 'running',
    executing: 'running',
    critiquing: 'running',
    blocked: 'blocked',
    completed: 'complete',
    failed: 'error',
};

/**
 * Host step statuses mapped onto the client vocabulary. A step that needs
 * rework or is blocked is shown as an error so the Retry control appears.
 */
const HOST_STEP_STATUS: Readonly<Record<string, StepStatus>> = {
    pending: 'queued',
    in_progress: 'running',
    submitted: 'running',
    done: 'done',
    needs_rework: 'error',
    blocked: 'error',
};

function planStatusOf(raw: string): PlanStatus {
    const mapped = HOST_PLAN_STATUS[raw];
    if (mapped !== undefined) return mapped;
    return PLAN_STATUSES.has(raw as PlanStatus) ? (raw as PlanStatus) : 'queued';
}

function stepStatusOf(raw: string): StepStatus {
    const mapped = HOST_STEP_STATUS[raw];
    if (mapped !== undefined) return mapped;
    return STEP_STATUSES.has(raw as StepStatus) ? (raw as StepStatus) : 'queued';
}

/**
 * Parse one plan step. The host sends `title` plus a longer `description`,
 * and `ordering` for the position; the older `description` / `iteration`
 * keys are still accepted.
 */
export function parseStep(v: unknown, fallbackPlanId = ''): StepUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    return {
        id,
        planId: stringOr(v['plan_id'] ?? v['planId'], fallbackPlanId),
        iteration: numberOr(v['ordering'] ?? v['iteration'] ?? v['step'], 0),
        description: optionalString(v['title']) ?? stringOr(v['description'], ''),
        status: stepStatusOf(stringOr(v['status'], 'queued')),
        startedAt: timestampOr(v['started_at'] ?? v['startedAt'], 0),
        completedAt: timestampOr(v['completed_at'] ?? v['completedAt'], 0),
        result: stringOr(v['result'], ''),
        errorMessage: stringOr(
            v['error_message'] ?? v['errorMessage'] ?? v['last_rejection_reason'],
            '',
        ),
    };
}

export function parsePlan(v: unknown): PlanUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    return {
        id,
        conversationId: stringOr(v['conversation_id'] ?? v['conv_id'] ?? v['conversationId'], ''),
        goal: stringOr(v['goal'], ''),
        status: planStatusOf(stringOr(v['status'], 'queued')),
        createdAt: timestampOr(v['created_at'] ?? v['createdAt'], 0),
        updatedAt: timestampOr(v['updated_at'] ?? v['updatedAt'], 0),
        steps: arrayOf(v['steps'], (s) => parseStep(s, id)),
    };
}

/** Stringifies a JSON value for display; strings pass through unchanged. */
function displayText(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    if (raw === undefined || raw === null) return '';
    try {
        return JSON.stringify(raw, null, 2);
    } catch {
        return String(raw);
    }
}

/**
 * Parse one tool-call log row. The host sends `arguments` and `result` as
 * parsed JSON (or a string when the stored text is not JSON) and the start
 * time as `started_at`.
 */
export function parseToolCallLog(v: unknown): ToolCallLogUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    return {
        id,
        callId: stringOr(v['call_id'] ?? v['callId'], id),
        messageId: stringOr(v['message_id'] ?? v['messageId'], ''),
        conversationId: stringOr(v['conversation_id'] ?? v['conv_id'] ?? v['conversationId'], ''),
        agentId: stringOr(v['agent_id'] ?? v['agentId'], ''),
        memberAlias: stringOr(v['member_alias'] ?? v['memberAlias'], ''),
        toolName: stringOr(v['tool_name'] ?? v['toolName'], ''),
        arguments: displayText(v['arguments']),
        status: stringOr(v['status'], 'pending'),
        result: displayText(v['result']),
        errorMessage: stringOr(v['error_message'] ?? v['errorMessage'], ''),
        createdAt: timestampOr(
            v['started_at'] ?? v['startedAt'] ?? v['created_at'] ?? v['createdAt'],
            0,
        ),
    };
}

/**
 * Parse one activity-log row. The host's audit rows are camelCase
 * (`eventType`, `eventSummary`, `toolName`, ISO `createdAt`); the older
 * `kind` / `description` keys are still accepted.
 */
export function parseActivityEvent(v: unknown): ActivityEventUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    const toolName = stringOr(v['toolName'] ?? v['tool_name'], '');
    return {
        id,
        kind: stringOr(v['eventType'] ?? v['event_type'] ?? v['kind'] ?? v['event_kind'], ''),
        description:
            optionalString(v['eventSummary']) ??
            optionalString(v['event_summary']) ??
            optionalString(v['description']) ??
            toolName,
        actorAlias: stringOr(v['actor_alias'] ?? v['actorAlias'], ''),
        actorAgentId: stringOr(v['actor_agent_id'] ?? v['actorAgentId'], ''),
        turnId: stringOr(v['turn_id'] ?? v['turnId'], ''),
        createdAt: timestampOr(v['created_at'] ?? v['createdAt'], 0),
    };
}

/** Parse one poll option. The host sends the tally as `votes`. */
export function parsePollOption(v: unknown): PollOptionUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    return {
        id,
        text: stringOr(v['text'], ''),
        voteCount: numberOr(v['votes'] ?? v['vote_count'] ?? v['voteCount'], 0),
    };
}

/**
 * Parse one poll. The host reports `status: "open" | "closed"` and ISO
 * timestamps; a `closed` boolean and numeric timestamps are also accepted.
 */
export function parsePoll(v: unknown): PollUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    const rawMode = stringOr(v['mode'], 'single');
    const mode: 'single' | 'multi' = rawMode === 'multi' ? 'multi' : 'single';
    return {
        id,
        conversationId: stringOr(v['conversation_id'] ?? v['conv_id'] ?? v['conversationId'], ''),
        question: stringOr(v['question'], ''),
        options: arrayOf(v['options'], parsePollOption),
        mode,
        closed: v['status'] === 'closed' || booleanOr(v['closed'], false),
        closesAt: timestampOr(v['closes_at'] ?? v['closesAt'], 0),
        createdAt: timestampOr(v['created_at'] ?? v['createdAt'], 0),
    };
}

/**
 * Parse one heartbeat run row. The host sends `startedAtMs` (-1 when
 * unknown), `durationMs` (-1 while running) and the report `title`.
 */
export function parseHeartbeatRun(v: unknown): HeartbeatRunUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    const startedAt = Math.max(
        0,
        timestampOr(v['startedAtMs'] ?? v['started_at'] ?? v['startedAt'], 0),
    );
    const durationMs = numberOr(v['durationMs'] ?? v['duration_ms'], -1);
    const finishedAt =
        startedAt > 0 && durationMs >= 0
            ? startedAt + durationMs
            : Math.max(0, timestampOr(v['finished_at'] ?? v['finishedAt'], 0));
    return {
        id,
        configId: stringOr(v['config_id'] ?? v['configId'], ''),
        startedAt,
        finishedAt,
        outcome: stringOr(v['outcome'], ''),
        report: optionalString(v['report']) ?? stringOr(v['title'], ''),
    };
}

/**
 * Parse one generated-file row. Image and audio rows carry `file_name` and
 * `total_bytes` (-1 when the file is missing); artifact rows carry `size`.
 */
export function parseGeneratedFile(v: unknown): GeneratedFileUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const name = optionalString(v['name'] ?? v['file_name'] ?? v['fileName']);
    if (name === undefined) return undefined;
    return {
        name,
        mimeType: stringOr(v['mime_type'] ?? v['mimeType'], ''),
        size: Math.max(0, numberOr(v['size'] ?? v['total_bytes'] ?? v['totalBytes'], 0)),
        createdAt: timestampOr(v['created_at'] ?? v['createdAt'], 0),
    };
}

export function parseSkill(v: unknown): SkillUi | undefined {
    if (!isJsonObject(v)) return undefined;
    const id = optionalString(v['id']);
    if (id === undefined) return undefined;
    return {
        id,
        source: stringOr(v['source'], ''),
        version: stringOr(v['version'], ''),
        description: stringOr(v['description'], ''),
        tags: stringArray(v['tags']),
        reviewState: stringOr(v['review_state'] ?? v['reviewState'], ''),
    };
}
