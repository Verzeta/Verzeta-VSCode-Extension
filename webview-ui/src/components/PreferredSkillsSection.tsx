// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * PreferredSkillsSection — surfaces the per-folder skill allowlist
 * + "expose only" flag. Mirrors Android `PreferredSkillsSection`
 * (ui/folders/FolderEditorSheet.kt lines 540-588) + the sub-sheet
 * (`PreferredSkillsSheet.kt`). Visible only in edit mode in
 * FolderCreateSheet.
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ Preferred skills           (2 selected)            │
 *   │ Expose only 2 preferred skills; other skills are   │
 *   │ hidden from the assistant in this project.         │
 *   │ [ ✨ Edit preferred skills ]                       │
 *   └────────────────────────────────────────────────────┘
 *
 * The button opens an inline modal listing every installed skill
 * (`SkillUi` from `skill.list`) with a checkbox per row and a final
 * "Expose only preferred" toggle. Save fires
 * `preferredSkills.setRequested` which posts skill ids +
 * expose-only flag to the host.
 */

import { useEffect, useState } from 'preact/hooks';
import type { SkillUi } from '../../../src/shared/wire-types.js';
import { skillsFor } from '../state/catalogs.js';
import { preferredSkillsFor } from '../state/preferredSkills.js';
import { send } from '../lib/bus.js';

export function PreferredSkillsSection({
    hostId,
    folderId,
}: {
    readonly hostId: string;
    readonly folderId: string;
}) {
    const allSkills = skillsFor(hostId);
    const snapshot = preferredSkillsFor(hostId, folderId);
    const [editorOpen, setEditorOpen] = useState<boolean>(false);

    useEffect(() => {
        send({ type: 'preferredSkills.requested', hostId, folderId });
    }, [hostId, folderId]);

    const explainer =
        allSkills.length === 0
            ? 'No skills installed on the host.'
            : snapshot.skillIds.length === 0
              ? 'No preference set; the assistant sees all available skills.'
              : snapshot.exposeOnly
                ? `Expose only ${snapshot.skillIds.length} preferred skill${snapshot.skillIds.length === 1 ? '' : 's'}; other skills are hidden from the assistant in this project.`
                : `Prefer ${snapshot.skillIds.length} skill${snapshot.skillIds.length === 1 ? '' : 's'}. Other skills remain available.`;

    return (
        <section class="verzeta-sheet__section">
            <div class="verzeta-hb__header">
                <h3 class="verzeta-sheet__label">Preferred skills</h3>
                <span class="verzeta-hb__count">{snapshot.skillIds.length} selected</span>
            </div>
            <div class="verzeta-skills__explain">{explainer}</div>
            <button
                type="button"
                class="verzeta-team__addBtn"
                onClick={() => setEditorOpen(true)}
                disabled={allSkills.length === 0}
                title={
                    allSkills.length === 0
                        ? 'Install skills on the host to enable preferences'
                        : 'Edit preferred skills'
                }
            >
                Edit preferred skills
            </button>
            {editorOpen ? (
                <PreferredSkillsSheet
                    hostId={hostId}
                    folderId={folderId}
                    allSkills={allSkills}
                    initialIds={snapshot.skillIds}
                    initialExposeOnly={snapshot.exposeOnly}
                    onClose={() => setEditorOpen(false)}
                />
            ) : null}
        </section>
    );
}

function PreferredSkillsSheet({
    hostId,
    folderId,
    allSkills,
    initialIds,
    initialExposeOnly,
    onClose,
}: {
    readonly hostId: string;
    readonly folderId: string;
    readonly allSkills: readonly SkillUi[];
    readonly initialIds: readonly string[];
    readonly initialExposeOnly: boolean;
    readonly onClose: () => void;
}) {
    const [selected, setSelected] = useState<readonly string[]>(initialIds);
    const [exposeOnly, setExposeOnly] = useState<boolean>(initialExposeOnly);

    const onToggle = (id: string): void => {
        setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    };

    const onSave = (): void => {
        send({
            type: 'preferredSkills.setRequested',
            hostId,
            folderId,
            skillIds: selected,
            exposeOnly,
        });
        onClose();
    };

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Preferred skills"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">Preferred skills</h3>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-addmember__body">
                    <p class="verzeta-addmember__hint">
                        Tick the skills you want the assistant to prefer in this project's
                        conversations. Use the toggle below to also hide the other skills.
                    </p>
                    <ul class="verzeta-configmember__tools" role="list">
                        {allSkills.map((skill) => {
                            const checked = selected.includes(skill.id);
                            return (
                                <li key={skill.id}>
                                    <label class="verzeta-configmember__tool">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => onToggle(skill.id)}
                                        />
                                        <span class="verzeta-configmember__toolBody">
                                            <span class="verzeta-configmember__toolName">
                                                {skill.id}
                                                {skill.version.length > 0 ? (
                                                    <span class="verzeta-team__coordTag">
                                                        v{skill.version}
                                                    </span>
                                                ) : null}
                                            </span>
                                            {skill.description.length > 0 ? (
                                                <span class="verzeta-configmember__toolDesc">
                                                    {skill.description}
                                                </span>
                                            ) : null}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                    <label class="verzeta-addmember__coordToggle">
                        <input
                            type="checkbox"
                            checked={exposeOnly}
                            onChange={(e) =>
                                setExposeOnly((e.currentTarget as HTMLInputElement).checked)
                            }
                        />
                        <span class="verzeta-addmember__coordLabel">
                            Expose only preferred skills (hide the rest from the assistant)
                        </span>
                    </label>
                </div>
                <footer class="verzeta-addmember__footer">
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                        onClick={onSave}
                    >
                        Save
                    </button>
                </footer>
            </div>
        </div>
    );
}
