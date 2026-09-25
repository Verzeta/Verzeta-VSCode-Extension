// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * HelpSheet — full-page in-app help. Mirrors Android `HelpScreen.kt`
 * shape: bucketed sections of topics, each topic a short prose
 * block. Reached from Settings → "Help & docs" row or from About.
 *
 * Help text deliberately stays terse and operational — quick
 * answers to "how do I X" without leaving the editor. Deep docs
 * still live in the repo's docs/User folder.
 */

import { closeHelp, helpOpen } from '../state/aboutHelp.js';

interface HelpTopic {
    readonly title: string;
    readonly body: string;
}

interface HelpSectionDef {
    readonly label: string;
    readonly topics: readonly HelpTopic[];
}

const SECTIONS: readonly HelpSectionDef[] = [
    {
        label: 'Install',
        topics: [
            {
                title: 'Install the extension',
                body: 'Install from the VS Code Marketplace, or sideload the .vsix published with each Verzeta Studio release. The extension activates when VS Code starts.',
            },
            {
                title: 'Pair a host',
                body: 'Open the Verzeta sidebar. On the Home tab, click "Add host", or run Cmd/Ctrl+Shift+P → Verzeta: Add Host. Paste the URL and the pair code your desktop host displayed. The extension stores the bearer token in VS Code SecretStorage, never in globalState or workspace files.',
            },
            {
                title: 'TLS pinning for self-signed hosts',
                body: 'When the host uses a self-signed certificate, paste its SHA-256 fingerprint into the "TLS Pin" step while adding the host. The extension then trusts exactly that certificate instead of the system CA store.',
            },
        ],
    },
    {
        label: 'Chat',
        topics: [
            {
                title: 'Start a chat',
                body: 'Open the Chat tab and click "New chat" for a 1:1 chat with the host\'s default agent. For a group chat, click "New group" in the conversation rail.',
            },
            {
                title: 'Send a message',
                body: 'Type into the composer and press Enter (Shift+Enter for newline). Streaming replies render token-by-token; "Stop" cancels mid-stream. The thinking sidecar shows under a disclosure when the model supports it.',
            },
            {
                title: 'Attachments',
                body: 'Click the + button to attach files or images. Limits: 8 attachments per message, 16 MiB per attachment, 16 MiB total. Filenames are sanitised before sending.',
            },
            {
                title: 'Code-block highlighting',
                body: "Fenced code blocks are syntax-highlighted via Shiki (same engine VS Code uses) for TypeScript, JavaScript, Python, Bash, JSON, CSS, HTML, and diff. Themes track VS Code's light/dark/high-contrast.",
            },
        ],
    },
    {
        label: 'Project rooms',
        topics: [
            {
                title: 'What is a project room?',
                body: 'A project room is a folder that pins a named-agent team, a shared goal, optional preferred skills, and optional project documents. Mention any member by alias to direct a question; coordinators get the catch-all.',
            },
            {
                title: 'Create a project',
                body: 'Home tab → click "Project Rooms" → "New project". Pick a folder type (project, organization, or regular), set the goal and description, add agents with aliases, and mark a coordinator. Or start from a template via "Browse all".',
            },
            {
                title: 'Templates',
                body: 'Templates seed the roster, scenario, and goal of a new project. Pin user-saved templates to the landing screen. Use "Read more" → "Save as new" to clone a built-in template and customise it.',
            },
            {
                title: 'Heartbeats',
                body: "Heartbeats are scheduled agent runs attached to a project folder. Configure schedules (6-field cron) and goals in the folder editor's Heartbeats section. To post eligible reports into a chat, turn on Chat settings → Heartbeat.",
            },
        ],
    },
    {
        label: 'Settings',
        topics: [
            {
                title: 'Chat settings',
                body: 'Per-conversation: primary agent, model, system prompt, parameters (temperature / max tokens / context window), streaming, thinking, require-confirmation, tools, RAG, heartbeat gate, preferred skills (with optional folder override).',
            },
            {
                title: 'Host settings',
                body: 'Use Settings tab → Hosts to add, remove, or connect to hosts. Models, agents, tools, MCP servers, and skills are host-wide catalogs that refresh automatically on connect.',
            },
            {
                title: 'Devices',
                body: 'Settings tab → Devices paired with this host lists every device paired with the host, including this one. Click Revoke on another device to remove its access. Revoked devices stay visible (read-only) under Settings → Revoked devices.',
            },
        ],
    },
    {
        label: 'Troubleshoot',
        topics: [
            {
                title: 'View logs',
                body: 'View → Output → Verzeta shows connection, wire-protocol, and reconciliation logs. Set verzeta.log.level to "debug" in VS Code settings for verbose wire-layer output.',
            },
            {
                title: '"No response until F5 reload"',
                body: "Usually means the conversation's msg.subscribe was missed. Send the message again; the extension re-subscribes before every send. If it keeps happening, disconnect and reconnect from Settings.",
            },
            {
                title: 'TLS fingerprint mismatch',
                body: "The host's certificate changed. Put the new SHA-256 fingerprint in the host's tlsCertSha256 entry of the verzeta.hosts setting, or remove and re-add the host. If your system CA store trusts the certificate, clear the pin instead.",
            },
            {
                title: 'Settings catalogs empty',
                body: 'Settings catalogs (tools, MCP, skills, agents) fill in automatically after a successful connect. If they stay empty, part of the host may be unreachable. Check the Verzeta output channel for diagnostics.',
            },
        ],
    },
];

export function HelpSheet() {
    if (!helpOpen.value) return null;
    return (
        <div class="verzeta-prooms-overlay" role="dialog" aria-modal="true" aria-label="Help">
            <header class="verzeta-prooms__header">
                <button
                    type="button"
                    class="verzeta-prooms__back"
                    onClick={closeHelp}
                    aria-label="Back"
                >
                    ‹
                </button>
                <h1 class="verzeta-prooms__title">Help &amp; docs</h1>
            </header>
            <div class="verzeta-prooms__crumb">
                <span>SETTINGS</span>
                <span aria-hidden="true">·</span>
                <span>HELP</span>
            </div>
            <div class="verzeta-prooms__scroll">
                {SECTIONS.map((section) => (
                    <section key={section.label} class="verzeta-about__section">
                        <h3 class="verzeta-about__label">{section.label}</h3>
                        {section.topics.map((topic) => (
                            <article key={topic.title} class="verzeta-help__topic">
                                <h4 class="verzeta-help__topicTitle">{topic.title}</h4>
                                <p class="verzeta-help__topicBody">{topic.body}</p>
                            </article>
                        ))}
                    </section>
                ))}
            </div>
        </div>
    );
}
