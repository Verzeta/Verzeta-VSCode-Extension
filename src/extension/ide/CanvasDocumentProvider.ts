// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as vscode from 'vscode';
import type { Logger } from '../log/Logger.js';
import type { ConnectionManager } from '../hosts/ConnectionManager.js';

export const CANVAS_SCHEME = 'verzeta-canvas';

interface ParsedCanvasUri {
    readonly hostId: string;
    readonly conversationId: string;
    readonly fileName: string;
}

function parseCanvasUri(uri: vscode.Uri): ParsedCanvasUri | undefined {
    if (uri.scheme !== CANVAS_SCHEME) return undefined;
    const hostId = uri.authority;
    if (hostId.length === 0) return undefined;
    const segments = uri.path.split('/').filter((s) => s.length > 0);
    if (segments.length < 2) return undefined;
    const conversationId = segments[0];
    if (conversationId === undefined) return undefined;
    const fileName = segments.slice(1).join('/');
    return { hostId, conversationId, fileName };
}

export function buildCanvasUri(
    hostId: string,
    conversationId: string,
    fileName: string,
): vscode.Uri {
    return vscode.Uri.from({
        scheme: CANVAS_SCHEME,
        authority: hostId,
        path: `/${conversationId}/${fileName}`,
    });
}

export interface CanvasProviderDeps {
    readonly connectionManager: ConnectionManager;
    readonly logger: Logger;
}

export class CanvasDocumentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly deps: CanvasProviderDeps;
    private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this.emitter.event;

    constructor(deps: CanvasProviderDeps) {
        this.deps = deps;
    }

    /**
     * Notify VS Code that one canvas document changed. The editor
     * re-calls `provideTextDocumentContent` to refresh.
     */
    notifyChanged(hostId: string, conversationId: string, fileName: string): void {
        this.emitter.fire(buildCanvasUri(hostId, conversationId, fileName));
    }

    /**
     * Refresh every open canvas tab for a conversation. The tab's file
     * name comes from `canvas.suggested_export_name`, which need not match
     * the name in the host's event, so tabs are matched by host and
     * conversation only.
     *
     * @param hostId the host the canvas belongs to.
     * @param conversationId the conversation whose canvas changed.
     */
    notifyConversationChanged(hostId: string, conversationId: string): void {
        for (const doc of vscode.workspace.textDocuments) {
            const parsed = parseCanvasUri(doc.uri);
            if (parsed?.hostId !== hostId || parsed.conversationId !== conversationId) continue;
            this.notifyChanged(hostId, conversationId, parsed.fileName);
        }
    }

    async provideTextDocumentContent(
        uri: vscode.Uri,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const parsed = parseCanvasUri(uri);
        if (parsed === undefined) {
            this.deps.logger.warn('CanvasDocumentProvider: malformed uri', {
                uri: uri.toString(true),
            });
            return placeholder('malformed', 'Verzeta could not parse this canvas URI.');
        }
        const repository = this.deps.connectionManager.repositoryFor(parsed.hostId);
        if (repository === undefined) {
            this.deps.logger.warn('CanvasDocumentProvider: no repository for host', {
                hostId: parsed.hostId,
            });
            return placeholder(
                'disconnected',
                'The Verzeta host for this canvas is not connected. Open the Verzeta sidebar → Settings → Connect, then reopen the canvas.',
            );
        }
        try {
            const content = await repository.getActiveCanvasForConv(parsed.conversationId);
            if (content.length === 0) {
                return placeholder(
                    'empty',
                    'This conversation has no active canvas yet. Ask the assistant to create one (e.g. "create a canvas with a quick-sort in Python"); the tab will refresh when it does.',
                );
            }
            return content;
        } catch (error: unknown) {
            this.deps.logger.warn('CanvasDocumentProvider: fetch failed', {
                conversationId: parsed.conversationId,
                error: error instanceof Error ? error.message : String(error),
            });
            return placeholder(
                'fetch-failed',
                `Verzeta failed to fetch the canvas content: ${
                    error instanceof Error ? error.message : 'unknown error'
                }`,
            );
        }
    }

    dispose(): void {
        this.emitter.dispose();
    }
}

/**
 * `verzeta.openCanvasInEditor` — entry point invoked from the
 * webview when the user clicks "Open canvas in editor" on a chat
 * that has an active canvas, or from the Command Palette while a
 * conversation is selected.
 *
 * The command resolves the conv's active canvas filename via the
 * wire op `canvas.suggested_export_name`, opens the corresponding
 * `verzeta-canvas://` URI, and shows it in an editor tab. When
 * there is no active canvas, the user still lands on an editor tab
 * with a friendly placeholder explaining how to create one — so the
 * "Open canvas in editor" click is never a silent no-op.
 */
export function registerOpenCanvasCommand(deps: {
    readonly connectionManager: ConnectionManager;
    readonly logger: Logger;
}): vscode.Disposable {
    return vscode.commands.registerCommand(
        'verzeta.openCanvasInEditor',
        async (rawArgs: unknown) => {
            const args = parseOpenArgs(rawArgs);
            if (args === undefined) {
                await vscode.window.showWarningMessage(
                    'Verzeta: this command must be invoked from the chat UI (no host/conversation context provided).',
                );
                return;
            }
            const repository = deps.connectionManager.repositoryFor(args.hostId);
            if (repository === undefined) {
                await vscode.window.showWarningMessage(
                    'Verzeta: host is not connected. Open Settings → Connect first.',
                );
                return;
            }
            let fileName = 'canvas.md';
            try {
                const suggested = await repository.suggestedCanvasExportName(args.conversationId);
                if (suggested.length > 0) fileName = suggested;
            } catch (error: unknown) {
                deps.logger.warn('verzeta.openCanvasInEditor: suggested name fetch failed', {
                    conversationId: args.conversationId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
            const uri = buildCanvasUri(args.hostId, args.conversationId, fileName);
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
                deps.logger.info('verzeta.openCanvasInEditor: opened', {
                    hostId: args.hostId,
                    conversationId: args.conversationId,
                    fileName,
                });
            } catch (error: unknown) {
                deps.logger.warn('verzeta.openCanvasInEditor: openTextDocument failed', {
                    uri: uri.toString(true),
                    error: error instanceof Error ? error.message : String(error),
                });
                await vscode.window.showErrorMessage(
                    `Verzeta: failed to open the canvas tab. ${
                        error instanceof Error ? error.message : 'unknown error'
                    }`,
                );
            }
        },
    );
}

function placeholder(kind: string, message: string): string {
    return [
        '// Verzeta canvas',
        `// status: ${kind}`,
        '//',
        ...message.split('\n').map((line) => `// ${line}`),
        '',
    ].join('\n');
}

function parseOpenArgs(raw: unknown): { hostId: string; conversationId: string } | undefined {
    if (raw === null || typeof raw !== 'object') return undefined;
    const obj = raw as Record<string, unknown>;
    const hostId = obj['hostId'];
    const conversationId = obj['conversationId'];
    if (
        typeof hostId !== 'string' ||
        hostId.length === 0 ||
        typeof conversationId !== 'string' ||
        conversationId.length === 0
    ) {
        return undefined;
    }
    return { hostId, conversationId };
}
