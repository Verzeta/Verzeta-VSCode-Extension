// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * members: roster checks shared by the folder, group and Quick Start
 * sheets. The extension refuses a roster with an empty alias and drops
 * the whole request, so each sheet disables Save until every row has one.
 */

/**
 * Whether any roster row has an alias that is empty after trimming.
 *
 * @param members the roster rows being edited.
 * @returns true when at least one alias is blank.
 */
export function hasBlankAlias(members: readonly { readonly alias: string }[]): boolean {
    return members.some((m) => m.alias.trim().length === 0);
}

/** Tooltip shown on a disabled Save button while an alias is blank. */
export const BLANK_ALIAS_HINT = 'Give every member an alias';
