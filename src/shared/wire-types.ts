// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'error' | 'user_interrupted' | '';

/**
 * One persisted message row, as projected by the host's
 * `WireDbReader::messageById` / `messagesForConversation`.
 */
export interface MessageUi {
    readonly id: string;
    readonly conversationId: string;
    readonly role: MessageRole;
    readonly content: string;
    readonly createdAt: number;
    readonly tokenCount?: number | undefined;
    readonly modelUsed?: string | undefined;
    readonly finishReason?: FinishReason | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
    readonly agentId?: string | undefined;
    readonly memberAlias?: string | undefined;
    readonly turnId?: string | undefined;
    /**
     * Reasoning sidecar captured from the provider's thinking
     * channel. Render-only — NEVER serialised on the outbound
     * side. Mirrors the desktop and Android L3 invariants.
     */
    readonly thinkingContent?: string | undefined;
}

/**
 * One conversation row, as projected by the host's `conv.list`
 * and `conv.get` ops.
 */
export interface ConversationUi {
    readonly id: string;
    readonly title: string;
    readonly folderId?: string | undefined;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly isGroup: boolean;
    readonly isPinned: boolean;
    readonly primaryAgentId?: string | undefined;
    readonly memberAlias?: string | undefined;
    /** Last message preview, when the host includes one. */
    readonly preview?: string | undefined;
}

export type FolderKind = 'regular' | 'project' | 'organization';

/**
 * One folder row. Projects + organisations are folders with
 * `folderType !== 'regular'`.
 */
export interface FolderUi {
    readonly id: string;
    readonly name: string;
    readonly parentId?: string | undefined;
    readonly folderType: FolderKind;
    readonly goal?: string | undefined;
    readonly description?: string | undefined;
}

/**
 * One project / conversation member (an aliased agent).
 */
export interface MemberUi {
    readonly id: string;
    readonly agentId: string;
    readonly alias: string;
    readonly isCoordinator: boolean;
    readonly modelProvider?: string | undefined;
    readonly modelName?: string | undefined;
    /** Per-member tool allowlist. Empty means the agent's own tool set. */
    readonly allowedTools?: readonly string[] | undefined;
    /**
     * Who added the member: `user` or `agent`. The host uses it to decide
     * which members an agent may remove, so a roster save sends it back
     * unchanged. Undefined when the host did not report it.
     */
    readonly addedByKind?: MemberAddedByKind | undefined;
    /** Id of the agent that added the member when `addedByKind` is `agent`. */
    readonly addedByAgentId?: string | undefined;
}

/** The two member provenance values the host accepts. */
export type MemberAddedByKind = 'user' | 'agent';

/**
 * One named-agent template definition.
 */
export interface AgentSummaryUi {
    readonly id: string;
    readonly name: string;
    readonly description?: string | undefined;
    readonly iconName?: string | undefined;
    readonly isBuiltin: boolean;
    readonly isCoordinator: boolean;
}

/**
 * Conversation-level settings + host-global flags inlined per Android
 * ConvSettingsUi. Response from the host is CAMELCASE; write payload
 * (`conv.settings.save`) is SNAKE_CASE per the protocol convention.
 */
export type AgentPattern = 'direct' | 'react' | 'planner' | 'router' | 'multi_agent' | 'memory';

export interface ConvSettingsUi {
    readonly systemPrompt: string;
    readonly temperature: number;
    readonly maxTokens: number;
    readonly contextWindow: number;
    readonly streaming: boolean;
    readonly thinking: boolean;
    readonly providerId: string;
    readonly modelName: string;
    readonly isGroup: boolean;
    readonly folderId: string;
    readonly primaryAgentId: string;
    readonly heartbeatAutoSurface: boolean;
    readonly autoSurfaceMaxPerDay: number;
    readonly agentPattern: AgentPattern;
    readonly requireConfirmation: boolean;
    readonly toolsEnabled: boolean;
    readonly ragEnabled: boolean;
    /**
     * Sampling overrides. -1 means "Auto" — the slot is unset and the
     * host's per-(provider,model) recommended profile (or the model's
     * own default) fills it. Editable only when [forceAppSampling] is
     * off, mirroring the desktop RightSettingsPanel.
     */
    readonly topK: number;
    readonly topP: number;
    readonly repeatPenalty: number;
    readonly presencePenalty: number;
    readonly frequencyPenalty: number;
    /** App-recommended sampling profile force-applies when true. */
    readonly forceAppSampling: boolean;
    /** Verbose tool prose in the system prompt (off by default). */
    readonly toolsInSystemPrompt: boolean;
    /** Conversation-memory (dynamic compaction) toggle. */
    readonly dynamicCompactEnabled: boolean;
    /** Compact cadence in assistant turns; 0 disables the cadence trigger. */
    readonly compactEveryTurns: number;
}

