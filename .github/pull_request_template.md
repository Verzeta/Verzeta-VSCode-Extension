<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later

Do NOT delete any section or checklist item. A PR that removes the template or
leaves the checklist blank does not meet the requirements and is flagged
automatically. If an item genuinely does not apply, tick it and add
"(N/A: reason)".
-->

## Summary

<!-- One or two sentences: what does this change do? -->

## Why

<!-- The reasoning. What problem does it solve? -->

## Linked issue

<!-- Required. Every PR must resolve an existing issue. -->

Closes #

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Documentation only

## Build and test proof

<!--
REQUIRED. Paste the real output of `npm run verify` from your machine (it runs
typecheck, lint, format, audit, build, and the test suite). Per CONTRIBUTING.md:
"If your local verify is green, CI will be green."
-->

```text
$ npm run verify
# ... paste the tail showing typecheck/lint/format/audit/build all pass ...
# ... and the test runner summary (pass count, 0 failures) ...
```

## Contributor checklist

- [ ] `npm run verify` passes locally and I pasted the proof above.
- [ ] **New feature → new tests**, or **bug fix → a regression test that fails without the fix**.
- [ ] I did **not** bypass lint/typecheck with `// eslint-disable` or `any`, and did not lower a rule in `eslint.config.mjs` / `.npmrc`.
- [ ] Every new file carries the **SPDX headers**; `reuse lint` passes.
- [ ] Wire types stay in sync with the host `wire-protocol` (no client-only ops that the host does not serve).
- [ ] If user-visible behaviour changed, I updated the relevant page under `docs/User/`.
- [ ] Commit messages follow the project style (summary + why) and each commit is **signed off** (`git commit -s`, DCO).
- [ ] I signed the [CLA](https://github.com/Verzeta/Verzeta-VSCode-Extension/blob/main/CLA.md).
- [ ] This PR does **one thing** and is not a declined category (telemetry, phone-home, forced accounts, SPDX removal, or a style-only mass change).

## Notes for the reviewer

<!-- Screenshots for webview/UI changes are appreciated. -->
