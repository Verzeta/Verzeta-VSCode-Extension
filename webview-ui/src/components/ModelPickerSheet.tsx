// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ModelPickerSheet — full-height sheet that lists every provider +
 * model the host advertises and lets the user pick the active one.
 * Mirrors Android `ModelPickerSheet` (see
 * `ChatScreen.kt:163`). Opens behind the chat-header subtitle and
 * behind the Conversation Settings Model section's "Change" button.
 *
 * Layout:
 *   - Header: title + close button (mirrors ConversationSettingsSheet).
 *   - Body: one section per provider that has at least one model,
 *     each row clickable, the active row highlighted. Per-capability
 *     glyphs (streaming / tools / vision) live next to the provider
 *     display-name.
 *   - Footer: Cancel button.
 *
 * Clicking a row posts `models.setActiveRequested`. The host emits
 * `models.active_changed` when the switch lands; that envelope
 * updates the cached catalog so the chat-header subtitle reflects
 * the new selection without a refetch.
 */

import { useEffect, useState } from 'preact/hooks';
import type { ProviderUi } from '../../../src/shared/wire-types.js';
import { activeHostId } from '../state/hosts.js';
import { closeModelPickerSheet } from '../state/chatUi.js';
import { modelCatalogFor } from '../state/models.js';
import { send } from '../lib/bus.js';

export function ModelPickerSheet() {
    const hostId = activeHostId.value;
    const catalog = hostId !== undefined ? modelCatalogFor(hostId) : undefined;
    const [query, setQuery] = useState<string>('');

    // Defensive refetch — if the catalog was never primed (e.g. the
    // host added providers after sessionReady), trigger one now so
    // the picker has something to render.
    useEffect(() => {
        if (hostId === undefined) return;
        if (catalog === undefined || catalog.providers.length === 0) {
            send({ type: 'models.catalog.requested', hostId });
        }
    }, [hostId, catalog?.providers.length]);

    if (hostId === undefined) {
        return (
            <section class="verzeta-sheet" role="dialog" aria-label="Pick a model">
                <SheetHeader />
                <div class="verzeta-sheet__empty">No host selected.</div>
                <SheetFooter />
            </section>
        );
    }

    const allProviders = (catalog?.providers ?? []).filter((p) => p.models.length > 0);
    const activeProvider = catalog?.activeProvider ?? '';
    const activeModel = catalog?.activeModel ?? '';

    // Search: case-insensitive substring across provider displayName,
    // providerId, and model name. Each provider's models are filtered
    // independently; providers with zero matches drop out. Mirrors
    // the FilterField pattern Android uses for the same picker.
    const filter = query.trim().toLowerCase();
    const filteredProviders =
        filter.length === 0
            ? allProviders
            : allProviders
                  .map((p) => {
                      const providerMatches =
                          p.displayName.toLowerCase().includes(filter) ||
                          p.providerId.toLowerCase().includes(filter);
                      if (providerMatches) {
                          // Provider name matches — surface all its models.
                          return p;
                      }
                      const matchingModels = p.models.filter((m) =>
                          m.toLowerCase().includes(filter),
                      );
                      if (matchingModels.length === 0) return null;
                      return { ...p, models: matchingModels };
                  })
                  .filter((p): p is ProviderUi => p !== null);

    const totalMatches = filteredProviders.reduce((sum, p) => sum + p.models.length, 0);

    const onPick = (providerId: string, modelName: string): void => {
        send({ type: 'models.setActiveRequested', hostId, providerId, modelName });
        closeModelPickerSheet();
    };

    return (
        <section class="verzeta-sheet" role="dialog" aria-label="Pick a model">
            <SheetHeader />
            <div class="verzeta-modelpicker__searchbar">
                <SearchIcon />
                <input
                    type="text"
                    class="verzeta-modelpicker__search"
                    placeholder="Search providers and models…"
                    value={query}
                    onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
                    aria-label="Filter providers and models"
                    autoFocus
                />
                {filter.length > 0 ? (
                    <button
                        type="button"
                        class="verzeta-modelpicker__searchclear"
                        onClick={() => setQuery('')}
                        title="Clear filter"
                        aria-label="Clear filter"
                    >
                        ✕
                    </button>
                ) : null}
                {filter.length > 0 ? (
                    <span class="verzeta-modelpicker__searchcount">
                        {totalMatches} {totalMatches === 1 ? 'match' : 'matches'}
                    </span>
                ) : null}
            </div>
            <div class="verzeta-sheet__body">
                {allProviders.length === 0 ? (
                    <div class="verzeta-sheet__empty">
                        No providers configured on this host. Add one from the Verzeta Studio
                        desktop app.
                    </div>
                ) : filteredProviders.length === 0 ? (
                    <div class="verzeta-sheet__empty">No models match &ldquo;{query}&rdquo;.</div>
                ) : (
                    filteredProviders.map((p) => (
                        <ProviderSection
                            key={p.providerId}
                            provider={p}
                            activeProvider={activeProvider}
                            activeModel={activeModel}
                            onPick={onPick}
                        />
                    ))
                )}
            </div>
            <SheetFooter />
        </section>
    );
}

