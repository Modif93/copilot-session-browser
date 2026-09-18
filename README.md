# Copilot Session Browser

> Browse, search, summarise, and export your GitHub Copilot Chat sessions — entirely locally, with no network calls and no telemetry.

---

## Features

| Feature                   | Description                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| **Session Browser**       | Sidebar panel with full-text search, date filtering, and sorting                         |
| **Transcript Viewer**     | Turn-by-turn conversation view with syntax-highlighted code blocks and one-click copy    |
| **Summary**               | Generate Markdown summary with a live inline preview                                     |
| **Export**                | Export sessions as JIRA Markdown, Standard Markdown, or JSON — preview before saving     |
| **Export Sessions**       | Export all sessions or a checked selection as one file or separate files in a chosen folder |
| **Import**                | Re-load a previously exported JSON session file                                          |
| **SQLite Support**        | Reads `.vscdb` and `.db` files directly — no manual data export required                 |
| **Diagnostics**           | Inspect discovered storage paths, file types, database tables, and session counts        |
| **Storage Path Override** | Point the extension at any custom `workspaceStorage`, `globalStorage`, or User directory |
| **Secret Redaction**      | Automatically strips tokens, API keys, passwords, and private keys before any export     |
| **Local-First & Private** | Zero network calls; telemetry is off by default                                          |

---

## Getting Started

After installing the extension from the VS Code Marketplace:

1. Click the **Copilot Session Browser** icon in the Activity Bar (left sidebar).
2. The extension automatically discovers your Copilot Chat sessions.
3. Click any session to open the transcript viewer.