export interface ConvSettingsPatch {
    readonly systemPrompt?: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly contextWindow?: number;
    readonly streaming?: boolean;
    readonly thinking?: boolean;
    /**
     * Retrieval-augmented generation, scoped to one conversation. The host
     * keeps this on `llm_config.rag_enabled` and carries it on
     * `conv.settings.{get,save}`. The older host-global `rag.enabled.set`
     * op was deleted host-side and now answers `unknown_op`.
     */
    readonly ragEnabled?: boolean;
    readonly topK?: number;
    readonly topP?: number;
    readonly repeatPenalty?: number;
    readonly presencePenalty?: number;
    readonly frequencyPenalty?: number;
    readonly forceAppSampling?: boolean;
    readonly toolsInSystemPrompt?: boolean;
    readonly dynamicCompactEnabled?: boolean;
    readonly compactEveryTurns?: number;
}

/**
 * Outgoing attachment staged in the composer, ready to ship via the
 * `msg.send_with_attachments` wire op. Mirrors Android
 * `data/chat/OutgoingAttachment.kt`. Caps (enforced both client-side
 * and re-validated server-side):
 *   - MAX_ATTACHMENTS attachments per message
 *   - MAX_CONTENT_BYTES raw bytes per attachment
 *   - MAX_CONTENT_BYTES raw bytes total per message
 *   (see `wire-limits.ts` — the single source mirrored from the host)
 * `contentBase64` is the URL-safe-free standard base64 (no data: URL
 * prefix). `rawBytes` is the pre-encode byte count used for cap
 * checks; the host re-validates `content_base64` and rejects with
 * `payload_too_large` if a rule is broken.
 */
export interface OutgoingAttachmentUi {
    readonly fileName: string;
    readonly mimeType: string;
    readonly rawBytes: number;
    readonly contentBase64: string;
}

/** One paired-device row, projected from `clients.list`. */
export interface ClientUi {
    readonly id: string;
    readonly name: string;
    readonly current: boolean;
    readonly revoked: boolean;
    readonly lastSeenAt: number;
    readonly firstPairedAt: number;
}

/** One catalog tool entry, projected from `tool.list`. */
export interface ToolUi {
    readonly name: string;
    readonly description: string;
    readonly enabled: boolean;
    readonly isBuiltIn: boolean;
    readonly kind: 'built_in' | 'custom' | 'mcp';
    readonly mcpServer: string;
    readonly shortName: string;
}

/** One MCP server entry, projected from `mcp.list`. */
export interface McpServerUi {
    readonly name: string;
    readonly type: string;
    readonly disabled: boolean;
    readonly status: string;
    readonly errorMessage: string;
    readonly toolCount: number;
}

/** One skill entry, projected from `skill.list`. */
export interface SkillUi {
    readonly id: string;
    readonly source: string;
    readonly version: string;
    readonly description: string;
    readonly tags: readonly string[];
    readonly reviewState: string;
}

/**
 * One provider entry in the host model catalog, projected from
 * `models.catalog`. The host returns the per-provider capability
 * flags (streaming / tool-calling / vision) alongside the model
 * list so the picker can surface them as glyphs without a follow-up
 * round trip. Mirrors Android `ProviderUi` (see
 * `MainViewModel.kt::loadModelCatalog` around line 2583).
 */
export interface ProviderUi {
    readonly providerId: string;
    readonly displayName: string;
    readonly supportsStreaming: boolean;
    readonly supportsToolCalling: boolean;
    readonly supportsVision: boolean;
    readonly models: readonly string[];
}

/**
 * Snapshot of the host's model catalog plus the currently active
 * provider+model. Pushed to the webview on session-ready and
 * whenever the host emits a `models.active_changed` event. Empty
 * `providers`, `activeProvider`, `activeModel` are valid — the host
 * may not have any provider configured yet.
 */
export interface ModelCatalogUi {
    readonly providers: readonly ProviderUi[];
    readonly activeProvider: string;
    readonly activeModel: string;
}

export interface SearchProviderUi {
    readonly id: string;
    readonly displayName: string;
    readonly requiresApiKey: boolean;
    readonly hasKey: boolean;
    readonly active: boolean;
    readonly baseUrl: string;
}

/** Snapshot of the host's web-search provider catalogue. */
export interface SearchProvidersCatalogUi {
    readonly providers: readonly SearchProviderUi[];
}

