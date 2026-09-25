// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import { DisposableStore, asDisposable } from '../../../src/extension/infra/disposables.js';

describe('asDisposable', () => {
    test('runs the callback on dispose', () => {
        let ran = 0;
        const d = asDisposable(() => {
            ran += 1;
        });
        d.dispose();
        strictEqual(ran, 1);
    });

    test('is idempotent', () => {
        let ran = 0;
        const d = asDisposable(() => {
            ran += 1;
        });
        d.dispose();
        d.dispose();
        d.dispose();
        strictEqual(ran, 1);
    });
});

describe('DisposableStore', () => {
    test('disposes added entries in reverse order', () => {
        const order: string[] = [];
        const store = new DisposableStore();
        store.add(asDisposable(() => order.push('a')));
        store.add(asDisposable(() => order.push('b')));
        store.add(asDisposable(() => order.push('c')));
        store.dispose();
        deepStrictEqual(order, ['c', 'b', 'a']);
    });

    test('isDisposed reflects state', () => {
        const store = new DisposableStore();
        strictEqual(store.isDisposed(), false);
        store.dispose();
        strictEqual(store.isDisposed(), true);
    });

    test('disposes immediately if added after store dispose', () => {
        const store = new DisposableStore();
        store.dispose();
        let ran = false;
        store.add(
            asDisposable(() => {
                ran = true;
            }),
        );
        strictEqual(ran, true);
    });

    test('addAll accepts an array', () => {
        const order: number[] = [];
        const store = new DisposableStore();
        store.addAll([
            asDisposable(() => order.push(1)),
            asDisposable(() => order.push(2)),
            asDisposable(() => order.push(3)),
        ]);
        store.dispose();
        deepStrictEqual(order, [3, 2, 1]);
    });

    test('swallows individual disposer failures', () => {
        const order: string[] = [];
        const store = new DisposableStore();
        store.add(asDisposable(() => order.push('first')));
        store.add(
            asDisposable(() => {
                throw new Error('mid');
            }),
        );
        store.add(asDisposable(() => order.push('last')));
        store.dispose();
        deepStrictEqual(order, ['last', 'first']);
    });

    test('double dispose is a no-op', () => {
        let calls = 0;
        const store = new DisposableStore();
        store.add(
            asDisposable(() => {
                calls += 1;
            }),
        );
        store.dispose();
        store.dispose();
        strictEqual(calls, 1);
    });
});
