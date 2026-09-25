// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Result<T, E> — a discriminated-union alternative to exceptions
 * for code paths where errors are expected (wire failures, parse
 * failures, user-input validation). Exceptions remain reserved
 * for programmer errors (impossible states, broken invariants).
 *
 * Usage:
 *     const r = await tryFetch(url);
 *     if (r.kind === 'err') {
 *         logger.warn('fetch failed', r.error);
 *         return;
 *     }
 *     // r.value is now typed as the success type
 */

export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
    readonly kind: 'ok';
    readonly value: T;
}

export interface Err<E> {
    readonly kind: 'err';
    readonly error: E;
}

export function ok<T>(value: T): Ok<T> {
    return { kind: 'ok', value };
}

export function err<E>(error: E): Err<E> {
    return { kind: 'err', error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
    return r.kind === 'ok';
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
    return r.kind === 'err';
}

/**
 * Unwrap a Result by providing a default for the error case.
 * Useful when the error is recoverable and you want the success
 * value or a fallback inline.
 */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
    return r.kind === 'ok' ? r.value : fallback;
}

/**
 * Map the success value of a Result through a transform.
 * Errors pass through unchanged.
 */
export function mapOk<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return r.kind === 'ok' ? ok(fn(r.value)) : r;
}

/**
 * Map the error value of a Result through a transform.
 * Success values pass through unchanged.
 */
export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    return r.kind === 'err' ? err(fn(r.error)) : r;
}
