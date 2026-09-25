<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Workspace mounts

A **workspace mount** shares your VS Code workspace with a chat on the
Verzeta Studio host. Once it is shared, the chat's agents can list folders,
read files, write code and, if you allow it, run shell commands, all inside
your workspace folder.

---

## What a workspace mount is

When you share a workspace, the extension registers it with the host and
answers the host's requests:

- The host can **list** folders and **read** files in your workspace.
- The host can **write** files in your workspace, subject to the permission
  tier you choose.
- The host can **run shell commands** in your workspace, subject to a
  setting for each conversation.

The host asks for files when an agent needs them. Your editor serves each
file, and the host does not keep a copy. File contents an agent reads are
sent to the model provider that agent uses.

A built-in blocklist always applies, in every tier. Agents can never read
or write `.git`, `node_modules`, `dist`, `build`, `target`, `out`, `.next`,
`.cache` and `.idea` folders, `.env` files, SSH and cloud credential
folders (`.ssh`, `.aws`, `.azure`, `.kube`), `.npmrc`, `.netrc`,
`*.pem` and `*.key` files, private SSH keys, or anything under a
`secrets` folder or named `credentials*`.

---

## Share a workspace

1. Run **Verzeta: Register Workspace Mount**.
2. If several folders are open in VS Code, choose which one this chat
   should see.
3. Choose the conversation that will see the workspace.
4. Choose a permission tier: **Ask before every edit**, **Smart Mode
   (auto-edit safe changes)** or **Bypass (full auto, my responsibility)**.
5. If the chat is not in a folder, Verzeta creates a folder named after
   your workspace and moves the chat into it. A notification confirms the
   mount, and a status bar item appears.

You can also click **Share workspace** on the banner at the top of a chat
that cannot see your files.

A shared workspace stays shared across VS Code restarts and reconnects for
the same workspace.

### Share prompt

When you send a message in a chat that cannot see your workspace, Verzeta
asks: "Agents in "<chat>" can't see your files yet. Share the "<folder>"
workspace with this chat?" Choose:

- **Share workspace** to share it.
- **Not now** to skip. Verzeta asks again the next time VS Code starts.
- **Never for this workspace** to stop asking in this workspace.

In a project room, with exactly one workspace folder open, Verzeta
shares the workspace automatically on your first message instead of
asking, and shows "Workspace shared with this chat". Turn this off with
`verzeta.workspaceMount.autoRegister`. **Never for this workspace** also
stops automatic sharing.

Sharing from this prompt, from the banner or automatically uses the tier
in `verzeta.workspaceMount.defaultTier`, which is always Ask or Smart,
never Bypass.

If the host refuses a share, for example because the folder name is too
long, you see "Failed to share the workspace" with the reason, and nothing
is shared.

---

## Permission tiers

| Tier       | What it means                                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ask**    | Each write opens a VS Code dialog, "Verzeta wants to write <file> (<n> bytes). Approve?", with **Approve** and **Reject**.                                                  |
| **Smart**  | Writes that pass every safety rule apply without asking. A write that changes more than 500 lines, is larger than 256 KiB, or creates a new file over 200 lines asks first. |
| **Bypass** | Writes apply without asking. You can only choose it from the tier picker; it cannot be the default.                                                                         |

In every tier, Verzeta refuses a write when:

- the file's extension is not on the Smart Mode list
  (`verzeta.workspaceMount.smartMode.extensionAllowlist`),
- the path matches a glob in your `verzeta.workspaceMount.blocklist`, or
- the content looks dangerous, for example embedded credentials or private
  keys, a download piped into a shell, or a reverse shell.

The tier pre-selected in the picker comes from
`verzeta.workspaceMount.defaultTier` (default `ask`). `bypass` cannot be
the default: any value other than `smart`, including `bypass`, is treated
as `ask`. The workspace mount settings are read from your user settings
only, so a repository's `.vscode/settings.json` cannot change them.

To change the tier, run **Verzeta: Change Workspace Mount Permission
Tier**, or click the mount status bar item and choose **Change permission
tier**. Switching to Bypass asks you to confirm. The new tier is also saved
on the host, so the desktop shows the same tier.

When more than one mount is active, the tier, refresh and unregister
commands act on the mount for the chat open in the Verzeta view. If that
chat has no mount, they ask which one to use.

---

## The mount status bar item

While a mount is registered, the status bar shows
"Verzeta: <workspace> ↔ <folder> (<tier>)". It turns amber in Bypass.
Click it for a menu:

