// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';

import {
    fromPersisted,
    makeHostConfig,
    normaliseFingerprint,
    requiresTls,
    toPersisted,
} from '../../../src/extension/hosts/HostConfig.js';

describe('makeHostConfig', () => {
    test('assigns a UUID-shaped id', () => {
        const h = makeHostConfig({
            name: 'server',
            url: 'wss://server:9180/',
            tlsCertSha256: 'AB:CD',
        });
        strictEqual(typeof h.id, 'string');
        strictEqual(h.id.length, 36);
        strictEqual(h.id.charAt(8), '-');
        strictEqual(h.id.charAt(13), '-');
        strictEqual(h.id.charAt(18), '-');
        strictEqual(h.id.charAt(23), '-');
    });

    test('preserves other fields verbatim', () => {
        const h = makeHostConfig({
            name: 'home-server',
            url: 'wss://home:9180/',
            tlsCertSha256: 'AB:CD:EF',
        });
        strictEqual(h.name, 'home-server');
        strictEqual(h.url, 'wss://home:9180/');
        strictEqual(h.tlsCertSha256, 'AB:CD:EF');
    });
});

describe('fromPersisted / toPersisted', () => {
    test('round-trips a wss host with fingerprint', () => {
        const persisted = {
            id: 'host-1',
            name: 'home',
            url: 'wss://home:9180/',
            tlsCertSha256: 'AB:CD',
        };
        const round = toPersisted(fromPersisted(persisted));
        deepStrictEqual(round, persisted);
    });

    test('round-trips a ws host without fingerprint', () => {
        const persisted = {
            id: 'host-2',
            name: 'lab',
            url: 'ws://lab:9180/',
        };
        const round = toPersisted(fromPersisted(persisted));
        deepStrictEqual(round, persisted);
    });

    test('fromPersisted tolerates absent fingerprint', () => {
        const h = fromPersisted({
            id: 'host-3',
            name: 'plain',
            url: 'ws://plain:9180/',
        });
        strictEqual(h.tlsCertSha256, '');
    });

    test('toPersisted omits empty fingerprint', () => {
        const p = toPersisted({
            id: 'host-4',
            name: 'plain',
            url: 'ws://plain:9180/',
            tlsCertSha256: '',
        });
        strictEqual('tlsCertSha256' in p, false);
    });
});

describe('requiresTls', () => {
    test('detects wss://', () => {
        strictEqual(requiresTls('wss://server/'), true);
        strictEqual(requiresTls('WSS://server/'), true);
    });

    test('rejects ws://', () => {
        strictEqual(requiresTls('ws://server/'), false);
    });

    test('rejects unknown schemes', () => {
        strictEqual(requiresTls('https://server/'), false);
        strictEqual(requiresTls(''), false);
    });
});

describe('normaliseFingerprint', () => {
    test('strips openssl prefix and lowercase hex', () => {
        const out = normaliseFingerprint('sha256 Fingerprint=ab:cd:ef:01:23');
        strictEqual(out, 'AB:CD:EF:01:23');
    });

    test('inserts colons every two characters', () => {
        const out = normaliseFingerprint('abcdef0123');
        strictEqual(out, 'AB:CD:EF:01:23');
    });

    test('strips arbitrary whitespace and separators', () => {
        const out = normaliseFingerprint('  ab cd-ef:01 23  ');
        strictEqual(out, 'AB:CD:EF:01:23');
    });

    test('discards non-hex characters', () => {
        const out = normaliseFingerprint('ab cd zz ef');
        strictEqual(out, 'AB:CD:EF');
    });
});
