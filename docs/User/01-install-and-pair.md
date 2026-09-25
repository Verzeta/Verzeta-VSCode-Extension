<!--
SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
SPDX-License-Identifier: LGPL-3.0-or-later
-->

# Install and pair

## Install the extension

Verzeta for VS Code is available on the **Visual Studio Marketplace**.
Install it in any of these ways:

**From the Extensions view:**

1. Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **Verzeta**.
3. Click **Install**.

**From the Command Palette:**

```
Ctrl+Shift+P → Extensions: Install Extensions → search "Verzeta"
```

**From the terminal (CLI):**

```bash
code --install-extension verzeta.verzeta
```

The extension starts when VS Code starts. A Verzeta icon appears in the
Activity Bar on the left. Click it to open the Verzeta view.

## Pair with your desktop

You pair the extension once per Verzeta Studio desktop. The pairing token
survives VS Code restarts, reboots and updates, so you do not need to pair
again unless the device is revoked.

### Step 1: Turn on Remote Access on the desktop

In the **Verzeta Studio** desktop application:

1. Open **Settings > Remote Access** and click **Manage Remote Access**.
2. Turn on the server switch. It reads **Server is running**.
3. Note one of the addresses listed under **CLIENTS CAN REACH THIS HOST AT**,
   for example `ws://192.168.1.42:9180/ws`. The default port is 9180.
4. Optional: turn on **TLS encryption**. The desktop creates a self-signed
   certificate, shows its **SHA-256 FINGERPRINT**, and the addresses change
   to `wss://`. TLS is off by default.
5. Under **Pair a device**, click **Generate pair code**. The 6-digit code
   is valid for 5 minutes. Keep the dialog open.

On a host without the desktop window, run `verzeta-remote --pair-code` to
generate a code.

### Step 2: Run "Verzeta: Add Host" in VS Code

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run
   **Verzeta: Add Host**. You can also click **＋ Add host** on the Verzeta
   Home tab.
2. Fill in the prompts and press **Enter** after each one:

| Prompt                      | What to enter                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name                        | Any label for this desktop, for example `home-desktop`                                                                                                                                     |
| WebSocket URL               | The address from the desktop dialog, for example `ws://192.168.1.42:9180/ws`. Include the port.                                                                                            |
| TLS Pin (only for `wss://`) | The desktop's SHA-256 fingerprint. Colons are optional. For the desktop's own self-signed certificate you must enter it. Leave it blank only for a certificate your system already trusts. |
| Pair code                   | The 6-digit code from **Generate pair code**                                                                                                                                               |

The prompts are titled **Verzeta: Add Host (1/4)** to **(4/4)**. For a
`ws://` address there is no TLS Pin prompt, so there are three.

### Step 3: Confirm it worked

After the last prompt, the extension pairs, stores the token and connects.
You see "Verzeta: Host "<name>" paired." The Home tab shows the host as
**CONNECTED** with your recent conversations, and the Chat tab lists every
conversation on the host.

If pairing fails, you see an error message that starts with
"Verzeta: Pairing failed:". The most common ones:

| Message                                                             | Fix                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Verzeta: Pairing failed: The pair code was not accepted.`          | The code was mistyped, is older than 5 minutes, or was already used. Click **Generate pair code** on the desktop and run **Verzeta: Add Host** (or **Verzeta: Pair…** for a host you already added) again.                |
| `Verzeta: Pairing failed: WebSocket connection failed`              | The extension could not reach the host, or the TLS connection failed. Check the address, that the server is running, and that `ws://` or `wss://` matches the **TLS encryption** switch. For `wss://`, check the TLS pin. |
| `Verzeta: Could not parse the host URL: Endpoint path must be /ws.` | The address has a path other than `/ws`. Copy the address exactly as the desktop shows it.                                                                                                                                |

See [Troubleshooting](09-troubleshooting.md) for more.

## Managing hosts

You can pair the extension with more than one Verzeta Studio desktop.

- **Add another host:** run **Verzeta: Add Host** again, or click **Add
  another host** on the Settings tab.
- **Switch hosts:** on the Settings tab, click **Connect** next to the host
  you want.
- **Remove a host:** run **Verzeta: Remove Host…**, or click **Remove** next
  to a host on the Settings tab, then pick the host and confirm. This
  deletes the host and its token from VS Code only. The token stays valid
  on the desktop until you revoke it.
- **Pair a host again:** run **Verzeta: Pair…**, pick the host and enter a
  new pair code. The host keeps its name, address and TLS pin; only the
  token is replaced. Use this after the device was revoked. Hosts that need
  pairing are listed first.
- **Revoke this device:** while connected, click **Revoke this device** on
  the Settings tab (or at the bottom of the Home tab). The desktop
  invalidates the token right away, and the extension disconnects and
  deletes its stored token. To use the host again, run **Verzeta: Pair…**.
  To delete the local entry, remove the host.

> **Tip:** To revoke from the desktop instead, open Verzeta Studio, go to
> **Settings > Remote Access > Manage Remote Access**, find this device
> under **Paired devices**, and click **Revoke**. VS Code devices are named
> "VS Code · <computer name>".

## What gets stored in VS Code

| What                                                                                   | Where                                                                                                                                   |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Pairing tokens                                                                         | VS Code `SecretStorage` (backed by the OS keychain: GNOME Keyring / KWallet on Linux, Keychain on macOS, Credential Manager on Windows) |
| Host configuration (name, URL, TLS pin)                                                | VS Code settings under `verzeta.hosts`; no token is stored here                                                                         |
| Command-execution setting for each conversation, and shared workspaces with their tier | VS Code `workspaceState` for this workspace                                                                                             |
| UI preferences                                                                         | `verzeta.*` settings                                                                                                                    |

There is no database, message cache, analytics or log file beyond the
VS Code Output channel, which stays on your machine.
