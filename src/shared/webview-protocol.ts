// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type {
    ActivityEventUi,
    AgentPattern,
    AgentRunStateUi,
    AgentStepUi,
    AgentSummaryUi,
    ClientUi,
    ConvSettingsPatch,
    ConvSettingsUi,
    GeneratedFileUi,
    HeartbeatConfigUi,
    HeartbeatRunUi,
    McpServerUi,
    MemberAddedByKind,
    MemberUi,
    ModelCatalogUi,
    OutgoingAttachmentUi,
    PendingToolConfirmationUi,
    PlanUi,
    PollUi,
    ProjectTemplateRosterMemberUi,
    ProjectTemplateUi,
    SearchProvidersCatalogUi,
    SkillUi,
    ToolCallLogUi,
    ToolUi,
} from './wire-types.js';

/** Host-side representation of one paired host for the webview. */
export interface HostSummaryUi {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    /** True when a TLS cert SHA-256 pin is configured for the host. */
    readonly hasTlsPin: boolean;
}

/** Cross-host connection state shipped on every push. */
export interface HostConnectionState {
    readonly hostId: string;
    readonly state:
        | 'disconnected'
        | 'connecting'
        | 'authenticating'
        | 'connected'
        | 'reconnecting'
        | 'unauthorized'
        | 'error';
}

/** Recent-conversation row rendered in the Home tab + Chat list. */
export interface RecentConversationUi {
    readonly id: string;
    readonly hostId: string;
    readonly title: string;
    readonly isGroup: boolean;
    readonly isPinned: boolean;
    readonly updatedAt: number;
    readonly preview: string;
}

/** Full conversation projection — drives the Chat tab navigation. */
export interface ConversationFullUi {
    readonly id: string;
    readonly hostId: string;
    readonly title: string;
    readonly folderId: string | undefined;
    readonly isGroup: boolean;
    readonly isPinned: boolean;
    readonly primaryAgentId: string | undefined;
    readonly updatedAt: number;
    readonly preview: string;
}

/** Folder summary used to render the Project Rooms section. */
export interface FolderSummaryUi {
    readonly id: string;
    readonly hostId: string;
    readonly name: string;
    readonly folderType: 'regular' | 'project' | 'organization';
    readonly parentId: string | undefined;
    /**
     * Optional metadata copied from the host's folder.summary
     * projection. The host populates these for Project /
     * Organization folders that have them set; Regular folders
     * leave them blank. Read by the folder editor on edit-mode
     * hydration so the user sees the saved values rather than
     * empty fields.
     */
    readonly goal: string;
    readonly description: string;
}

/** One row in the Chat tab's message timeline. */
export interface MessageRowUi {
    readonly id: string;
    readonly conversationId: string;
    readonly role: 'user' | 'assistant' | 'system' | 'tool';
    readonly content: string;
    readonly thinkingContent: string;
    readonly createdAt: number;
    readonly modelUsed: string;
    readonly tokenCount: number;
    readonly finishReason: string;
    readonly agentId: string | undefined;
    readonly memberAlias: string | undefined;
}

export type TabId = 'home' | 'chat' | 'settings';

/**
 * Remote command-execution policy for a conversation (vfs.execute):
 *   - off   : refuse; the agent gets exec_disabled and the command runs
 *             on the host instead.
 *   - ask   : confirm every command before it runs (user is responsible).
 *   - allow : auto-run (still SmartFilter-gated and sandboxed).
 */
export type RemoteExecMode = 'off' | 'ask' | 'allow';

