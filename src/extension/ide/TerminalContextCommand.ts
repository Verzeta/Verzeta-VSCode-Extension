// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * `verzeta.sendTerminalCommand` — sends the last terminal command (its
 * command line + captured output + exit status) to the active
 * conversation, so the user can ask an agent to explain or fix a failing
 * command. Uses VS Code's terminal SHELL INTEGRATION API (the clean way
 * to read command output — there is no API to read an arbitrary terminal
 * selection, so we never touch the clipboard). User-initiated from the
 * terminal context menu / palette, so it adds no noise.
 */

import * as vscode from 'vscode';
import {
    ensureConversation,
    sendEditorAction,
    type EditorActionsDeps,
} from './EditorActionsCommand.js';
import type { EditorAction } from './EditorActionsCatalog.js';

/** Cap captured output so a chatty command can't swamp the prompt. */
const MAX_OUTPUT_CHARS = 20_000;

/** Passthrough action — the body is composed here and sent verbatim. */
const TERMINAL_ACTION: EditorAction = { id: 'terminal', label: 'Terminal', prompt: '{sel}' };

interface CapturedCommand {
    readonly command: string;
    readonly output: string;
    readonly exitCode: number | undefined;
}

async function readAll(execution: vscode.TerminalShellExecution): Promise<string> {
    let out = '';
    try {
        for await (const chunk of execution.read()) {
            out += chunk;
            if (out.length >= MAX_OUTPUT_CHARS) return out.slice(0, MAX_OUTPUT_CHARS);
        }
    } catch {
        // Stream errors are non-fatal; we send whatever was captured.
    }
    return out;
}

export function registerTerminalContextCommand(deps: EditorActionsDeps): vscode.Disposable {
    let last: CapturedCommand | undefined;
    const disposables: vscode.Disposable[] = [];

    // Shell integration is required + only present on recent VS Code with
    // a supported shell. Guard so older hosts don't crash on activation.
    const onStart = vscode.window.onDidStartTerminalShellExecution;
    const onEnd = vscode.window.onDidEndTerminalShellExecution;
    if (typeof onStart === 'function' && typeof onEnd === 'function') {
        const pending = new Map<vscode.TerminalShellExecution, Promise<string>>();
        disposables.push(
            onStart((e) => {
                pending.set(e.execution, readAll(e.execution));
            }),
            onEnd((e) => {
                const p = pending.get(e.execution);
                pending.delete(e.execution);
                void (p ?? Promise.resolve('')).then((output) => {
                    last = {
                        command: e.execution.commandLine.value,
                        output,
                        exitCode: e.exitCode,
                    };
                });
            }),
        );
    }

    disposables.push(
        vscode.commands.registerCommand('verzeta.sendTerminalCommand', () =>
            runSendTerminal(deps, last),
        ),
    );
    return vscode.Disposable.from(...disposables);
}

async function runSendTerminal(
    deps: EditorActionsDeps,
    last: CapturedCommand | undefined,
): Promise<void> {
    if (last === undefined) {
        await vscode.window.showWarningMessage(
            'Verzeta: run a command in the integrated terminal first (requires shell integration).',
        );
        return;
    }
    const target = await ensureConversation(deps);
    if (target === undefined) return;

    const ec = last.exitCode;
    const status =
        ec === undefined ? '' : ec === 0 ? ' (it succeeded)' : ` (it failed, exit ${ec})`;
    const output = last.output.trim();
    const failed = ec !== undefined && ec !== 0;
    const body =
        `I ran this terminal command${status}:\n\n\`\`\`sh\n$ ${last.command}\n\`\`\`\n\n` +
        `Output:\n\n\`\`\`\n${output.length > 0 ? output : '(no output captured)'}\n\`\`\`` +
        (failed ? '\n\nPlease help me understand and fix it.' : '');

    await sendEditorAction(deps, target, TERMINAL_ACTION, {
        relPath: 'terminal',
        language: 'shell',
        selection: body,
    });
}
