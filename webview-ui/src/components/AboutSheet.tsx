// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * AboutSheet — full-page About surface. Mirrors Android
 * `AboutScreen.kt`: brand mark + version + tagline + Help link +
 * Links + Project + open-source attributions.
 *
 * Version is captured from the host handshake (`extensionVersion`
 * on `HostHandshake`) so it cannot drift from the publish manifest.
 *
 * Reached from Settings → "About Verzeta for VS Code" row.
 */

import { aboutOpen, closeAbout, extensionVersion, openHelp } from '../state/aboutHelp.js';
import { VerzetaMark } from './VerzetaMark.js';

export function AboutSheet() {
    if (!aboutOpen.value) return null;
    return (
        <div class="verzeta-prooms-overlay" role="dialog" aria-modal="true" aria-label="About">
            <header class="verzeta-prooms__header">
                <button
                    type="button"
                    class="verzeta-prooms__back"
                    onClick={closeAbout}
                    aria-label="Back"
                >
                    ‹
                </button>
                <h1 class="verzeta-prooms__title">About</h1>
            </header>
            <div class="verzeta-prooms__crumb">
                <span>SETTINGS</span>
                <span aria-hidden="true">·</span>
                <span>ABOUT</span>
            </div>
            <div class="verzeta-prooms__scroll">
                <section class="verzeta-about__brand">
                    <VerzetaMark size={64} />
                    <h2 class="verzeta-about__name">Verzeta</h2>
                    <p class="verzeta-about__tagline">
                        Multi-agent project rooms inside VS Code. Pair a Verzeta Studio host and
                        chat with named-alias agent teams from the editor.
                    </p>
                    <p class="verzeta-about__version">
                        Version {extensionVersion.value.length > 0 ? extensionVersion.value : 'dev'}
                    </p>
                </section>

                <section class="verzeta-about__section">
                    <h3 class="verzeta-about__label">Help</h3>
                    <AboutRow
                        title="Help &amp; docs"
                        subtitle="Install, pair, chat, projects, settings, troubleshoot."
                        onClick={() => {
                            closeAbout();
                            openHelp();
                        }}
                    />
                </section>

                <section class="verzeta-about__section">
                    <h3 class="verzeta-about__label">Links</h3>
                    <AboutRow
                        title="Project repository"
                        subtitle="Source code lives in the Verzeta Studio monorepo (desktop host) and the verzeta-vscode-extension repo (this client)."
                    />
                </section>

                <section class="verzeta-about__section">
                    <h3 class="verzeta-about__label">Project</h3>
                    <AboutRow
                        title="License"
                        subtitle="This extension: LGPL-3.0-or-later. Verzeta Studio (the desktop host) is open source. See the desktop project's LICENSING file for details."
                    />
                    <AboutRow
                        title="What this extension does"
                        subtitle="Pairs over WebSocket with your Verzeta Studio host. Chat, projects, plans, polls, tool calls, heartbeats, and media all go over that connection. No data is processed on Verzeta-controlled servers."
                    />
                    <AboutRow
                        title="Diagnostics"
                        subtitle="View → Output → Verzeta for connection logs. Set verzeta.log.level to 'debug' in VS Code settings for verbose wire-layer output."
                    />
                </section>

                <section class="verzeta-about__section">
                    <h3 class="verzeta-about__label">Open-source libraries</h3>
                    <AboutRow
                        title="Preact + @preact/signals"
                        subtitle="MIT license. Webview UI framework and fine-grained reactivity for streaming chat."
                    />
                    <AboutRow
                        title="undici"
                        subtitle="MIT license. HTTP and WebSocket library from the Node.js project. Used as the WebSocket transport, with a custom checkServerIdentity hook for TLS pinning."
                    />
                    <AboutRow
                        title="Shiki"
                        subtitle="MIT license. Syntax highlighter (the same engine VS Code uses). Bundled via shiki/core with the JavaScript regex engine, so no wasm."
                    />
                    <AboutRow
                        title="esbuild"
                        subtitle="MIT license. Production bundler. Tree-shakes unused code, so the .vsix ships a single dist/extension.js with no node_modules."
                    />
                    <AboutRow
                        title="TypeScript"
                        subtitle="Apache 2.0 license. Type system. Strict mode, noUncheckedIndexedAccess, and exactOptionalPropertyTypes."
                    />
                </section>
            </div>
        </div>
    );
}

function AboutRow({
    title,
    subtitle,
    onClick,
}: {
    readonly title: string;
    readonly subtitle: string;
    readonly onClick?: () => void;
}) {
    if (onClick !== undefined) {
        return (
            <button
                type="button"
                class="verzeta-about__row verzeta-about__row--button"
                onClick={onClick}
            >
                <span class="verzeta-about__rowTitle">{title}</span>
                <span class="verzeta-about__rowSubtitle">{subtitle}</span>
            </button>
        );
    }
    return (
        <div class="verzeta-about__row">
            <span class="verzeta-about__rowTitle">{title}</span>
            <span class="verzeta-about__rowSubtitle">{subtitle}</span>
        </div>
    );
}