function SearchIcon() {
    return (
        <svg
            class="verzeta-modelpicker__searchicon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
        >
            <circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="1.8" />
            <path d="M20 20l-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
    );
}

function SheetHeader() {
    return (
        <header class="verzeta-sheet__header">
            <h2 class="verzeta-sheet__title">Pick a model</h2>
            <button
                type="button"
                class="verzeta-sheet__close"
                onClick={closeModelPickerSheet}
                aria-label="Close"
            >
                ✕
            </button>
        </header>
    );
}

function SheetFooter() {
    return (
        <footer class="verzeta-modelpicker__footer">
            <button
                type="button"
                class="verzeta-modelpicker__cancel"
                onClick={closeModelPickerSheet}
            >
                Cancel
            </button>
        </footer>
    );
}

function ProviderSection({
    provider,
    activeProvider,
    activeModel,
    onPick,
}: {
    readonly provider: ProviderUi;
    readonly activeProvider: string;
    readonly activeModel: string;
    readonly onPick: (providerId: string, modelName: string) => void;
}) {
    return (
        <section class="verzeta-modelpicker__provider">
            <div class="verzeta-modelpicker__providerHeader">
                <span class="verzeta-modelpicker__providerName">{provider.displayName}</span>
                <CapabilityGlyphs provider={provider} />
            </div>
            <ul class="verzeta-modelpicker__models" role="list">
                {provider.models.map((model) => {
                    const isActive =
                        provider.providerId === activeProvider && model === activeModel;
                    const cls = isActive
                        ? 'verzeta-modelpicker__model verzeta-modelpicker__model--active'
                        : 'verzeta-modelpicker__model';
                    return (
                        <li key={model}>
                            <button
                                type="button"
                                class={cls}
                                onClick={() => onPick(provider.providerId, model)}
                                aria-pressed={isActive}
                            >
                                <span class="verzeta-modelpicker__modelName">{model}</span>
                                {isActive ? (
                                    <span
                                        class="verzeta-modelpicker__activeBadge"
                                        aria-label="Active model"
                                    >
                                        ✓
                                    </span>
                                ) : null}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function CapabilityGlyphs({ provider }: { readonly provider: ProviderUi }) {
    const items: { readonly key: string; readonly label: string; readonly glyph: string }[] = [];
    if (provider.supportsStreaming) {
        items.push({ key: 'stream', label: 'Streaming', glyph: '⚡' });
    }
    if (provider.supportsToolCalling) {
        items.push({ key: 'tools', label: 'Tool calling', glyph: '🔧' });
    }
    if (provider.supportsVision) {
        items.push({ key: 'vision', label: 'Vision', glyph: '👁' });
    }
    if (items.length === 0) return null;
    return (
        <span class="verzeta-modelpicker__caps" aria-hidden="false">
            {items.map((i) => (
                <span key={i.key} class="verzeta-modelpicker__cap" title={i.label}>
                    {i.glyph}
                </span>
            ))}
        </span>
    );
}