/**
 * One pending tool-call confirmation. Triggered by the host's
 * `tool_call.requested` event when the assistant wants to execute a
 * tool that the user opted into confirming first (see Android
 * `agent.require_confirmation` flag + `PendingToolConfirmationUi`
 * struct in `MainViewModel.kt`). The webview shows a modal with the
 * tool name + JSON args; Approve fires `tool_call.approve`, Deny
 * fires `tool_call.deny`. Dismissed when `tool_call.completed` echoes
 * the same callId back.
 */
export interface PendingToolConfirmationUi {
    readonly callId: string;
    readonly toolName: string;
    /** Pretty-printed JSON arguments — ready to render in a <pre>. */
    readonly arguments: string;
    readonly conversationId: string;
    readonly messageId: string;
    readonly agentId: string;
    readonly memberAlias: string;
}

/**
 * Plan status as shown in the Plans overlay. `blocked` is a live plan that
 * is waiting on a step the user can retry, skip or mark done.
 */
export type PlanStatus = 'queued' | 'running' | 'blocked' | 'complete' | 'abandoned' | 'error';
export type StepStatus = 'queued' | 'running' | 'success' | 'error' | 'skipped' | 'done';

/**
 * One execution step inside a Plan. Mirrors Android `StepUi`.
 */
export interface StepUi {
    readonly id: string;
    readonly planId: string;
    readonly iteration: number;
    readonly description: string;
    readonly status: StepStatus;
    readonly startedAt: number;
    readonly completedAt: number;
    readonly result: string;
    readonly errorMessage: string;
}

/**
 * One agent run-plan tied to a conversation. Mirrors Android
 * `PlanUi` (data/plan/PlanUi.kt).
 */
export interface PlanUi {
    readonly id: string;
    readonly conversationId: string;
    readonly goal: string;
    readonly status: PlanStatus;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly steps: readonly StepUi[];
}

/**
 * One tool-call log entry. Mirrors Android `ToolCallUi`.
 */
export interface ToolCallLogUi {
    readonly id: string;
    readonly callId: string;
    readonly messageId: string;
    readonly conversationId: string;
    readonly agentId: string;
    readonly memberAlias: string;
    readonly toolName: string;
    readonly arguments: string;
    readonly status: string;
    readonly result: string;
    readonly errorMessage: string;
    readonly createdAt: number;
}

/**
 * One activity-log event. Mirrors Android `ActivityEventUi`.
 */
export interface ActivityEventUi {
    readonly id: string;
    readonly kind: string;
    readonly description: string;
    readonly actorAlias: string;
    readonly actorAgentId: string;
    readonly turnId: string;
    readonly createdAt: number;
}

/**
 * One poll option. Mirrors Android `PollOptionUi`.
 */
export interface PollOptionUi {
    readonly id: string;
    readonly text: string;
    readonly voteCount: number;
}

/**
 * One poll attached to a conversation. Mirrors Android `PollUi`.
 */
export interface PollUi {
    readonly id: string;
    readonly conversationId: string;
    readonly question: string;
    readonly options: readonly PollOptionUi[];
    readonly mode: 'single' | 'multi';
    readonly closed: boolean;
    readonly closesAt: number;
    readonly createdAt: number;
}

/**
 * One heartbeat-run row from `heartbeat.recent_runs`. Mirrors
 * Android `HeartbeatRunUi`.
 */
export interface HeartbeatRunUi {
    readonly id: string;
    readonly configId: string;
    readonly startedAt: number;
    readonly finishedAt: number;
    readonly outcome: string;
    readonly report: string;
}

/**
 * One generated-file row (image / audio / artifact). Mirrors Android
 * `GeneratedFileUi`.
 */
export interface GeneratedFileUi {
    readonly name: string;
    readonly mimeType: string;
    readonly size: number;
    readonly createdAt: number;
}

/**
 * One bundled-or-saved project template. Mirrors Android
 * `ProjectTemplateUi`. `geometryKind` + `baseHue` drive a small
 * procedural banner in the card (see ProjectTemplateBanner). `id`
 * is a stable catalog slug for built-ins, a UUID-shaped slug for
 * user-saved templates.
 */
export type TemplateGeometryKind =
    | 'circles'
    | 'grid'
    | 'triangle'
    | 'wave'
    | 'bars'
    | 'arrows'
    | 'spiral'
    | 'dots';

export interface ProjectTemplateUi {
    readonly id: string;
    readonly name: string;
    readonly tagLabel: string;
    readonly category: string;
    readonly geometryKind: TemplateGeometryKind;
    readonly baseHue: number;
    readonly scenario: string;
    readonly goal: string;
    readonly description: string;
    readonly isUserSaved: boolean;
    readonly isPinned: boolean;
}

