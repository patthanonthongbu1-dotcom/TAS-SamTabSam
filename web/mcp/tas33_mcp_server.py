"""
TAS-33 MCP Server
------------------
Lets Claude read tasks from the TAS-33 Firestore database (project
"tas-samtabsam"), exposing the same data the calendar and announce
pages read.

Setup:
  1. pip install -r requirements.txt
  2. Get a Firebase service account key (see README.md)
  3. Save it as serviceAccountKey.json next to this file
  4. Point Claude Desktop/Code at this script (see README.md)

A note on the schema, because it is not what you would guess:

  Shared tasks live in the top-level `tasks` collection and have NO
  status field. A task document is:

      name       str   required by firestore.rules
      subject    str
      type       str   normal | deadline | prediction | marker
      start      str   "YYYY-MM-DD"
      end        str   "YYYY-MM-DD", required by firestore.rules
      note       str
      markerType str   markers only, e.g. "quiz"
      date       str   markers only, mirrors start/end
      difficulty int   optional, 1-999 points; see below
      createdAt  int   epoch ms
      updatedAt  int   epoch ms, edits only

  Whether a task is *done* is per-user, not a property of the task:
  it lives in `userDone/{uid}` as

      { done:       {taskId: true}, archiveHidden: {...},
        progress:   {taskId: {mode: "steps"|"percent", value, total}},
        difficulty: {taskId: points} }

  so a task is only "done" relative to somebody. Pass a uid to
  list_tasks/get_task to have that folded in.

  Every task also carries a weight -- more points means harder work.
  Tools return it as two fields:

      points           int   1-999, or 0 for a marker
      points_estimated bool  true when nobody set it and this is a guess

  `difficulty` on the task is the author's number; `difficulty` in
  userDone is the reader's own and wins over it. When neither exists
  the weight is estimated from the task's type and how many days it
  runs, and `points_estimated` is true -- report those as rough, not as
  something anyone decided.
"""

import math
import os
from datetime import date, datetime

import firebase_admin
from firebase_admin import credentials, firestore

# mcp 2.x renamed FastMCP to MCPServer; keep working on both.
try:
    from mcp.server.mcpserver import MCPServer
except ImportError:  # mcp < 2
    from mcp.server.fastmcp import FastMCP as MCPServer


# --- Firebase setup ---
# You can either drop the key file next to this script,
# or set an env var TAS33_SERVICE_ACCOUNT pointing to it.
DEFAULT_KEY = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "serviceAccountKey.json")
SERVICE_ACCOUNT_PATH = os.environ.get("TAS33_SERVICE_ACCOUNT", DEFAULT_KEY)

# Whose ticks and To Do list to read when a tool isn't given a uid.
# Shared tasks belong to the whole class, so "is this done?" and "is this
# on my list?" are only answerable relative to a person. Set TAS33_UID in
# the MCP config and the tools stop needing the uid spelled out.
DEFAULT_UID = os.environ.get("TAS33_UID") or None

_db = None


def db():
    """Connect on first use.

    Deliberately not done at import time: a missing or malformed key
    would then blow up before the MCP handshake, and Claude Desktop
    would only report that the server exited, with the real reason
    buried in a log. This way the error comes back as a tool result.
    """
    global _db
    if _db is None:
        if not os.path.exists(SERVICE_ACCOUNT_PATH):
            raise FileNotFoundError(
                f"No Firebase service account key at {SERVICE_ACCOUNT_PATH}. "
                "Download one from the Firebase console "
                "(Project settings -> Service accounts -> Generate new "
                "private key), save it there, or set TAS33_SERVICE_ACCOUNT "
                "to its path."
            )
        if not firebase_admin._apps:
            firebase_admin.initialize_app(
                credentials.Certificate(SERVICE_ACCOUNT_PATH))
        _db = firestore.client()
    return _db


# --- Schema helpers ---

# announce.html still writes the original type names, and documents
# created with them are live in the collection, so calendar.html maps
# them on read. Anything reading `tasks` has to do the same or it will
# silently miss tasks -- see TYPE_ALIASES in web/calendar.html.
TYPE_ALIASES = {
    "send_on": "normal",
    "send_before": "deadline",
    "estimated": "prediction",
}
VALID_TYPES = ("normal", "deadline", "prediction", "marker")


def task_type(data: dict) -> str:
    """The canonical type of a task, resolving legacy names."""
    raw = data.get("type")
    return TYPE_ALIASES.get(raw, raw) or "normal"


# --- Points: how heavy a task is ---

