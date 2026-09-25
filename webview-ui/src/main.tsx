// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Webview entry point — bundled by esbuild into dist/webview/index.js.
 *
 * Mounts the Preact `<App />` into the `#root` div the HTML shell
 * (`src/extension/webview/htmlShell.ts`) renders. The CSS import is
 * picked up by esbuild's CSS bundling and emitted as
 * `dist/webview/index.css` alongside the JS.
 */

import { render } from 'preact';
import './styles/global.css';
import './styles/tabs.css';
import './styles/home.css';
import './styles/chat.css';
import './styles/settings.css';
import { App } from './App.js';

const root = document.getElementById('root');
if (root !== null) {
    // Replace the boot placeholder the HTML shell rendered.
    root.innerHTML = '';
    render(<App />, root);
}