/** Top-level envelope tag for messages flowing out of the host. */
export type ExtensionToWebview =
    | { readonly type: 'ready'; readonly host: HostHandshake }
    | { readonly type: 'pong'; readonly seq: number }
    | { readonly type: 'error'; readonly message: string }
    | {
          readonly type: 'hosts.updated';
          readonly hosts: readonly HostSummaryUi[];
          readonly activeHostId: string | undefined;
          readonly defaultHostId: string | undefined;
          readonly states: readonly HostConnectionState[];
      }
    | {
          readonly type: 'host.stateChanged';
          readonly hostId: string;
          readonly state: HostConnectionState['state'];
      }
    | {
          readonly type: 'conversations.recent.updated';
          readonly hostId: string;
          readonly conversations: readonly RecentConversationUi[];
      }
    | {
          readonly type: 'conversations.full.updated';
          readonly hostId: string;
          readonly conversations: readonly ConversationFullUi[];
          readonly folders: readonly FolderSummaryUi[];
      }
    | {
          readonly type: 'messages.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly messages: readonly MessageRowUi[];
      }
    | {
          readonly type: 'message.delta';
          readonly hostId: string;
          readonly conversationId: string;
          readonly messageId: string;
          readonly contentDelta: string;
          readonly thinkingDelta: string;
      }
    | {
          readonly type: 'host.pingResult';
          readonly hostId: string;
          readonly ok: boolean;
          readonly latencyMs: number;
          readonly error: string;
      }
    | {
          readonly type: 'host.identity';
          readonly hostId: string;
          readonly clientId: string;
          readonly clientName: string;
      }
    | {
          readonly type: 'conv.settings.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly settings: ConvSettingsUi;
      }
    | {
          readonly type: 'agents.updated';
          readonly hostId: string;
          readonly agents: readonly AgentSummaryUi[];
      }
    | {
          readonly type: 'clients.updated';
          readonly hostId: string;
          readonly clients: readonly ClientUi[];
      }
    | {
          readonly type: 'tools.updated';
          readonly hostId: string;
          readonly tools: readonly ToolUi[];
      }
    | {
          readonly type: 'mcp.updated';
          readonly hostId: string;
          readonly servers: readonly McpServerUi[];
      }
    | {
          readonly type: 'skills.updated';
          readonly hostId: string;
          readonly skills: readonly SkillUi[];
      }
    | {
          readonly type: 'verifySession.result';
          readonly hostId: string;
          readonly ok: boolean;
          readonly latencyMs: number;
          readonly clientId: string;
          readonly clientName: string;
          readonly error: string;
      }
    | {
          readonly type: 'folder.members.updated';
          readonly hostId: string;
          readonly folderId: string;
          readonly members: readonly MemberUi[];
      }
    | {
          readonly type: 'models.catalog.updated';
          readonly hostId: string;
          readonly catalog: ModelCatalogUi;
      }
    | {
          readonly type: 'models.active.changed';
          readonly hostId: string;
          readonly activeProvider: string;
          readonly activeModel: string;
      }
    | {
          readonly type: 'search.providers.updated';
          readonly hostId: string;
          readonly catalog: SearchProvidersCatalogUi;
      }
    | {
          /**
           * Fired after the extension's `conversation.createRequested`
           * handler successfully creates a new conversation on the host.
           * The webview switches to the Chat tab + sets
           * activeConversationId so the freshly-created conv opens.
           */
          readonly type: 'conversation.created';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Ask the webview to switch to a conversation (Chat tab +
           * activeConversationId). Fired by the extension when the
           * user clicks Open on an @mention notification.
           */
          readonly type: 'conversation.focusRequested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Whether the open VS Code workspace is shared (mounted)
           * with a conversation. Pushed on conversation switch and
           * whenever mounts or workspace folders change; drives the
           * in-chat share banner. 'mismatched' = a mount exists but
           * is bound to a different folder than this conversation
           * resolves to.
           */
          readonly type: 'workspace.shareStatus.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly status: 'mounted' | 'unmounted' | 'mismatched' | 'none';
          readonly workspaceName: string;
      }
    | {
          /**
           * Per-conversation context-window fill percentage from the
           * host's `chat.context_fill.changed` wire event (measured
           * at each request build). Drives the composer gauge chip.
           */
          readonly type: 'chat.contextFill.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly percent: number;
      }
    | {
          /**
           * Surface a tool-call confirmation modal. Fired by WireSync
           * when the host emits `tool_call.requested`. The modal is
           * host-level (App.tsx) — visible regardless of which
           * conversation is foregrounded, matching Android's
           * `MainUiState.pendingToolConfirmation` behaviour.
           */
          readonly type: 'tool_call.confirmation.requested';
          readonly hostId: string;
          readonly pending: PendingToolConfirmationUi;
      }
    | {
          /** Dismiss any active modal whose callId matches. */
          readonly type: 'tool_call.confirmation.dismissed';
          readonly hostId: string;
          readonly callId: string;
      }
    | {
          /** Upsert one step in the agent progress banner. */
          readonly type: 'agent.step.update';
          readonly hostId: string;
          readonly step: AgentStepUi;
      }
    | {
          /** Mutate the agent run-state (banner visibility + step counter). */
          readonly type: 'agent.run.state.update';
          readonly hostId: string;
          readonly runState: AgentRunStateUi;
      }
    | {
          /**
           * Full heartbeat-config list for one folder, pushed when the
           * webview asks via `heartbeats.requested` and on
           * `heartbeat.config.changed` / `.removed` events. Empty array
           * = no heartbeats configured.
           */
          readonly type: 'heartbeats.updated';
          readonly hostId: string;
          readonly folderId: string;
          readonly configs: readonly HeartbeatConfigUi[];
      }
    | {
          /** Preferred-skills snapshot for one folder. */
          readonly type: 'preferredSkills.updated';
          readonly hostId: string;
          readonly folderId: string;
          readonly skillIds: readonly string[];
          readonly exposeOnly: boolean;
      }
    | {
          /**
           * Whether the conversation overrides its parent folder's
           * preferred-skill list. Sourced from
           * `skill.override_parent_folder` with scope_type=conversation.
           * When `override` is false, the conversation inherits the
           * folder list; when true, the conv-scope list (next envelope)
           * is applied instead.
           */
          readonly type: 'convSkillOverride.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly override: boolean;
      }
    | {
          /**
           * Conversation-scope preferred-skill snapshot. Sourced from
           * `skill.preferred.list` with scope_type=conversation. Only
           * meaningful when the conv overrides its parent folder.
           */
          readonly type: 'convPreferredSkills.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly skillIds: readonly string[];
      }
    | {
          /**
           * Per-conversation heartbeat-gate snapshot. Sourced from
           * the dedicated `conv.heartbeat.gate` op (NOT the
           * `conv.settings.save` patch, which silently drops these
           * fields per W17).
           */
          readonly type: 'convHeartbeatGate.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly allow: boolean;
          readonly maxPerDay: number;
      }
    | {
          /**
           * Per-conversation remote command-execution mode (vfs.execute
           * Off / Ask / Allow). Client-local — stored in this device's
           * workspaceState, never on the host. Pushed in response to a
           * `convExecMode.requested` and after a `convExecMode.set`.
           */
          readonly type: 'convExecMode.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly mode: RemoteExecMode;
      }
    | {
          /**
           * An agent tried to run a command in a conversation whose
           * execution mode is Off. Drives a one-click in-chat banner
           * that offers to enable Ask / Allow — the in-chat replacement
           * for the old corner consent toast. The command ran on the
           * host this turn (the agent got exec_disabled).
           */
          readonly type: 'exec.consentSuggested';
          readonly hostId: string;
          readonly conversationId: string;
          readonly commandPreview: string;
      }
    | {
          /**
           * Ask-mode per-command confirmation, shown as a modal in the
           * chat area (not a VS Code dialog). The webview replies with
           * `exec.confirmResponse` carrying the same requestId.
           */
          readonly type: 'exec.confirmRequested';
          readonly hostId: string;
          readonly conversationId: string;
          readonly requestId: string;
          readonly command: string;
          readonly sandboxed: boolean;
      }
    | {
          /** Documents list for one folder. */
          readonly type: 'documents.updated';
          readonly hostId: string;
          readonly folderId: string;
          readonly documents: readonly { readonly name: string; readonly size: number }[];
      }
    | {
          readonly type: 'plans.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly plans: readonly PlanUi[];
      }
    | {
          readonly type: 'toolCalls.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly toolCalls: readonly ToolCallLogUi[];
      }
    | {
          readonly type: 'activity.updated';
          readonly hostId: string;
          readonly scopeKind: 'project' | 'conversation' | 'turn';
          readonly scopeId: string;
          readonly events: readonly ActivityEventUi[];
      }
    | {
          readonly type: 'polls.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly polls: readonly PollUi[];
      }
    | {
          readonly type: 'media.updated';
          readonly hostId: string;
          readonly conversationId: string;
          readonly images: readonly GeneratedFileUi[];
          readonly audio: readonly GeneratedFileUi[];
          readonly artifacts: readonly GeneratedFileUi[];
      }
    | {
          readonly type: 'mcp.serverTools.updated';
          readonly hostId: string;
          readonly serverName: string;
          readonly tools: readonly ToolUi[];
      }
    | {
          readonly type: 'skill.detail.updated';
          readonly hostId: string;
          readonly skill: SkillUi;
      }
    | {
          readonly type: 'heartbeat.runs.updated';
          readonly hostId: string;
          readonly configId: string;
          readonly runs: readonly HeartbeatRunUi[];
      }
    | {
          /** Project-template landing list snapshot. */
          readonly type: 'projectTemplates.updated';
          readonly hostId: string;
          readonly templates: readonly ProjectTemplateUi[];
      }
    | {
          /**
           * Full project-template catalog (built-ins + user-saved,
           * both pinned and unpinned). Distinct from the landing list
           * because the Template Library shows the full catalog while
           * the home landing only shows built-ins + user-pinned.
           */
          readonly type: 'projectTemplates.allUpdated';
          readonly hostId: string;
          readonly templates: readonly ProjectTemplateUi[];
      }
    | {
          /**
           * Roster (member list) for one template — fed to the
           * Read-More detail sheet.
           */
          readonly type: 'template.roster.updated';
          readonly hostId: string;
          readonly templateId: string;
          readonly members: readonly ProjectTemplateRosterMemberUi[];
      }
    | {
          /**
           * Fired after `project_template.create_project` succeeds.
           * Carries the friendly `folderName` + `memberCount` so the
           * KickoffSheet can render "Start chatting with your team?"
           * with accurate copy. Mirrors Android's
           * `project_template.project_created` host event +
           * `consumeProjectTemplateCreated` bridge to PendingKickoff.
           */
          readonly type: 'projectTemplate.projectCreated';
          readonly hostId: string;
          readonly folderId: string;
          readonly folderName: string;
          readonly memberCount: number;
      }
    | {
          /**
           * Fired when `project_template.create_project` fails, or cannot
           * be sent. The Quick Start sheet unlocks its inputs and shows
           * `message`.
           */
          readonly type: 'projectTemplate.createFailed';
          readonly hostId: string;
          readonly templateId: string;
          readonly message: string;
      }
    | {
          /**
           * Fired after `folder.createRequested` succeeds. Mirrors
           * Android: the create dialog closes and (if members were
           * added) the KickoffSheet appears so the user can spin up
           * 1:1 and/or group chats. The webview does NOT auto-open
           * the folder in edit mode — that was explicitly rejected.
           */
          readonly type: 'folder.created';
          readonly hostId: string;
          readonly folderId: string;
          readonly folderName: string;
          readonly memberCount: number;
      }
    | {
          /**
           * Stage an IDE-sourced payload onto the chat composer. Used
           * by `verzeta.sendSelectionToChat` and the file-attach
           * commands so the user sees the staged content in the chat
           * before sending. `attachment` lands in pendingAttachments
           * (existing chip UI); `composerText` is appended to the
           * draft (with a leading double-newline if the draft already
           * has text). Either field may be empty — the command picks
           * the appropriate shape for the payload kind.
           *
           * `focusChat=true` switches the webview to the Chat tab
           * after staging, so the user lands where the action takes
           * effect.
           */
          readonly type: 'ide.stage';
          readonly composerText: string;
          readonly attachment: {
              readonly fileName: string;
              readonly mimeType: string;
              readonly rawBytes: number;
              readonly contentBase64: string;
          } | null;
          readonly focusChat: boolean;
      }
    | {
          /**
           * Surface an informational toast inside the webview (errors
           * around attachment caps, "no active conversation", etc).
           * Distinct from the global `error` envelope so the IDE
           * surfaces can show a softer non-error message when needed.
           */
          readonly type: 'ide.notice';
          readonly level: 'info' | 'warn' | 'error';
          readonly message: string;
      };

