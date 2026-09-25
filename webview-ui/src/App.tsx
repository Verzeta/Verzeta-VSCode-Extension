// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { PendingToolConfirmationModal } from './components/PendingToolConfirmationModal.js';
import { AboutSheet } from './components/AboutSheet.js';
import { DeleteConfirmModal } from './components/DeleteConfirmModal.js';
import { FolderActivityModal } from './components/FolderActivityModal.js';
import { HelpSheet } from './components/HelpSheet.js';
import { KickoffSheet } from './components/KickoffSheet.js';
import { PairedDevicesScreen } from './components/PairedDevicesScreen.js';
import { ProjectRoomsLanding } from './components/ProjectRoomsLanding.js';
import { ProjectTemplateDetailSheet } from './components/ProjectTemplateDetailSheet.js';
import { QuickStartProjectSheet } from './components/QuickStartProjectSheet.js';
import { closeQuickStart, reportQuickStartCreateFailure } from './state/projectQuickStart.js';
import { RevokedDevicesScreen } from './components/RevokedDevicesScreen.js';
import { TemplateLibrarySheet } from './components/TemplateLibrarySheet.js';
import { setExtensionVersion } from './state/aboutHelp.js';
import { projectRoomsLandingOpen } from './state/projectRoomsUi.js';
import { AppShellHeader } from './components/AppShellHeader.js';
import { TabBar } from './components/TabBar.js';
import { onMessage, send } from './lib/bus.js';
import { ChatTab } from './tabs/ChatTab.js';
import { HomeTab } from './tabs/HomeTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';
import {
    setHostIdentity,
    setHostPingResult,
    setHostState,
    setHostsSnapshot,
} from './state/hosts.js';
import { setAgentsFor } from './state/agents.js';
import {
    setClientsFor,
    setMcpFor,
    setSkillsFor,
    setToolsFor,
    setVerifyResult,
} from './state/catalogs.js';
import { setConvSettings } from './state/convSettings.js';
import {
    setFolderMembers,
    setFullConversations,
    setRecentConversations,
} from './state/conversations.js';
import {
    applyDelta,
    clearAllThinkingPlaceholders,
    clearThinkingPlaceholders,
    setMessages,
} from './state/messages.js';
import { composerSending, setSending } from './state/composer.js';
import { setActiveModelFor, setModelCatalogFor } from './state/models.js';
import { setSearchProvidersFor } from './state/searchProviders.js';
import { setActiveConversationId } from './state/conversations.js';
import { setContextFill } from './state/contextFill.js';
import { setShareStatus } from './state/shareStatus.js';
import { setConvExecMode } from './state/convExecMode.js';
import { setExecConsent, clearExecConsent } from './state/execConsent.js';
import { setPendingExecConfirm } from './state/execConfirm.js';
import { ExecConfirmModal } from './components/ExecConfirmModal.js';
import { setAgentRunState, upsertAgentStep } from './state/agentRun.js';
import { clearPendingToolCall, setPendingToolCall } from './state/toolCalls.js';
import { setHeartbeats } from './state/heartbeats.js';
import { setPreferredSkills } from './state/preferredSkills.js';
import {
    setConvHeartbeatGate,
    setConvPreferredSkills,
    setConvSkillOverride,
} from './state/convSkills.js';
import { addPendingAttachment, composerDraft, setComposerDraft } from './state/composer.js';
import { setIdeNotice } from './state/ide.js';
import { setDocuments } from './state/documents.js';
import {
    setProjectTemplates,
    setProjectTemplatesAll,
    setTemplateRoster,
} from './state/projectTemplates.js';
import { setPendingKickoff } from './state/pendingKickoff.js';
import { setActivity, setMedia, setPlans, setPolls, setToolCalls } from './state/chatOverlays.js';
import { setHeartbeatRuns, setMcpServerTools, setSkillDetail } from './state/detailCaches.js';
import { currentTab, setTab } from './state/tabs.js';

const lastError = signal<string | null>(null);

