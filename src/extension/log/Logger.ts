// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Logger — thin wrapper around vscode.OutputChannel with explicit
 * level gating and structured formatting.
 *
 * Logging policy:
 *     - level=error  always shown
 *     - level=warn   warnings + errors
 *     - level=info   informational lifecycle events + everything above
 *     - level=debug  verbose internal state + everything above
 *
 * No log line ever includes a bearer token, pair code, or full
 * message content. Callers preview-truncate sensitive strings
 * before passing them in.
 */

import * as vscode from 'vscode';
import type { Disposable } from '../infra/disposables.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

export interface LoggerOptions {
    /** Defaults to 'info'. */
    readonly level?: LogLevel;
    /** Defaults to 'Verzeta'. */
    readonly channelName?: string;
}

export class Logger implements Disposable {
    private readonly channel: vscode.OutputChannel;
    private level: LogLevel;

    constructor(options: LoggerOptions = {}) {
        this.channel = vscode.window.createOutputChannel(options.channelName ?? 'Verzeta');
        this.level = options.level ?? 'info';
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    getLevel(): LogLevel {
        return this.level;
    }

    /**
     * Reveal the Verzeta output channel in VS Code's bottom panel.
     * Invoked by the `verzeta.openOutputChannel` command bound to
     * the Settings → "Open output channel" row, and by any future
     * call site that needs to point the user at the diagnostics
     * stream.
     */
    show(preserveFocus = false): void {
        this.channel.show(preserveFocus);
    }

    error(message: string, context?: Readonly<Record<string, unknown>>): void {
        this.log('error', message, context);
    }

    warn(message: string, context?: Readonly<Record<string, unknown>>): void {
        this.log('warn', message, context);
    }

    info(message: string, context?: Readonly<Record<string, unknown>>): void {
        this.log('info', message, context);
    }

    debug(message: string, context?: Readonly<Record<string, unknown>>): void {
        this.log('debug', message, context);
    }

    dispose(): void {
        this.channel.dispose();
    }

    private log(
        level: LogLevel,
        message: string,
        context: Readonly<Record<string, unknown>> | undefined,
    ): void {
        if (LEVEL_ORDER[level] > LEVEL_ORDER[this.level]) {
            return;
        }
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
        if (context === undefined || Object.keys(context).length === 0) {
            this.channel.appendLine(`${prefix} ${message}`);
            return;
        }
        // Structured fields appended as a compact JSON object.
        // Contexts must NOT include secrets — callers' responsibility.
        let serialized: string;
        try {
            serialized = JSON.stringify(context);
        } catch {
            serialized = '<non-serialisable>';
        }
        this.channel.appendLine(`${prefix} ${message} ${serialized}`);
    }
}
