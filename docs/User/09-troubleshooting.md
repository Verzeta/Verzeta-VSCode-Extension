<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Troubleshooting

The extension talks to the network only through its connection to your
paired Verzeta Studio host. Most problems are a closed connection, a
rejected token, or a request the host refused. Each section below starts
with the message you see.

The connection state appears in three places: the status line on the
Home tab's host card, the colored dot next to the active host on the
Settings tab, and the dot in the chat header (hover it to see the state).

---

## Pairing fails

### "Verzeta: Pairing failed: auth_failed: invalid or expired pairing code"

The host rejected the code. The same message covers a mistyped code, a
code older than 5 minutes, and a code that was already used; each code
works only once. On the desktop, open **Settings > Remote Access > Manage
Remote Access** and click **Generate pair code** (or run
`verzeta-remote --pair-code` on a host without the desktop window). Then
run **Verzeta: Add Host** again and enter the new 6-digit code within
5 minutes.

### "Verzeta: Pairing failed: WebSocket connection failed"

The extension could not open the connection. See
[Can't connect to the host](#cant-connect-to-the-host).

### "Verzeta: Could not parse the host URL: Endpoint path must be /ws."

The address may end in `/ws` (as the desktop shows it), `/`, or nothing
after the port. Any other path is rejected. This message appears only after
you have filled in every prompt, so run **Verzeta: Add Host** again with
the address copied from the desktop dialog.

Always include the port. Without it, the extension uses port 80 for
`ws://` and 443 for `wss://`, not 9180.

### The TLS Pin prompt says "A SHA-256 fingerprint is 64 hex characters"

The fingerprint you pasted is incomplete. Copy the whole **SHA-256
FINGERPRINT** from the desktop dialog. Colons are optional.

---

## Can't connect to the host

### Home tab shows "CONNECTION ERROR" or "DISCONNECTED"

"CONNECTION ERROR" comes with "Couldn’t reach the host. Verify the URL in
Settings or check the Verzeta output channel for diagnostics." The same
problem during pairing shows "Verzeta: Pairing failed: WebSocket connection
failed". Check these in order:

1. **Is the host running?** On the desktop, open **Settings > Remote
   Access > Manage Remote Access** and check that the switch reads
   **Server is running**.
2. **Is the address correct?** On the Settings tab, the address is shown
   under the host's name. It must match an address listed under **CLIENTS
   CAN REACH THIS HOST AT** in the desktop dialog, including the port
   (default 9180), for example `ws://192.168.1.42:9180/ws`. To change the
   address, remove the host and add it again.
3. **Is the port reachable?** Make sure no firewall on the host computer or
   your router blocks the port.
4. **Does `ws://` or `wss://` match?** It must match the **TLS encryption**
   switch on the desktop. TLS is off by default, so the default address
   starts with `ws://`.
5. **Is the TLS pin right?** For `wss://` with the desktop's self-signed
   certificate, you must enter its SHA-256 fingerprint when you add the
   host. If the fingerprint is wrong or missing, the connection fails with
   the same messages as above; there is no separate "mismatch" message. If
   you clicked **Regenerate certificate** on the desktop, remove the host
   and add it again with the new fingerprint.

When the state is **DISCONNECTED**, click **⚡ Connect** on the Home tab.
After a **CONNECTION ERROR**, fix the cause and click **Try again**. You can
also click **Connect** next to the host on the Settings tab.

> If the certificate changed and you did not regenerate it, do not
> connect. Someone may be intercepting the connection.

### Home tab shows "UNAUTHORIZED"

The card says "The stored token was rejected. Pair again with a fresh code
from the host." The host no longer accepts this device's token. This
happens after the device is revoked on the desktop (under **Paired
devices**) or with **Revoke this device** in the extension.

1. Generate a new pair code on the desktop.
2. Click **＋ Pair again** on the Home tab, or run **Verzeta: Pair…** and
   pick the host.
3. Enter the new code. The extension stores the new token and reconnects.

You do not need to remove and add the host again.

---

## Connection drops mid-session

If an open connection drops, the Home tab shows **RECONNECTING…** and the
extension tries once to reconnect after about one second (set by
`verzeta.reconnect.backoffMs`). If that attempt
fails, the host shows **DISCONNECTED** or **CONNECTION ERROR**. Click
**⚡ Connect** or **Try again** on the Home tab, or **Connect** next to the
host on the Settings tab.

Your pairing token survives host restarts. Only a revoke makes it invalid
(see [Home tab shows "UNAUTHORIZED"](#home-tab-shows-unauthorized)).

---

## Errors that mention "unknown_op"

For example "Send failed: unknown_op: unknown op: …". The extension and
Verzeta Studio are on versions that do not match. Update both to the same
release.

---

## Chat not appearing or hard to find

The Verzeta chat can be in three places:

1. **Activity Bar:** click the Verzeta icon (a speech-bubble icon) on the
   left.
2. **Secondary Side Bar:** on VS Code 1.106 and newer, Verzeta can also sit
   in the Secondary Side Bar. If it is hidden, open it with **View >
   Appearance > Secondary Side Bar**, then click the Verzeta icon.
3. **Editor tab:** if you ran **Open Chat in Editor**, look for a tab named
   "Verzeta" in the editor area. To open it again, run **Verzeta: Open Chat
   in Editor**.

If you still cannot find it, run **Verzeta: Focus on Verzeta View** from
the Command Palette.

### The Verzeta icon is missing in some folders

VS Code turns Verzeta off in Restricted Mode. Trust the folder (run
**Workspaces: Manage Workspace Trust**) to use it there.

### Editor commands say "opening the sidebar"

For example "Verzeta: opening the sidebar. Send the selection again." The
chat view had not loaded yet. The extension opens it; run the command
again.

### "Verzeta: connect to a host from the Verzeta sidebar first."

An editor action needs a connected host. Connect on the Home tab, then run
the action again. "Verzeta: the active host is not connected." means the
same.

### "Verzeta: run a command in the integrated terminal first (requires shell integration)."

**Send Last Terminal Command to Chat** only sees commands that finished in
a terminal with shell integration, after the extension started. Run the
command again in the integrated terminal, then retry.

### "Verzeta: no Git repository found in this workspace." or "Verzeta: no uncommitted changes found."

**Add Git Diff to Chat** and **Generate Commit Message** need a Git
repository with changes. Open the repository folder, or make a change
first.

---

## Messages stuck sending or spinning dots

If you send a message and the typing indicator does not go away:

1. Check the dot in the chat header (hover it to see the state) or the
   Home tab. If it is not **Connected**, click **⚡ Connect** on the Home
   tab.
2. If the connection is fine but no reply starts, the host may still be
   busy with an earlier request. Wait, or click **Stop generation**.
3. The typing indicator clears itself after a send error, or after 60
   seconds. If the view still looks stuck, run **Developer: Reload
   Webviews** from the Command Palette.
4. If the output channel shows `rate_limited`, the host received more than
   200 requests per second from this device. Wait a moment, then reload
   the webviews if the chat stays stuck.

---

## Attachment rejected

| Message                                                                                                      | Cause                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Maximum 8 attachments per message."                                                                         | A message can have at most 8 attachments.                                                                                                                                                   |
| `"<name>" exceeds the 16 MiB per-attachment cap.`                                                            | A file from **Add Files**, a paste or a file-manager drop is larger than 16 MiB.                                                                                                            |
| "Total attachments would exceed 16 MiB."                                                                     | All attachments together can be at most 16 MiB.                                                                                                                                             |
| `Verzeta: <file> is <n> MiB, which exceeds the 4 MiB per-attachment cap.`                                    | A file attached from VS Code (editor, Explorer or **Add Context**) is larger than 4 MiB.                                                                                                    |
| `"<name>" is empty.`                                                                                         | Empty files cannot be attached.                                                                                                                                                             |
| `"<name>" can't be sent. File names can't start with a dot or contain /, \ or "..".`                         | File names cannot start with a dot or contain `/`, `\` or `..`. This applies to every way of attaching, including the editor and Explorer commands. For example, `.env` cannot be attached. |
| "Message too large to send (<n> MiB; the wire limit is 24 MiB). Remove or shrink attachments and try again." | The whole message, after encoding, must fit in 24 MiB.                                                                                                                                      |

For large files, share the workspace with the chat so the agent can read
the file directly (see [Workspace mount](06-workspace-mount.md)).

---

## Command execution blocked or does nothing

If an agent tries to run a shell command and you see no dialog, or nothing
happens:

1. **Check the conversation's Command execution setting.** Click the gear
   in the chat header to open **Chat settings**. **Command execution**
   should be **Ask** or **Allow**. If it is **Off**, the command runs on the
   host instead, and a banner offers to enable it here.
2. **If you dismissed the banner**, change the setting to **Ask** in **Chat
   settings**.
3. **If no banner appeared**, check that the workspace is shared with this
   chat. Commands need a workspace mount. See the
   [workspace mount guide](06-workspace-mount.md).
4. **If the agent reports `blocked_by_smart_filter`**, the safety filter
   stopped a dangerous command. This happens in every mode, including
   Allow.

---

## Workspace mount shows no files or the agent can't see my files

1. Check that the workspace is shared. The status bar shows
   "Verzeta: <workspace> ↔ <folder> (<tier>)" while a mount is active.
2. Run **Verzeta: Refresh Workspace Mount Tree** to send a fresh file list
   to the host.
3. New top-level files and folders are sent within about 30 seconds.
   Changes deeper in the tree are not sent until you refresh.
4. If you add or remove a workspace folder, the extension stops sharing
   and says "Verzeta: the workspace folders changed, so the workspace mount
   was released." Share the workspace again from the chat's **Share
   workspace** banner or with **Verzeta: Register Workspace Mount**.
5. If you see "the workspace manifest hit the 1500-file cap", agents see
   only part of the file list.
6. Files on the built-in blocklist (`.git`, `node_modules`, build output,
   `.env` files, keys and credentials) are never visible to agents.

### Registering fails

| Message                                                                                                     | Fix                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| "Open a workspace folder in VS Code before registering a Verzeta workspace mount."                          | Open a folder in VS Code first.                  |
| "Connect to a Verzeta host before registering a workspace mount."                                           | Connect on the Home tab first.                   |
| "No conversations on the active host yet. Open or create a chat in Verzeta first, then pair the workspace." | Create a chat with **New chat** in the Chat tab. |

### An agent's file access was refused

The agent reports a reason such as `blocked_path`, `smart_blocked` or
`stale_fingerprint`. See
[Why an agent's file access was refused](06-workspace-mount.md#why-an-agents-file-access-was-refused).

---

## Extension logging

Set the log level to `debug` for more detail:

```json
"verzeta.log.level": "debug"
```

Open the Verzeta output channel (**View > Output**, then choose
**Verzeta**, or **Open output channel** on the Settings tab) to see
connection events, message flow and errors. Include this log when you
report a bug.
