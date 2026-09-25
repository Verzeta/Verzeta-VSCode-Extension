// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    DEFAULT_COALESCE_WINDOW_MS,
    TopLevelStructureWatcher,
    type TimerHandle,
    type TimerHost,
} from '../../../src/extension/workspace/TopLevelStructureWatcher.js';

class ManualTimer implements TimerHost {
    private nextId = 0;
    private readonly scheduled = new Map<
        number,
        { delayMs: number; callback: () => void; cancelled: boolean }
    >();
    private elapsedMs = 0;

    schedule(delayMs: number, callback: () => void): TimerHandle {
        const id = this.nextId++;
        this.scheduled.set(id, { delayMs, callback, cancelled: false });
        return {
            cancel: () => {
                const entry = this.scheduled.get(id);
                if (entry !== undefined) entry.cancelled = true;
            },
        };
    }

    advance(deltaMs: number): void {
        this.elapsedMs += deltaMs;
        const dueIds: number[] = [];
        for (const [id, entry] of this.scheduled) {
            if (entry.cancelled) continue;
            if (entry.delayMs <= deltaMs) {
                dueIds.push(id);
            } else {
                entry.delayMs -= deltaMs;
            }
        }
        for (const id of dueIds) {
            const entry = this.scheduled.get(id);
            if (entry === undefined || entry.cancelled) continue;
            this.scheduled.delete(id);
            entry.callback();
        }
    }

    pendingCount(): number {
        let n = 0;
        for (const entry of this.scheduled.values()) {
            if (!entry.cancelled) n += 1;
        }
        return n;
    }

    totalElapsedMs(): number {
        return this.elapsedMs;
    }
}

function silentLogger(): {
    error(): void;
    warn(): void;
    info(): void;
    debug(): void;
} {
    return {
        error(): void {},
        warn(): void {},
        info(): void {},
        debug(): void {},
    };
}

describe('TopLevelStructureWatcher — single notify', () => {
    test('emits one callback after the window expires', () => {
        const timer = new ManualTimer();
        let fired = 0;
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 30_000,
            onCoalescedChange: () => {
                fired += 1;
            },
        });

        watcher.notify('created');
        assert.equal(fired, 0);
        assert.equal(watcher.isPending(), true);

        timer.advance(29_999);
        assert.equal(fired, 0);

        timer.advance(1);
        assert.equal(fired, 1);
        assert.equal(watcher.isPending(), false);
    });

    test('DEFAULT_COALESCE_WINDOW_MS is 30000', () => {
        assert.equal(DEFAULT_COALESCE_WINDOW_MS, 30_000);
    });
});

describe('TopLevelStructureWatcher — flood resistance', () => {
    test('1000 raw notify() calls inside one window produce exactly ONE callback', () => {
        const timer = new ManualTimer();
        let fired = 0;
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 30_000,
            onCoalescedChange: () => {
                fired += 1;
            },
        });

        for (let i = 0; i < 1000; i += 1) {
            watcher.notify(i % 2 === 0 ? 'created' : 'deleted');
        }
        assert.equal(watcher.getNotifyCount(), 1000);
        assert.equal(timer.pendingCount(), 1);
        assert.equal(fired, 0);

        timer.advance(30_000);
        assert.equal(fired, 1);
        assert.equal(watcher.getNotifyCount(), 1000);
    });

    test('repeated notify across windows produces one callback per window', () => {
        const timer = new ManualTimer();
        let fired = 0;
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 1000,
            onCoalescedChange: () => {
                fired += 1;
            },
        });

        watcher.notify('created');
        timer.advance(1000);
        assert.equal(fired, 1);

        watcher.notify('created');
        timer.advance(1000);
        assert.equal(fired, 2);

        watcher.notify('created');
        timer.advance(1000);
        assert.equal(fired, 3);
    });

    test('idle period after window without notify produces no callback', () => {
        const timer = new ManualTimer();
        let fired = 0;
        const _watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 1000,
            onCoalescedChange: () => {
                fired += 1;
            },
        });
        void _watcher;

        timer.advance(10_000);
        assert.equal(fired, 0);
    });
});

describe('TopLevelStructureWatcher — dispose', () => {
    test('dispose cancels a pending window', () => {
        const timer = new ManualTimer();
        let fired = 0;
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 30_000,
            onCoalescedChange: () => {
                fired += 1;
            },
        });

        watcher.notify('created');
        assert.equal(timer.pendingCount(), 1);

        watcher.dispose();
        timer.advance(30_000);

        assert.equal(fired, 0);
    });

    test('notify after dispose is a no-op', () => {
        const timer = new ManualTimer();
        let fired = 0;
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 1000,
            onCoalescedChange: () => {
                fired += 1;
            },
        });

        watcher.dispose();
        watcher.notify('created');

        assert.equal(watcher.getNotifyCount(), 0);
        timer.advance(2000);
        assert.equal(fired, 0);
    });

    test('double dispose is a no-op', () => {
        const timer = new ManualTimer();
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 1000,
            onCoalescedChange: () => {},
        });

        watcher.dispose();
        watcher.dispose();
    });
});

describe('TopLevelStructureWatcher — error handling', () => {
    test('a throwing callback does not break subsequent windows', () => {
        const timer = new ManualTimer();
        let fireAttempts = 0;
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 1000,
            onCoalescedChange: () => {
                fireAttempts += 1;
                if (fireAttempts === 1) throw new Error('first window blew up');
            },
        });

        watcher.notify('created');
        timer.advance(1000);
        assert.equal(fireAttempts, 1);

        watcher.notify('created');
        timer.advance(1000);
        assert.equal(fireAttempts, 2);
    });

    test('a rejected-promise callback does not break subsequent windows', async () => {
        const timer = new ManualTimer();
        let fireAttempts = 0;
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 1000,
            onCoalescedChange: () => {
                fireAttempts += 1;
                if (fireAttempts === 1) return Promise.reject(new Error('async fail'));
                return Promise.resolve();
            },
        });

        watcher.notify('created');
        timer.advance(1000);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(fireAttempts, 1);

        watcher.notify('created');
        timer.advance(1000);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(fireAttempts, 2);
    });
});

describe('TopLevelStructureWatcher — diagnostic accessors', () => {
    test('isPending reflects state correctly', () => {
        const timer = new ManualTimer();
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 1000,
            onCoalescedChange: () => {},
        });

        assert.equal(watcher.isPending(), false);
        watcher.notify('created');
        assert.equal(watcher.isPending(), true);
        timer.advance(1000);
        assert.equal(watcher.isPending(), false);
    });

    test('getNotifyCount accumulates across windows', () => {
        const timer = new ManualTimer();
        const watcher = new TopLevelStructureWatcher({
            logger: silentLogger() as unknown as never,
            timer,
            windowMs: 1000,
            onCoalescedChange: () => {},
        });

        watcher.notify('created');
        watcher.notify('deleted');
        timer.advance(1000);
        watcher.notify('created');
        timer.advance(1000);

        assert.equal(watcher.getNotifyCount(), 3);
    });
});
