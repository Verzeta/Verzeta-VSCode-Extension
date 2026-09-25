<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Settings

Verzeta has two kinds of settings: **conversation settings**, which control
how one chat behaves on the desktop, and **extension settings**, which
control the VS Code extension itself.

---

## Conversation settings

Click the gear in the chat header. The panel is titled **Chat settings**.
Most of these settings are stored on the desktop and apply to the
conversation in every paired client (VS Code, Android and so on).
**Command execution** is the exception: it is stored on this device.

### Model

Shows the current provider and model. Click **Change** (or the model name
in the chat header) to pick another one. The list contains the models set
up on the desktop: local Ollama models, or cloud providers (OpenAI,
Anthropic, Gemini and others) with your own API keys.

### System prompt

Set or edit the system prompt, which is sent at the start of every request
in this conversation. Leave it blank to use the agent's default.

### Parameters and sampling

| Setting                                                           | What it does                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Temperature                                                       | How random the model's output is                                                                          |
| Max tokens (-1 = Auto)                                            | The most tokens the model may write per reply. **-1** uses the model's own default.                       |
| Context window                                                    | How much history the host includes in each request                                                        |
| Use app-recommended sampling                                      | Use the host's tuned sampling profile for the active model. Turn it off to set the values below yourself. |
| Top K, Top P, Repeat penalty, Presence penalty, Frequency penalty | Sampling controls. Each accepts **-1** for Auto.                                                          |

### Conversation memory

**Auto-compact long chats** summarises older messages as the context window
fills, so long conversations keep fitting in the model's context. **Compact
every N turns (0 = off)** also compacts on a fixed schedule.

### Agent behaviour

| Setting                         | What it does                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Agent pattern                   | How the agent works through a request: Direct, ReAct, Planner, Router, Multi-agent or Memory                          |
| Streaming                       | Show replies as they are generated                                                                                    |
| Thinking                        | Ask models that support it to reason before answering. The **Thinking** toggle next to the send button does the same. |
| Require confirmation            | Pause the agent before it runs destructive tools                                                                      |
| Tools enabled                   | Let agents use the host's tools. This applies to every conversation on the host.                                      |
| Describe tools in system prompt | Add long tool descriptions to the system prompt. The panel recommends leaving it off.                                 |
| RAG enabled                     | Add retrieved context to the prompt, for this conversation                                                            |

When **Thinking** is on and the model reasons, a collapsed **Reasoning**
section appears above the reply. Models without a reasoning pass ignore
the setting.

To limit which tools a member of a project can use, set that up on the
desktop.

### Other sections

- **Command execution**: whether agents may run commands in your shared
  workspace on this device. See [Workspace mount](06-workspace-mount.md#running-commands-in-your-workspace).
- **Heartbeat**: **Auto-surface heartbeat reports**.
- **Preferred skills**: choose skills for this chat. Turn on **Override
  parent folder** to use your own choice instead of the folder's.

---

## Extension settings (`verzeta.*`)

These settings are in your VS Code settings (`settings.json`) and control
the extension itself. Open them with **File > Preferences > Settings**
(`Ctrl+,` / `Cmd+,`) and search for "Verzeta".

### Hosts

| Setting                    | Default   | Description                                                                                                                                                                                     |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verzeta.hosts`            | `[]`      | The paired Verzeta Studio desktops, each with an `id`, `name`, `url` and optional `tlsCertSha256` (the TLS pin). Use **Verzeta: Add Host** and **Verzeta: Remove Host…** instead of editing it. |
| `verzeta.defaultHostId`    | _(empty)_ | The `id` of the host to use at startup. When empty, the first paired host is used.                                                                                                              |
| `verzeta.connectOnStartup` | `true`    | Connect to the default host when VS Code starts.                                                                                                                                                |

### Interface

| Setting              | Default | Description                                                                                                                               |
| -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `verzeta.initialTab` | `home`  | Which tab the Verzeta view opens on: `home`, `chat` or `settings`.                                                                        |
| `verzeta.log.level`  | `info`  | How much the Verzeta output channel logs: `error`, `warn`, `info` or `debug`. Set it to `debug` when troubleshooting connection problems. |

### CodeLens

| Setting                    | Default | Description                                                                                                         |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `verzeta.codeLens.enabled` | `false` | Show Verzeta CodeLens links (**Explain**, **Add tests**, **Refactor**) above functions and classes. Off by default. |

### Workspace Mount

These settings control how agents on the desktop read and write files in
your shared workspace. All `verzeta.workspaceMount.*` settings, including
`autoRegister` and `allowlist` below, apply from your user settings only.
A workspace's `.vscode/settings.json` cannot change them.

| Setting                              | Default | Description                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verzeta.workspaceMount.defaultTier` | `ask`   | The permission tier pre-selected when you share a workspace: `ask` or `smart`. Also used when you share from the in-chat banner, the share prompt or automatically. Any other value, including `bypass`, is treated as `ask`; choose Bypass in the tier picker. |
| `verzeta.workspaceMount.blocklist`   | `[]`    | Extra path globs that agents may not list, read or write. The built-in blocklist (credentials, keys, `.env` files, `.git`, `node_modules`, build output) always applies and cannot be removed.                                                                  |

#### Smart Mode options

These rules run on every write. A write whose extension is not on the list
is refused in every tier. In Smart, a write over the size or line limits
asks for confirmation.

| Setting                                               | Default                              | Description                                                                                |
| ----------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `verzeta.workspaceMount.smartMode.extensionAllowlist` | _(long list of code and text types)_ | File extensions agents may write to. Writes to other extensions are refused in every tier. |
| `verzeta.workspaceMount.smartMode.maxDiffLines`       | `500`                                | In Smart, a write that changes more lines than this asks first.                            |
| `verzeta.workspaceMount.smartMode.maxFileBytes`       | `262144` (256 KiB)                   | In Smart, a write larger than this asks first.                                             |

### Connection and sharing

| Setting                               | Default | Description                                                                                                                                                                                       |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verzeta.reconnect.backoffMs`         | `1000`  | Delay in milliseconds before the one automatic reconnect attempt after a dropped connection (250 to 60000).                                                                                       |
| `verzeta.workspaceMount.autoRegister` | `true`  | Share the workspace automatically on the first message in a project room that has no mount, when exactly one workspace folder is open. See [Workspace mount](06-workspace-mount.md#share-prompt). |
| `verzeta.workspaceMount.allowlist`    | `[]`    | When not empty, agents can only list, read and write paths matching one of these globs.                                                                                                           |
