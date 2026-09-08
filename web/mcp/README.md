# TAS-33 MCP Server

Exposes the TAS-33 task data to Claude as four read-only tools,
against the `tas-samtabsam` Firebase project:

| tool | reads | answers |
|---|---|---|
| `list_tasks` | `tasks` | what the class has been set, and what you've ticked |
| `get_task` | `tasks` | one shared task by id |
| `list_todo` | `todo/{uid}` | what's on *your* To Do list, in your order |
| `list_personal_tasks` | `userTasks/{uid}/tasks` | your own private tasks |

`list_todo` and `list_personal_tasks` are per-person, and `list_tasks`
becomes per-person once it knows who you are — see **Whose data** below.

## The schema, and why `status` is gone

The original `list_tasks(status=...)` didn't match the database. There
is **no `status` field on a task**, and no `todo` / `in_progress` /
`done` values anywhere. Two things replace it:

**1. `type` — what kind of task it is.** Written by `calendar.html`
(the task modal) and `announce.html` (Sync to calendar):

| canonical    | legacy name in live data | shown in the app as |
|--------------|--------------------------|---------------------|
| `normal`     | `send_on`                | Send On             |
| `deadline`   | `send_before`            | Send Before         |
| `prediction` | `estimated`              | Estimated           |
| `marker`     | —                        | Marker              |

`announce.html` still writes the legacy names (`send_on` etc.) and
`calendar.html` maps them on read via `TYPE_ALIASES`, so documents
under both spellings are live in the collection right now. The server
normalises them the same way — this is why it filters in Python
instead of with a Firestore `where()`, which would silently miss every
legacy-named document.

A full task document:

    name       str   required by firestore.rules
    subject    str
    type       str   see table above
    start      str   "YYYY-MM-DD"
    end        str   "YYYY-MM-DD", required by firestore.rules
    note       str
    markerType str   markers only, e.g. "quiz"
    date       str   markers only, mirrors start/end
    createdAt  int   epoch ms
    updatedAt  int   epoch ms, edits only

**2. Done is per-user, not a property of the task.** Shared tasks
belong to the whole class, so "done" lives in `userDone/{uid}`:

    { done:         { taskId: true },
      archiveHidden: { taskId: true },
      progress:     { taskId: { mode: "steps"|"percent", value, total } } }

Pass `uid=` to `list_tasks` / `get_task` to fold that person's `done`
and `progress` into each task. Without a uid there is no meaningful
answer to "is this done?", so the field is simply absent.

Personal tasks in `userTasks/{uid}/tasks` are a separate collection,
covered by `list_personal_tasks`.

## Whose data

Set `TAS33_UID` in the MCP config (see below) and every tool defaults
to that person — no uid needs passing. Without it, `list_tasks` still
works but can't say what's done, and the two personal tools return an
error asking for a uid.

To find a uid: it's the Firebase auth uid, and it's the document id
under `userDone/` and `todo/` for that person.

### The To Do list is not "tasks due today"

`todo/{uid}` is a hand-ordered shortlist the user built by picking
tasks out of the calendar — membership is a deliberate choice, not a
date filter. So "what's on my list" is `list_todo`, while "what's due
this week" is `list_tasks`. They overlap only by coincidence.

An item is a **view** over a task, never a copy: it stores a `ref` and
nothing else, and the name, subject and due date are resolved fresh
against the live task every time. That's why `list_todo` reads both
task collections to build an index. Items are one of three sources:

    shared     ref -> a doc in `tasks`
    personal   ref -> a doc in `userTasks/{uid}/tasks`
    note       free-typed text, no task behind it, never "done"

An item whose task was since deleted comes back as `orphan: true`
rather than vanishing, matching how the app draws a "Task removed" row.
The retired Focus Deck is handled too: a stored doc that still carries
the old `deck` flag has those items lifted to the top, which is what
the app shows until the list is next saved.

## Setup

### 1. Install dependencies

Already done, into `.venv/` next to this file:

    python -m venv .venv
    .venv\Scripts\python.exe -m pip install -r requirements.txt

A venv rather than a global install, because Claude Desktop needs one
fixed interpreter path that won't change under it.

### 2. Get a Firebase service account key

1. Open <https://console.firebase.google.com/project/tas-samtabsam/settings/serviceaccounts/adminsdk>
   (signed in as the account that owns the project).
