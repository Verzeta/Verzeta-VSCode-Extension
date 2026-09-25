// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import type { Disposable } from '../infra/disposables.js';
import { TypedEventEmitter } from '../infra/TypedEventEmitter.js';
import type { Logger } from '../log/Logger.js';
import type { ConversationUi } from '../../shared/wire-types.js';

interface ConversationStoreEvents extends Record<string, readonly unknown[]> {
    readonly changed: readonly [hostId: string];
    readonly activeChanged: readonly [conversationId: string | undefined];
}

export class ConversationStore
    extends TypedEventEmitter<ConversationStoreEvents>
    implements Disposable
{
    private readonly logger: Logger;
    private readonly perHost = new Map<string, ConversationUi[]>();
    private active: string | undefined;

    constructor(logger: Logger) {
        super();
        this.logger = logger;
    }

    byHost(hostId: string): readonly ConversationUi[] {
        return this.perHost.get(hostId) ?? [];
    }

    findById(hostId: string, convId: string): ConversationUi | undefined {
        return this.byHost(hostId).find((c) => c.id === convId);
    }

    replace(hostId: string, conversations: readonly ConversationUi[]): void {
        this.perHost.set(hostId, [...conversations]);
        this.logger.debug('conversations replaced', {
            hostId,
            count: conversations.length,
        });
        this.emit('changed', hostId);
    }

    upsertOne(hostId: string, conv: ConversationUi): void {
        const current = this.perHost.get(hostId) ?? [];
        const idx = current.findIndex((c) => c.id === conv.id);
        if (idx === -1) {
            current.push(conv);
        } else {
            current[idx] = conv;
        }
        this.perHost.set(hostId, current);
        this.emit('changed', hostId);
    }

    removeOne(hostId: string, convId: string): void {
        const current = this.perHost.get(hostId) ?? [];
        const filtered = current.filter((c) => c.id !== convId);
        if (filtered.length === current.length) return;
        this.perHost.set(hostId, filtered);
        if (this.active === convId) {
            this.active = undefined;
            this.emit('activeChanged', undefined);
        }
        this.emit('changed', hostId);
    }

    clearHost(hostId: string): void {
        if (!this.perHost.has(hostId)) return;
        this.perHost.delete(hostId);
        this.emit('changed', hostId);
    }

    activeConversationId(): string | undefined {
        return this.active;
    }

    setActiveConversationId(convId: string | undefined): void {
        if (this.active === convId) return;
        this.active = convId;
        this.emit('activeChanged', convId);
    }

    dispose(): void {
        this.perHost.clear();
        this.active = undefined;
        this.removeAllListeners();
    }
}