/**
 * One member entry on a template's roster (returned by
 * `project_template.roster`). Mirrors the host's `templateRoster`
 * shape (project-template-service.cpp:312-327).
 */
export interface ProjectTemplateRosterMemberUi {
    readonly agentId: string;
    readonly alias: string;
    readonly isCoordinator: boolean;
    readonly agentName: string;
    readonly iconName: string;
    readonly modelProvider: string;
    readonly modelName: string;
    readonly allowedTools: readonly string[];
}

/**
 * One scheduled subagent run (a "heartbeat") attached to a folder
 * (Project / Organization) or a conversation. Mirrors Android
 * `HeartbeatConfigUi` (data/heartbeat/HeartbeatConfigUi.kt). Created
 * via `heartbeat.upsert`, removed via `heartbeat.remove`, fired
 * manually via `heartbeat.run_now`.
 *
 * `scope_type` is `'folder'` or `'conversation'`. `schedule` is a
 * cron-ish expression — an empty schedule means manual fire only.
 * `enabled` toggles whether the cron fires; manual runs bypass it.
 */
export interface HeartbeatConfigUi {
    readonly id: string;
    readonly agentId: string;
    readonly scopeType: 'folder' | 'conversation';
    readonly scopeId: string;
    readonly alias: string;
    readonly schedule: string;
    readonly goal: string;
    readonly enabled: boolean;
    readonly autoSurfaceTargetConversationId: string;
    readonly maxRunsPerDay: number;
    readonly lastFireOutcome: string;
    /** When a run's report is worth posting. Edited on the desktop; kept on save. */
    readonly surfaceCriteria: string;
    /** Whether the heartbeat agent may change its own config. Kept on save. */
    readonly selfConfigAllowed: boolean;
}

export type AgentStepStatus = 'running' | 'success' | 'error' | 'pending';

/**
 * One agent step in the progress banner. The host emits
 * `agent.step.started` (status: running) and `agent.step.completed`
 * (status: success | error). The banner renders the most recent N
 * steps with status icons + descriptions; mirrors Android
 * `AgentProgressBanner.kt`.
 */
export interface AgentStepUi {
    readonly iteration: number;
    readonly description: string;
    readonly status: AgentStepStatus;
    readonly conversationId: string;
}

/**
 * Current state of an agent run. The host emits `agent.run.state`
 * whenever the run starts, advances an iteration, or finishes.
 * `isRunning` drives the AgentProgressBanner's visibility. When a
 * run finishes the step list is cleared client-side.
 */
export interface AgentRunStateUi {
    readonly conversationId: string;
    readonly isRunning: boolean;
    readonly currentIteration: number;
    readonly maxIterations: number;
}

/**
 * Permission tier registered with a workspace mount. Drives the
 * extension-side confirmation routing per L25 of the host plan:
 *
 *   ask    — every write surfaces a confirmation modal (DEFAULT).
 *   smart  — extension-side heuristic auto-approves "obviously safe"
 *            writes, auto-rejects "obviously dangerous" ones,
 *            escalates ambiguous ones to `ask`.
 *   bypass — writes auto-apply; persistent banner reminds the user.
 *            Audit log still records every write.
 *
 * The host stores the tier as advisory metadata; the authoritative
 * confirmation decision happens on the client. The tier strings
 * match the host's `folder_mounts.permission_tier` CHECK enum
 * exactly.
 */
export type PermissionTier = 'ask' | 'smart' | 'bypass';

/**
 * One entry in the shallow tree manifest the extension pushes to
 * the host on `workspace.mount.register` and `workspace.mount.
 * update_tree`. Paths are workspace-relative POSIX paths (forward
 * slashes regardless of host OS). `mtimeMs` is Unix milliseconds.
 */
export interface WorkspaceTreeEntry {
    readonly path: string;
    readonly size: number;
    readonly mtimeMs: number;
}

export interface WorkspaceTreeManifest {
    readonly v: 1;
    readonly files: readonly WorkspaceTreeEntry[];
}

/**
 * Local record of a currently-active workspace mount in this VS Code
 * window. Persisted across reloads in `workspaceState` so a
 * re-registered mount keeps the same `mountId` after restart.
 */
export interface WorkspaceMountInfoUi {
    readonly folderId: string;
    readonly mountId: string;
    readonly ownerLabel: string;
    readonly permissionTier: PermissionTier;
    readonly workspaceRoot: string;
    readonly registeredAtMs: number;
    readonly fileCount: number;
}