2. Confirm the project name reads **tas-samtabsam** at the top.
3. Click **Generate new private key**, then **Generate key** in the
   dialog. A `.json` file downloads.
4. Move it to this folder and rename it exactly `serviceAccountKey.json`:

       move "%USERPROFILE%\Downloads\tas-samtabsam-firebase-adminsdk-*.json" ^
            "d:\tas-samtabsam\web\mcp\serviceAccountKey.json"

Take the *Service accounts* tab specifically — a key from *General* is
a Web app config (apiKey/authDomain) and won't work.

**This key is a full admin credential.** It bypasses
`firestore.rules` entirely and can read and write every collection in
the project, including `userDone`, `todo` and `links`. So:

- It is gitignored here (`serviceAccountKey.json`, `*serviceAccount*.json`,
  `*-firebase-adminsdk-*.json`). Don't move it somewhere that isn't.
- Don't paste it into a chat, an issue, or a deployed site.
- If it leaks, revoke it: same console page → **Manage service account
  permissions** → Keys → delete the key, then generate a new one.

To keep the key outside the repo entirely, put it anywhere you like
and point `TAS33_SERVICE_ACCOUNT` at it instead (see the config below).

### 3. Verify it works

    .venv\Scripts\python.exe verify_setup.py

Checks the key is a real service account key for the right project,
connects, and reports how many tasks it read and which fields they
carry. Prints no task text, so the output is safe to share.

### 4. Wire it into Claude Desktop

Claude Desktop has two builds, and they read **different files**:

| build | config path |
|---|---|
| Microsoft Store (MSIX) — *this machine* | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| standalone .exe installer | `%APPDATA%\Claude\claude_desktop_config.json` |

The Store build is packaged, so its writes to `%APPDATA%` are redirected
into that container. Putting the config in `%APPDATA%\Claude\` there
does nothing at all — the app never reads it. To check which you have:

    powershell -c "Get-Process claude | Select-Object -Expand Path -Unique"

A path under `Program Files\WindowsApps\` means the Store build.

Merge this into that file — it already holds your Desktop preferences,
so add the `mcpServers` key rather than replacing the whole file:

```json
{
  "mcpServers": {
    "tas-33": {
      "command": "d:\\tas-samtabsam\\web\\mcp\\.venv\\Scripts\\python.exe",
      "args": ["d:\\tas-samtabsam\\web\\mcp\\tas33_mcp_server.py"],
      "env": {
        "TAS33_SERVICE_ACCOUNT": "d:\\tas-samtabsam\\web\\mcp\\serviceAccountKey.json",
        "TAS33_UID": "<your firebase uid>"
      }
    }
  }
}
```

Backslashes must be doubled — it's JSON. If you already have an
`mcpServers` block, add `"tas-33"` inside it rather than adding a
second block. Restart Claude Desktop fully (quit from the tray, not
just close the window); `tas-33` then appears under the tools icon.

Edit it while Desktop is **closed**. It rewrites this file to persist
preferences, so an edit made while it is running can be overwritten on
exit.

The `env` line is optional while the key sits next to the script, but
it is what lets you move the key out of the repo — point it anywhere.

### Claude Code instead

    claude mcp add tas-33 --scope local -e TAS33_SERVICE_ACCOUNT=d:\tas-samtabsam\web\mcp\serviceAccountKey.json -- d:\tas-samtabsam\web\mcp\.venv\Scripts\python.exe d:\tas-samtabsam\web\mcp\tas33_mcp_server.py

Then `/mcp` to check it connected.

## Troubleshooting

The tools return their real error as a normal result, so ask Claude
what it got back rather than digging through logs.

| message | meaning |
|---|---|
| `FileNotFoundError: No Firebase service account key at ...` | step 2 not done, or the file is named wrong |
| `DefaultCredentialsError` / `invalid_grant` | key was revoked or is malformed — generate a new one |
| `PermissionDenied` | key is for the wrong project; check `verify_setup.py` output |
| server won't start in Claude Desktop | bad path, single backslashes in the JSON, or the config edited in the wrong one of the two paths above |

Logs: `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\mcp-server-tas-33.log`
on the Store build, or `%APPDATA%\Claude\logs\...` on the standalone one.
