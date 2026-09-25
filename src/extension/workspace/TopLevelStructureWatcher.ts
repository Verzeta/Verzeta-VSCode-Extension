// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { asDisposable, type Disposable } from '../infra/disposables.js';
import type { Logger } from '../log/Logger.js';

export const DEFAULT_COALESCE_WINDOW_MS = 30_000;

/**
 * Substrate that schedules a callback to fire after `delayMs`.
 * Returns a cancel handle. Production wires this to
 * `setTimeout` / `clearTimeout`; tests pass a controlled clock so
 * the coalesce window can be advanced deterministically.
 */
export interface TimerHost {
    schedule(delayMs: number, callback: () => void): TimerHandle;
}

export interface TimerHandle {
    cancel(): void;
}

/**
 * Production TimerHost wired to Node's setTimeout. The handle's
 * cancel calls clearTimeout. Reusable across watcher instances.
 */
export const SET_TIMEOUT_TIMER_HOST: TimerHost = {
    schedule(delayMs, callback) {
        const handle = setTimeout(callback, delayMs);
        return {
            cancel: () => {
                clearTimeout(handle);
            },
        };
    },
};

export interface TopLevelStructureWatcherOptions {
    readonly logger: Logger;
    /** Defaults to `SET_TIMEOUT_TIMER_HOST`. Tests inject a controllable clock. */
    readonly timer?: TimerHost | undefined;
    /** Coalesce window in ms. Defaults to {@link DEFAULT_COALESCE_WINDOW_MS}. */
    readonly windowMs?: number | undefined;
    /** Fired at most once per coalesce window when at least one notify() landed. */
    readonly onCoalescedChange: () => void | Promise<void>;
}

/**
 * Per-instance coalescing state machine. NOT thread-safe (Node is
 * single-threaded; instance-per-mount in production).
 *
 * State diagram:
 *
 *   idle          --notify()--> pending
 *   pending       --notify()--> pending  (window unchanged)
 *   pending       --window expires--> idle  (callback invoked,
 *                                            new notify() opens a
 *                                            fresh window even if
 *                                            the async tail is
 *                                            still resolving)
 *
 * `disposed` is a terminal state — any subsequent notify() is a
 * no-op so a late-arriving event after the caller's dispose()
 * cannot resurrect the watcher.
 *
 * State returns to idle synchronously after the callback is
 * invoked. An async callback whose Promise has not yet resolved
 * does NOT block a fresh window — but a new window will still
 * wait the full coalesce duration before firing, so the
 * "1 frame per windowMs" ceiling is preserved.
 */
type State = 'idle' | 'pending' | 'disposed';

export class TopLevelStructureWatcher implements Disposable {
    private readonly logger: Logger;
    private readonly timer: TimerHost;
    private readonly windowMs: number;
    private readonly callback: () => void | Promise<void>;
    private state: State = 'idle';
    private pendingHandle: TimerHandle | undefined;
    private notifyCount = 0;

    constructor(options: TopLevelStructureWatcherOptions) {
        this.logger = options.logger;
        this.timer = options.timer ?? SET_TIMEOUT_TIMER_HOST;
        this.windowMs = options.windowMs ?? DEFAULT_COALESCE_WINDOW_MS;
        this.callback = options.onCoalescedChange;
    }

    /**
     * Signals that a depth-1 structural change was observed. The
     * caller is the substrate (the production file-system watcher
     * adapter, or a test stub). Multiple notify() calls inside the
     * coalesce window collapse into a single callback fire.
     *
     * `kind` is purely informational — recorded as a debug log
     * line so a user investigating "the watcher fired too often"
     * can correlate timing with their workspace activity. The
     * coalesced callback receives no payload; it just means
     * "something changed at depth 1, re-walk to find out what".
     */
    notify(kind: 'created' | 'deleted'): void {
        if (this.state === 'disposed') return;
        this.notifyCount += 1;
        this.logger.debug('top-level watcher: notify', {
            kind,
            notifyCount: this.notifyCount,
            state: this.state,
        });
        if (this.state === 'pending') {
            // Already inside the coalesce window — the existing
            // timer will fire one callback when it expires. The
            // window's purpose is to bound the wire-frame rate at
            // 1 frame per windowMs regardless of how many raw
            // events land.
            return;
        }
        this.state = 'pending';
        this.pendingHandle = this.timer.schedule(this.windowMs, () => {
            this.pendingHandle = undefined;
            this.fire();
        });
    }

    /**
     * True iff a coalesce window is currently open. Useful for
     * tests + diagnostics.
     */
    isPending(): boolean {
        return this.state === 'pending';
    }

    /**
     * Cumulative notify() calls since construction. Lets tests
     * assert "1000 raw events produced exactly one callback".
     */
    getNotifyCount(): number {
        return this.notifyCount;
    }

    dispose(): void {
        if (this.state === 'disposed') return;
        if (this.pendingHandle !== undefined) {
            this.pendingHandle.cancel();
            this.pendingHandle = undefined;
        }
        this.state = 'disposed';
    }

    private fire(): void {
        if (this.state === 'disposed') return;
        // Return to idle SYNCHRONOUSLY before invoking the
        // callback. A new notify() that lands while the callback
        // is running (sync or via a still-pending Promise tail)
        // is then free to open a fresh window — but that window
        // still waits the full coalesce duration before firing,
        // so the "1 frame per windowMs" ceiling is preserved.
        this.state = 'idle';
        let outcome: void | Promise<void>;
        try {
            outcome = this.callback();
        } catch (error) {
            this.logger.warn('top-level watcher: callback threw', {
                error: errorMessage(error),
            });
            return;
        }
        if (outcome instanceof Promise) {
            outcome.catch((error: unknown) => {
                this.logger.warn('top-level watcher: callback rejected', {
                    error: errorMessage(error),
                });
            });
        }
    }
}

/**
 * Builds a {@link Disposable} composite of the watcher itself plus
 * the upstream subscriptions the caller provided. Convenience for
 * the production wiring path where the file-system watcher's own
 * disposables need to be torn down in lockstep with the coalescer.
 */
export function combineWatcherDisposables(
    watcher: TopLevelStructureWatcher,
    ...upstream: readonly Disposable[]
): Disposable {
    return asDisposable(() => {
        watcher.dispose();
        for (const d of upstream) {
            try {
                d.dispose();
            } catch {
                // Ignore — best-effort teardown.
            }
        }
    });
}

function errorMessage(value: unknown): string {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    return 'unknown error';
}
