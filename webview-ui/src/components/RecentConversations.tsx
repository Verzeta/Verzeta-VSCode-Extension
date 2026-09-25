// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * RecentConversations — list of the most-recently-updated
 * conversations on the active host. Clicking one fires a
 * `conversation.openRequested` envelope to the extension and
 * switches the active tab to Chat.
 *
 * Empty state copy reflects whether the user has paired a host or
 * not, so the surface is never just blank.
 */

import { send } from '../lib/bus.js';
import { activeHostId, hostsList } from '../state/hosts.js';
import { recentConversationsFor, setActiveConversationId } from '../state/conversations.js';
import { setTab } from '../state/tabs.js';
import type { RecentConversationUi } from '../../../src/shared/webview-protocol.js';

export function RecentConversations() {
    const hosts = hostsList.value;
    const active = activeHostId.value;
    if (hosts.length === 0) {
        return (
            <section class="verzeta-recent">
                <h2 class="verzeta-recent__heading">Recent conversations</h2>
                <p class="verzeta-recent__empty">
                    Pair a Verzeta Studio host to see your conversations here.
                </p>
            </section>
        );
    }
    if (active === undefined) {
        return (
            <section class="verzeta-recent">
                <h2 class="verzeta-recent__heading">Recent conversations</h2>
                <p class="verzeta-recent__empty">Pick a host above to load its conversations.</p>
            </section>
        );
    }
    const items = recentConversationsFor(active);
    const activeHost = hosts.find((h) => h.id === active);
    const hostLabel = activeHost?.name.toUpperCase() ?? '';
    if (items.length === 0) {
        return (
            <section class="verzeta-recent">
                <h2 class="verzeta-recent__heading">
                    <span>Recent</span>
                    {hostLabel.length > 0 ? (
                        <span class="verzeta-recent__heading-host">{hostLabel}</span>
                    ) : null}
                </h2>
                <p class="verzeta-recent__empty">
                    No conversations on this host yet. New ones appear here once the extension
                    connects.
                </p>
            </section>
        );
    }
    return (
        <section class="verzeta-recent">
            <h2 class="verzeta-recent__heading">
                <span>Recent</span>
                {hostLabel.length > 0 ? (
                    <span class="verzeta-recent__heading-host">{hostLabel}</span>
                ) : null}
            </h2>
            <ul class="verzeta-recent__list" role="list">
                {items.map((conv) => (
                    <RecentRow key={conv.id} conv={conv} />
                ))}
            </ul>
        </section>
    );
}

function RecentRow({ conv }: { readonly conv: RecentConversationUi }) {
    const onActivate = (): void => {
        setActiveConversationId(conv.id);
        send({
            type: 'conversation.openRequested',
            hostId: conv.hostId,
            conversationId: conv.id,
        });
        setTab('chat');
    };
    return (
        <li class="verzeta-recent__item">
            <button type="button" class="verzeta-recent__button" onClick={onActivate}>
                <span class="verzeta-recent__icon" aria-hidden="true">
                    {conv.isGroup ? <GroupIcon /> : <ChatBubbleIcon />}
                </span>
                <span class="verzeta-recent__body">
                    <span class="verzeta-recent__title">
                        {conv.isPinned ? <span aria-hidden="true">★ </span> : null}
                        {conv.title.length > 0 ? conv.title : 'Untitled'}
                    </span>
                    {conv.preview.length > 0 ? (
                        <span class="verzeta-recent__preview">{conv.preview}</span>
                    ) : null}
                    <span class="verzeta-recent__meta">
                        {conv.isGroup ? 'Group' : 'Chat'}
                        {conv.updatedAt > 0 ? ` · ${formatRelativeTime(conv.updatedAt)}` : ''}
                    </span>
                </span>
            </button>
        </li>
    );
}

function ChatBubbleIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M21 12c0 4.4-4 8-9 8a10 10 0 0 1-3.6-.7L4 21l1.5-3.8A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
            />
        </svg>
    );
}

function GroupIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.6" />
            <circle cx="17" cy="11" r="2.5" stroke="currentColor" stroke-width="1.4" />
            <path
                d="M3 20c0-3 2.7-5 6-5s6 2 6 5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
            />
            <path
                d="M15 19c0-2 2.2-4 4-4s2 1 2 1"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
            />
        </svg>
    );
}

/**
 * Lightweight relative-time formatter — avoids pulling a date
 * library. Buckets: <1 min, minutes, hours, days, then absolute
 * short date.
 */
function formatRelativeTime(updatedAtMs: number): string {
    const deltaSeconds = Math.max(0, Math.round((Date.now() - updatedAtMs) / 1000));
    if (deltaSeconds < 60) return 'just now';
    if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
    if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
    if (deltaSeconds < 604800) return `${Math.floor(deltaSeconds / 86400)}d ago`;
    const date = new Date(updatedAtMs);
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}
