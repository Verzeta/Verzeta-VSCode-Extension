// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Disposable helpers — wraps the VS Code disposable pattern in
 * a few small primitives so callers do not reimplement the same
 * shapes over and over.
 *
 * `Disposable` is the minimal contract — anything with a
 * `dispose()` method. It matches `vscode.Disposable` structurally,
 * so values from VS Code APIs are accepted directly.
 */

export interface Disposable {
    dispose(): void;
}

/**
 * Builds a Disposable from a plain callback. Idempotent — calling
 * `dispose()` twice runs the callback at most once.
 */
export function asDisposable(fn: () => void): Disposable {
    let done = false;
    return {
        dispose: () => {
            if (done) return;
            done = true;
            fn();
        },
    };
}

/**
 * A collection of disposables that can itself be disposed as a
 * single unit. Useful for grouping the disposables produced by a
 * subsystem so its owner can tear them all down with one call.
 *
 * Listeners added after `dispose()` are immediately disposed
 * rather than tracked.
 */
export class DisposableStore implements Disposable {
    private readonly entries: Disposable[] = [];
    private disposed = false;

    add<T extends Disposable>(disposable: T): T {
        if (this.disposed) {
            disposable.dispose();
            return disposable;
        }
        this.entries.push(disposable);
        return disposable;
    }

    addAll(disposables: readonly Disposable[]): void {
        for (const d of disposables) {
            this.add(d);
        }
    }

    isDisposed(): boolean {
        return this.disposed;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // Dispose in reverse order so dependents tear down before
        // their dependencies (the VS Code convention).
        for (let i = this.entries.length - 1; i >= 0; i -= 1) {
            const entry = this.entries[i];
            if (entry !== undefined) {
                try {
                    entry.dispose();
                } catch {
                    // Disposal must not throw. Swallow individual
                    // failures so siblings still get a chance to
                    // clean up.
                }
            }
        }
        this.entries.length = 0;
    }
}
