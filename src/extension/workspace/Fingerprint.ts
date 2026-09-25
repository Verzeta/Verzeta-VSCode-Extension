// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { createHash } from 'node:crypto';

const FINGERPRINT_REGEX = /^[0-9a-f]{64}$/;

/**
 * Computes the SHA-256 fingerprint of `content`. Returns the
 * 64-character lowercase hex digest. Bytes are hashed verbatim — no
 * normalisation, no line-ending conversion, no whitespace trimming.
 * The fingerprint is over the EXACT bytes the file system holds.
 */
export function fingerprintOf(content: Uint8Array): string {
    const hash = createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
}

/**
 * Returns true iff `value` is a syntactically-valid fingerprint
 * (64 lowercase hex characters). Does NOT verify whether the
 * fingerprint matches any particular content — that comparison
 * happens by string-equality against `fingerprintOf(currentBytes)`.
 *
 * Callers that receive a fingerprint from the wire MUST validate
 * the shape before using it; the host's `expected_fingerprint`
 * arrives as `unknown` and a malformed value (uppercase hex,
 * truncated string, JSON null) is a hard reject.
 */
export function isValidFingerprintShape(value: unknown): value is string {
    return typeof value === 'string' && FINGERPRINT_REGEX.test(value);
}

/**
 * Convenience: hashes `content` and compares against `expected` in
 * a single call. Returns true iff the hashes match. Used by the
 * write handler immediately before applying an edit.
 */
export function matchesFingerprint(content: Uint8Array, expected: string): boolean {
    return fingerprintOf(content) === expected;
}
