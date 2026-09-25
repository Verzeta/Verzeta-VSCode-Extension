// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { activeConversationId } from '../state/conversations.js';
import {
    chatSettingsSheetOpen,
    folderCreateSheetOpen,
    groupCreateSheetOpen,
    modelPickerSheetOpen,
} from '../state/chatUi.js';
import { AgentProgressBanner } from '../components/AgentProgressBanner.js';
import { ChatHeader } from '../components/ChatHeader.js';
import { ChatNavRail } from '../components/ChatNavRail.js';
import { ChatIcon, TabHeader } from '../components/AppShellHeader.js';
import { ChatOverlaysHost, ChatToolsMenu } from '../components/ChatOverlays.js';
import { Composer } from '../components/Composer.js';
import { IdeNoticeToast } from '../components/IdeNoticeToast.js';
import { ConversationSettingsSheet } from '../components/ConversationSettingsSheet.js';
import { FolderCreateSheet } from '../components/FolderCreateSheet.js';
import { MessageTimeline } from '../components/MessageTimeline.js';
import { WorkspaceShareBanner } from '../components/WorkspaceShareBanner.js';
import { ExecConsentBanner } from '../components/ExecConsentBanner.js';
import { ModelPickerSheet } from '../components/ModelPickerSheet.js';
import { NewGroupSheet } from '../components/NewGroupSheet.js';

export function ChatTab() {
    const convId = activeConversationId.value;
    const sheetOpen = chatSettingsSheetOpen.value;
    const folderSheetOpen = folderCreateSheetOpen.value;
    const groupSheetOpen = groupCreateSheetOpen.value;
    const modelPickerOpen = modelPickerSheetOpen.value;
    return (
        <div
            class="verzeta-tab-panel verzeta-chat"
            id="verzeta-panel-chat"
            role="tabpanel"
            aria-labelledby="verzeta-tab-chat"
        >
            {convId === undefined ? (
                <div class="verzeta-chat__railwrap">
                    <TabHeader icon={<ChatIcon />} title="Chat" />
                    <ChatNavRail />
                    {folderSheetOpen ? <FolderCreateSheet /> : null}
                    {groupSheetOpen ? <NewGroupSheet /> : null}
                </div>
            ) : (
                <div class="verzeta-chat__detail">
                    <ChatHeader />
                    <WorkspaceShareBanner />
                    <ExecConsentBanner />
                    <MessageTimeline />
                    <AgentProgressBanner />
                    <IdeNoticeToast />
                    <Composer />
                    {sheetOpen ? <ConversationSettingsSheet /> : null}
                    {modelPickerOpen ? <ModelPickerSheet /> : null}
                    {groupSheetOpen ? <NewGroupSheet /> : null}
                    <ChatToolsMenu />
                    <ChatOverlaysHost />
                </div>
            )}
        </div>
    );
}
