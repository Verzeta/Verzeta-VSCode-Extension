<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Release notes

Public release notes for Verzeta for VS Code. The release workflow publishes the
section whose heading matches the release version (`## [X.Y.Z]`) as the GitHub
release body. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-07-10

The first public release of Verzeta for VS Code. It brings the agent teams on your Verzeta Studio host into VS Code.

Pair the extension with your own Verzeta Studio host, then chat from the side bar, the Secondary Side Bar or an editor tab.

### Highlights

- **Multi-agent chat** in the editor, with a provider and model per agent and each reply labelled with the agent that wrote it.
- **Editor AI actions**: Explain, Fix bugs, Refactor, Add tests and Add docs from the lightbulb menu, plus Ask an Agent About This.
- **Adding context**: send a selection, files or a Git diff; drag and drop files and paste images.
- **Workspace sharing**: let agents read and write your project files (served on request, never stored on the host), with Ask, Smart and Bypass approval tiers.
- **Workspace commands**: agents can run shell commands in your workspace, sandboxed on Linux and macOS, with a setting for each conversation (Off, Ask or Allow).

### Privacy

There is no Verzeta cloud and no telemetry. The editor never calls a model provider; your host does.

### Install

Install from the VS Code Marketplace, or download the `.vsix` from the assets below. Requires VS Code 1.95 or newer and a [Verzeta Studio](https://verzeta.com) host.
