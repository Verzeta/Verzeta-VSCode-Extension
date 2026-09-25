// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Verzeta VS Code Extension — esbuild bundler config.
 *
 * Builds TWO independent targets:
 *
 *   1. The extension host bundle — `src/extension/extension.ts` →
 *      `dist/extension.js` (CommonJS, node22 target, `vscode`
 *      external).
 *
 *   2. The webview UI bundle — `webview-ui/src/main.tsx` →
 *      `dist/webview/index.js` + `dist/webview/index.css` (ESM,
 *      browser target, Preact JSX). The bundle ships Preact +
 *      `@preact/signals` inline — there are NO external imports,
 *      no CDN fetches, no third-party scripts loaded at runtime.
 *
 * CLI flags:
 *   --watch        rebuild on change (both targets)
 *   --production   minify + drop source maps
 *   --extension    build only the extension host target
 *   --webview      build only the webview target
 *
 * The defaults build BOTH targets sequentially.
 */

import * as esbuild from 'esbuild';
import { argv } from 'node:process';

const watch = argv.includes('--watch');
const production = argv.includes('--production');
const onlyExtension = argv.includes('--extension');
const onlyWebview = argv.includes('--webview');

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
    entryPoints: ['src/extension/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: !production,
    minify: production,
    treeShaking: true,
    logLevel: 'info',
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
    entryPoints: ['webview-ui/src/main.tsx'],
    bundle: true,
    outdir: 'dist/webview',
    entryNames: 'index',
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    sourcemap: !production,
    minify: production,
    treeShaking: true,
    logLevel: 'info',
    loader: {
        '.css': 'css',
        // Brand SVGs ship as data: URIs so the actual file in
        // `webview-ui/src/assets/` is the single source of truth —
        // no manual path extraction, no drift. The webview CSP
        // already allows `img-src ... data:` (see htmlShell.ts).
        '.svg': 'dataurl',
    },
};

const targets = [];
if (!onlyWebview) targets.push({ name: 'extension', config: extensionConfig });
if (!onlyExtension) targets.push({ name: 'webview', config: webviewConfig });

if (watch) {
    const ctxs = await Promise.all(
        targets.map(async ({ name, config }) => ({
            name,
            ctx: await esbuild.context(config),
        })),
    );
    await Promise.all(ctxs.map(({ ctx }) => ctx.watch()));
    console.log(`esbuild: watching [${targets.map((t) => t.name).join(', ')}]`);
} else {
    for (const { name, config } of targets) {
        await esbuild.build(config);
        console.log(`esbuild: built ${name} target (production=${production})`);
    }
}
