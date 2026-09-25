// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type {
    ProjectTemplateRosterMemberUi,
    ProjectTemplateUi,
} from '../../../src/shared/wire-types.js';
import { activeHostId } from '../state/hosts.js';
import {
    projectTemplatesAllFor,
    projectTemplatesFor,
    templateRosterFor,
} from '../state/projectTemplates.js';
import { closeTemplateDetail, templateDetailOpen } from '../state/projectRoomsUi.js';
import { openQuickStart } from '../state/projectQuickStart.js';
import { send } from '../lib/bus.js';

export function ProjectTemplateDetailSheet() {
    const id = templateDetailOpen.value;
    if (id === null) return null;
    const hostId = activeHostId.value;
    if (hostId === undefined) {
        closeTemplateDetail();
        return null;
    }
    return <DetailBody hostId={hostId} templateId={id} />;
}

function DetailBody({
    hostId,
    templateId,
}: {
    readonly hostId: string;
    readonly templateId: string;
}) {
    const all = projectTemplatesAllFor(hostId);
    const landing = projectTemplatesFor(hostId);
    const template = useMemo<ProjectTemplateUi | undefined>(
        () => all.find((t) => t.id === templateId) ?? landing.find((t) => t.id === templateId),
        [all, landing, templateId],
    );
    const roster = templateRosterFor(hostId, templateId);
    const [saveOpen, setSaveOpen] = useState<boolean>(false);
    const [confirmDelete, setConfirmDelete] = useState<boolean>(false);

    useEffect(() => {
        send({ type: 'template.roster.requested', hostId, templateId });
    }, [hostId, templateId]);

    if (template === undefined) {
        return (
            <div
                class="verzeta-addmember-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label="Template detail"
                onClick={(e) => {
                    if (e.target === e.currentTarget) closeTemplateDetail();
                }}
            >
                <div class="verzeta-addmember">
                    <header class="verzeta-addmember__header">
                        <h3 class="verzeta-addmember__title">Template not found</h3>
                        <button
                            type="button"
                            class="verzeta-sheet__close"
                            onClick={closeTemplateDetail}
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </header>
                    <div class="verzeta-addmember__body">
                        <p class="verzeta-prooms__empty">
                            The catalog hasn't loaded yet. Try opening the Template Library first.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Template detail"
            onClick={(e) => {
                if (e.target === e.currentTarget) closeTemplateDetail();
            }}
        >
            <div class="verzeta-tpldetail">
                <header class="verzeta-tpldetail__header">
                    <h3 class="verzeta-addmember__title">{template.name || template.id}</h3>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={closeTemplateDetail}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-tpldetail__body">
                    <div class="verzeta-tpldetail__chips">
                        {template.category.length > 0 ? (
                            <span class="verzeta-tpldetail__chip">{template.category}</span>
                        ) : null}
                        {template.tagLabel.length > 0 ? (
                            <span class="verzeta-tpldetail__chip">{template.tagLabel}</span>
                        ) : null}
                        {template.isUserSaved ? (
                            <span class="verzeta-libcard__badge">User-saved</span>
                        ) : (
                            <span class="verzeta-libcard__badge verzeta-libcard__badge--builtin">
                                Built-in
                            </span>
                        )}
                        {template.isPinned ? (
                            <span class="verzeta-tpldetail__chip">★ Pinned</span>
                        ) : null}
                    </div>
                    {template.scenario.length > 0 ? (
                        <Section label="Scenario" body={template.scenario} />
                    ) : null}
                    {template.goal.length > 0 ? (
                        <Section label="Goal" body={template.goal} />
                    ) : null}
                    {template.description.length > 0 ? (
                        <Section label="Description" body={template.description} />
                    ) : null}
                    <Section
                        label={`Roster (${roster.length})`}
                        body={roster.length === 0 ? 'Loading…' : ''}
                    >
                        {roster.length > 0 ? <RosterList roster={roster} /> : null}
                    </Section>
                </div>
                <footer class="verzeta-addmember__footer">
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--primary"
                        onClick={() => {
                            closeTemplateDetail();
                            openQuickStart({
                                templateId,
                                name: template.name,
                                scenario: template.scenario,
                                goal: template.goal,
                                description: template.description,
                                members: [],
                            });
                        }}
                    >
                        Quick Start
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={() =>
                            send({
                                type: 'template.pinRequested',
                                hostId,
                                templateId,
                                pinned: !template.isPinned,
                            })
                        }
                    >
                        {template.isPinned ? '★ Unpin' : '☆ Pin'}
                    </button>
                    <button
                        type="button"
                        class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                        onClick={() => setSaveOpen(true)}
                    >
                        Save as new
                    </button>
                    {template.isUserSaved ? (
                        <button
                            type="button"
                            class="verzeta-sheet__btn verzeta-sheet__btn--danger"
                            onClick={() => setConfirmDelete(true)}
                        >
                            Delete
                        </button>
                    ) : null}
                </footer>
            </div>
            {saveOpen ? (
                <SaveAsNewDialog
                    source={template}
                    onCancel={() => setSaveOpen(false)}
                    onSubmit={(edits) => {
                        send({
                            type: 'template.saveAsNewRequested',
                            hostId,
                            sourceTemplateId: templateId,
                            name: edits.name,
                            scenario: edits.scenario,
                            goal: edits.goal,
                            description: edits.description,
                            // The Read More detail dialog doesn't
                            // edit the roster — empty roster ride
                            // means "use the source template's
                            // existing roster".
                            members: [],
                        });
                        setSaveOpen(false);
                    }}
                />
            ) : null}
            {confirmDelete ? (
                <div
                    class="verzeta-addmember-backdrop"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Confirm delete"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setConfirmDelete(false);
                    }}
                >
                    <div class="verzeta-addmember">
                        <header class="verzeta-addmember__header">
                            <h3 class="verzeta-addmember__title">Delete template?</h3>
                        </header>
                        <div class="verzeta-addmember__body">
                            <p>
                                "{template.name || template.id}" will be removed from your library.
                            </p>
                        </div>
                        <footer class="verzeta-addmember__footer">
                            <button
                                type="button"
                                class="verzeta-sheet__btn verzeta-sheet__btn--secondary"
                                onClick={() => setConfirmDelete(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                class="verzeta-sheet__btn verzeta-sheet__btn--danger"
                                onClick={() => {
                                    send({
                                        type: 'template.deleteRequested',
                                        hostId,
                                        templateId,
                                    });
                                    setConfirmDelete(false);
                                    closeTemplateDetail();
                                }}
                            >
                                Delete
                            </button>
                        </footer>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function Section({
    label,
    body,
    children,
}: {
    readonly label: string;
    readonly body: string;
    readonly children?: ComponentChildren;
}) {
    return (
        <section class="verzeta-tpldetail__section">
            <h4 class="verzeta-tpldetail__label">{label}</h4>
            {body.length > 0 ? <p class="verzeta-tpldetail__body-text">{body}</p> : null}
            {children}
        </section>
    );
}

function RosterList({ roster }: { readonly roster: readonly ProjectTemplateRosterMemberUi[] }) {
    return (
        <ul class="verzeta-tpldetail__roster" role="list">
            {roster.map((m) => (
                <li key={`${m.agentId}::${m.alias}`} class="verzeta-tpldetail__rosterRow">
                    <span class="verzeta-tpldetail__rosterAlias">{m.alias}</span>
                    {m.agentName.length > 0 && m.agentName !== m.alias ? (
                        <span class="verzeta-tpldetail__rosterAgent">· {m.agentName}</span>
                    ) : null}
                    {m.isCoordinator ? (
                        <span class="verzeta-team__coordTag">★ Coordinator</span>
                    ) : null}
                    {m.modelProvider.length > 0 && m.modelName.length > 0 ? (
                        <span class="verzeta-tpldetail__rosterModel">
                            {m.modelProvider}/{m.modelName}
                        </span>
                    ) : null}
                </li>
            ))}
        </ul>
    );
}

function SaveAsNewDialog({
    source,
    onCancel,
    onSubmit,
}: {
    readonly source: ProjectTemplateUi;
    readonly onCancel: () => void;
    readonly onSubmit: (edits: {
        readonly name: string;
        readonly scenario: string;
        readonly goal: string;
        readonly description: string;
    }) => void;
}) {
    const [name, setName] = useState<string>(`${source.name} (copy)`);
    const [scenario, setScenario] = useState<string>(source.scenario);
    const [goal, setGoal] = useState<string>(source.goal);
    const [description, setDescription] = useState<string>(source.description);

    return (
        <div
            class="verzeta-addmember-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Save as new template"
            onClick={(e) => {
                if (e.target === e.currentTarget) onCancel();
            }}
        >
            <div class="verzeta-addmember">
                <header class="verzeta-addmember__header">
                    <h3 class="verzeta-addmember__title">Save as new template</h3>
                    <button
                        type="button"
                        class="verzeta-sheet__close"
                        onClick={onCancel}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </header>
                <div class="verzeta-addmember__body">
                    <p class="verzeta-addmember__hint">
                        The new template inherits the source roster. Edit any field below to
                        customise; leave blank to keep the source value.
                    </p>
                    <label class="verzeta-sheet__numberfield">
                        <span class="verzeta-sheet__numberlabel">Name</span>
                        <input
                            type="text"
                            class="verzeta-sheet__numberinput"
                            value={name}
                            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
                        />
                    </label>
                    <label class="verzeta-sheet__numberfield">
                        <span class="verzeta-sheet__numberlabel">Scenario</span>
                        <textarea
                            class="verzeta-sheet__textarea"
                            rows={2}
                            value={scenario}
                            onInput={(e) =>
                                setScenario((e.currentTarget as HTMLTextAreaElement).value)
                            }
                        />
                    </label>
                    <label class="verzeta-sheet__numberfield">
                        <span class="verzeta-sheet__numberlabel">Goal</span>
                        <textarea
                            class="verzeta-sheet__textarea"
                            rows={2}
                            value={goal}
                            onInput={(e) => setGoal((e.currentTarget as HTMLTextAreaElement).value)}
                        />
                    </label>
                    <label class="verzeta-sheet__numberfield">
                        <span class="verzeta-sheet__numberlabel">Description</span>
                        <textarea
                            class="verzeta-sheet__textarea"
                            rows={3}
                            value={description}
                            onInput={(e) =>
                                setDescription((e.currentTarget as HTMLTextAreaElement).value)
                            }
                        />
                    </label>
                </div>
                <footer class="verzeta-addmember__footer">
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
                        onClick={() => onSubmit({ name, scenario, goal, description })}
                        disabled={name.trim().length === 0}
                    >
                        Save
                    </button>
                </footer>
            </div>
        </div>
    );
}
