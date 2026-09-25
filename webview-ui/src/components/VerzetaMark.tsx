// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * VerzetaMark renders the canonical Verzeta Studio brand mark, sourced
 * from the actual file at `webview-ui/src/assets/verzeta-studio.svg`
 * (the same brand icon shipped by the Verzeta Studio host). esbuild
 * bundles the SVG as a data: URI via the `'.svg': 'dataurl'` loader so
 * any future edit to the source file flows through without code changes
 * in this component.
 *
 * Used in the Chat header brand slot, the assistant message avatar,
 * and the Home tab brand row. Matches the Android `VerzetaMark.kt`
 * 18/28/80 dp use cases.
 */

import verzetaStudioSvg from '../assets/verzeta-studio.svg';

export function VerzetaMark({
    size = 22,
    title,
}: {
    readonly size?: number;
    readonly title?: string;
}) {
    return (
        <img
            class="verzeta-mark"
            src={verzetaStudioSvg}
            width={size}
            height={size}
            alt={title ?? ''}
            role={title !== undefined ? 'img' : 'presentation'}
            draggable={false}
        />
    );
}
