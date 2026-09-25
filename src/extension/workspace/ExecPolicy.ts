// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import * as vscode from 'vscode';

import type { RemoteExecMode } from '../../shared/webview-protocol.js';

export type ExecMode = RemoteExecMode;

/** workspaceState key holding the per-conversation mode map. */
const MODES_KEY = 'verzeta.remoteExec.modes';

export class ExecPolicy {
    private readonly memento: vscode.Memento;
    private unsandboxedNoticeShown = false;

    constructor(memento: vscode.Memento) {
        this.memento = memento;
    }

    private modes(): Record<string, ExecMode> {
        const raw = this.memento.get<Record<string, string>>(MODES_KEY, {});
        const out: Record<string, ExecMode> = {};
        for (const [id, m] of Object.entries(raw)) {
            if (m === 'ask' || m === 'allow' || m === 'off') out[id] = m;
        }
        return out;
    }

    /** This conversation's mode, defaulting to Off. */
    getMode(conversationId: string): ExecMode {
        if (conversationId.length === 0) return 'off';
        return this.modes()[conversationId] ?? 'off';
    }

    /** Persist this conversation's mode. */
    async setMode(conversationId: string, mode: ExecMode): Promise<void> {
        if (conversationId.length === 0) return;
        const next = { ...this.modes(), [conversationId]: mode };
        await this.memento.update(MODES_KEY, next);
    }

    /**
     * Ask-mode per-command confirmation. Shows the exact command and
     * whether it will be sandboxed; returns true on approval.
     */
    async confirmCommand(command: string, sandboxed: boolean): Promise<boolean> {
        const sandboxNote = sandboxed
            ? 'It will run sandboxed (workspace-scoped).'
            : '⚠ No sandbox is available on this platform. It will run with your full permissions.';
        const choice = await vscode.window.showWarningMessage(
            `Run this command on your device?\n\n${command}\n\n${sandboxNote}`,
            { modal: true },
            'Run',
        );
        return choice === 'Run';
    }

    /**
     * One-time-per-session notice that a command ran without a sandbox,
     * so the user is never silently unprotected.
     */
    noticeRanUnsandboxed(): void {
        if (this.unsandboxedNoticeShown) return;
        this.unsandboxedNoticeShown = true;
        void vscode.window.showWarningMessage(
            'Verzeta ran an agent command without a sandbox (none is available on this ' +
                'platform). Install bubblewrap (Linux) for sandboxed execution.',
        );
    }
}
