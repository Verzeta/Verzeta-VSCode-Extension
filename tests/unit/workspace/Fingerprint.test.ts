// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
    fingerprintOf,
    isValidFingerprintShape,
    matchesFingerprint,
} from '../../../src/extension/workspace/Fingerprint.js';

const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('fingerprintOf', () => {
    test('returns 64-character lowercase hex', () => {
        const fp = fingerprintOf(new Uint8Array([0x68, 0x69]));
        assert.equal(fp.length, 64);
        assert.match(fp, /^[0-9a-f]{64}$/);
    });

    test('empty bytes produce the published SHA-256("")', () => {
        assert.equal(fingerprintOf(new Uint8Array()), SHA256_EMPTY);
    });

    test('bytes "abc" produce the published SHA-256("abc")', () => {
        const bytes = new TextEncoder().encode('abc');
        assert.equal(fingerprintOf(bytes), SHA256_ABC);
    });

    test('distinct inputs produce distinct fingerprints', () => {
        const a = fingerprintOf(new TextEncoder().encode('alpha'));
        const b = fingerprintOf(new TextEncoder().encode('beta'));
        assert.notEqual(a, b);
    });

    test('byte-equal inputs produce byte-equal fingerprints', () => {
        const a = fingerprintOf(new Uint8Array([1, 2, 3, 4, 5]));
        const b = fingerprintOf(new Uint8Array([1, 2, 3, 4, 5]));
        assert.equal(a, b);
    });

    test('a single bit flip changes the fingerprint completely', () => {
        const a = fingerprintOf(new Uint8Array([0x00]));
        const b = fingerprintOf(new Uint8Array([0x01]));
        assert.notEqual(a, b);
        let diffNibbles = 0;
        for (let i = 0; i < a.length; i += 1) {
            if (a[i] !== b[i]) diffNibbles += 1;
        }
        assert.ok(diffNibbles > 30, `expected >30 nibble differences, got ${diffNibbles}`);
    });
});

describe('isValidFingerprintShape', () => {
    test('accepts the empty-string SHA-256 vector', () => {
        assert.equal(isValidFingerprintShape(SHA256_EMPTY), true);
    });

    test('rejects undefined / null / non-strings', () => {
        assert.equal(isValidFingerprintShape(undefined), false);
        assert.equal(isValidFingerprintShape(null), false);
        assert.equal(isValidFingerprintShape(123), false);
        assert.equal(isValidFingerprintShape({}), false);
        assert.equal(isValidFingerprintShape([]), false);
    });

    test('rejects uppercase hex', () => {
        assert.equal(isValidFingerprintShape(SHA256_EMPTY.toUpperCase()), false);
    });

    test('rejects strings shorter than 64 chars', () => {
        assert.equal(isValidFingerprintShape(SHA256_EMPTY.slice(0, 63)), false);
        assert.equal(isValidFingerprintShape(''), false);
    });

    test('rejects strings longer than 64 chars', () => {
        assert.equal(isValidFingerprintShape(SHA256_EMPTY + 'a'), false);
    });

    test('rejects non-hex characters (g-z)', () => {
        const bad = SHA256_EMPTY.slice(0, 63) + 'g';
        assert.equal(isValidFingerprintShape(bad), false);
    });

    test('rejects whitespace-padded fingerprints', () => {
        assert.equal(isValidFingerprintShape(' ' + SHA256_EMPTY), false);
        assert.equal(isValidFingerprintShape(SHA256_EMPTY + ' '), false);
    });
});

describe('matchesFingerprint', () => {
    test('returns true for byte-equal content and matching fingerprint', () => {
        const content = new TextEncoder().encode('abc');
        assert.equal(matchesFingerprint(content, SHA256_ABC), true);
    });

    test('returns false for byte-different content', () => {
        const content = new TextEncoder().encode('abd');
        assert.equal(matchesFingerprint(content, SHA256_ABC), false);
    });

    test('returns false when the expected fingerprint is bogus', () => {
        const content = new TextEncoder().encode('abc');
        const bogus = '0'.repeat(64);
        assert.equal(matchesFingerprint(content, bogus), false);
    });
});