# A mirror of web/tas-points.js. Kept in step by hand, like task_type()
# above -- the app is static ES modules with no build step, so there is
# nothing to share the arithmetic through. If the ladder or the bands
# change over there, they change here.
POINT_PRESETS = (10, 25, 50, 100, 200)
POINT_TYPE_BASE = {
    "normal": 50, "send_on": 50,
    "deadline": 50, "send_before": 50,
    "prediction": 25, "estimated": 25,
    "marker": 0,
}


def js_round(x: float) -> int:
    """Math.round(), not Python's round().

    Python rounds halves to even (round(12.5) == 12), JavaScript rounds
    them up. A weight that came out at exactly .5 would otherwise land on
    a different rung here than in the app.
    """
    return math.floor(x + 0.5)


def nearest_preset(points: float) -> int:
    """The rung of the ladder closest to `points`.

    Rounds first, the way nearestPreset() does by passing through
    normPoints() -- a tie at 37.5 is a tie at 38 by then, and 50 wins it.
    """
    n = js_round(points)
    return min(POINT_PRESETS, key=lambda p: abs(p - n))


def suggest_points(data: dict) -> int:
    """The estimate a task gets when nobody has weighed it.

    From its due-date kind and how many days it runs -- the same two
    readings suggestPoints() uses in web/tas-points.js.
    """
    base = POINT_TYPE_BASE.get(data.get("type") or "normal", 50)
    if not base:
        return 0

    factor = 1.0
    try:
        start = datetime.strptime(data["start"], "%Y-%m-%d").date()
        end = datetime.strptime(data["end"], "%Y-%m-%d").date()
        days = (end - start).days
        factor = (0.5 if days <= 1 else 0.75 if days <= 3 else
                  1.0 if days <= 7 else 1.5 if days <= 14 else 2.0)
    except (KeyError, TypeError, ValueError):
        pass

    return nearest_preset(base * factor)


def norm_points(v) -> int | None:
    """A stored weight, or None if it isn't a usable positive number."""
    try:
        n = js_round(float(v))
    except (TypeError, ValueError):
        return None
    return min(999, n) if n > 0 else None


def points_of(data: dict, points_map=None) -> tuple[int, bool]:
    """(points, estimated) for a task -- mirrors pointsOf() in the app.

    The user's own weight wins, then whatever the task's author set,
    then an estimate. `estimated` says nobody has actually chosen this
    number, so an assistant shouldn't report it as a decision.
    """
    if task_type(data) == "marker":
        return 0, False
    mine = norm_points((points_map or {}).get(data.get("id")))
    if mine is not None:
        return mine, False
    theirs = norm_points(data.get("difficulty"))
    if theirs is not None:
        return theirs, False
    return suggest_points(data), True


def shape_progress(p) -> dict | None:
    """A userDone progress entry as {mode, value, total, percent}."""
    if not isinstance(p, dict) or not p.get("total"):
        return None
    try:
        pct = round(p["value"] / p["total"] * 100)
    except (TypeError, ZeroDivisionError):
        return None
    return {"mode": p.get("mode"), "value": p.get("value"),
            "total": p.get("total"), "percent": pct}


