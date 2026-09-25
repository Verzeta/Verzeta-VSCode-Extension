// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * TypedEventEmitter — a strongly-typed wrapper around Node's
 * built-in EventEmitter. Each event name maps to a tuple of its
 * listener arguments, enforced at compile time.
 *
 * Usage:
 *     type ConnEvents = {
 *         opened: [hostId: string];
 *         closed: [hostId: string, reason: string];
 *     };
 *     const bus = new TypedEventEmitter<ConnEvents>();
 *     bus.on('opened', (id) => { ... });
 *     bus.emit('opened', 'host-uuid');  // typechecked
 */

import { EventEmitter } from 'node:events';

/**
 * EventMap is a record of event name -> listener argument tuple.
 * Constraining to `unknown[]` keeps it strictly typed yet flexible.
 */
export type EventMap = Record<string, readonly unknown[]>;

export class TypedEventEmitter<E extends EventMap> {
    private readonly emitter = new EventEmitter();

    on<K extends keyof E & string>(event: K, listener: (...args: E[K]) => void): this {
        this.emitter.on(event, listener as unknown as (...args: unknown[]) => void);
        return this;
    }

    off<K extends keyof E & string>(event: K, listener: (...args: E[K]) => void): this {
        this.emitter.off(event, listener as unknown as (...args: unknown[]) => void);
        return this;
    }

    once<K extends keyof E & string>(event: K, listener: (...args: E[K]) => void): this {
        this.emitter.once(event, listener as unknown as (...args: unknown[]) => void);
        return this;
    }

    emit<K extends keyof E & string>(event: K, ...args: E[K]): boolean {
        return this.emitter.emit(event, ...args);
    }

    removeAllListeners<K extends keyof E & string>(event?: K): this {
        if (event === undefined) {
            this.emitter.removeAllListeners();
        } else {
            this.emitter.removeAllListeners(event);
        }
        return this;
    }

    listenerCount<K extends keyof E & string>(event: K): number {
        return this.emitter.listenerCount(event);
    }
}