/** Top-level envelope tag for messages flowing into the host. */
export type WebviewToExtension =
    | { readonly type: 'hello' }
    | { readonly type: 'ping'; readonly seq: number }
    | { readonly type: 'host.setActive'; readonly hostId: string }
    | { readonly type: 'host.connectRequested'; readonly hostId: string }
    | { readonly type: 'host.disconnectRequested'; readonly hostId: string }
    | { readonly type: 'host.commandRequested'; readonly commandId: string }
    | {
          readonly type: 'conversation.openRequested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Delete a conversation. WebviewSync calls `conv.delete`
           * then relies on the host's `conv.deleted` event to refresh
           * the sidebar. The webview shows a confirm modal before
           * firing this envelope; the extension does NOT re-confirm.
           */
          readonly type: 'conversation.deleteRequested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Delete a folder (Project / Organization / Regular).
           * WebviewSync calls `folder.delete` then relies on the
           * host's `folder.deleted` event to refresh the sidebar.
           * Confirmation is the webview's responsibility.
           */
          readonly type: 'folder.deleteRequested';
          readonly hostId: string;
          readonly folderId: string;
      }
    | {
          readonly type: 'message.send';
          readonly hostId: string;
          readonly conversationId: string;
          readonly text: string;
      }
    | {
          readonly type: 'message.sendWithAttachments';
          readonly hostId: string;
          readonly conversationId: string;
          readonly text: string;
          readonly attachments: readonly OutgoingAttachmentUi[];
      }
    | {
          readonly type: 'message.stop';
          readonly hostId: string;
      }
    | {
          readonly type: 'host.pingRequested';
          readonly hostId: string;
      }
    | {
          readonly type: 'host.revokeSelfRequested';
          readonly hostId: string;
      }
    | {
          readonly type: 'conv.settings.requested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Fetch this conversation's client-local command-execution
           * mode; the extension replies with `convExecMode.updated`.
           */
          readonly type: 'convExecMode.requested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Set this conversation's client-local command-execution mode
           * (from the Conversation Settings control). Stored in
           * workspaceState; the extension echoes `convExecMode.updated`.
           */
          readonly type: 'convExecMode.set';
          readonly hostId: string;
          readonly conversationId: string;
          readonly mode: RemoteExecMode;
      }
    | {
          /**
           * The user's decision on an `exec.confirmRequested` modal.
           * `requestId` echoes the request; `approved` runs or rejects
           * the command.
           */
          readonly type: 'exec.confirmResponse';
          readonly hostId: string;
          readonly requestId: string;
          readonly approved: boolean;
      }
    | {
          /**
           * One-click share from the in-chat banner. The click is the
           * consent; the extension binds the workspace mount to this
           * conversation (releasing a mismatched mount first).
           */
          readonly type: 'workspace.shareRequested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          readonly type: 'conv.settings.save';
          readonly hostId: string;
          readonly conversationId: string;
          readonly patch: ConvSettingsPatch;
      }
    | {
          readonly type: 'agent.pattern.set';
          readonly hostId: string;
          readonly conversationId: string;
          readonly pattern: AgentPattern;
      }
    | {
          readonly type: 'agent.require_confirmation.set';
          readonly hostId: string;
          readonly conversationId: string;
          readonly require: boolean;
      }
    | {
          readonly type: 'tools.enabled.set';
          readonly hostId: string;
          readonly conversationId: string;
          readonly enabled: boolean;
      }
    // RAG has no message of its own: it is a per-conversation setting and
    // travels as `conv.settings.save` with a `{ ragEnabled }` patch. The old
    // `rag.enabled.set` message existed to drive a host-global wire op that the
    // host deleted; it answered `unknown_op` on every modern host.
    | {
          readonly type: 'conv.primary_agent.set';
          readonly hostId: string;
          readonly conversationId: string;
          readonly agentId: string;
      }
    | {
          readonly type: 'agents.listRequested';
          readonly hostId: string;
      }
    | {
          readonly type: 'clients.listRequested';
          readonly hostId: string;
      }
    | {
          readonly type: 'clients.revokeRequested';
          readonly hostId: string;
          readonly clientId: string;
      }
    | {
          readonly type: 'tools.listRequested';
          readonly hostId: string;
      }
    | {
          readonly type: 'mcp.listRequested';
          readonly hostId: string;
      }
    | {
          readonly type: 'skills.listRequested';
          readonly hostId: string;
      }
    | {
          readonly type: 'verifySession.requested';
          readonly hostId: string;
      }
    | {
          readonly type: 'folder.members.requested';
          readonly hostId: string;
          readonly folderId: string;
      }
    | {
          readonly type: 'folder.member.chat.openRequested';
          readonly hostId: string;
          readonly folderId: string;
          readonly agentId: string;
          readonly alias: string;
      }
    | {
          readonly type: 'folder.kickoff.groupRequested';
          readonly hostId: string;
          readonly folderId: string;
      }
    | {
          /**
           * "Create a 1:1 conversation with each member" — fires
           * `folder.kickoff.individual` on the host, which spawns N
           * direct chats (one per project member). Mirrors Android
           * `runKickoffIndividual` (MainViewModel.kt) wired into the
           * KickoffSheet `onStart` callback.
           */
          readonly type: 'folder.kickoff.individualRequested';
          readonly hostId: string;
          readonly folderId: string;
      }
    | {
          readonly type: 'conversation.createRequested';
          readonly hostId: string;
      }
    | {
          readonly type: 'folder.createRequested';
          readonly hostId: string;
          readonly name: string;
          readonly folderType: 'regular' | 'project' | 'organization';
          readonly goal: string;
          readonly description: string;
          /**
           * Optional roster snapshot to install onto the new folder
           * immediately after creation. WebviewSync chains
           * `folder.members.set` once the new folder's id is known.
           * Empty array means "no roster yet" (the user can add
           * members later from the folder detail screen).
           *
           * `modelProvider` / `modelName` / `allowedTools` are
           * per-member overrides, stored by the host's
           * `folder.members.set` op. Empty strings + empty array =
           * "no override; inherit conversation default".
           * `addedByKind` / `addedByAgentId` carry the member's
           * provenance so a save keeps it; absent means the host
           * default (`user`).
           */
          readonly members: readonly {
              readonly agentId: string;
              readonly alias: string;
              readonly isCoordinator: boolean;
              readonly modelProvider: string;
              readonly modelName: string;
              readonly allowedTools: readonly string[];
              readonly addedByKind?: MemberAddedByKind | undefined;
              readonly addedByAgentId?: string | undefined;
          }[];
      }
    | {
          readonly type: 'models.catalog.requested';
          readonly hostId: string;
      }
    | {
          readonly type: 'models.setActiveRequested';
          readonly hostId: string;
          readonly providerId: string;
          readonly modelName: string;
      }
    | {
          readonly type: 'search.providers.requested';
          readonly hostId: string;
      }
    | {
          readonly type: 'search.setActiveRequested';
          readonly hostId: string;
          readonly providerId: string;
      }
    | {
          /** Approve a pending tool-call confirmation. */
          readonly type: 'tool_call.approveRequested';
          readonly hostId: string;
          readonly callId: string;
      }
    | {
          /** Deny a pending tool-call confirmation. */
          readonly type: 'tool_call.denyRequested';
          readonly hostId: string;
          readonly callId: string;
      }
    | {
          /** Request the heartbeat-config list for one folder. */
          readonly type: 'heartbeats.requested';
          readonly hostId: string;
          readonly folderId: string;
      }
    | {
          /** Insert or update a heartbeat config. */
          readonly type: 'heartbeat.upsertRequested';
          readonly hostId: string;
          /** Empty string = insert; existing id = update. */
          readonly id: string;
          readonly folderId: string;
          readonly agentId: string;
          readonly alias: string;
          readonly schedule: string;
          readonly goal: string;
          readonly enabled: boolean;
          readonly maxRunsPerDay: number;
          readonly autoSurfaceTargetConversationId: string;
      }
    | {
          /** Delete a heartbeat config. */
          readonly type: 'heartbeat.removeRequested';
          readonly hostId: string;
          readonly id: string;
          readonly folderId: string;
      }
    | {
          /** Fire a heartbeat immediately. */
          readonly type: 'heartbeat.runRequested';
          readonly hostId: string;
          readonly id: string;
      }
    | {
          /** Request the preferred-skills snapshot for one folder. */
          readonly type: 'preferredSkills.requested';
          readonly hostId: string;
          readonly folderId: string;
      }
    | {
          /** Replace the preferred-skill set + expose-only flag for one folder. */
          readonly type: 'preferredSkills.setRequested';
          readonly hostId: string;
          readonly folderId: string;
          readonly skillIds: readonly string[];
          readonly exposeOnly: boolean;
      }
    | {
          /**
           * Request the conv-scope override-parent-folder flag for one
           * conversation. WebviewSync answers with
           * `convSkillOverride.updated`.
           */
          readonly type: 'convSkillOverride.requested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Toggle whether the conversation overrides its parent
           * folder's preferred-skill list. WebviewSync calls
           * `skill.set_override_parent_folder` with
           * scope_type=conversation, then re-fetches to confirm.
           */
          readonly type: 'convSkillOverride.setRequested';
          readonly hostId: string;
          readonly conversationId: string;
          readonly override: boolean;
      }
    | {
          /**
           * Request the conv-scope preferred-skill list. WebviewSync
           * answers with `convPreferredSkills.updated`.
           */
          readonly type: 'convPreferredSkills.requested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Replace the conv-scope preferred-skill list. WebviewSync
           * calls `skill.preferred.set` with scope_type=conversation,
           * then re-fetches to confirm.
           */
          readonly type: 'convPreferredSkills.setRequested';
          readonly hostId: string;
          readonly conversationId: string;
          readonly skillIds: readonly string[];
      }
    | {
          /**
           * Request the per-conversation heartbeat-gate state. The
           * host returns { allow, max_per_day }; WebviewSync emits
           * `convHeartbeatGate.updated`.
           */
          readonly type: 'convHeartbeatGate.requested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * Set per-conversation heartbeat-gate. WebviewSync calls
           * the dedicated `conv.heartbeat.gate.set` op then re-fetches
           * to confirm the host-canonical state. Replaces the W14
           * approach of routing these fields through
           * `conv.settings.save` (which silently dropped them).
           */
          readonly type: 'convHeartbeatGate.setRequested';
          readonly hostId: string;
          readonly conversationId: string;
          readonly allow: boolean;
          readonly maxPerDay: number;
      }
    | {
          /** Request the documents list for one folder. */
          readonly type: 'documents.requested';
          readonly hostId: string;
          readonly folderId: string;
      }
    | {
          /** Upload a base64-encoded document to a folder. */
          readonly type: 'document.uploadRequested';
          readonly hostId: string;
          readonly folderId: string;
          readonly fileName: string;
          readonly contentBase64: string;
      }
    | {
          /** Remove a document by name. */
          readonly type: 'document.removeRequested';
          readonly hostId: string;
          readonly folderId: string;
          readonly fileName: string;
      }
    | {
          /**
           * Create a standalone group chat with the given member set.
           * Mirrors Android `MainViewModel.createGroup` (line 1632).
           * WebviewSync calls `group.create` then sets the new conv
           * as active so the user lands on the freshly-created chat.
           */
          readonly type: 'group.createRequested';
          readonly hostId: string;
          readonly title: string;
          readonly members: readonly {
              readonly agentId: string;
              readonly alias: string;
              readonly isCoordinator: boolean;
          }[];
      }
    | { readonly type: 'plans.requested'; readonly hostId: string; readonly conversationId: string }
    | {
          readonly type: 'task.startRequested';
          readonly hostId: string;
          readonly conversationId: string;
          readonly goal: string;
      }
    | { readonly type: 'plan.stopRequested'; readonly hostId: string; readonly planId: string }
    | {
          readonly type: 'plan.stopAllRequested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          readonly type: 'step.retryRequested';
          readonly hostId: string;
          readonly stepId: string;
          readonly notes: string;
      }
    | { readonly type: 'step.overrideRequested'; readonly hostId: string; readonly stepId: string }
    | {
          readonly type: 'step.skipRequested';
          readonly hostId: string;
          readonly stepId: string;
          readonly reason: string;
      }
    | {
          readonly type: 'toolCalls.requested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          readonly type: 'activity.requested';
          readonly hostId: string;
          readonly scopeKind: 'project' | 'conversation' | 'turn';
          readonly scopeId: string;
      }
    | { readonly type: 'polls.requested'; readonly hostId: string; readonly conversationId: string }
    | {
          readonly type: 'poll.startRequested';
          readonly hostId: string;
          readonly conversationId: string;
          readonly question: string;
          readonly options: readonly string[];
          readonly mode: 'single' | 'multi';
          readonly closesInMinutes: number;
      }
    | {
          readonly type: 'poll.voteRequested';
          readonly hostId: string;
          readonly pollId: string;
          readonly optionId: string;
      }
    | { readonly type: 'poll.closeRequested'; readonly hostId: string; readonly pollId: string }
    | {
          readonly type: 'media.requested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          readonly type: 'mcp.serverTools.requested';
          readonly hostId: string;
          readonly serverName: string;
      }
    | {
          readonly type: 'skill.detail.requested';
          readonly hostId: string;
          readonly skillId: string;
      }
    | {
          readonly type: 'heartbeat.runs.requested';
          readonly hostId: string;
          readonly configId: string;
      }
    | {
          /** Request the landing project-template list (built-ins + pinned). */
          readonly type: 'projectTemplates.requested';
          readonly hostId: string;
      }
    | {
          /** Request the FULL project-template catalog for the Library. */
          readonly type: 'projectTemplates.allRequested';
          readonly hostId: string;
      }
    | {
          /** Request the roster (members) for one template. */
          readonly type: 'template.roster.requested';
          readonly hostId: string;
          readonly templateId: string;
      }
    | {
          /**
           * Pin or unpin a template into the user's landing list.
           * WebviewSync calls `project_template.pin_user`, then
           * re-fetches both the landing list AND the full catalog so
           * every cache reflects the new state.
           */
          readonly type: 'template.pinRequested';
          readonly hostId: string;
          readonly templateId: string;
          readonly pinned: boolean;
      }
    | {
          /**
           * Save a template as a new user-template. When
           * `sourceTemplateId` is non-empty the new template inherits
           * the source's fields; otherwise the host seeds defaults.
           * Optional edits override the source. `members` is the
           * user's final roster from the Quick Start sheet (so a
           * "Save as template" from there carries the customised
           * team into the saved template).
           *
           * WebviewSync calls `project_template.save_as_new` then
           * re-fetches catalogs.
           */
          readonly type: 'template.saveAsNewRequested';
          readonly hostId: string;
          readonly sourceTemplateId: string;
          readonly name: string;
          readonly scenario: string;
          readonly goal: string;
          readonly description: string;
          readonly members: readonly {
              readonly agentId: string;
              readonly alias: string;
              readonly isCoordinator: boolean;
              /** Optional per-member overrides, kept in the saved template. */
              readonly modelProvider?: string;
              readonly modelName?: string;
              readonly allowedTools?: readonly string[];
          }[];
      }
    | {
          /**
           * Delete a user-saved template. Built-in templates are
           * immune (the host returns false). WebviewSync re-fetches
           * catalogs to confirm.
           */
          readonly type: 'template.deleteRequested';
          readonly hostId: string;
          readonly templateId: string;
      }
    | {
          /**
           * Spin up a folder from a project template with
           * user-edited customisations from the Quick Start sheet.
           * Empty fields fall back to the template's defaults on the
           * host side. Members is the user's final roster (after
           * add/remove/alias edits + optional per-member provider /
           * model / tool whitelist override).
           *
           * The template create op stores the override triplet
           * together with agentId/alias/isCoordinator.
           */
          readonly type: 'projectTemplate.createProjectRequested';
          readonly hostId: string;
          readonly templateId: string;
          readonly name: string;
          readonly goal: string;
          readonly description: string;
          readonly scenario: string;
          readonly members: readonly {
              readonly agentId: string;
              readonly alias: string;
              readonly isCoordinator: boolean;
              readonly modelProvider: string;
              readonly modelName: string;
              readonly allowedTools: readonly string[];
          }[];
      }
    | {
          /**
           * Update an existing folder's metadata + roster. Mirrors
           * `folder.createRequested` but targets an existing folder
           * id. WebviewSync chains
           *   folder.rename (if name changed)
           *   → folder.update_metadata
           *   → folder.members.set
           * Heartbeats / preferred skills / documents are inline ops
           * — not batched in this envelope.
           */
          readonly type: 'folder.updateRequested';
          readonly hostId: string;
          readonly folderId: string;
          readonly originalName: string;
          readonly name: string;
          readonly folderType: 'regular' | 'project' | 'organization';
          readonly goal: string;
          readonly description: string;
          readonly members: readonly {
              readonly agentId: string;
              readonly alias: string;
              readonly isCoordinator: boolean;
              readonly modelProvider: string;
              readonly modelName: string;
              readonly allowedTools: readonly string[];
              readonly addedByKind?: MemberAddedByKind | undefined;
              readonly addedByAgentId?: string | undefined;
          }[];
      }
    | {
          /**
           * Replace a folder's roster (used by the full-MembershipEditor
           * save flow). Members ship in camelCase here; RemoteRepository
           * converts to the snake_case wire shape. Each member carries
           * optional `modelProvider` / `modelName` / `allowedTools` per
           * Android MemberRowState.
           */
          readonly type: 'folder.members.setRequested';
          readonly hostId: string;
          readonly folderId: string;
          readonly members: readonly {
              readonly agentId: string;
              readonly alias: string;
              readonly isCoordinator: boolean;
              readonly modelProvider: string;
              readonly modelName: string;
              readonly allowedTools: readonly string[];
              readonly addedByKind?: MemberAddedByKind | undefined;
              readonly addedByAgentId?: string | undefined;
          }[];
      }
    | {
          /**
           * Save one existing project member's provider, model and tool
           * allowlist without replacing the roster. WebviewSync calls
           * `folder.member.override.set` and reports an error when the
           * host refuses or matches no member. Empty values clear an
           * override. `alias` is the member's saved alias on the host.
           */
          readonly type: 'folder.member.override.setRequested';
          readonly hostId: string;
          readonly folderId: string;
          readonly alias: string;
          readonly modelProvider: string;
          readonly modelName: string;
          readonly allowedTools: readonly string[];
      }
    | {
          /**
           * Apply an assistant-emitted code suggestion as a workspace
           * edit. Triggered from the webview's MessageBubble when the
           * code block carries a target-path hint in the info string
           * (e.g. ```ts:src/foo.ts). The extension shows a diff
           * preview against the existing file (when present) before
           * applying.
           */
          readonly type: 'ide.applyEditRequested';
          readonly targetPath: string;
          readonly language: string;
          readonly content: string;
      }
    | {
          readonly type: 'ide.openCanvasRequested';
          readonly hostId: string;
          readonly conversationId: string;
      }
    | {
          /**
           * "Add Context" from the composer "+" menu — asks the
           * extension to show a workspace-file quick-pick; picked files
           * are staged back as attachment chips via `ide.stage`.
           */
          readonly type: 'ide.addContextRequested';
      }
    | {
          /**
           * Files dropped onto the composer from the VS Code Explorer or
           * an editor (carried as file URIs). The extension reads each
           * and stages it back as an attachment chip. (OS file-manager
           * drops are read directly in the webview and never reach here.)
           */
          readonly type: 'ide.dropUrisRequested';
          readonly uris: readonly string[];
      };

/**
 * Handshake payload sent from the host the moment the webview
 * reports it is mounted. Carries the data the Preact app needs to
 * pick its initial tab + colour scheme without a round-trip.
 */
export interface HostHandshake {
    /** VS Code extension version (matches `package.json` `version`). */
    readonly extensionVersion: string;
    /** ID of the webview view — `verzeta.sidebarView` or `verzeta.sidebarSecondaryView`. */
    readonly viewId: string;
    /** Initial tab the host wants the webview to display. */
    readonly initialTab: TabId;
}
