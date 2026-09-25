// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ContextFillStore — per-conversation context-window fill percentage,
 * fed by the host's `chat.context_fill.changed` wire event (measured
 * host-side at each request build). Drives the composer gauge chip.
 *
 * Absent entry = no measurement yet for that conversation this
 * session; the gauge stays hidden rather than showing a fake 0%.
 */

import type { Disposable } from '../infra/disposables.js';
import { TypedEventEmitter } from '../infra/TypedEventEmitter.js';

interface ContextFillStoreEvents extends Record<string, readonly unknown[]> {
    readonly changed: readonly [hostId: string, conversationId: string, percent: number];
}

export class ContextFillStore
    extends TypedEventEmitter<ContextFillStoreEvents>
    implements Disposable
{
    private readonly percents = new Map<string, number>();

    /**
     * Record a fill measurement. Percent is clamped to [0, 100];
     * non-finite input is ignored.
     */
    set(hostId: string, conversationId: string, percent: number): void {
        if (!Number.isFinite(percent)) return;
        const clamped = Math.max(0, Math.min(100, Math.round(percent)));
        this.percents.set(`${hostId}:${conversationId}`, clamped);
        this.emit('changed', hostId, conversationId, clamped);
    }

    /** Last measured fill percent, or undefined if never measured. */
    get(hostId: string, conversationId: string): number | undefined {
        return this.percents.get(`${hostId}:${conversationId}`);
    }

    /** Drop every measurement for a host (on disconnect). */
    clearHost(hostId: string): void {
        for (const key of [...this.percents.keys()]) {
            if (key.startsWith(`${hostId}:`)) this.percents.delete(key);
        }
    }

    dispose(): void {
        this.percents.clear();
        this.removeAllListeners();
    }
}
