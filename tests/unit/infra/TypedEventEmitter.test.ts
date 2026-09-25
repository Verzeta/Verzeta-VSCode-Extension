// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { TypedEventEmitter } from '../../../src/extension/infra/TypedEventEmitter.js';

interface Events extends Record<string, readonly unknown[]> {
    readonly hello: readonly [name: string];
    readonly count: readonly [n: number, doubled: number];
    readonly empty: readonly [];
}

describe('TypedEventEmitter', () => {
    test('on + emit delivers args', () => {
        const bus = new TypedEventEmitter<Events>();
        const received: string[] = [];
        bus.on('hello', (name) => received.push(name));
        bus.emit('hello', 'alice');
        bus.emit('hello', 'bob');
        deepStrictEqual(received, ['alice', 'bob']);
    });

    test('off removes the listener', () => {
        const bus = new TypedEventEmitter<Events>();
        const received: string[] = [];
        const listener = (name: string): void => {
            received.push(name);
        };
        bus.on('hello', listener);
        bus.emit('hello', 'first');
        bus.off('hello', listener);
        bus.emit('hello', 'second');
        deepStrictEqual(received, ['first']);
    });

    test('once fires exactly once', () => {
        const bus = new TypedEventEmitter<Events>();
        let calls = 0;
        bus.once('empty', () => {
            calls += 1;
        });
        bus.emit('empty');
        bus.emit('empty');
        strictEqual(calls, 1);
    });

    test('multi-arg events deliver all args', () => {
        const bus = new TypedEventEmitter<Events>();
        const collected: Array<readonly [number, number]> = [];
        bus.on('count', (n, doubled) => collected.push([n, doubled]));
        bus.emit('count', 3, 6);
        bus.emit('count', 4, 8);
        deepStrictEqual(collected, [
            [3, 6],
            [4, 8],
        ]);
    });

    test('removeAllListeners clears every listener for an event', () => {
        const bus = new TypedEventEmitter<Events>();
        let calls = 0;
        bus.on('empty', () => {
            calls += 1;
        });
        bus.on('empty', () => {
            calls += 1;
        });
        bus.removeAllListeners('empty');
        bus.emit('empty');
        strictEqual(calls, 0);
    });

    test('removeAllListeners with no arg clears every event', () => {
        const bus = new TypedEventEmitter<Events>();
        let helloCalls = 0;
        let emptyCalls = 0;
        bus.on('hello', () => {
            helloCalls += 1;
        });
        bus.on('empty', () => {
            emptyCalls += 1;
        });
        bus.removeAllListeners();
        bus.emit('hello', 'x');
        bus.emit('empty');
        strictEqual(helloCalls, 0);
        strictEqual(emptyCalls, 0);
    });

    test('listenerCount reports correctly', () => {
        const bus = new TypedEventEmitter<Events>();
        const noop = (): void => {};
        bus.on('empty', noop);
        bus.on('empty', noop);
        strictEqual(bus.listenerCount('empty'), 2);
    });
});
