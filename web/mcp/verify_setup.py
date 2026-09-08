r"""
Check the TAS-33 MCP server can actually reach Firestore.

Run this after dropping serviceAccountKey.json next to it:

    .venv\Scripts\python.exe verify_setup.py

It only reads, and it prints no task text -- just counts and field
names -- so it is safe to paste the output anywhere.
"""
import json
import os
import sys

import tas33_mcp_server as s

EXPECTED_PROJECT = "tas-samtabsam"


def main() -> int:
    print(f"key path : {s.SERVICE_ACCOUNT_PATH}")
    if not os.path.exists(s.SERVICE_ACCOUNT_PATH):
        print("\nFAIL: no key file there yet. See README.md step 3.")
        return 1

    try:
        with open(s.SERVICE_ACCOUNT_PATH, encoding="utf-8") as fh:
            key = json.load(fh)
    except json.JSONDecodeError as e:
        print(f"\nFAIL: that file isn't valid JSON ({e}). Re-download it.")
        return 1

    missing = [k for k in ("type", "project_id", "private_key", "client_email")
               if k not in key]
    if missing:
        print(f"\nFAIL: key is missing {', '.join(missing)}. That's probably a "
              "Web/OAuth client config, not a service account key -- make sure "
              "you used Project settings -> Service accounts.")
        return 1

    print(f"project  : {key['project_id']}")
    print(f"account  : {key['client_email']}")
    if key["project_id"] != EXPECTED_PROJECT:
        print(f"\nFAIL: that key is for {key['project_id']!r}, but TAS-33 is "
              f"{EXPECTED_PROJECT!r}. Wrong Firebase project selected.")
        return 1

    print("\nconnecting to Firestore...")
    try:
        tasks = s.list_tasks(limit=1000)
    except Exception as e:
        print(f"\nFAIL: {type(e).__name__}: {e}")
        return 1

    if tasks and isinstance(tasks[0], dict) and "error" in tasks[0] and len(tasks) == 1:
        print(f"\nFAIL: {tasks[0]['error']}")
        return 1

    print(f"OK: read {len(tasks)} task(s) from the 'tasks' collection.")

    by_type: dict[str, int] = {}
    fields: set[str] = set()
    for t in tasks:
        by_type[t.get("type", "?")] = by_type.get(t.get("type", "?"), 0) + 1
        fields.update(t.keys())
    if by_type:
        print("types    : " + ", ".join(f"{k}={v}" for k, v in sorted(by_type.items())))
        print("fields   : " + ", ".join(sorted(fields)))
    if "status" in fields:
        print("\nNOTE: a 'status' field turned up in live data. It isn't written "
              "by calendar.html or announce.html -- worth a look before relying "
              "on the type filter.")

    print("\nAll good. Wire it into Claude with the config in README.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
