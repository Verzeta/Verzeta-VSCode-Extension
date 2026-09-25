// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * HostConfig — typed value object for a paired Verzeta Studio host.
 *
 * Persists in `vscode.workspace.getConfiguration('verzeta').hosts`
 * (see ConfigurationSchema.PersistedHostConfig for the on-disk
 * shape). The bearer token does NOT live here — it lives in
 * vscode.SecretStorage, keyed by the host id.
 */

import { randomUUID } from 'node:crypto';
import type { PersistedHostConfig } from '../settings/ConfigurationSchema.js';

export interface HostConfig {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    /**
     * Pinned TLS certificate SHA-256 fingerprint (upper-case hex
     * with colons or without). Required for wss:// hosts. Empty
     * string for ws:// hosts.
     */
    readonly tlsCertSha256: string;
}

/**
 * Constructs a new HostConfig from user-provided inputs. The id is
 * locally generated so the user's host name can change without
 * breaking secret-store keys or settings references.
 */
export function makeHostConfig(input: Omit<HostConfig, 'id'>): HostConfig {
    return {
        id: randomUUID(),
        name: input.name,
        url: input.url,
        tlsCertSha256: input.tlsCertSha256,
    };
}

/**
 * Maps the persisted JSON shape onto the in-memory HostConfig.
 * Tolerates missing `tlsCertSha256` for ws:// hosts.
 */
export function fromPersisted(p: PersistedHostConfig): HostConfig {
    return {
        id: p.id,
        name: p.name,
        url: p.url,
        tlsCertSha256: p.tlsCertSha256 ?? '',
    };
}

/**
 * Maps the in-memory HostConfig back to the on-disk shape.
 * Omits `tlsCertSha256` when empty so the JSON stays tidy.
 */
export function toPersisted(h: HostConfig): PersistedHostConfig {
    if (h.tlsCertSha256.length === 0) {
        return { id: h.id, name: h.name, url: h.url };
    }
    return {
        id: h.id,
        name: h.name,
        url: h.url,
        tlsCertSha256: h.tlsCertSha256,
    };
}

/**
 * Returns true when the URL scheme requires TLS pinning.
 */
export function requiresTls(url: string): boolean {
    return url.toLowerCase().startsWith('wss://');
}

/**
 * Normalises a TLS fingerprint to upper-case hex with colon
 * separators every two characters. Strips whitespace and any
 * "sha256 Fingerprint=" prefix from openssl output.
 */
export function normaliseFingerprint(raw: string): string {
    const trimmed = raw.trim();
    const stripped = trimmed.replace(/^sha256\s+fingerprint=/i, '');
    const hexOnly = stripped.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    const groups: string[] = [];
    for (let i = 0; i < hexOnly.length; i += 2) {
        groups.push(hexOnly.slice(i, i + 2));
    }
    return groups.join(':');
}