- **Change permission tier**: switch between Ask, Smart and Bypass.
- **Refresh workspace tree**: send an updated file list to the host.
- **Unregister this workspace mount**: stop sharing the workspace.

Top-level files and folders you add or remove are sent to the host
automatically within about 30 seconds. For changes deeper in the tree, use
**Refresh workspace tree**.

---

## Your own blocklist

You can block more paths:

```json
"verzeta.workspaceMount.blocklist": [
  "private/**",
  "*.secret"
]
```

Agents cannot list, read or write paths that match your globs. The
built-in blocklist always applies as well, and you cannot remove it.

## Your own allowlist

To limit agents to part of the workspace, list the paths they may use:

```json
"verzeta.workspaceMount.allowlist": [
  "src/**",
  "docs/**"
]
```

When the allowlist is not empty, agents can only list, read and write
paths that match one of its globs (refused with **not_allowlisted**). The
blocklists still apply. Both settings take effect on the next request;
run **Verzeta: Refresh Workspace Mount Tree** to update the file list the
agents see.

---

## Why an agent's file access was refused

The agent reports the reason in the chat. Common ones:

- **blocked_path**: the path is on the built-in blocklist.
- **smart_blocked**: the write failed a safety rule (see Permission tiers).
- **user_rejected**: you clicked **Reject** in the write dialog, or
  **Cancel** in the command dialog.
- **stale_fingerprint**: the file changed on disk after the agent read it.
  The agent should read it again.
- **payload_too_large**: a single write over 10 MiB. Reads return at most
  1 MiB per call, and a folder listing returns at most 5000 entries.
- **symlink_escape**: the path leads outside the workspace through a
  symbolic link.
- **absolute_path_forbidden** or **unsafe_path**: the agent used an
  absolute path or a path with `..`.
- **mount_not_found** or **mount_stale**: the workspace is no longer
  shared, or was shared again. Share it again if needed.

---

## Running commands in your workspace

Agents can run shell commands in your workspace (for example a build, the
test suite or a linter). You control this for each conversation.

### Setting command execution

Click the gear in the chat header to open **Chat settings**, and find
**Command execution** ("Let agents run commands in this workspace (this
device)"):

| Setting                                    | Behaviour                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Off: run on the host instead** (default) | The command runs on the Verzeta Studio computer, not here. A banner offers to enable it here. |
| **Ask: confirm every command**             | Each command waits for you to click **Run** or **Cancel**.                                    |
| **Allow: auto-run (safety-filtered)**      | Commands run without asking. The safety filter and sandbox still apply.                       |

The setting is stored on this device, for this workspace, for each
conversation. Commands also need the workspace to be shared with the chat.

### The command banner

When a conversation is set to **Off** and an agent tries to run a command,
a banner appears: "An agent wanted to run a command here (…). It ran on the
host instead. Let agents run commands in this workspace?" Click **Ask each
time** or **Allow** to change the setting for this conversation right away,
or dismiss the banner.

### The command dialog (Ask)

In **Ask** mode, a dialog titled **Run command on your device?** shows the
command and whether it will run in a sandbox. Click **Run** to run it and
send the output to the agent, or **Cancel** to refuse. The agent is told
that you declined, so it can adjust.

### Limits and sandboxing

Commands run in the shared workspace folder. They stop after 2 minutes by
default, and their output is capped at 1 MiB. On Linux they run inside
bubblewrap (`bwrap`), and on macOS inside `sandbox-exec`, when those work.
Windows has no sandbox, so commands there run with the permissions of
VS Code. When a command runs without a sandbox, the extension warns you
once per session: "Verzeta ran an agent command without a sandbox (none is
available on this platform). Install bubblewrap (Linux) for sandboxed
execution."

A safety filter blocks dangerous commands in every mode, including Allow.
Examples are piping a download into a shell, reverse shells, and embedded
credentials. Review commands before you approve them.

---

## Stop sharing a workspace

Run **Verzeta: Unregister Workspace Mount**, or click the status bar item
and choose **Unregister this workspace mount**. The host's agents can no
longer read or write your workspace until you share it again.

If you add or remove a workspace folder in VS Code, the extension stops
sharing and says so. Share the workspace again afterwards.

---

## What a workspace mount does not do

- **Copy your files to the host.** The host reads files only when an agent
  asks for them.
- **Expose files to the internet.** All traffic goes over the paired
  connection between the extension and the host.
- **Override the built-in blocklist.** Credentials, keys, `.env` files and
  the other paths listed above are always excluded.