> If no sessions appear, see [Troubleshooting: Sessions Not Found](#troubleshooting-sessions-not-found) below.

---

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for any of the following:

| Command                                                                     | Description                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Copilot Session Browser: Refresh Session Index`                            | Re-scan local storage and reload the session list                       |
| `Copilot Session Browser: View Session`                                     | Open the selected session transcript in a tab                           |
| `Copilot Session Browser: Summarize Session`                                | Generate an Atlassian Markdown summary panel                            |
| `Copilot Session Browser: Export Session (JIRA Markdown / Markdown / JSON)` | Choose format and options, then preview before copy or save             |
| `Copilot Session Browser: Export Sessions (Markdown / JSON)`               | Export all sessions or choose a subset; search by title, workspace, or ID |
| `Copilot Session Browser: Import Session`                                   | Load a previously exported JSON session into the index                  |
| `Copilot Session Browser: Set Storage Path Override`                        | Set or clear a custom path for session discovery                        |
| `Copilot Session Browser: Diagnostics`                                      | View all discovered files, their types, table names, and session counts |

---

## Exporting all or selected sessions

Click **Export Sessions** in the sidebar title bar, or run the command from
the Command Palette. All sessions are checked initially: confirm to export all,
or adjust the checkboxes to export only the sessions you need. The selection picker
searches titles, workspaces, and IDs and shows dates and message counts.
Inside a workspace, the picker includes only that workspace’s sessions. From the
workspace list or All Sessions view, it includes all loaded sessions. Sessions are
listed newest updated first; search and date filters do not limit the export picker. Refresh first if
you need to discover newer sessions.

Right-click a workspace and choose **Export Workspace Sessions…** to export only
that workspace’s sessions. All matching sessions are checked initially, including
sessions associated by workspace path or storage hash.

Markdown includes all transcripts in a single document and offers secret-redaction
and code-block options. JSON uses the `redactSecretsByDefault` setting and can be
loaded through **Import Session** to restore every session in the file. Cancelling
any selection or destination dialog stops the export before writing. Batch export saves directly;
individual session exports retain their preview panel.

After choosing the format and options, choose an export layout:

- **One combined file**: choose a filename and destination in the Save dialog.
  The file contains only the chosen sessions (every loaded session if all remain checked).
- **Separate files in a folder**: choose a destination folder. A new uniquely named
  `copilot-export-<date>-<uuid>` subfolder is created there, containing one file per
  session. Numbered filenames prevent collisions between identical session titles.
  Existing exports are preserved. Progress and the final destination are displayed;
  if some sessions fail, the result reports saved/failed counts and keeps successful files.

## Extension Settings

Configure the extension in VS Code Settings (`Ctrl+,` / `Cmd+,`):

| Setting                                        | Default | Description                                                                         |
| ---------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `copilotSessionBrowser.redactSecretsByDefault` | `true`  | Automatically redact secrets (tokens, API keys, passwords) in summaries and exports |
| `copilotSessionBrowser.overrideStoragePath`    | `""`    | Custom path for session discovery. Clears to restore auto-detection.                |
| `copilotSessionBrowser.additionalSearchPaths`  | `[]`    | Extra VS Code User directories to include alongside auto-detected paths             |
| `copilotSessionBrowser.enableTelemetry`        | `false` | Opt-in anonymous usage telemetry                                                    |

---

## Troubleshooting: Sessions Not Found

If the extension does not automatically discover your sessions, you can manually point it to the right location.

### Step 1 — Use the command (recommended)

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **`Copilot Session Browser: Set Storage Path Override`**
3. Enter one of the paths below
4. The extension refreshes automatically

To **restore automatic detection**, run the command again and leave the input blank.

### Step 2 — What path to enter

| Path you provide                | What gets scanned                                      |
| ------------------------------- | ------------------------------------------------------ |
| `...\workspaceStorage`          | All `<hash>\github.copilot-chat\` sub-directories      |
| `...\globalStorage`             | `globalStorage\github.copilot-chat\` directly          |
| `...\Code\User` (or any parent) | Both `globalStorage` and `workspaceStorage` beneath it |

**Common paths by platform:**

**Windows**

```
C:\Users\<you>\AppData\Roaming\Code\User\workspaceStorage
C:\Users\<you>\AppData\Roaming\Code\User
```

**macOS**

```
~/Library/Application Support/Code/User/workspaceStorage
~/Library/Application Support/Code/User
```

**Linux**

```
~/.config/Code/User/workspaceStorage
~/.config/Code/User
```

### Step 3 — Run Diagnostics

Run **`Copilot Session Browser: Diagnostics`** from the Command Palette to see every file the extension found, its format, database table names, and session count. This is the fastest way to identify why sessions may not be appearing.

---

## Security & Privacy

- **No network calls** — all processing is done locally on your machine.
- **Strict Content Security Policy** — all extension webviews run with `default-src 'none'`.
- **Script nonces** — unique per webview session, preventing code injection.
- **Secret redaction** — the following are removed before any export or summary (enabled by default):
  - PEM private keys
  - Bearer tokens
  - AWS access keys
  - GitHub Personal Access Tokens (PATs)
  - Azure storage account keys
  - Database connection string passwords
  - Generic long-form tokens
- **Explicit save actions** — exports are written only after a user chooses a file or destination folder.
- **Redaction warning** — the JIRA summary panel displays a visible warning when redaction is disabled.

---

## For Contributors & Developers

See [DEVELOPMENT.md](./DEVELOPMENT.md) for setup instructions, build steps, test details, and the internal architecture.

## Zed and JetBrains sessions

Refresh also collects **Zed's built-in Agent** threads and **JetBrains GitHub Copilot
CLI agent** sessions. They appear alongside VS Code sessions with `zed` or
`jetbrains-copilot` tags, including workspaces that have never been opened in VS Code.
Existing workspace-scoped selection and Markdown/JSON exports apply to both sources.

| Source | Default location |
| --- | --- |
| Zed on macOS | `~/Library/Application Support/Zed/threads/threads.db` |
| Zed on Linux | `${XDG_DATA_HOME:-~/.local/share}/zed/threads/threads.db` |
| Zed on Windows | `%LOCALAPPDATA%\Zed\threads\threads.db` |
| JetBrains Copilot CLI agent | `~/.copilot/session-state/<session-id>/events.jsonl` and `workspace.yaml` |

Use `copilotSessionBrowser.zedDatabasePath` (database file) or
`copilotSessionBrowser.jetbrainsSessionPath` (session-state directory) for custom
**absolute** paths. These sources are independent of the VS Code storage override.
Only Copilot sessions whose YAML metadata has `client_name: copilot-intellij` are
included; other Copilot CLI clients are excluded.

Collection reads source files without modifying them. Missing default locations are
normal; malformed files/threads are reported in Diagnostics while other sessions
continue loading. If Zed has an uncheckpointed SQLite WAL, a warning requests closing
Zed and refreshing to include the latest data. Only the main database is read.

The transcript includes user/assistant text and code fences. Zed tool execution,
thinking blocks and image binaries are not reconstructed; images use a placeholder.
For a Zed thread spanning several folders, the first folder in its stored display
order is used as the workspace. Legacy Zed LMDB, Zed external agents, old JetBrains
Copilot local sessions, and JetBrains AI Assistant XML chats are not supported.

Format references:
- [Zed database source](https://github.com/zed-industries/zed/blob/main/crates/agent/src/db.rs)
- [Zed message source](https://github.com/zed-industries/zed/blob/main/crates/agent/src/thread.rs)
- [JetBrains Copilot session files](https://github.com/microsoft/copilot-intellij-feedback/wiki/Access-Copilot-CLI-Session-Data)
- [Copilot event types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/session-events.ts)

## Visual Studio Community Copilot sessions

Refresh also scans Visual Studio's local Copilot Chat sessions and adds the
`visual-studio` tag. Sessions use the parent of `.vs` as their workspace, so the
existing workspace-scoped picker and Markdown/JSON exports work unchanged.

On Windows, discovery uses session file references from
`%TEMP%/VSGitHubCopilotLogs/*.chat.log` (also checking the LocalAppData Temp folder),
`~/source/repos`, and `~/Documents/Visual Studio 2022/Projects` and
`~/Documents/Visual Studio 2026/Projects`. Current VS Code workspace folders are
also scanned. Add other solution roots using:

```json
"copilotSessionBrowser.visualStudioSearchPaths": [
  "D:\\Projects",
  "C:\\Work\\MySolution"
]
```

A project root or its `.vs` directory can be supplied. Scanning looks for
`.vs/<solution>/copilot-chat/<hash>/sessions/<file>`; it does not scan whole drives.
It descends up to five project directory levels, skips dependency/build directories
and directory symlinks, and reports a 10,000-directory limit in Diagnostics.
Copied project trees can also be read on macOS/Linux through these paths.

The reader supports the observed version-1 MessagePack stream: one version byte,
a session header, and alternating request/response records. User/assistant text,
code fences, session dates and title are retained. Injected context attachments,
tool details and image binaries are not reconstructed. Partial/corrupt records,
unknown versions, and files above 64 MiB produce Diagnostics entries; valid earlier
messages and other sessions remain available. Source files are never modified.

**Evidence and limits:** Microsoft documents the Visual Studio chat-history UI but
does not publish the disk schema in that guide. The storage layout and parser are
based on the original [public Visual Studio data-access implementation](https://github.com/rajbos/ai-engineering-fluency/blob/main/src/visualstudio.ts),
not a Microsoft compatibility guarantee. See also Microsoft's
[chat history documentation](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-chat-context-references?view=vs-2022).
Visual Studio 2026's newer SDK-backed Agent Preview and cloud sessions are not
claimed as supported by this on-disk reader. Community edition has not been tested
in a running Windows IDE; automated tests use synthetic binary fixtures.
