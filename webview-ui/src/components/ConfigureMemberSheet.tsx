// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * ConfigureMemberSheet — per-member provider + model + tools
 * whitelist editor opened from a row's Configure button.
 *
 * Direct port of Android `MembershipEditor.ConfigureMemberSheet`
 * (lines 547-752 of `ui/projectrooms/MembershipEditor.kt`). Fields:
 *
 *   - Provider override: "(Use conversation default)" or pick from
 *     `modelCatalog.providers[]`. Glyph row shows capability flags
 *     (streaming / tools / vision / custom).
 *   - Model override: only when provider is set. "(Use provider
 *     default)" or pick from the provider's `models[]`.
 *   - Tool whitelist: checkbox per tool. Empty whitelist means
 *     "inherit — all tools available" (NOT "no tools").
 *
 * Apply mutates the parent's DraftMember; Cancel discards the local
 * draft.
 */

import { useMemo, useState } from 'preact/hooks';
import type { ProviderUi, ToolUi } from '../../../src/shared/wire-types.js';

export interface ConfigureMemberDraft {
    readonly alias: string;
    readonly modelProvider: string;
    readonly modelName: string;
    readonly allowedTools: readonly string[];
}

export function ConfigureMemberSheet({
    member,
    providers,
    availableTools,
    onApply,
    onCancel,
}: {
    readonly member: ConfigureMemberDraft;
    readonly providers: readonly ProviderUi[];
    readonly availableTools: readonly ToolUi[];
    readonly onApply: (provider: string, model: string, tools: readonly string[]) => void;
    readonly onCancel: () => void;
}) {
    const [provider, setProvider] = useState<string>(member.modelProvider);
    const [model, setModel] = useState<string>(member.modelName);
    const [tools, setTools] = useState<readonly string[]>(member.allowedTools);

    const modelsForProvider = useMemo(() => {
        if (provider.length === 0) return [] as readonly string[];
        const p = providers.find((x) => x.providerId === provider);
        return p?.models ?? [];
    }, [provider, providers]);

    const onProviderPick = (next: string): void => {
        setProvider(next);
        // Resetting provider also resets the model (the new provider
        // probably doesn't have the previously-picked model in its
        // catalog). Mirrors Android line 645-648.
        setModel('');
    };

    const onToggleTool = (toolName: string): void => {
        setTools(
            tools.includes(toolName) ? tools.filter((t) => t !== toolName) : [...tools, toolName],
        );
    };

    return (
        <div
            class="verzeta-configmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={`Configure @${member.alias}`}
            onClick={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div class="verzeta-configmember">
                <header class="verzeta-configmember__header">
                    <h3 class="verzeta-configmember__title">Configure @{member.alias}</h3>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={onCancel}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-configmember__body">
                    <p class="verzeta-configmember__intro">
                        Override the provider, model, and tool whitelist for this member. Other
                        members in the same chat are unaffected.
                    </p>

                    <section class="verzeta-configmember__section">
                        <h4 class="verzeta-configmember__label">Provider override</h4>
                        <ProviderSelect
                            providers={providers}
                            value={provider}
                            onChange={onProviderPick}
                        />
                    </section>

                    {provider.length > 0 ? (
                        <section class="verzeta-configmember__section">
                            <h4 class="verzeta-configmember__label">Model override</h4>
                            <ModelSelect
                                models={modelsForProvider}
                                value={model}
                                onChange={setModel}
                            />
                        </section>
                    ) : null}

                    <section class="verzeta-configmember__section">
                        <h4 class="verzeta-configmember__label">Tool whitelist</h4>
                        <p class="verzeta-configmember__hint">
                            Tick the tools this member is allowed to call. Leave all unticked to
                            inherit (all tools available).
                        </p>
                        {availableTools.length === 0 ? (
                            <p class="verzeta-configmember__empty">
                                No tools loaded. Catalogs may still be loading.
                            </p>
                        ) : (
                            <ul class="verzeta-configmember__tools" role="list">
                                {availableTools.map((tool) => {
                                    const checked = tools.includes(tool.name);
                                    return (
                                        <li key={tool.name}>
                                            <label class="verzeta-configmember__tool">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => onToggleTool(tool.name)}
                                                />
                                                <span class="verzeta-configmember__toolBody">
                                                    <span class="verzeta-configmember__toolName">
                                                        {tool.name}
                                                    </span>
                                                    {tool.description.length > 0 ? (
                                                        <span class="verzeta-configmember__toolDesc">
                                                            {tool.description}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </label>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </section>
                </div>
                <footer class="verzeta-configmember__footer">
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                        onClick={() => onApply(provider, model, tools)}
                    >
                        Apply
                    </button>
                </footer>
            </div>
        </div>
    );
}

function ProviderSelect({
    providers,
    value,
    onChange,
}: {
    readonly providers: readonly ProviderUi[];
    readonly value: string;
    readonly onChange: (next: string) => void;
}) {
    return (
        <div class="verzeta-configmember__select">
            <select
                value={value}
                onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
            >
                <option value="">(Use conversation default)</option>
                {providers.map((p) => (
                    <option key={p.providerId} value={p.providerId}>
                        {p.displayName.length > 0 ? p.displayName : p.providerId}
                    </option>
                ))}
            </select>
            {value.length > 0 ? <ProviderCaps providers={providers} value={value} /> : null}
        </div>
    );
}

function ProviderCaps({
    providers,
    value,
}: {
    readonly providers: readonly ProviderUi[];
    readonly value: string;
}) {
    const p = providers.find((x) => x.providerId === value);
    if (p === undefined) return null;
    const caps: string[] = [];
    if (p.supportsStreaming) caps.push('streaming');
    if (p.supportsToolCalling) caps.push('tools');
    if (p.supportsVision) caps.push('vision');
    if (caps.length === 0) return null;
    return <p class="verzeta-configmember__caps">{caps.join(' · ')}</p>;
}

function ModelSelect({
    models,
    value,
    onChange,
}: {
    readonly models: readonly string[];
    readonly value: string;
    readonly onChange: (next: string) => void;
}) {
    return (
        <div class="verzeta-configmember__select">
            <select
                value={value}
                onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
            >
                <option value="">(Use provider default)</option>
                {models.map((m) => (
                    <option key={m} value={m}>
                        {m}
                    </option>
                ))}
            </select>
        </div>
    );
}
