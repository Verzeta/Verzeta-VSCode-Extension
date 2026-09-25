// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * pairing: the pair-code exchange shared by Add Host and Pair: open a
 * one-shot connection, trade the code for a bearer token, close it.
 * Also holds the client name and the user-facing pairing error text so
 * both commands say the same thing.
 */

import * as os from 'node:os';
import type { PairResponse } from '../../shared/wire-envelope.js';
import type { Logger } from '../log/Logger.js';
import { parseEndpoint, type RemoteEndpoint } from '../wire/RemoteEndpoint.js';
import { RemoteRepository } from '../wire/RemoteRepository.js';
import { RemoteOpError, RemoteSession } from '../wire/RemoteSession.js';

/** Where to pair: the host URL and its optional TLS pin. */
export interface PairTarget {
    readonly url: string;
    readonly tlsCertSha256: string;
}

/**
 * The part of RemoteSession the exchange needs. Tests pass a fake.
 */
export interface PairSession {
    connect(endpoint: RemoteEndpoint, tlsCertSha256: string): Promise<void>;
    send(op: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>;
    dispose(): Promise<void>;
}

/** Builds the one-shot session. Defaults to a real RemoteSession. */
export type PairSessionFactory = (logger: Logger) => PairSession;

const defaultSessionFactory: PairSessionFactory = (logger) =>
    new RemoteSession({ logger, verboseState: false });

/**
 * Trade a pair code for a bearer token over a one-shot connection.
 *
 * The session is always closed before this returns, so the caller can
 * open the persistent connection without the host seeing two sockets
 * for the same client.
 *
 * @param target the host URL and TLS pin.
 * @param code the pair code shown on the host.
 * @param logger logger for the one-shot session.
 * @param makeSession session factory; tests inject a fake.
 * @returns the host's pair response, including the token.
 * @throws when the URL is invalid, the connection fails, or the host
 *         rejects the code (`RemoteOpError`).
 */
export async function exchangePairCode(
    target: PairTarget,
    code: string,
    logger: Logger,
    makeSession: PairSessionFactory = defaultSessionFactory,
): Promise<PairResponse> {
    const endpoint = parseEndpoint(target.url);
    const session = makeSession(logger);
    try {
        await session.connect(endpoint, target.tlsCertSha256);
        const repository = new RemoteRepository(session as unknown as RemoteSession);
        return await repository.pair(code.trim(), clientName());
    } finally {
        await session.dispose();
    }
}

/** The client name this extension pairs under, for example `VS Code · laptop`. */
export function clientName(): string {
    const hostname = os.hostname() || 'unknown-host';
    return `VS Code · ${hostname}`;
}

/**
 * Turn a pairing failure into a short message for the user.
 *
 * @param error whatever `exchangePairCode` threw.
 * @returns a sentence to show after "Pairing failed: ".
 */
export function friendlyPairError(error: unknown): string {
    if (error instanceof RemoteOpError) {
        if (
            error.kind === 'auth_failed' ||
            error.kind === 'invalid_pair_code' ||
            error.kind === 'unauthorized'
        ) {
            return 'The pair code was not accepted. It may be wrong or expired. Generate a new code on the host and try again.';
        }
        if (error.kind === 'expired_pair_code') {
            return 'Pair code expired. Generate a fresh one and try again.';
        }
        return `${error.kind}: ${error.detail}`;
    }
    if (error instanceof Error) return error.message;
    return String(error);
}

/** Prompt text for the pair-code input box, shared by Add Host and Pair. */
export const PAIR_CODE_PROMPT =
    'Enter the 6-digit pair code from the host (Settings > Remote Access > Manage Remote Access > Generate pair code, or `verzeta-remote --pair-code`).';
