// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * SearchField — a single `<input type="search">` bound to the
 * `searchQuery` signal. Trims on input so leading/trailing
 * whitespace doesn't change the result set. ESC clears.
 */

import { searchQuery, setSearchQuery } from '../state/chatNav.js';

export function SearchField() {
    const value = searchQuery.value;
    return (
        <div class="verzeta-search">
            <input
                type="search"
                class="verzeta-search__input"
                placeholder="Search conversations"
                value={value}
                onInput={(event) => {
                    const next = (event.currentTarget as HTMLInputElement).value;
                    setSearchQuery(next);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' && value.length > 0) {
                        event.preventDefault();
                        setSearchQuery('');
                    }
                }}
                aria-label="Search conversations"
                spellcheck={false}
                autoComplete="off"
                autoCorrect="off"
            />
        </div>
    );
}
