// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import {
    activeConversationId,
    fullConversationsFor,
    setActiveConversationId,
} from '../state/conversations.js';
import { activeHostId, stateOf as connectionStateOf } from '../state/hosts.js';
import { activeMessages } from '../state/messages.js';
import { openChatSettingsSheet, openModelPickerSheet } from '../state/chatUi.js';
import { openChatOverlay } from '../state/chatOverlays.js';
import { modelCatalogFor } from '../state/models.js';
import { VerzetaMark } from './VerzetaMark.js';
import type { HostConnectionState } from '../../../src/shared/webview-protocol.js';

const STATE_TOOLTIP: Record<HostConnectionState['state'], string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting…',
    authenticating: 'Authenticating…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    unauthorized: 'Unauthorized',
    error: 'Connection error',
};

export function ChatHeader() {
    const hostId = activeHostId.value;
    const convId = activeConversationId.value;
    const conv =
        hostId !== undefined && convId !== undefined
            ? fullConversationsFor(hostId).find((c) => c.id === convId)
            : undefined;
    const title = conv === undefined || conv.title.length === 0 ? 'Untitled' : conv.title;
    const subtitle = modelSubtitle(hostId);
    const state = hostId !== undefined ? connectionStateOf(hostId) : 'disconnected';

    const onBack = (): void => {
        setActiveConversationId(undefined);
    };

    return (
        <div class="verzeta-chathdr" role="banner">
            <button
                type="button"
                class="verzeta-chathdr__back"
                onClick={onBack}
                aria-label="Back to conversations"
                title="Back to conversations"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                        d="M15 18l-6-6 6-6"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </button>
            <span class="verzeta-chathdr__brand" aria-hidden="true">
                <VerzetaMark size={20} />
            </span>
            <div class="verzeta-chathdr__titlewrap">
                <div class="verzeta-chathdr__title" title={title}>
                    {title}
                </div>
                <button
                    type="button"
                    class="verzeta-chathdr__modelbtn"
                    onClick={openModelPickerSheet}
                    title={
                        subtitle.length > 0
                            ? `${subtitle} (click to change model)`
                            : 'Click to pick a model'
                    }
                    aria-label="Pick a model"
                    disabled={hostId === undefined}
                >
                    <span class="verzeta-chathdr__modeltext">
                        {subtitle.length > 0 ? subtitle : 'Pick a model'}
                    </span>
                    <span class="verzeta-chathdr__modelchevron" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path
                                d="M6 9l6 6 6-6"
                                stroke="currentColor"
                                stroke-width="2.2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </span>
                </button>
            </div>
            <div class="verzeta-chathdr__actions">
                <span
                    class={`verzeta-chathdr__dot verzeta-chathdr__dot--${state}`}
                    title={STATE_TOOLTIP[state]}
                    aria-label={STATE_TOOLTIP[state]}
                    role="status"
                />
                <button
                    type="button"
                    class="verzeta-chathdr__iconbtn"
                    onClick={() => openChatOverlay('menu')}
                    title="Plans · tool calls · activity · polls · media"
                    aria-label="Open more tools"
                    disabled={convId === undefined}
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <circle cx="5" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="19" cy="12" r="1.6" />
                    </svg>
                </button>
                <button
                    type="button"
                    class="verzeta-chathdr__iconbtn"
                    onClick={openChatSettingsSheet}
                    title="Conversation settings"
                    aria-label="Conversation settings"
                    disabled={convId === undefined}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" />
                        <path
                            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9 1.7 1.7 0 0 0 4.3 7.2L4.2 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1c0 .7.4 1.3 1 1.5a1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8c.2.6.8 1 1.5 1.1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
                            stroke="currentColor"
                            stroke-width="1.4"
                            stroke-linejoin="round"
                        />
                    </svg>
                </button>
            </div>
        </div>
    );
}

/**
 * Subtitle string under the chat title: 'provider · model' when the
 * host's catalog has the active provider+model set; falls back to
 * the last-streamed `modelUsed` so a freshly-loaded conversation
 * still shows something useful before the catalog primes.
 */
function modelSubtitle(hostId: string | undefined): string {
    if (hostId === undefined) return '';
    const catalog = modelCatalogFor(hostId);
    if (catalog !== undefined) {
        const provider = catalog.activeProvider;
        const model = catalog.activeModel;
        if (provider.length > 0 && model.length > 0) return `${provider} · ${model}`;
        if (model.length > 0) return model;
        if (provider.length > 0) return provider;
    }
    return lastModelUsed();
}

function lastModelUsed(): string {
    const msgs = activeMessages.value;
    for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        if (msg !== undefined && msg.modelUsed.length > 0) return msg.modelUsed;
    }
    return '';
}
