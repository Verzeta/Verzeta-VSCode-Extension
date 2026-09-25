// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import {
    err,
    isErr,
    isOk,
    mapErr,
    mapOk,
    ok,
    unwrapOr,
} from '../../../src/extension/infra/Result.js';

describe('Result', () => {
    test('ok carries the value', () => {
        const r = ok(42);
        strictEqual(r.kind, 'ok');
        strictEqual(r.value, 42);
    });

    test('err carries the error', () => {
        const r = err('boom');
        strictEqual(r.kind, 'err');
        strictEqual(r.error, 'boom');
    });

    test('isOk / isErr discriminate correctly', () => {
        const success = ok('a');
        const failure = err(new Error('b'));
        strictEqual(isOk(success), true);
        strictEqual(isErr(success), false);
        strictEqual(isOk(failure), false);
        strictEqual(isErr(failure), true);
    });

    test('unwrapOr returns the value on ok', () => {
        strictEqual(unwrapOr(ok(7), 0), 7);
    });

    test('unwrapOr returns the fallback on err', () => {
        strictEqual(unwrapOr(err<string>('nope'), 99), 99);
    });

    test('mapOk transforms success values', () => {
        const r = mapOk(ok(3), (n) => n * 2);
        deepStrictEqual(r, ok(6));
    });

    test('mapOk leaves err untouched', () => {
        const r = mapOk(err<string>('x'), (n: number) => n * 2);
        deepStrictEqual(r, err('x'));
    });

    test('mapErr transforms error values', () => {
        const r = mapErr(err('lc'), (s) => s.toUpperCase());
        deepStrictEqual(r, err('LC'));
    });

    test('mapErr leaves ok untouched', () => {
        const r = mapErr(ok(5), (s: string) => s.toUpperCase());
        deepStrictEqual(r, ok(5));
    });
});
