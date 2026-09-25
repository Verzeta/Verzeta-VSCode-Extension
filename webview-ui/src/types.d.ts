// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Ambient type declarations for the webview app.
 *
 * esbuild handles `import './foo.css'` as a side-effect import and
 * emits a sibling `.css` next to the bundled `.js`. TypeScript needs
 * an ambient module declaration to accept the import shape.
 */

declare module '*.css';

/**
 * `.svg` files are bundled by esbuild as data URIs (see
 * esbuild.config.mjs `'.svg': 'dataurl'`). Importing one returns
 * the encoded string suitable for an `<img src>` attribute.
 */
declare module '*.svg' {
    const dataUri: string;
    export default dataUri;
}
