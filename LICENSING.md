<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Licensing

Verzeta™ for VS Code is the editor companion client for [Verzeta™ Studio](https://github.com/Verzeta), which is released under a triple-license arrangement (GPL / LGPL / commercial). This repository follows the same framework, but because every file here classifies into the framework's _infrastructure_ tier, the practical outcome is simple: **this entire repository is LGPL-3.0-or-later.**

For the legal text, see the [`LICENSES/`](LICENSES/) directory. For the source-of-truth per-file declaration, look at the SPDX license-identifier line at the top of each source file; the project is [REUSE 3.0](https://reuse.software/) compliant.

---

## The short version

| You want to…                                                      | License path                                                                                                                                                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use the Verzeta VS Code extension as an end user                  | No action needed. Just install and use.                                                                                                                                    |
| Read, study, modify the source for personal or research use       | LGPL covers it.                                                                                                                                                            |
| Fork the extension and publish your fork                          | Allowed under LGPL. Keep the SPDX headers, honour the LGPL source-availability obligations, and don't use the "Verzeta" name or logo (see [TRADEMARKS.md](TRADEMARKS.md)). |
| Embed this code into another open-source project                  | LGPL: dynamic-link under LGPL §6.                                                                                                                                          |
| Use this code in a closed-source product without LGPL obligations | Buy a commercial license (Utils tier). Contact `hello@verzeta.com` with the subject prefix `[Verzeta Commercial]`.                                                         |
| Contribute a patch upstream                                       | Sign the [CLA.md](CLA.md).                                                                                                                                                 |

---

## How this repo maps onto the Verzeta triple-license

The Verzeta Studio host project classifies its code into three tracks:

1. **GPL-3.0-or-later**: the host's _moat_ (RAGP, multi-agent cascade, task orchestration, …). **No file in this repository is in that track.** The VS Code extension is a wire-protocol client and UI; it contains none of the moat components. That is also why `LICENSES/` here carries no GPL text, because REUSE 3.0 forbids shipping license files that no file in the project uses. The GPL tier lives host-side; see the host repository's `LICENSING.md` for its per-component breakdown.

2. **LGPL-3.0-or-later**: the _infrastructure_ tier: wire-protocol plumbing, generic models, UI components, build tooling, tests. The host's classification places client + UI code squarely here, and that is everything this repository contains:
    - The WebSocket wire-protocol client and RPC handlers (`src/extension/wire/`, `src/shared/`).
    - The extension-host services: hosts, conversations, workspace-mount, IDE-integration commands (`src/extension/`).
    - The entire Preact webview UI and its state holders (`webview-ui/`).
    - The extension shell, build configuration (esbuild + tsconfig), and the test suite.

    LGPL means: you can link these files into a proprietary or differently-licensed work, provided you honour LGPL §6 (allow the user to replace the LGPL'd component, make the component's source available, etc.).

3. **Commercial licenses**: for organisations that don't want copyleft obligations. For this repository only the **Utils** tier is relevant (it licenses you out of the LGPL §6 obligations); the **Full-stack** tier matters only if you also embed the host's GPL moat. Terms are individually negotiated; write to `hello@verzeta.com` with the subject prefix `[Verzeta Commercial]`. Both tiers carry mandatory attribution and do **not** by themselves authorise use of the Verzeta name or logo (see [TRADEMARKS.md](TRADEMARKS.md)).

Third-party npm dependencies are not part of this source tree (they are fetched at build time, not vendored) and keep their own upstream licenses; they are deliberately not relicensed. The build only depends on packages whose licenses are LGPL-compatible; `npm run audit:signatures` and the dependency review in `SECURITY.md` guard that boundary.

---

## What this means in practice

### For end users

You don't need a license to use the extension. Install it, run it, share it. The licensing framework is a developer / integrator concern, not an end-user concern.

### For the VSIX you install

A built Verzeta `.vsix` package contains only LGPL-classified Verzeta code plus third-party dependencies under their own (LGPL-compatible) licenses. Unlike the host desktop binary, there is no GPL-classified object code in the package.

### For your fork

A community fork is permitted under LGPL. To stay legal:

- Preserve every SPDX header line at the top of each file.
- Honour LGPL §6 if you ship a built extension: make the corresponding source of the LGPL'd components available, or provide a relink mechanism.
- Do not call your fork "Verzeta", reuse its `publisher.name` package identity, or use the Verzeta logo. Pick a different name. See [TRADEMARKS.md](TRADEMARKS.md).

### For your contribution

To contribute a patch upstream, you sign the [CLA.md](CLA.md). The CLA assigns copyright in your contribution to the project owner. This is what keeps the commercial-license track operable across the whole Verzeta project. If you prefer your change to exist under LGPL only, ship it from a fork instead; we can't take a contribution that splits ownership across the triple-license.

---

## Frequently asked

**Q. The host is triple-licensed, so why is this repo effectively single-licensed?**

Because classification is per-file, not per-repo, and every file here lands in the infrastructure tier. The framework is shared; the outcome differs because the code differs. If a future component of the extension were classified as moat, its files would carry GPL SPDX headers and the GPL text would be added to `LICENSES/` at that point.

**Q. Is this still "open source" given the commercial track?**

Yes. LGPL-3.0-or-later is OSI-approved and every file carries an OSI-approved declaration. The commercial track is an _additional_ option, not a replacement: the same pattern Qt, MySQL, and Berkeley DB use.

**Q. Can I get a machine-readable license inventory?**

`reuse spdx > sbom.spdx` from a checked-out tree produces a full SPDX-format SBOM listing every file's license.

---

## What is NOT covered by this document

- The Verzeta Studio host application (its own `LICENSING.md` governs).
- The trained model weights your host connects to (the model authors' licenses apply).
- The data your conversations generate (yours, governed by [PRIVACY.md](PRIVACY.md)).
- Verzeta's name and logo (see [TRADEMARKS.md](TRADEMARKS.md)).

---

## Document maintenance

This document is part of the Verzeta VS Code extension source tree and is updated whenever the licensing arrangement changes. The Git history is the canonical record of every change.

Last reviewed: 2026-06.