export function App() {
    useEffect(() => {
        const unsubscribe = onMessage((msg) => {
            switch (msg.type) {
                case 'ready':
                    setTab(msg.host.initialTab);
                    setExtensionVersion(msg.host.extensionVersion);
                    break;
                case 'pong':
                    // Foundation-only ping/pong; no UI surface yet.
                    break;
                case 'error':
                    lastError.value = msg.message;
                    // A failed send (e.g. payload too large) leaves the
                    // composer stuck "sending" with a synthetic
                    // typing-dots row that nothing else will clear — the
                    // message never reached the host, so no snapshot or
                    // delta follows. Re-arm the composer and drop the dots
                    // whenever a send was in flight.
                    if (composerSending.value) {
                        setSending(false);
                        clearAllThinkingPlaceholders();
                    }
                    break;
                case 'hosts.updated':
                    setHostsSnapshot({
                        hosts: msg.hosts,
                        activeHostId: msg.activeHostId,
                        defaultHostId: msg.defaultHostId,
                        states: msg.states,
                    });
                    break;
                case 'host.stateChanged':
                    setHostState(msg.hostId, msg.state);
                    break;
                case 'conversations.recent.updated':
                    setRecentConversations(msg.hostId, msg.conversations);
                    break;
                case 'conversations.full.updated':
                    setFullConversations(msg.hostId, msg.conversations, msg.folders);
                    break;
                case 'messages.updated':
                    setMessages(msg.conversationId, msg.messages);
                    // A snapshot arrival also ends any in-flight send
                    // — the assistant turn either finalised normally
                    // or was aborted. The composer can re-arm.
                    if (composerSending.value) setSending(false);
                    // If a fresh streaming placeholder appeared (empty
                    // content + non-thinking id), drop the local
                    // typing-dots row to avoid the brief two-bubble
                    // flicker between streaming.started and the first
                    // delta.
                    if (
                        msg.messages.some(
                            (m) =>
                                m.role === 'assistant' &&
                                m.content.length === 0 &&
                                !m.id.startsWith('thinking:'),
                        )
                    ) {
                        clearThinkingPlaceholders(msg.conversationId);
                    }
                    break;
                case 'message.delta':
                    applyDelta(
                        msg.conversationId,
                        msg.messageId,
                        msg.contentDelta,
                        msg.thinkingDelta,
                    );
                    // Real assistant content is arriving — drop the
                    // synthetic typing-dots placeholder the composer
                    // inserted at send time.
                    clearThinkingPlaceholders(msg.conversationId);
                    break;
                case 'host.pingResult':
                    setHostPingResult(msg.hostId, msg.ok, msg.latencyMs, msg.error);
                    break;
                case 'host.identity':
                    setHostIdentity(msg.hostId, msg.clientId, msg.clientName);
                    break;
                case 'conv.settings.updated':
                    setConvSettings(msg.conversationId, msg.settings);
                    break;
                case 'agents.updated':
                    setAgentsFor(msg.hostId, msg.agents);
                    break;
                case 'clients.updated':
                    setClientsFor(msg.hostId, msg.clients);
                    break;
                case 'tools.updated':
                    setToolsFor(msg.hostId, msg.tools);
                    break;
                case 'mcp.updated':
                    setMcpFor(msg.hostId, msg.servers);
                    break;
                case 'skills.updated':
                    setSkillsFor(msg.hostId, msg.skills);
                    break;
                case 'verifySession.result':
                    setVerifyResult(
                        msg.hostId,
                        msg.ok,
                        msg.latencyMs,
                        msg.clientId,
                        msg.clientName,
                        msg.error,
                    );
                    break;
                case 'folder.members.updated':
                    setFolderMembers(msg.hostId, msg.folderId, msg.members);
                    break;
                case 'models.catalog.updated':
                    setModelCatalogFor(msg.hostId, msg.catalog);
                    break;
                case 'models.active.changed':
                    setActiveModelFor(msg.hostId, msg.activeProvider, msg.activeModel);
                    break;
                case 'search.providers.updated':
                    setSearchProvidersFor(msg.hostId, msg.catalog);
                    break;
                case 'conversation.created':
                    // The host accepted a New Chat request and minted a
                    // conv_id. Switch the webview's active conv to it +
                    // flip to the Chat tab so the freshly-created conv
                    // opens without an extra click.
                    setActiveConversationId(msg.conversationId);
                    setTab('chat');
                    break;
                case 'conversation.focusRequested':
                    // Extension-side ask (e.g. Open on an @mention
                    // notification) — same switch as conversation.created.
                    setActiveConversationId(msg.conversationId);
                    setTab('chat');
                    break;
                case 'chat.contextFill.updated':
                    setContextFill(msg.conversationId, msg.percent);
                    break;
                case 'workspace.shareStatus.updated':
                    setShareStatus(msg.conversationId, msg.status, msg.workspaceName);
                    break;
                case 'convExecMode.updated':
                    setConvExecMode(msg.conversationId, msg.mode);
                    // Enabling (from the settings sheet or the banner)
                    // retires any pending consent banner.
                    if (msg.mode !== 'off') clearExecConsent(msg.conversationId);
                    break;
                case 'exec.consentSuggested':
                    setExecConsent(msg.conversationId, msg.commandPreview);
                    break;
                case 'exec.confirmRequested':
                    setPendingExecConfirm({
                        hostId: msg.hostId,
                        conversationId: msg.conversationId,
                        requestId: msg.requestId,
                        command: msg.command,
                        sandboxed: msg.sandboxed,
                    });
                    break;
                case 'tool_call.confirmation.requested':
                    setPendingToolCall(msg.hostId, msg.pending);
                    break;
                case 'tool_call.confirmation.dismissed':
                    clearPendingToolCall(msg.callId);
                    break;
                case 'agent.step.update':
                    upsertAgentStep(msg.step);
                    break;
                case 'agent.run.state.update':
                    setAgentRunState(msg.runState);
                    break;
                case 'heartbeats.updated':
                    setHeartbeats(msg.hostId, msg.folderId, msg.configs);
                    break;
                case 'preferredSkills.updated':
                    setPreferredSkills(msg.hostId, msg.folderId, {
                        skillIds: msg.skillIds,
                        exposeOnly: msg.exposeOnly,
                    });
                    break;
                case 'convSkillOverride.updated':
                    setConvSkillOverride(msg.hostId, msg.conversationId, msg.override);
                    break;
                case 'convPreferredSkills.updated':
                    setConvPreferredSkills(msg.hostId, msg.conversationId, msg.skillIds);
                    break;
                case 'convHeartbeatGate.updated':
                    setConvHeartbeatGate(msg.hostId, msg.conversationId, {
                        allow: msg.allow,
                        maxPerDay: msg.maxPerDay,
                    });
                    break;
                case 'documents.updated':
                    setDocuments(msg.hostId, msg.folderId, msg.documents);
                    break;
                case 'projectTemplates.updated':
                    setProjectTemplates(msg.hostId, msg.templates);
                    break;
                case 'projectTemplates.allUpdated':
                    setProjectTemplatesAll(msg.hostId, msg.templates);
                    break;
                case 'template.roster.updated':
                    setTemplateRoster(msg.hostId, msg.templateId, msg.members);
                    break;
                case 'plans.updated':
                    setPlans(msg.hostId, msg.conversationId, msg.plans);
                    break;
                case 'toolCalls.updated':
                    setToolCalls(msg.hostId, msg.conversationId, msg.toolCalls);
                    break;
                case 'activity.updated':
                    setActivity(msg.hostId, msg.scopeKind, msg.scopeId, msg.events);
                    break;
                case 'polls.updated':
                    setPolls(msg.hostId, msg.conversationId, msg.polls);
                    break;
                case 'media.updated':
                    setMedia(msg.hostId, msg.conversationId, {
                        images: msg.images,
                        audio: msg.audio,
                        artifacts: msg.artifacts,
                    });
                    break;
                case 'mcp.serverTools.updated':
                    setMcpServerTools(msg.hostId, msg.serverName, msg.tools);
                    break;
                case 'skill.detail.updated':
                    setSkillDetail(msg.hostId, msg.skill);
                    break;
                case 'heartbeat.runs.updated':
                    setHeartbeatRuns(msg.hostId, msg.configId, msg.runs);
                    break;
                case 'folder.created':
                    // Mirrors Android: close the create dialog, land
                    // the user on the Chat tab where the new folder
                    // is visible in the rail. If members were added,
                    // hand off to the KickoffSheet so the user can
                    // spin up 1:1 and/or group chats — same flow
                    // Android shows. We do NOT auto-open the folder
                    // in edit mode (user explicitly rejected that
                    // behaviour); the ⚙ Edit button on the rail row
                    // is the way back in.
                    setTab('chat');
                    if (msg.memberCount > 0) {
                        setPendingKickoff({
                            hostId: msg.hostId,
                            folderId: msg.folderId,
                            folderName: msg.folderName,
                            memberCount: msg.memberCount,
                        });
                    }
                    break;
                case 'projectTemplate.createFailed':
                    reportQuickStartCreateFailure(msg.templateId, msg.message);
                    break;
                case 'projectTemplate.projectCreated':
                    // Quick Start flow finished. Close the form and
                    // open the KickoffSheet ("Start chatting with
                    // your team?") so the user can pick 1:1 chats
                    // and/or a group chat — feature parity with
                    // Android's `consumeProjectTemplateCreated` ->
                    // PendingKickoff path. The KickoffSheet itself
                    // closes the Project Rooms landing when the user
                    // makes a pick or dismisses.
                    closeQuickStart();
                    setPendingKickoff({
                        hostId: msg.hostId,
                        folderId: msg.folderId,
                        folderName: msg.folderName,
                        memberCount: msg.memberCount,
                    });
                    setTab('chat');
                    break;
                case 'ide.stage': {
                    // Editor-bridged staging: append composer text
                    // (selection-as-markdown), stage an attachment
                    // (file), and optionally switch to the Chat tab
                    // so the user lands where the action takes
                    // effect.
                    if (msg.composerText.length > 0) {
                        const current = composerDraft.value;
                        const sep = current.length > 0 && !current.endsWith('\n') ? '\n\n' : '';
                        setComposerDraft(current + sep + msg.composerText);
                    }
                    if (msg.attachment !== null) {
                        const err = addPendingAttachment(msg.attachment);
                        if (err !== null) setIdeNotice({ level: 'error', message: err });
                    }
                    if (msg.focusChat) setTab('chat');
                    break;
                }
                case 'ide.notice':
                    setIdeNotice({ level: msg.level, message: msg.message });
                    break;
            }
        });
        send({ type: 'hello' });
        return unsubscribe;
    }, []);

    return (
        <>
            <AppShellHeader />
            <TabBar />
            <ActiveTabPanel />
            {projectRoomsLandingOpen.value ? <ProjectRoomsLanding /> : null}
            <TemplateLibrarySheet />
            <ProjectTemplateDetailSheet />
            <QuickStartProjectSheet />
            <RevokedDevicesScreen />
            <PairedDevicesScreen />
            <AboutSheet />
            <HelpSheet />
            <PendingToolConfirmationModal />
            <ExecConfirmModal />
            <DeleteConfirmModal />
            <FolderActivityModal />
            <KickoffSheet />
            <ErrorBanner />
        </>
    );
}

function ActiveTabPanel() {
    switch (currentTab.value) {
        case 'home':
            return <HomeTab />;
        case 'chat':
            return <ChatTab />;
        case 'settings':
            return <SettingsTab />;
        default:
            // Exhaustive — TS will error here if a new TabId is added without a case.
            return null;
    }
}

function ErrorBanner() {
    const message = lastError.value;
    if (message === null) return null;
    return (
        <div class="verzeta-error-banner" role="alert">
            {message}
            <button
                type="button"
                class="verzeta-error-banner__dismiss"
                onClick={() => {
                    lastError.value = null;
                }}
                aria-label="Dismiss error"
            >
                ×
            </button>
        </div>
    );
}