def days_left(end: str | None, today: date | None = None) -> int | None:
    """Whole days from today to `end`. Negative means overdue.

    Matches the calendar's daysLeft(): dates are plain "YYYY-MM-DD"
    local dates, so this is a calendar-day difference, not elapsed time.
    """
    if not end:
        return None
    try:
        d = datetime.strptime(end, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    return (d - (today or date.today())).days


def shape(doc, done_map=None, progress_map=None, points_map=None) -> dict:
    """A task document as the app sees it."""
    data = doc.to_dict() or {}
    data["id"] = doc.id
    # points_of() reads the stored spelling, so weigh before normalising
    data["points"], data["points_estimated"] = points_of(data, points_map)
    data["type"] = task_type(data)
    if done_map is not None:
        data["done"] = bool(done_map.get(doc.id))
    if progress_map is not None:
        data["progress"] = shape_progress(progress_map.get(doc.id))
    return data


def user_state(uid: str):
    """(done, progress, difficulty) maps for a user.

    All three live in the one userDone/{uid} document: what they have
    ticked off, how far through each task they are, and any weight they
    set for themselves over the top of the task's own.
    """
    if not uid:
        return None, None, None
    snap = db().collection("userDone").document(uid).get()
    if not snap.exists:
        return {}, {}, {}
    data = snap.to_dict() or {}
    return (data.get("done") or {}, data.get("progress") or {},
            data.get("difficulty") or {})


def resolve_uid(uid: str | None) -> str | None:
    """The uid a tool should act as: explicit argument, else TAS33_UID."""
    return uid or DEFAULT_UID


def personal_tasks(uid: str) -> list:
    """This user's private tasks from userTasks/{uid}/tasks.

    A separate collection from the shared `tasks` list, and only ever
    visible to its owner -- but To Do items can point at either, so
    resolving a list needs both.
    """
    col = db().collection("userTasks").document(uid).collection("tasks")
    out = []
    for doc in col.stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        data["type"] = task_type(data)
        data["personal"] = True
        out.append(data)
    return out


def task_index(uid: str) -> dict:
    """Shared tasks plus this user's personal ones, keyed by id.

    Personal tasks win a collision, matching buildTaskIndex() in
    web/tas-todo-state.js -- they're the user's own and nobody else can
    edit them away.
    """
    index = {}
    for doc in db().collection("tasks").stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        data["type"] = task_type(data)
        data["personal"] = False
        index[doc.id] = data
    for t in personal_tasks(uid):
        index[t["id"]] = t
    return index


def order_todo_items(raw) -> list:
    """Stored todo items in the order the app displays them.

    Mirrors sanitizeItems() in web/tas-todo-state.js: drop junk, sort by
    (order, createdAt), then lift anything still carrying the retired
    Focus Deck flag to the top -- a doc that hasn't been re-saved since
    the deck was retired still renders that way in the app, and this
    view should match what the user is looking at.
    """
    if not isinstance(raw, list):
        return []
    seen, out = set(), []
    for r in raw:
        if not isinstance(r, dict):
            continue
        iid = r.get("id")
        if not isinstance(iid, str) or not iid or iid in seen:
            continue
        source = r.get("source")
        if source not in ("shared", "personal", "note"):
            source = "shared" if r.get("ref") else "note"
        ref = None if source == "note" else (r.get("ref") or None)
        # A non-note that lost its ref can only render as an orphan.
        if source != "note" and not ref:
            continue
        seen.add(iid)
        out.append({
            "id": iid, "ref": ref, "source": source,
            "text": r.get("text") or "", "notes": r.get("notes") or "",
            "order": r["order"] if isinstance(r.get("order"), (int, float)) else len(out),
            "createdAt": r.get("createdAt") or 0,
            "_deck": bool(r.get("deck")),
        })
    out.sort(key=lambda it: (it["order"], it["createdAt"]))
    return [it for it in out if it["_deck"]] + [it for it in out if not it["_deck"]]


def as_error(exc: Exception) -> dict:
    """Turn an exception into a tool result.

    Letting it propagate instead would get it replaced with a bare
    "Error executing tool list_tasks" by the SDK, with the real
    message left in a server log nobody is reading. A missing key or a
    revoked credential is the single most likely thing to go wrong
    here, so that message has to come back through the tool.
    """
    return {"error": f"{type(exc).__name__}: {exc}"}


# --- MCP server ---
mcp = MCPServer("tas-33")


@mcp.tool()
def list_tasks(
    type: str | None = None,
    subject: str | None = None,
    uid: str | None = None,
    include_done: bool = True,
    limit: int = 200,
) -> list[dict]:
    """
    Get tasks from the TAS-33 shared 'tasks' collection in Firestore.

    There is no status field on a task. Use `type` to filter by kind of
    task, and pass `uid` if you want to know what a particular person
    has ticked off.

    Args:
        type: optional filter -- "normal" (send on), "deadline"
              (send before), "prediction" (estimated) or "marker".
              Legacy names (send_on, send_before, estimated) are
              accepted and normalised.
        subject: optional exact subject name to filter by.
        uid: Firebase uid. Adds `done` and `progress` to each task from
             that user's userDone/{uid} document. Defaults to TAS33_UID
             from the environment, so it rarely needs passing.
        include_done: set False, with a uid, to drop that user's
             completed tasks.
        limit: maximum tasks to return (default 200).
    """
    if type:
        wanted = TYPE_ALIASES.get(type, type)
        if wanted not in VALID_TYPES:
            return [{"error": f"Unknown type {type!r}. "
                              f"Expected one of {', '.join(VALID_TYPES)}."}]
    else:
        wanted = None

    try:
        done_map, progress_map, points_map = user_state(resolve_uid(uid))

        # Filtered in Python rather than with a Firestore where(): a
        # where("type","==","normal") would miss every document still
        # stored under the legacy name. The collection is one class's
        # task list, so reading it whole is cheap.
        results = []
        for doc in db().collection("tasks").stream():
            task = shape(doc, done_map, progress_map, points_map)
            if wanted and task["type"] != wanted:
                continue
            if subject and task.get("subject") != subject:
                continue
            if not include_done and task.get("done"):
                continue
            results.append(task)
    except Exception as e:
        return [as_error(e)]

    # Soonest deadline first, which is the order the calendar shows.
    # Sort before truncating, so `limit` gives the most urgent N rather
    # than an arbitrary N in whatever order Firestore streamed them.
    results.sort(key=lambda t: (t.get("end") or "9999-99-99", t.get("name") or ""))
    return results[:limit]


@mcp.tool()
def get_task(task_id: str, uid: str | None = None) -> dict:
    """
    Get a single shared task by its Firestore document ID.

    Args:
        task_id: the document ID from the 'tasks' collection.
        uid: Firebase uid, to include whether that person has marked the
             task done and how far through it they are. Defaults to
             TAS33_UID from the environment.
    """
    try:
        doc = db().collection("tasks").document(task_id).get()
        if not doc.exists:
            return {"error": f"No task found with id {task_id}"}
        done_map, progress_map, points_map = user_state(resolve_uid(uid))
        return shape(doc, done_map, progress_map, points_map)
    except Exception as e:
        return as_error(e)


@mcp.tool()
def list_todo(uid: str | None = None) -> list[dict]:
    """
    Get the user's personal To Do list -- what they have picked out to
    work on, in the order they arranged it, with whether each is done.

    This is a hand-ordered shortlist drawn from the shared task list,
    their private tasks and free-typed notes. It is NOT the same as
    "tasks due today": membership is a deliberate choice the user made,
    so use this to answer "what's on my list" and list_tasks for "what
    is due when".

    Each row carries `done`, `progress`, `days_left` (negative when
    overdue) and `source` ("shared", "personal" or "note"). An item
    whose task was since deleted comes back with `orphan: true`.

    Args:
        uid: Firebase uid. Defaults to TAS33_UID from the environment.
    """
    who = resolve_uid(uid)
    if not who:
        return [{"error": "No uid. Pass uid, or set TAS33_UID in the MCP "
                          "server config so this defaults to you."}]
    try:
        snap = db().collection("todo").document(who).get()
        if not snap.exists:
            return []
        items = order_todo_items((snap.to_dict() or {}).get("items"))
        if not items:
            return []

        index = task_index(who)
        done_map, progress_map, points_map = user_state(who)
        today = date.today()

        rows = []
        for pos, it in enumerate(items):
            row = {
                "position": pos + 1,
                "id": it["id"],
                "source": it["source"],
                "notes": it["notes"],
            }
            if it["source"] == "note":
                # A free-typed note is its own content -- no task behind it,
                # so nothing to mark done against.
                row.update(title=it["text"] or "Untitled note", subject="",
                           type="note", end=None, orphan=False,
                           done=None, progress=None, days_left=None)
                rows.append(row)
                continue

            task = index.get(it["ref"])
            if task is None:
                row.update(title="Task removed", subject="", type="orphan",
                           end=None, orphan=True, task_id=it["ref"],
                           done=None, progress=None, days_left=None)
                rows.append(row)
                continue

            # Markers carry `date` where everything else carries `end`.
            end = task.get("end") or task.get("date")
            weight = points_of(task, points_map)
            row.update(
                title=task.get("name") or "Untitled task",
                subject=task.get("subject") or "",
                type=task.get("type") or "normal",
                end=end,
                orphan=False,
                task_id=task["id"],
                personal=bool(task.get("personal")),
                done=bool(done_map.get(task["id"])),
                progress=shape_progress(progress_map.get(task["id"])),
                days_left=days_left(end, today),
                # This row is hand-picked rather than spread, so a new
                # field has to be named here or it is silently dropped.
                points=weight[0],
                points_estimated=weight[1],
            )
            rows.append(row)
        return rows
    except Exception as e:
        return [as_error(e)]


@mcp.tool()
def list_personal_tasks(uid: str | None = None,
                        include_done: bool = True) -> list[dict]:
    """
    Get the user's private tasks from userTasks/{uid}/tasks.

    These are theirs alone -- not the shared class list that list_tasks
    reads. Same fields, plus `done` and `progress`.

    Args:
        uid: Firebase uid. Defaults to TAS33_UID from the environment.
        include_done: set False to drop the ones already ticked off.
    """
    who = resolve_uid(uid)
    if not who:
        return [{"error": "No uid. Pass uid, or set TAS33_UID in the MCP "
                          "server config so this defaults to you."}]
    try:
        done_map, progress_map, points_map = user_state(who)
        today = date.today()
        rows = []
        for t in personal_tasks(who):
            t["done"] = bool(done_map.get(t["id"]))
            if not include_done and t["done"]:
                continue
            t["progress"] = shape_progress(progress_map.get(t["id"]))
            t["points"], t["points_estimated"] = points_of(t, points_map)
            t["days_left"] = days_left(t.get("end") or t.get("date"), today)
            rows.append(t)
        rows.sort(key=lambda t: (t.get("end") or "9999-99-99", t.get("name") or ""))
        return rows
    except Exception as e:
        return [as_error(e)]


if __name__ == "__main__":
    mcp.run(transport="stdio")
