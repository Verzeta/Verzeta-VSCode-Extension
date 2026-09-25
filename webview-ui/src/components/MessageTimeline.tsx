// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * MessageTimeline — renders the active conversation's messages as a
 * vertical list. Variable row heights make a virtualized timeline
 * harder (would need a row-height oracle); for chat MVP the list
 * is rendered in full inside a scroll container and Preact + signals
 * mutate only the rows whose data changed — streaming a token
 * touches one text node, not the whole list.
 *
 * The container auto-scrolls to the bottom when new messages arrive
 * UNLESS the user has scrolled up beyond the stick threshold — that
 * read-while-streaming lock matches the Android ChatScreen behaviour.
 */

import { useEffect, useRef } from 'preact/hooks';
import { activeConversationId } from '../state/conversations.js';
import { activeMessages } from '../state/messages.js';
import { MessageBubble } from './MessageBubble.js';

const STICK_THRESHOLD_PX = 96;

export function MessageTimeline() {
    const messages = activeMessages.value;
    const convId = activeConversationId.value;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const stickyRef = useRef<boolean>(true);

    useEffect(() => {
        const el = containerRef.current;
        if (el === null) return;
        const onScroll = (): void => {
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            stickyRef.current = distanceFromBottom < STICK_THRESHOLD_PX;
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (el === null) return;
        if (!stickyRef.current) return;
        el.scrollTop = el.scrollHeight;
    }, [messages.length, convId]);

    if (convId === undefined) {
        return (
            <div class="verzeta-timeline__empty">
                <div class="verzeta-timeline__empty-icon" aria-hidden="true">
                    💬
                </div>
                <div class="verzeta-timeline__empty-title">No conversation open</div>
                <div class="verzeta-timeline__empty-detail">
                    Pick a conversation from the list to start chatting.
                </div>
            </div>
        );
    }
    if (messages.length === 0) {
        return (
            <div class="verzeta-timeline__empty">
                <div class="verzeta-timeline__empty-icon" aria-hidden="true">
                    ✨
                </div>
                <div class="verzeta-timeline__empty-title">Send the first message</div>
                <div class="verzeta-timeline__empty-detail">
                    Type below to start the conversation.
                </div>
            </div>
        );
    }
    return (
        <div ref={containerRef} class="verzeta-timeline" role="log" aria-live="polite">
            {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
            ))}
        </div>
    );
}
