<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Contributing to the Verzeta VS Code Extension

Thanks for considering a contribution. Before opening a pull
request, please read the engineering standards that govern this
repository. They are not boilerplate; every rule has been earned.

## What we expect

- **Code standards.** Every source file, class, and public method
  carries a documentation header. Keep responsibilities separated
  by layer, keep functions focused, and add tests for new
  behaviour.
- **Commit discipline.** One commit per clear intent (one phase,
  one fix, one refactor) with a descriptive message.
- **Supply-chain posture.** The npm security posture is strict:
  `ignore-scripts=true`, exact-pinned versions, no native modules,
  no LLM SDKs. Read the section below before adding any dependency.
- **Security reports.** See [SECURITY.md](SECURITY.md) for how to
  report a security issue privately.

## Setting up locally

```bash
# Pin Node version
nvm use                 # reads .nvmrc; installs Node 22.11.0 if absent

# Install dependencies with lockfile-strict + scripts disabled
npm ci

# Run the full verification chain
npm run verify
```

`npm ci` refuses to install if `package.json` and
`package-lock.json` are out of sync. This is intentional. If you
need to add a dependency, justify it in the PR description: why it
is needed, why no existing dependency covers it, and the output of
`npm audit` and `npm audit signatures` for the new package.

## Local verification gate

Before every commit:

```bash
npm run verify
```

This is the same chain CI runs:

1. `npm run typecheck`: TypeScript strict mode
2. `npm run lint`: ESLint + forbidden-imports
3. `npm run format`: Prettier check
4. `npm run audit`: `npm audit --audit-level=moderate`
5. `npm run audit:signatures`: `npm audit signatures`
6. `npm run build`: esbuild bundle
7. `npm run test`: Node native test runner

If your local verify is green, CI should be green too.

## Pull-request expectations

A pull request has the best chance of being accepted when it:

- Has a clear single intent (one phase, one fix, one refactor)
- Has a descriptive commit message with a single clear intent
- Passes `npm run verify` locally
- Adds tests for new behaviour
- Updates documentation when the public API or user-visible
  behaviour changes
- Does not introduce new dependencies without the
  supply-chain-checklist evidence in the PR description

A pull request will be **rejected** if it:

- Bypasses lint or typecheck with `// eslint-disable-line` or
  `// @ts-ignore` without a written rationale
- Adds a runtime dependency without supply-chain review
- Adds a development dependency with lifecycle scripts
- Adds a native module
- Adds an LLM SDK
- Lowers any rule in `.npmrc` or `eslint.config.js`
- Adds telemetry / analytics
- Relaxes a project standard without a separately justified PR

## Reviews

Reviews happen as time allows, and response times vary. If your pull
request has had no response, a follow-up comment is welcome.

## Reporting bugs

Public bugs (UI / behaviour issues, not security) go in the
project's issue tracker. Please include:

- Extension version
- VS Code version
- Verzeta Studio host version
- Steps to reproduce
- Expected vs actual behaviour
- Relevant entries from the Verzeta Output Channel

For security issues, see [SECURITY.md](SECURITY.md).

## Licensing and the CLA

Verzeta is released under a triple-license arrangement: GPL-3.0-or-later
for the host's differentiated components, LGPL-3.0-or-later for supporting
infrastructure, and commercial licenses for organisations that do not want
either copyleft variant. This extension is entirely in the LGPL
infrastructure tier; see [LICENSING.md](LICENSING.md).

Operating the commercial track requires the project owner to hold the
right to relicense contributed code. Contributors therefore sign a
Contributor License Agreement that:

- **Assigns** copyright in the contribution to the project owner. This is
  an assignment, not a license grant. You retain a non-exclusive right to
  use your own contribution in your own separate work under any license
  you choose.
- Grants a perpetual, irrevocable, royalty-free patent licence (with the
  standard patent-retaliation clause).
- Warrants that the contribution is your own work and free of third-party
  encumbrances.

The full text and the sign-off mechanism are in [CLA.md](CLA.md). Every
pull request must be signed off by every author before merge; the CLA bot
guides first-time contributors through the one-time acceptance.

Every file in your contribution must carry the SPDX headers
(`SPDX-FileCopyrightText` plus `SPDX-License-Identifier: LGPL-3.0-or-later`).
The project is [REUSE 3.0](https://reuse.software/) compliant; run
`reuse lint` to verify.
