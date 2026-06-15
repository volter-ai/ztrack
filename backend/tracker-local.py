import json
import os
import re
import sys
import shlex
import sqlite3
import subprocess
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

project_root = Path(os.environ["PROJECT_ROOT"])
config_path = Path(os.environ["CONFIG_FILE"])
config = json.loads(config_path.read_text())
local_config = config.get("local", {}) if isinstance(config.get("local"), dict) else {}
linear_config = config.get("linear", {}) if isinstance(config.get("linear"), dict) else {}
team_key = str(local_config.get("teamKey") or linear_config.get("teamKey") or "LOCAL").upper()
RUNNABLE_ASSIGNEE = os.environ.get("TRACKER_RUNNABLE_ASSIGNEE", "operator")


def canonical_project_root():
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=project_root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        common = Path(result.stdout.strip())
        return common.parent if common.name == ".git" else project_root
    except Exception:
        return project_root


canonical_root = canonical_project_root()
database_rel = str(local_config.get("database") or ".volter/tracker/tracker.sqlite")
database_path = Path(database_rel)
if not database_path.is_absolute():
    database_path = canonical_root / database_path

store_rel = str(local_config.get("store") or ".volter/tracker/local-store.json")
store_path = Path(store_rel)
if not store_path.is_absolute():
    store_path = canonical_root / store_path

lock_path = database_path.with_suffix(database_path.suffix + ".lock")
AUDIT_FIELDS = [
    "title",
    "body",
    "state",
    "stateType",
    "devProgress",
    "labels",
    "assignee",
    "projectId",
    "parentId",
    "priority",
    "completedAt",
    "canceledAt",
]


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def slug(value):
    out = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return out or "item"


def safe_text(value):
    return "" if value is None else str(value)


def default_store():
    return {
        "version": 1,
        "teamKey": team_key,
        "nextIssueNumber": 1,
        "labels": {},
        "projects": {},
        "issues": {},
        "comments": {},
        "relations": [],
        "sprints": {},
    }


def ensure_database():
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database_path, timeout=30) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("CREATE TABLE IF NOT EXISTS tracker_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tracker_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                issue_identifier TEXT,
                field TEXT,
                old_value TEXT,
                new_value TEXT,
                metadata TEXT NOT NULL DEFAULT '{}'
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS tracker_audit_log_issue_idx ON tracker_audit_log(issue_identifier, created_at, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS tracker_audit_log_entity_idx ON tracker_audit_log(entity_type, entity_id, created_at, id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tracker_issue_index (
                identifier TEXT PRIMARY KEY,
                state TEXT,
                state_type TEXT,
                project_id TEXT,
                project_name TEXT,
                assignee TEXT,
                blocked INTEGER NOT NULL DEFAULT 0,
                blocks INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT
            )
        """)
        conn.execute("CREATE TABLE IF NOT EXISTS tracker_issue_label_index (identifier TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY(identifier, label))")
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS tracker_search USING fts5(
                kind UNINDEXED,
                ref UNINDEXED,
                issue_identifier UNINDEXED,
                title,
                body,
                labels,
                project,
                comments,
                tokenize='porter unicode61'
            )
        """)
        conn.commit()


def read_sqlite_store():
    if not database_path.exists():
        return None
    ensure_database()
    with sqlite3.connect(database_path, timeout=30) as conn:
        row = conn.execute("SELECT value FROM tracker_store WHERE key = 'store'").fetchone()
    if not row:
        return None
    data = json.loads(row[0])
    with sqlite3.connect(database_path, timeout=30) as conn:
        count = conn.execute("SELECT COUNT(*) FROM tracker_search").fetchone()[0]
        if count == 0 and data.get("issues"):
            conn.execute("BEGIN IMMEDIATE")
            rebuild_search_index(conn, data)
            conn.commit()
    return data


def json_clone(value):
    return json.loads(json.dumps(value))


def audit_actor():
    return os.environ.get("TRACKER_AUDIT_ACTOR") or os.environ.get("USER") or "local"


def audit_value(value):
    return json.dumps(value, sort_keys=True)


def append_audit_entries(conn, entries):
    for entry in entries or []:
        conn.execute(
            """
            INSERT INTO tracker_audit_log(
                created_at, actor, action, entity_type, entity_id, issue_identifier,
                field, old_value, new_value, metadata
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entry.get("createdAt") or now(),
                entry.get("actor") or audit_actor(),
                entry.get("action", ""),
                entry.get("entityType", ""),
                entry.get("entityId", ""),
                entry.get("issueIdentifier"),
                entry.get("field"),
                audit_value(entry.get("oldValue")) if "oldValue" in entry else None,
                audit_value(entry.get("newValue")) if "newValue" in entry else None,
                audit_value(entry.get("metadata", {})),
            ),
        )


def write_sqlite_store(data, audit_entries=None):
    ensure_database()
    with sqlite3.connect(database_path, timeout=30, isolation_level=None) as conn:
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "INSERT INTO tracker_store(key, value) VALUES('store', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(data, indent=2, sort_keys=True) + "\n",),
        )
        append_audit_entries(conn, audit_entries or [])
        rebuild_search_index(conn, data)
        conn.commit()


def relation_rows_for(data):
    rows = []
    issues = data.get("issues", {})
    for relation in data.get("relations", []):
        source = issues.get(relation.get("issueId", ""))
        target = issues.get(relation.get("relatedIssueId", ""))
        if not source or not target:
            continue
        rows.append({
            "type": relation.get("type", "related"),
            "issue": source["identifier"],
            "relatedIssue": target["identifier"],
        })
    return rows


def rebuild_search_index(conn, data):
    issues = data.get("issues", {})
    projects = data.get("projects", {})
    comments = data.get("comments", {})
    relations = relation_rows_for(data)
    conn.execute("DELETE FROM tracker_issue_index")
    conn.execute("DELETE FROM tracker_issue_label_index")
    conn.execute("DELETE FROM tracker_search")
    for issue in issues.values():
        project = projects.get(issue.get("projectId") or "")
        labels = list(issue.get("labels", []))
        issue_comments = comments.get(issue["id"], [])
        blocked = any(row["type"] == "blocks" and row["relatedIssue"] == issue["identifier"] for row in relations)
        blocks = any(row["type"] == "blocks" and row["issue"] == issue["identifier"] for row in relations)
        conn.execute(
            """
            INSERT INTO tracker_issue_index(identifier, state, state_type, project_id, project_name, assignee, blocked, blocks, updated_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                issue["identifier"],
                issue.get("state", "Todo"),
                issue.get("stateType", "open"),
                issue.get("projectId", ""),
                project.get("name", "") if project else "",
                issue.get("assignee", ""),
                1 if blocked else 0,
                1 if blocks else 0,
                issue.get("updatedAt", ""),
            ),
        )
        for label in labels:
            conn.execute("INSERT OR IGNORE INTO tracker_issue_label_index(identifier, label) VALUES(?, ?)", (issue["identifier"], label))
        conn.execute(
            "INSERT INTO tracker_search(kind, ref, issue_identifier, title, body, labels, project, comments) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "issue",
                issue["identifier"],
                issue["identifier"],
                f"{safe_text(issue.get('identifier'))} {safe_text(issue.get('title'))} {safe_text(issue.get('branchName'))} {safe_text(issue.get('url'))}",
                safe_text(issue.get("body")),
                " ".join(labels),
                f"{safe_text(project.get('name'))} {safe_text(project.get('description'))}" if project else "",
                " ".join(safe_text(comment.get("body")) for comment in issue_comments),
            ),
        )
        for index, comment in enumerate(issue_comments):
            conn.execute(
                "INSERT INTO tracker_search(kind, ref, issue_identifier, title, body, labels, project, comments) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "comment",
                    f"{issue['identifier']}#comment-{index + 1}",
                    issue["identifier"],
                    safe_text(issue.get("title")),
                    "",
                    " ".join(labels),
                    safe_text(project.get("name")) if project else "",
                    safe_text(comment.get("body")),
                ),
            )
    for project in projects.values():
        conn.execute(
            "INSERT INTO tracker_search(kind, ref, issue_identifier, title, body, labels, project, comments) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "project",
                project["id"],
                "",
                safe_text(project.get("name")),
                safe_text(project.get("description")),
                "",
                f"{safe_text(project.get('name'))} {safe_text(project.get('state'))}",
                "",
            ),
        )


def fts_query(text):
    terms = [term for term in re.findall(r'"([^"]+)"|(\S+)', text or "") for term in term if term]
    return " OR ".join(f'"{term.replace(chr(34), chr(34) + chr(34))}"' for term in terms)


def load_store():
    data = read_sqlite_store()
    if data is None and store_path.exists():
        try:
            data = json.loads(store_path.read_text())
        except json.JSONDecodeError:
            data = default_store()
    if data is None:
        data = default_store()
    base = default_store()
    for key, value in data.items():
        base[key] = value
    base["teamKey"] = str(base.get("teamKey") or team_key).upper()
    return base


store = load_store()
team_key = str(store.get("teamKey") or team_key).upper()


def save_store(audit_entries=None):
    write_sqlite_store(store, audit_entries or [])


def issue_audit_entries(action, before, after, metadata=None, created_at=None):
    metadata = metadata or {}
    created_at = created_at or now()
    if before is None and after is None:
        return []
    issue = after or before
    identifier = issue.get("identifier") or issue.get("id")
    entries = []
    if before is None:
        fields = AUDIT_FIELDS
    elif after is None:
        fields = AUDIT_FIELDS
    else:
        fields = [field for field in AUDIT_FIELDS if before.get(field) != after.get(field)]
    for field in fields:
        entries.append({
            "createdAt": created_at,
            "action": action,
            "entityType": "issue",
            "entityId": identifier,
            "issueIdentifier": identifier,
            "field": field,
            "oldValue": None if before is None else before.get(field),
            "newValue": None if after is None else after.get(field),
            "metadata": metadata,
        })
    if action in {"comment", "relate", "unrelate"} and not entries:
        entries.append({
            "createdAt": created_at,
            "action": action,
            "entityType": "issue",
            "entityId": identifier,
            "issueIdentifier": identifier,
            "field": None,
            "metadata": metadata,
        })
    return entries


def read_audit_entries(issue_identifier=None, limit=100):
    ensure_database()
    clauses = []
    params = []
    if issue_identifier:
        clauses.append("issue_identifier = ?")
        params.append(issue_identifier)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"""
        SELECT id, created_at, actor, action, entity_type, entity_id, issue_identifier,
               field, old_value, new_value, metadata
        FROM tracker_audit_log
        {where}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    """
    params.append(limit)
    with sqlite3.connect(database_path, timeout=30) as conn:
        rows = conn.execute(sql, params).fetchall()
    entries = []
    for row in rows:
        entries.append({
            "id": row[0],
            "createdAt": row[1],
            "actor": row[2],
            "action": row[3],
            "entityType": row[4],
            "entityId": row[5],
            "issueIdentifier": row[6],
            "field": row[7],
            "oldValue": json.loads(row[8]) if row[8] is not None else None,
            "newValue": json.loads(row[9]) if row[9] is not None else None,
            "metadata": json.loads(row[10] or "{}"),
        })
    return entries


def state_history_summary(issue):
    identifier = issue["identifier"]
    entries = list(reversed(read_audit_entries(identifier, limit=5000)))
    state_changes = [
        entry for entry in entries
        if entry.get("field") in {"state", "stateType", "devProgress"}
    ]
    current_state = {
        "state": issue.get("state", ""),
        "stateType": issue.get("stateType", ""),
        "devProgress": issue.get("devProgress", ""),
    }
    since = None
    for entry in state_changes:
        field = entry.get("field")
        if current_state.get(field) == entry.get("newValue"):
            since = entry.get("createdAt")
    return {
        "current": current_state,
        "since": since,
        "changes": state_changes,
    }


@contextmanager
def tracker_process_lock():
    import fcntl

    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def refresh_store():
    global store
    global team_key
    store = load_store()
    team_key = str(store.get("teamKey") or team_key).upper()


def parse_opts(args):
    opts = {}
    positionals = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            key = arg[2:]
            if key in {
                "force",
                "no-project",
                "comments",
                "remove-project",
                "remove-parent",
                "has-comments",
                "has-children",
                "unassigned",
                "allow-empty-body",
                "remove-dev-progress",
            }:
                opts[key] = True
                i += 1
            elif i + 1 < len(args):
                opts.setdefault(key, []).append(args[i + 1])
                i += 2
            else:
                opts[key] = ""
                i += 1
        elif arg in {"-l", "-a", "-b", "-F", "-q", "-L"}:
            key = {"-l": "label", "-a": "assignee", "-b": "body", "-F": "body-file", "-q": "jq", "-L": "limit"}[arg]
            if i + 1 < len(args):
                opts.setdefault(key, []).append(args[i + 1])
                i += 2
            else:
                opts[key] = ""
                i += 1
        else:
            positionals.append(arg)
            i += 1
    return positionals, opts


def first(opts, key, default=""):
    value = opts.get(key, default)
    if isinstance(value, list):
        return value[-1] if value else default
    return value


def all_values(opts, key):
    value = opts.get(key, [])
    if isinstance(value, list):
        return value
    return [value] if value else []


def read_body(opts, *, allow_empty=False):
    body = first(opts, "body", "")
    body_file = first(opts, "body-file", "")
    if body_file:
        body = Path(body_file).read_text()
        if not body and not allow_empty:
            sys.exit(
                "tracker: refusing to replace body with empty --body-file; "
                "pass --allow-empty-body if this is intentional"
            )
    return body


def read_comment(opts):
    body = first(opts, "comment", "")
    body_file = first(opts, "comment-file", "")
    if body_file:
        body = Path(body_file).read_text()
    return body


def issue_number(identifier):
    match = re.search(r"(\d+)$", identifier)
    return int(match.group(1)) if match else 0


def issue_id_from_ref(ref):
    if ref in store["issues"]:
        return ref
    if ref.isdigit():
        candidate = f"{team_key}-{ref}"
        if candidate in store["issues"]:
            return candidate
    upper = ref.upper()
    if upper in store["issues"]:
        return upper
    return ref


def project_id_from_ref(ref):
    if ref in store["projects"]:
        return ref
    for project in store["projects"].values():
        if project.get("name") == ref:
            return project["id"]
    return ref


def normalize_project_status(status):
    return {"active": "started", "done": "completed"}.get(status, status)


def normalize_issue(issue):
    project = store["projects"].get(issue.get("projectId") or "")
    parent = store["issues"].get(issue.get("parentId") or "")
    children = [child for child in store["issues"].values() if child.get("parentId") == issue["id"]]
    comments = store["comments"].get(issue["id"], [])
    return {
        "id": issue["id"],
        "identifier": issue["identifier"],
        "number": issue["identifier"],
        "title": safe_text(issue.get("title")),
        "branchName": issue.get("branchName"),
        "description": safe_text(issue.get("body")),
        "body": safe_text(issue.get("body")),
        "state": {"name": issue.get("state", "Todo"), "type": issue.get("stateType", "open")},
        "stateType": issue.get("stateType", "open"),
        "devProgress": issue.get("devProgress", ""),
        "priority": issue.get("priority", 0),
        "url": issue.get("url", ""),
        "labels": {"nodes": [{"name": name} for name in issue.get("labels", [])]},
        "assignee": {"name": issue.get("assignee", "")} if issue.get("assignee") else None,
        "assignees": {"nodes": ([{"name": issue.get("assignee", "")}] if issue.get("assignee") else [])},
        "project": {"id": project["id"], "name": project["name"]} if project else None,
        "parent": {"id": parent["id"], "identifier": parent["identifier"]} if parent else None,
        "children": {"nodes": [normalize_issue(child) for child in children]},
        "comments": {"nodes": comments},
        "createdAt": issue.get("createdAt"),
        "updatedAt": issue.get("updatedAt"),
        "completedAt": issue.get("completedAt"),
        "canceledAt": issue.get("canceledAt"),
    }


def jq_value(value, expr):
    if not expr or expr == ".":
        return value
    if expr.startswith("[.labels[].name | select(. == ") and expr.endswith(")] | length"):
        wanted = expr.split('select(. == ', 1)[1].split(')', 1)[0].strip().strip('"').strip("'")
        labels_value = value.get("labels", []) if isinstance(value, dict) else []
        names = []
        if isinstance(labels_value, dict):
            names = [str(item.get("name", "")) for item in labels_value.get("nodes", []) if isinstance(item, dict)]
        elif isinstance(labels_value, list):
            names = [str(item.get("name", item)) if isinstance(item, dict) else str(item) for item in labels_value]
        return len([name for name in names if name == wanted])
    current = value
    for part in expr.lstrip(".").split("."):
        if isinstance(current, dict):
            current = current.get(part, "")
        elif isinstance(current, list) and part == "[-1]":
            current = current[-1] if current else {}
        elif isinstance(current, list) and part.isdigit():
            idx = int(part)
            current = current[idx] if idx < len(current) else ""
        else:
            return ""
    return current


def print_jq(value, expr):
    out = jq_value(value, expr)
    if isinstance(out, str):
        print(out)
    else:
        print(json.dumps(out, indent=2))


def issue_labels(issue):
    return list(issue.get("labels", []))


def issue_project(issue):
    project = store["projects"].get(issue.get("projectId") or "")
    return {"id": project["id"], "name": project["name"], "state": project.get("state", "started")} if project else None


def issue_text_blob(issue):
    project = issue_project(issue) or {}
    comments = store["comments"].get(issue["id"], [])
    blockers = blockers_for(issue)
    blocked = blocks_for(issue)
    parts = [
        safe_text(issue.get("identifier")),
        safe_text(issue.get("title")),
        safe_text(issue.get("body")),
        safe_text(issue.get("branchName")),
        safe_text(issue.get("url")),
        safe_text(issue.get("assignee")),
        safe_text(project.get("name")),
        safe_text(project.get("description")),
        " ".join(issue.get("labels", [])),
        " ".join(safe_text(comment.get("body")) for comment in comments),
        " ".join(
            " ".join([
                safe_text(related.get("identifier")),
                safe_text(related.get("title")),
                " ".join(safe_text(comment.get("body")) for comment in related.get("recentComments", [])),
            ])
            for related in blockers + blocked
        ),
    ]
    external = issue.get("external", {})
    if isinstance(external, dict):
        parts.extend(str(value) for value in external.values())
    return "\n".join(part for part in parts if part).lower()


def text_score(issue, query):
    terms = [term.lower() for term in re.findall(r'"([^"]+)"|(\S+)', query) for term in term if term]
    if not terms:
        return 0
    title = safe_text(issue.get("title")).lower()
    body = safe_text(issue.get("body")).lower()
    blob = issue_text_blob(issue)
    score = 0
    for term in terms:
        if term in title:
            score += 8
        if term in body:
            score += 3
        if term in blob:
            score += 1
    return score


def parse_time_filter(value):
    if not value:
        return None
    text = str(value).strip()
    rel = re.fullmatch(r"(\d+)([dhwm])", text)
    if rel:
        amount = int(rel.group(1))
        unit = rel.group(2)
        delta = {
            "d": timedelta(days=amount),
            "h": timedelta(hours=amount),
            "w": timedelta(weeks=amount),
            "m": timedelta(days=30 * amount),
        }[unit]
        return datetime.now(timezone.utc) - delta
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def issue_time(issue, field):
    value = issue.get(field)
    if not value:
        return None
    try:
        text = str(value)
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def bool_opt(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def relation_rows():
    rows = []
    for relation in store.get("relations", []):
        source = store["issues"].get(relation.get("issueId", ""))
        target = store["issues"].get(relation.get("relatedIssueId", ""))
        if not source or not target:
            continue
        rows.append({
            "type": relation.get("type", "related"),
            "issue": source["identifier"],
            "issueTitle": source["title"],
            "relatedIssue": target["identifier"],
            "relatedIssueTitle": target["title"],
            "createdAt": relation.get("createdAt"),
        })
    return sorted(rows, key=lambda row: (row["issue"], row["relatedIssue"], row["type"]))


def blockers_for(issue):
    out = []
    for row in relation_rows():
        if row["type"] == "blocks" and row["relatedIssue"] == issue["identifier"]:
            blocker = store["issues"].get(row["issue"])
            if blocker and blocker.get("stateType") not in {"completed", "canceled"}:
                out.append(issue_summary(blocker, include_comments=True))
    return out


def blocks_for(issue):
    out = []
    for row in relation_rows():
        if row["type"] == "blocks" and row["issue"] == issue["identifier"]:
            blocked = store["issues"].get(row["relatedIssue"])
            if blocked:
                out.append(issue_summary(blocked, include_comments=False))
    return out


def issue_summary(issue, include_comments=False):
    comments = store["comments"].get(issue["id"], [])
    labels = issue_labels(issue)
    is_skill_activity = "operation" in {label.lower() for label in labels} or any(label.lower().startswith("skill:") for label in labels)
    return {
        "identifier": issue["identifier"],
        "title": "Automation run happened" if is_skill_activity else issue["title"],
        "state": issue.get("state", "Todo"),
        "stateType": issue.get("stateType", "open"),
        "pmStage": issue.get("state", "Draft"),
        "blocked": bool(blockers_for(issue)),
        "labels": [label for label in labels if not label.lower().startswith("skill:")],
        "assignee": issue.get("assignee", ""),
        "project": issue_project(issue),
        "parent": store["issues"].get(issue.get("parentId") or "", {}).get("identifier"),
        "branchName": issue.get("branchName"),
        "updatedAt": issue.get("updatedAt"),
        **({"recentComments": comments[-3:]} if include_comments else {}),
    }


def issue_field(issue, field):
    if field in {"id", "identifier", "title", "body", "description", "priority", "url", "branchName", "devProgress", "createdAt", "updatedAt", "completedAt", "canceledAt"}:
        if field == "description":
            return issue.get("body", "")
        return issue.get(field, "")
    if field == "number":
        return issue["identifier"]
    if field == "state":
        return issue.get("state", "Todo")
    if field == "stateType":
        return issue.get("stateType", "open")
    if field == "labels":
        return list(issue.get("labels", []))
    if field == "assignee":
        return issue.get("assignee", "")
    if field == "assignees":
        assignee = issue.get("assignee", "")
        return [assignee] if assignee else []
    if field == "project":
        return issue_project(issue)
    if field == "parent":
        return store["issues"].get(issue.get("parentId") or "", {}).get("identifier", "")
    if field == "comments":
        return store["comments"].get(issue["id"], [])
    data = normalize_issue(issue)
    if field == "children":
        return [
            {
                "id": child["id"],
                "identifier": child["identifier"],
                "number": child["identifier"],
                "title": child["title"],
                "state": child["state"]["name"],
                "stateType": child["state"].get("type", ""),
            }
            for child in data["children"]["nodes"]
        ]
    return data.get(field, "")


def is_housekeeping_issue(issue):
    labels = {label.lower() for label in issue_labels(issue)}
    text = f"{safe_text(issue.get('title'))} {safe_text(issue.get('body'))}".lower()
    housekeeping_labels = {
        "maturity",
        "kaizen",
        "system-maintenance",
        "issue-audit",
        "orchestration-cleanup",
        "process-housekeeping",
    }
    return bool(labels & housekeeping_labels) or any(token in text for token in ["/issue-audit", "maturity check", "system maintenance"])


def is_execution_relevant(issue):
    labels = {label.lower() for label in issue_labels(issue)}
    if is_housekeeping_issue(issue):
        return False
    if issue.get("state") in {
        "Draft",
        "Ready",
        "In Progress",
        "In Review",
        "Ready to Close",
    }:
        return True
    return bool(labels & {
        "active-stack",
        "roadmap",
        "type:task",
        "type:delivery",
        "type:stakeholder-decision",
        "type:escalation",
        "type:topic",
        "source:stakeholder",
        "account-manager",
    }) or bool(issue.get("projectId"))


def pm_snapshot_model():
    all_issues = list(store["issues"].values())
    issues = [issue for issue in all_issues if is_execution_relevant(issue)]
    active_projects = [
        {
            "id": project["id"],
            "name": project["name"],
            "state": project.get("state", "started"),
            "targetDate": project.get("targetDate", ""),
            "updatedAt": project.get("updatedAt"),
        }
        for project in store["projects"].values()
        if project.get("state", "started") in {"started", "active", "planned"}
    ]
    active_stack = [issue for issue in issues if "active-stack" in issue_labels(issue)]
    def open_stage(stage):
        return [
            issue for issue in all_issues
            if issue.get("state") == stage
            and issue.get("stateType") not in {"completed", "canceled"}
        ]
    def in_progress_with_dev_progress(progress):
        return [
            issue for issue in all_issues
            if issue.get("state") == "In Progress"
            and (issue.get("devProgress") or "").lower() == progress
            and issue.get("stateType") not in {"completed", "canceled"}
        ]

    ready = [
        issue for issue in issues
        if issue.get("state") == "Ready"
        and issue.get("stateType") not in {"completed", "canceled"}
        and (issue.get("assignee") or "") == RUNNABLE_ASSIGNEE
        and not blockers_for(issue)
    ]
    blocked = [
        issue for issue in issues
        if blockers_for(issue)
    ]
    delivery = [
        issue for issue in issues
        if issue.get("state") == "In Progress"
        and (issue.get("devProgress") or "").lower() in {"ready for export", "exporting"}
        and issue.get("stateType") not in {"completed", "canceled"}
    ]
    lifecycle = {
        "backlog": [
            issue for issue in all_issues
            if issue.get("state") == "Backlog"
            and issue.get("stateType") == "backlog"
        ],
        "draft": open_stage("Draft"),
        "ready": open_stage("Ready"),
        "developing": in_progress_with_dev_progress("developing"),
        "readyForDelivery": in_progress_with_dev_progress("ready for export"),
        "delivering": in_progress_with_dev_progress("exporting"),
        "inReview": open_stage("In Review"),
        "readyToClose": open_stage("Ready to Close"),
        "done": [
            issue for issue in all_issues
            if issue.get("stateType") == "completed"
        ],
        "canceled": [
            issue for issue in all_issues
            if issue.get("stateType") == "canceled"
        ],
    }
    decisions = [
        issue for issue in issues
        if issue.get("stateType") not in {"completed", "canceled"}
        and {"type:stakeholder-decision", "type:escalation"} & {label.lower() for label in issue_labels(issue)}
    ]
    excluded = [
        issue
        for issue in store["issues"].values()
        if is_housekeeping_issue(issue)
    ]
    old = [
        issue for issue in issues
        if issue.get("stateType") in {"completed", "canceled"}
    ]
    return {
        "schemaVersion": 1,
        "kind": "project-manager-snapshot",
        "generatedAt": now(),
        "backend": "local",
        "teamKey": team_key,
        "activeProjects": sorted(active_projects, key=lambda item: item["name"]),
        "activeStack": [issue_summary(issue) for issue in sorted(active_stack, key=lambda item: issue_number(item["identifier"]))],
        "lifecycle": {
            key: [issue_summary(issue) for issue in sorted(value, key=lambda item: issue_number(item["identifier"]))]
            for key, value in lifecycle.items()
        },
        "readyRunnable": [issue_summary(issue) for issue in sorted(ready, key=lambda item: issue_number(item["identifier"]))],
        "blockedOrWaiting": [
            {
                **issue_summary(issue, include_comments=True),
                "blockedBy": blockers_for(issue),
                "blocks": blocks_for(issue),
            }
            for issue in sorted(blocked, key=lambda item: issue_number(item["identifier"]))
        ],
        "stakeholderAndEscalationBlockers": [
            {
                **issue_summary(issue, include_comments=True),
                "blocks": blocks_for(issue),
            }
            for issue in sorted(decisions, key=lambda item: issue_number(item["identifier"]))
        ],
        "deliveryIssues": [issue_summary(issue, include_comments=True) for issue in sorted(delivery, key=lambda item: issue_number(item["identifier"]))],
        "relations": relation_rows(),
        "omittedHistory": {
            "completedOrCanceled": len(old),
            "housekeeping": len(excluded),
        },
    }


def format_issue_line(issue):
    labels = ", ".join(issue.get("labels", [])) or "no-labels"
    project = issue.get("project")
    project_text = f" | project: {project['name']} ({project.get('state','')})" if project else ""
    assignee = f" | assignee: {issue['assignee']}" if issue.get("assignee") else ""
    return f"- {issue['identifier']} {issue['state']} [{labels}]{project_text}{assignee} | {issue['title']}"


def render_pm_snapshot(snapshot):
    lines = [
        "Project Manager Snapshot",
        f"Generated: {snapshot['generatedAt']}",
        f"Backend: {snapshot['backend']}",
        f"Team: {snapshot['teamKey']}",
        "",
        "Active Projects",
    ]
    if snapshot["activeProjects"]:
        for project in snapshot["activeProjects"]:
            target = f" target={project['targetDate']}" if project.get("targetDate") else ""
            lines.append(f"- {project['name']} ({project['id']}) state={project['state']}{target}")
    else:
        lines.append("- none")
    lifecycle = snapshot.get("lifecycle") or {}
    for title, key in [
        ("Backlog", "backlog"),
        ("Draft", "draft"),
        ("Ready", "ready"),
        ("In Progress / developing", "developing"),
        ("In Progress / ready for export", "readyForDelivery"),
        ("In Progress / exporting", "delivering"),
        ("In Review", "inReview"),
        ("Ready to Close", "readyToClose"),
        ("Done", "done"),
        ("Canceled", "canceled"),
    ]:
        lines.extend(["", title])
        items = lifecycle.get(key, [])
        if not items:
            lines.append("- none")
            continue
        for item in items:
            lines.append(format_issue_line(item))
    for title, key in [
        ("Blocked Overlay", "blockedOrWaiting"),
        ("Stakeholder / Escalation Blockers", "stakeholderAndEscalationBlockers"),
    ]:
        lines.extend(["", title])
        items = snapshot[key]
        if not items:
            lines.append("- none")
            continue
        for item in items:
            lines.append(format_issue_line(item))
            if key == "blockedOrWaiting" and item.get("blockedBy"):
                for blocker in item["blockedBy"]:
                    lines.append(f"  blocked by: {blocker['identifier']} {blocker['state']} | {blocker['title']}")
            if item.get("blocks"):
                for blocked in item["blocks"]:
                    lines.append(f"  blocks: {blocked['identifier']} {blocked['state']} | {blocked['title']}")
            comments = item.get("recentComments") or []
            for comment in comments[-2:]:
                body = " ".join(str(comment.get("body", "")).split())[:180]
                if body:
                    lines.append(f"  comment: {comment.get('createdAt','')[:19]} {body}")
    lines.extend(["", "Relations"])
    if snapshot["relations"]:
        for relation in snapshot["relations"]:
            if relation["type"] == "blocks":
                lines.append(f"- {relation['issue']} blocks {relation['relatedIssue']}")
            else:
                lines.append(f"- {relation['issue']} {relation['type']} {relation['relatedIssue']}")
    else:
        lines.append("- none")
    omitted = snapshot.get("omittedHistory") or {}
    lines.extend(["", "Omitted History"])
    lines.append(f"- completed/canceled old issues omitted: {omitted.get('completedOrCanceled', 0)}")
    lines.append(f"- housekeeping automation records omitted: {omitted.get('housekeeping', 0)}")
    return "\n".join(lines)


def snapshot_cmd(action, args):
    if action not in {"project-manager", "pm"}:
        sys.exit(f"tracker snapshot: unknown snapshot '{action}'")
    _, opts = parse_opts(args)
    fmt = first(opts, "format", "text") or ("json" if "json" in opts else "text")
    snapshot = pm_snapshot_model()
    if fmt == "json":
        print(json.dumps(snapshot, indent=2, sort_keys=True))
    else:
        print(render_pm_snapshot(snapshot))


def ensure_label(name, description="", color=""):
    label = store["labels"].get(name)
    if not label:
        label = {"id": f"label-{slug(name)}", "name": name, "description": description, "color": color}
        store["labels"][name] = label
    else:
        if description:
            label["description"] = description
        if color:
            label["color"] = color
    return label


def label_cmd(action, args):
    if action == "create":
        if not args:
            sys.exit("tracker label create: missing name")
        name = args[0]
        _, opts = parse_opts(args[1:])
        ensure_label(name, first(opts, "description", ""), first(opts, "color", ""))
        save_store()
        print(name)
        return
    if action == "list":
        for label in sorted(store["labels"].values(), key=lambda x: x["name"]):
            print(f"{label['name']}\t{label.get('color','')}")
        return
    if action == "view":
        if not args:
            sys.exit("tracker label view: missing name")
        label = store["labels"].get(args[0])
        if not label:
            sys.exit(f"tracker label view: label '{args[0]}' not found")
        _, opts = parse_opts(args[1:])
        json_fields = first(opts, "json", "")
        data = label
        if json_fields:
            fields = [f.strip() for f in json_fields.split(",") if f.strip()]
            data = {field: label.get(field, "") for field in fields}
        jq_expr = first(opts, "jq", "")
        print_jq(data, jq_expr) if jq_expr else print(json.dumps(data, indent=2))
        return
    if action == "delete":
        if not args:
            sys.exit("tracker label delete: missing name")
        store["labels"].pop(args[0], None)
        for issue in store["issues"].values():
            issue["labels"] = [label for label in issue.get("labels", []) if label != args[0]]
        save_store()
        print("Deleted")
        return
    sys.exit(f"tracker label: unknown action '{action}'")


def project_cmd(action, args):
    if action == "create":
        if not args:
            sys.exit("tracker project create: missing name")
        name = args[0]
        _, opts = parse_opts(args[1:])
        existing = next((p for p in store["projects"].values() if p["name"] == name), None)
        if existing:
            print(f"{existing['id']}\t{existing['name']}")
            return
        project_id = f"project-{slug(name)}"
        suffix = 2
        while project_id in store["projects"]:
            project_id = f"project-{slug(name)}-{suffix}"
            suffix += 1
        project = {
            "id": project_id,
            "name": name,
            "description": first(opts, "description", ""),
            "state": normalize_project_status(first(opts, "status", "started") or "started"),
            "targetDate": first(opts, "target-date", ""),
            "createdAt": now(),
            "updatedAt": now(),
        }
        store["projects"][project_id] = project
        save_store()
        print(f"{project_id}\t{name}")
        return
    if action == "list":
        _, opts = parse_opts(args)
        status = first(opts, "status", "")
        status = normalize_project_status(status)
        limit = int(first(opts, "limit", "0") or "0")
        projects = [
            {**project, "status": project.get("state", "started"), "progress": 0}
            for project in sorted(store["projects"].values(), key=lambda x: x["name"])
            if not status or project.get("state") == status
        ]
        if limit:
            projects = projects[:limit]
        json_fields = first(opts, "json", "")
        jq_expr = first(opts, "jq", "")
        if json_fields:
            fields = [f.strip() for f in json_fields.split(",") if f.strip()]
            data = [{field: project.get(field, "") for field in fields} for project in projects]
            print_jq(data, jq_expr) if jq_expr else print(json.dumps(data, indent=2))
        elif jq_expr:
            print_jq(projects, jq_expr)
        else:
            for project in projects:
                print(f"{project['id']}\t{project['name']}\t{project.get('state','started')}\t0%\t{project.get('targetDate','')}")
        return
    if action == "view":
        if not args:
            sys.exit("tracker project view: missing id")
        project = store["projects"].get(project_id_from_ref(args[0]))
        if not project:
            sys.exit(f"tracker project view: project '{args[0]}' not found")
        _, opts = parse_opts(args[1:])
        issues = [normalize_issue(issue) for issue in store["issues"].values() if issue.get("projectId") == project["id"]]
        data = {**project, "issues": {"nodes": issues}, "progress": 0}
        json_fields = first(opts, "json", "")
        if json_fields:
            fields = [f.strip() for f in json_fields.split(",") if f.strip()]
            data = {field: data.get(field, "") for field in fields}
        jq_expr = first(opts, "jq", "")
        print_jq(data, jq_expr) if jq_expr else print(json.dumps(data, indent=2))
        return
    if action == "lookup":
        _, opts = parse_opts(args)
        name = first(opts, "name", "") or first(opts, "title", "")
        project = next((p for p in store["projects"].values() if p["name"] == name), None)
        json_fields = first(opts, "json", "")
        jq_expr = first(opts, "jq", "")
        if json_fields:
            fields = [f.strip() for f in json_fields.split(",") if f.strip()]
            data = {field: project.get(field, "") if project else "" for field in fields}
            print_jq(data, jq_expr) if jq_expr else print(json.dumps(data, indent=2))
        elif jq_expr:
            print_jq(project or {}, jq_expr)
        else:
            print(project["id"] if project else "")
        return
    if action == "edit":
        if not args:
            sys.exit("tracker project edit: missing id or name")
        project = store["projects"].get(project_id_from_ref(args[0]))
        if not project:
            sys.exit(f"tracker project edit: project '{args[0]}' not found")
        _, opts = parse_opts(args[1:])
        if first(opts, "name", ""):
            project["name"] = first(opts, "name")
        if first(opts, "description", ""):
            project["description"] = first(opts, "description")
        if first(opts, "status", ""):
            project["state"] = normalize_project_status(first(opts, "status"))
        if first(opts, "target-date", ""):
            project["targetDate"] = first(opts, "target-date")
        project["updatedAt"] = now()
        save_store()
        print(f"{project['id']}\t{project['name']}\t{project.get('state','started')}")
        return
    if action in {"close", "activate"}:
        if not args:
            sys.exit(f"tracker project {action}: missing id or name")
        project = store["projects"].get(project_id_from_ref(args[0]))
        if not project:
            sys.exit(f"tracker project {action}: project '{args[0]}' not found")
        project["state"] = "completed" if action == "close" else "started"
        project["updatedAt"] = now()
        save_store()
        print(("Closed" if action == "close" else "Activated") + f": {project['name']}")
        return
    if action == "reopen":
        if not args:
            sys.exit("tracker project reopen: missing id or name")
        project = store["projects"].get(project_id_from_ref(args[0]))
        if not project:
            sys.exit(f"tracker project reopen: project '{args[0]}' not found")
        project["state"] = "started"
        project["updatedAt"] = now()
        save_store()
        print(f"Reopened: {project['name']}")
        return
    if action == "add-issue":
        if len(args) < 2:
            sys.exit("tracker project add-issue: need <project-id> <issue-id>")
        project = store["projects"].get(project_id_from_ref(args[0]))
        issue = store["issues"].get(issue_id_from_ref(args[1]))
        if not project or not issue:
            sys.exit("tracker project add-issue: project or issue not found")
        issue["projectId"] = project["id"]
        issue["updatedAt"] = now()
        save_store()
        print("Added")
        return
    if action == "issues":
        if not args:
            sys.exit("tracker project issues: missing project id or name")
        issue_cmd("list", ["--project", args[0]] + args[1:])
        return
    sys.exit(f"tracker project: unknown action '{action}'")


def issue_matches(issue, opts):
    state = first(opts, "state", "")
    dev_progress = first(opts, "dev-progress", "") or first(opts, "devProgress", "")
    state_type = first(opts, "state-type", "")
    state_type_in = set(all_values(opts, "state-type-in"))
    state_type_nin = set(all_values(opts, "state-type-nin"))
    labels = all_values(opts, "label")
    not_labels = all_values(opts, "not-label")
    project = first(opts, "project", "")
    parent = first(opts, "parent", "")
    assignee = first(opts, "assignee", "")
    no_project = bool(opts.get("no-project"))
    search = first(opts, "search", "") or first(opts, "query", "")
    issue_blockers = None
    issue_blocks = None
    if state == "open" and issue.get("stateType") in {"completed", "canceled"}:
        return False
    if state == "closed" and issue.get("stateType") not in {"completed", "canceled"}:
        return False
    if "," in state:
        if issue.get("state") not in {item for item in state.split(",") if item}:
            return False
        state = ""
    if state not in {"", "open", "closed", "all"} and issue.get("state") != state:
        return False
    if dev_progress:
        allowed_progress = {item.strip().lower() for item in dev_progress.split(",") if item.strip()}
        if (issue.get("devProgress") or "").lower() not in allowed_progress:
            return False
    if state_type and issue.get("stateType") != state_type:
        return False
    if state_type_in and issue.get("stateType") not in state_type_in:
        return False
    if state_type_nin and issue.get("stateType") in state_type_nin:
        return False
    if labels and not all(label in issue.get("labels", []) for label in labels):
        return False
    if not_labels and any(label in issue.get("labels", []) for label in not_labels):
        return False
    if project and issue.get("projectId") != project_id_from_ref(project):
        return False
    if parent and issue.get("parentId") != issue_id_from_ref(parent):
        return False
    if assignee:
        expected = "local" if assignee == "me" else assignee
        if (issue.get("assignee") or "") != expected:
            return False
    if opts.get("unassigned") and issue.get("assignee"):
        return False
    if no_project and issue.get("projectId"):
        return False
    if first(opts, "blocked", ""):
        issue_blockers = blockers_for(issue)
        if bool(issue_blockers) != bool_opt(first(opts, "blocked")):
            return False
    if first(opts, "blocks", ""):
        issue_blocks = blocks_for(issue)
        if bool(issue_blocks) != bool_opt(first(opts, "blocks")):
            return False
    if first(opts, "blocked-by", ""):
        issue_blockers = blockers_for(issue)
        blocker_id = issue_id_from_ref(first(opts, "blocked-by"))
        if not any(blocker.get("identifier") == blocker_id for blocker in issue_blockers):
            return False
    if opts.get("has-comments") and not store["comments"].get(issue["id"]):
        return False
    if opts.get("has-children") and not any(child.get("parentId") == issue["id"] for child in store["issues"].values()):
        return False
    kind = first(opts, "kind", "")
    if kind:
        label = f"type:{kind}"
        aliases = {"stakeholder": "type:stakeholder-decision", "decision": "type:stakeholder-decision"}
        if aliases.get(kind, label) not in issue.get("labels", []):
            return False
    for option, field, direction in [
        ("created-before", "createdAt", "before"),
        ("created-after", "createdAt", "after"),
        ("updated-before", "updatedAt", "before"),
        ("updated-after", "updatedAt", "after"),
        ("closed-before", "completedAt", "before"),
        ("closed-after", "completedAt", "after"),
    ]:
        cutoff = parse_time_filter(first(opts, option, ""))
        if cutoff:
            value = issue_time(issue, field)
            if not value:
                return False
            if direction == "before" and not value < cutoff:
                return False
            if direction == "after" and not value > cutoff:
                return False
    if search and text_score(issue, search) <= 0:
        return False
    return True


def issue_cmd(action, args):
    if action == "create":
        _, opts = parse_opts(args)
        title = first(opts, "title", "")
        if not title:
            sys.exit("tracker issue create: --title required")
        number = int(store.get("nextIssueNumber", 1))
        identifier = f"{team_key}-{number}"
        store["nextIssueNumber"] = number + 1
        labels = all_values(opts, "label")
        for label in labels:
            ensure_label(label)
        project_ref = first(opts, "project", "")
        project_id = project_id_from_ref(project_ref) if project_ref else ""
        parent_ref = first(opts, "parent", "")
        parent_id = issue_id_from_ref(parent_ref) if parent_ref else ""
        state = first(opts, "state", "Draft") or "Draft"
        issue = {
            "id": identifier,
            "identifier": identifier,
            "title": title,
            "body": read_body(opts, allow_empty=bool(opts.get("allow-empty-body"))),
            "state": "Draft",
            "stateType": "open",
            "priority": 0,
            "labels": labels,
            "assignee": first(opts, "assignee", ""),
            "projectId": project_id if project_id in store["projects"] else "",
            "parentId": parent_id if parent_id in store["issues"] else "",
            "branchName": f"{team_key.lower()}-{number}-{slug(title)}",
            "url": f"local://tracker/issue/{identifier}",
            "createdAt": now(),
            "updatedAt": now(),
            "completedAt": None,
            "canceledAt": None,
        }
        apply_state(issue, state)
        dev_progress = first(opts, "dev-progress", "") or first(opts, "devProgress", "")
        if dev_progress:
            issue["devProgress"] = dev_progress
        store["issues"][identifier] = issue
        save_store(issue_audit_entries("create", None, issue))
        print(f"{identifier}\t{title}")
        print(issue["url"], file=sys.stderr)
        return
    if action == "list":
        _, opts = parse_opts(args)
        limit_raw = first(opts, "limit", "")
        limit = int(limit_raw) if limit_raw else None
        json_fields = first(opts, "json", "")
        jq_expr = first(opts, "jq", "")
        search_text = first(opts, "search", "") or first(opts, "query", "")
        raw_issues = [issue for issue in store["issues"].values() if issue_matches(issue, opts)]
        if search_text:
            raw_issues = sorted(raw_issues, key=lambda x: (text_score(x, search_text), x.get("updatedAt", "")), reverse=True)
        else:
            raw_issues = sorted(raw_issues, key=lambda x: x.get("updatedAt", ""), reverse=True)
        if json_fields:
            fields = [f.strip() for f in json_fields.split(",") if f.strip()]
            mapped = []
            for raw in raw_issues[:limit]:
                row = {field: issue_field(raw, field) for field in fields}
                mapped.append(row)
            print_jq(mapped, jq_expr) if jq_expr else print(json.dumps(mapped, indent=2))
            return
        issues = [normalize_issue(issue) for issue in raw_issues[:limit]]
        if jq_expr:
            print_jq(issues, jq_expr)
            return
        for issue in issues:
            labels = ", ".join(l["name"] for l in issue["labels"]["nodes"])
            assignee = issue["assignee"]["name"] if issue.get("assignee") else ""
            print(f"{issue['identifier']}\t{issue['title']}\t{issue['state']['name']}\t{labels}\t{assignee}")
        return
    if action in {"view", "get"}:
        if not args:
            sys.exit(f"tracker issue {action}: missing id")
        issue = store["issues"].get(issue_id_from_ref(args[0]))
        if not issue:
            sys.exit(f"tracker issue {action}: issue '{args[0]}' not found")
        _, opts = parse_opts(args[1:])
        data = normalize_issue(issue)
        json_fields = first(opts, "json", "")
        if json_fields:
            fields = [f.strip() for f in json_fields.split(",") if f.strip()]
            data = {field: issue_field(issue, field) for field in fields}
        jq_expr = first(opts, "jq", "")
        print_jq(data, jq_expr) if jq_expr else print(json.dumps(data, indent=2))
        return
    if action in {"close", "edit"}:
        if not args:
            sys.exit(f"tracker issue {action}: missing id")
        issue = store["issues"].get(issue_id_from_ref(args[0]))
        if not issue:
            sys.exit(f"tracker issue {action}: issue '{args[0]}' not found")
        _, opts = parse_opts(args[1:])
        before_issue = json_clone(issue)
        if action == "close":
            reason = first(opts, "reason", "completed")
            state = "Canceled" if reason == "canceled" else "Done"
            opts["state"] = [state]
        if first(opts, "title", ""):
            issue["title"] = first(opts, "title")
        if first(opts, "body", "") or first(opts, "body-file", ""):
            issue["body"] = read_body(opts, allow_empty=bool(opts.get("allow-empty-body")))
        if first(opts, "state", ""):
            state = first(opts, "state")
            apply_state(issue, state)
        for label in all_values(opts, "add-label"):
            ensure_label(label)
            if label not in issue["labels"]:
                issue["labels"].append(label)
        for label in all_values(opts, "remove-label"):
            issue["labels"] = [existing for existing in issue["labels"] if existing != label]
        project_ref = first(opts, "project", "") or first(opts, "milestone", "")
        if project_ref:
            project_id = project_id_from_ref(project_ref)
            if project_id not in store["projects"]:
                sys.exit(f"tracker issue edit: project '{project_ref}' not found")
            issue["projectId"] = project_id
        if opts.get("remove-project"):
            issue["projectId"] = ""
        parent_ref = first(opts, "parent", "")
        if parent_ref:
            parent_id = issue_id_from_ref(parent_ref)
            if parent_id not in store["issues"]:
                sys.exit(f"tracker issue edit: parent '{parent_ref}' not found")
            issue["parentId"] = parent_id
        if opts.get("remove-parent"):
            issue["parentId"] = ""
        if first(opts, "assignee", ""):
            assignee = first(opts, "assignee")
            issue["assignee"] = "local" if assignee == "me" else assignee
        if first(opts, "priority", ""):
            issue["priority"] = int(first(opts, "priority"))
        dev_progress = first(opts, "dev-progress", "") or first(opts, "devProgress", "")
        if dev_progress:
            issue["devProgress"] = dev_progress
        if opts.get("remove-dev-progress"):
            issue["devProgress"] = None
        comment = read_comment(opts)
        if comment:
            store["comments"].setdefault(issue["id"], []).append({"body": comment, "createdAt": now(), "user": {"name": "local"}})
        issue["updatedAt"] = now()
        save_store(issue_audit_entries(action, before_issue, issue, {"commentAdded": bool(comment)}))
        print(f"{issue['identifier']}\t{issue['title']}\t{issue['state']}")
        return
    if action == "comment":
        if not args:
            sys.exit("tracker issue comment: missing id")
        issue_id = issue_id_from_ref(args[0])
        if issue_id not in store["issues"]:
            sys.exit(f"tracker issue comment: issue '{args[0]}' not found")
        _, opts = parse_opts(args[1:])
        body = read_body(opts)
        if not body:
            sys.exit("tracker issue comment: --body or --body-file required")
        before_issue = json_clone(store["issues"][issue_id])
        store["comments"].setdefault(issue_id, []).append({"body": body, "createdAt": now(), "user": {"name": "local"}})
        store["issues"][issue_id]["updatedAt"] = now()
        entries = issue_audit_entries("comment", before_issue, store["issues"][issue_id], {"commentLength": len(body)})
        save_store(entries)
        print("Comment added")
        return
    if action == "comments":
        if not args:
            sys.exit("tracker issue comments: missing id")
        issue_id = issue_id_from_ref(args[0])
        comments = store["comments"].get(issue_id, [])
        _, opts = parse_opts(args[1:])
        jq_expr = first(opts, "jq", "")
        if jq_expr:
            print_jq(comments, jq_expr)
        else:
            for c in comments:
                print(f"{c.get('createdAt','')[:19]}\t{c.get('user',{}).get('name','local')}\t{c.get('body','').replace(chr(10),' ')[:200]}")
        return
    if action == "history":
        if not args:
            sys.exit("tracker issue history: missing id")
        issue_id = issue_id_from_ref(args[0])
        issue = store["issues"].get(issue_id)
        if not issue:
            sys.exit(f"tracker issue history: issue '{args[0]}' not found")
        _, opts = parse_opts(args[1:])
        limit = int(first(opts, "limit", "100") or "100")
        entries = read_audit_entries(issue["identifier"], limit=limit)
        summary = state_history_summary(issue)
        data = {"issue": issue["identifier"], "state": summary, "entries": entries}
        jq_expr = first(opts, "jq", "")
        if jq_expr:
            print_jq(data, jq_expr)
        elif "json" in opts:
            print(json.dumps(data, indent=2, sort_keys=True))
        else:
            print(f"{issue['identifier']}\tcurrent={issue.get('state','')} devProgress={issue.get('devProgress') or ''}\tsince={summary.get('since') or ''}")
            for entry in entries:
                field = entry.get("field") or "-"
                old_value = entry.get("oldValue")
                new_value = entry.get("newValue")
                print(f"{entry.get('createdAt','')[:19]}\t{entry.get('action','')}\t{field}\t{old_value!r} -> {new_value!r}")
        return
    if action == "relate":
        if not args:
            sys.exit("tracker issue relate: missing id")
        _, opts = parse_opts(args[1:])
        blocks = first(opts, "blocks", "")
        if not blocks:
            sys.exit("tracker issue relate: --blocks required")
        issue_id = issue_id_from_ref(args[0])
        related_id = issue_id_from_ref(blocks)
        store["relations"].append({"issueId": issue_id, "relatedIssueId": related_id, "type": "blocks", "createdAt": now()})
        issue = store["issues"].get(issue_id)
        related = store["issues"].get(related_id)
        save_store(issue_audit_entries("relate", issue, issue, {"type": "blocks", "relatedIssue": related.get("identifier") if related else related_id}))
        print("Relation created")
        return
    if action == "relations":
        _, opts = parse_opts(args)
        if opts.get("all"):
            rows = relation_rows()
            jq_expr = first(opts, "jq", "")
            if jq_expr:
                print_jq(rows, jq_expr)
            else:
                print(json.dumps(rows, indent=2))
            return
        if not args:
            sys.exit("tracker issue relations: missing id")
        issue_id = issue_id_from_ref(args[0])
        issue = store["issues"].get(issue_id)
        if not issue:
            sys.exit(f"tracker issue relations: issue '{args[0]}' not found")
        rows = [row for row in relation_rows() if row["issue"] == issue["identifier"] or row["relatedIssue"] == issue["identifier"]]
        _, opts = parse_opts(args[1:])
        jq_expr = first(opts, "jq", "")
        if jq_expr:
            print_jq(rows, jq_expr)
        else:
            for row in rows:
                print(f"{row['issue']}\t{row['type']}\t{row['relatedIssue']}")
        return
    if action == "unrelate":
        if not args:
            sys.exit("tracker issue unrelate: missing id")
        _, opts = parse_opts(args[1:])
        blocks = first(opts, "blocks", "")
        if not blocks:
            sys.exit("tracker issue unrelate: --blocks required")
        issue_id = issue_id_from_ref(args[0])
        related_id = issue_id_from_ref(blocks)
        before = len(store["relations"])
        store["relations"] = [
            relation for relation in store["relations"]
            if not (relation.get("issueId") == issue_id and relation.get("relatedIssueId") == related_id and relation.get("type") == "blocks")
        ]
        issue = store["issues"].get(issue_id)
        related = store["issues"].get(related_id)
        removed = len(store["relations"]) < before
        entries = issue_audit_entries("unrelate", issue, issue, {"type": "blocks", "relatedIssue": related.get("identifier") if related else related_id, "removed": removed})
        save_store(entries if removed else [])
        print("Relation removed" if len(store["relations"]) < before else "No relation")
        return
    sys.exit(f"tracker issue: unknown action '{action}'")


def sprint_cmd(action, args):
    if action == "current":
        active = next((s for s in store["sprints"].values() if s.get("status") == "active"), None)
        if not active:
            active = {"id": "local-cycle-1", "identifier": f"{team_key}-SPRINT", "title": "Local Sprint", "label": "sprint:local"}
        _, opts = parse_opts(args)
        json_fields = first(opts, "json", "")
        if json_fields:
            fields = [f.strip() for f in json_fields.split(",") if f.strip()]
            print(json.dumps({field: active.get(field, "") for field in fields}))
        else:
            print(f"{active['identifier']}\t{active['title']}\t{active['label']}")
        return
    if action == "create":
        _, opts = parse_opts(args)
        name = first(opts, "name", "")
        start = first(opts, "start", "")
        end = first(opts, "end", "")
        if not name or not start or not end:
            sys.exit("tracker sprint create: --name, --start, and --end required")
        label = first(opts, "label", "") or f"sprint:{start}-{slug(name)}"
        ensure_label("sprint-meta")
        ensure_label("sprint:active")
        ensure_label(label)
        sprint = {"id": f"sprint-{slug(name)}", "identifier": f"{team_key}-SPRINT", "title": f"Sprint: {name}", "label": label, "status": "active", "start": start, "end": end}
        store["sprints"][sprint["id"]] = sprint
        save_store()
        print(f"{sprint['identifier']}\t{sprint['title']}\t{label}")
        return
    if action == "add-issue":
        if len(args) < 2:
            sys.exit("tracker sprint add-issue: need <sprint-label|current> <issue-id>")
        label = args[0]
        if label == "current":
            active = next((s for s in store["sprints"].values() if s.get("status") == "active"), {"label": "sprint:local"})
            label = active["label"]
        ensure_label(label)
        issue = store["issues"].get(issue_id_from_ref(args[1]))
        if issue and label not in issue["labels"]:
            issue["labels"].append(label)
            save_store()
        return
    if action == "issues":
        label = args[0] if args and not args[0].startswith("--") else "current"
        rest = args[1:] if args and not args[0].startswith("--") else args
        if label == "current":
            active = next((s for s in store["sprints"].values() if s.get("status") == "active"), {"label": "sprint:local"})
            label = active["label"]
        issue_cmd("list", ["--label", label] + rest)
        return
    if action == "interrupt":
        for sprint in store["sprints"].values():
            if sprint.get("status") == "active":
                sprint["status"] = "replaced"
        save_store()
        return
    sys.exit(f"tracker sprint: unknown action '{action}'")


def state_type_for_name(state):
    if state in {"Done", "Completed"}:
        return "completed"
    if state in {"Canceled", "Cancelled"}:
        return "canceled"
    if state == "Backlog":
        return "backlog"
    return "open"


CANONICAL_STATE_NAMES = {
    "backlog": "Backlog",
    "draft": "Draft",
    "ready": "Ready",
    "in progress": "In Progress",
    "in review": "In Review",
    "ready to close": "Ready to Close",
    "done": "Done",
    "canceled": "Canceled",
    "cancelled": "Canceled",
}

DEV_PROGRESS_BY_STATE = {
    "Developing": "developing",
    "Ready for Export": "ready for export",
    "Exporting": "exporting",
}


def apply_state(issue, state):
    if state in DEV_PROGRESS_BY_STATE:
        issue["state"] = "In Progress"
        issue["stateType"] = "open"
        issue["devProgress"] = DEV_PROGRESS_BY_STATE[state]
    else:
        issue["state"] = CANONICAL_STATE_NAMES.get(state.lower(), state)
        issue["stateType"] = state_type_for_name(issue["state"])
        issue["devProgress"] = ""
    issue["completedAt"] = now() if issue["stateType"] == "completed" else issue.get("completedAt")
    issue["canceledAt"] = now() if issue["stateType"] == "canceled" else issue.get("canceledAt")


def workflow_states():
    return [
        {"id": "state-backlog", "name": "Backlog", "type": "backlog"},
        {"id": "state-draft", "name": "Draft", "type": "open"},
        {"id": "state-ready", "name": "Ready", "type": "open"},
        {"id": "state-in-progress", "name": "In Progress", "type": "open"},
        {"id": "state-in-review", "name": "In Review", "type": "open"},
        {"id": "state-ready-to-close", "name": "Ready to Close", "type": "open"},
        {"id": "state-done", "name": "Done", "type": "completed"},
        {"id": "state-canceled", "name": "Canceled", "type": "canceled"},
    ]


def state_cmd(action, args):
    if action != "list":
        sys.exit(f"tracker state: unknown action '{action}'")
    _, opts = parse_opts(args)
    states = workflow_states()
    json_fields = first(opts, "json", "")
    if json_fields:
        fields = [f.strip() for f in json_fields.split(",") if f.strip()]
        states = [{field: state.get(field, "") for field in fields} for state in states]
    jq_expr = first(opts, "jq", "")
    if jq_expr:
        print_jq(states, jq_expr)
    elif json_fields:
        print(json.dumps(states, indent=2))
    else:
        for state in states:
            print(f"{state['id']}\t{state['name']}\t{state['type']}")


def local_users():
    users = [{"id": "local", "name": "local", "email": ""}]
    seen = {"local"}
    for issue in store["issues"].values():
        assignee = issue.get("assignee")
        if assignee and assignee not in seen:
            seen.add(assignee)
            users.append({"id": slug(assignee), "name": assignee, "email": ""})
    return users


def user_cmd(action, args):
    if action not in {"current", "list"}:
        sys.exit(f"tracker user: unknown action '{action}'")
    _, opts = parse_opts(args)
    data = local_users()[0] if action == "current" else local_users()
    json_fields = first(opts, "json", "")
    if json_fields:
        fields = [f.strip() for f in json_fields.split(",") if f.strip()]
        if isinstance(data, list):
            data = [{field: user.get(field, "") for field in fields} for user in data]
        else:
            data = {field: data.get(field, "") for field in fields}
    jq_expr = first(opts, "jq", "")
    if jq_expr:
        print_jq(data, jq_expr)
    elif json_fields:
        print(json.dumps(data, indent=2))
    elif isinstance(data, list):
        for user in data:
            print(f"{user['id']}\t{user['name']}\t{user.get('email','')}")
    else:
        print(f"{data['id']}\t{data['name']}\t{data.get('email','')}")


def import_linear_cmd(args):
    _, opts = parse_opts(args)
    file_path = first(opts, "file", "")
    if not file_path:
        sys.exit("tracker import linear: --file required")
    payload = json.loads(Path(file_path).read_text())
    imported_at = now()

    for label in payload.get("labels", []):
        if isinstance(label, str):
            ensure_label(label)
        else:
            ensure_label(label.get("name", ""), label.get("description", ""), label.get("color", ""))

    for project in payload.get("projects", []):
        project_id = project.get("id") or f"project-{slug(project.get('name', 'project'))}"
        store["projects"][project_id] = {
            "id": project_id,
            "name": project.get("name", project_id),
            "description": project.get("description", ""),
            "state": project.get("state", "started"),
            "targetDate": project.get("targetDate", ""),
            "createdAt": project.get("createdAt") or imported_at,
            "updatedAt": project.get("updatedAt") or imported_at,
            "external": project.get("external", {}),
        }

    max_number = int(store.get("nextIssueNumber", 1)) - 1
    issue_project_refs = {}
    issue_parent_refs = {}
    comments_by_issue = {}
    for source in payload.get("issues", []):
        identifier = source.get("identifier") or source.get("number") or source.get("id")
        if not identifier:
            continue
        labels = []
        for label in source.get("labels", []):
            name = label.get("name") if isinstance(label, dict) else label
            if name:
                ensure_label(name)
                labels.append(name)
        state = source.get("state", "Todo")
        if isinstance(state, dict):
            state_name = state.get("name", "Todo")
            state_type = state.get("type", "open")
        else:
            state_name = state
            state_type = source.get("stateType") or state_type_for_name(state_name)
        assignee = source.get("assignee", "")
        if isinstance(assignee, dict):
            assignee = assignee.get("name", "")
        issue = {
            "id": identifier,
            "identifier": identifier,
            "title": safe_text(source.get("title") or identifier),
            "body": safe_text(source.get("body") if source.get("body") is not None else source.get("description")),
            "state": state_name,
            "stateType": state_type,
            "priority": source.get("priority", 0),
            "labels": labels,
            "assignee": assignee,
            "projectId": "",
            "parentId": "",
            "branchName": source.get("branchName") or f"{team_key.lower()}-{issue_number(identifier)}-{slug(safe_text(source.get('title') or identifier))}",
            "url": source.get("url", f"local://tracker/issue/{identifier}"),
            "createdAt": source.get("createdAt") or imported_at,
            "updatedAt": source.get("updatedAt") or imported_at,
            "completedAt": source.get("completedAt"),
            "canceledAt": source.get("canceledAt"),
            "external": source.get("external", {}),
        }
        store["issues"][identifier] = issue
        max_number = max(max_number, issue_number(identifier))
        project_ref = source.get("projectId")
        if not project_ref:
            source_project = source.get("project")
            project_ref = source_project.get("id") if isinstance(source_project, dict) else source_project or ""
        parent_ref = source.get("parentId")
        if not parent_ref:
            source_parent = source.get("parent")
            parent_ref = source_parent.get("identifier") if isinstance(source_parent, dict) else source_parent or ""
        issue_project_refs[identifier] = project_ref
        issue_parent_refs[identifier] = parent_ref
        comments_by_issue[identifier] = source.get("comments", [])

    for identifier, project_ref in issue_project_refs.items():
        if project_ref:
            project_id = project_id_from_ref(str(project_ref))
            if project_id in store["projects"]:
                store["issues"][identifier]["projectId"] = project_id
    for identifier, parent_ref in issue_parent_refs.items():
        if parent_ref:
            parent_id = issue_id_from_ref(str(parent_ref))
            if parent_id in store["issues"]:
                store["issues"][identifier]["parentId"] = parent_id
    for identifier, comments in comments_by_issue.items():
        normalized = []
        if isinstance(comments, dict):
            comments = comments.get("nodes", [])
        for comment in comments or []:
            normalized.append({
                "body": comment.get("body", "") if isinstance(comment, dict) else str(comment),
                "createdAt": comment.get("createdAt", imported_at) if isinstance(comment, dict) else imported_at,
                "user": comment.get("user", {"name": "import"}) if isinstance(comment, dict) else {"name": "import"},
            })
        if normalized:
            store["comments"][identifier] = normalized

    existing_relations = {
        (relation.get("issueId"), relation.get("relatedIssueId"), relation.get("type", "blocks"))
        for relation in store.get("relations", [])
    }
    for relation in payload.get("relations", []):
        source = issue_id_from_ref(str(relation.get("issueId") or relation.get("issue") or ""))
        target = issue_id_from_ref(str(relation.get("relatedIssueId") or relation.get("relatedIssue") or relation.get("target") or ""))
        relation_type = relation.get("type", "blocks")
        key = (source, target, relation_type)
        if source in store["issues"] and target in store["issues"] and key not in existing_relations:
            store["relations"].append({"issueId": source, "relatedIssueId": target, "type": relation_type, "createdAt": relation.get("createdAt", imported_at)})
            existing_relations.add(key)

    store["nextIssueNumber"] = max(max_number + 1, int(store.get("nextIssueNumber", 1)))
    save_store()
    print(json.dumps({
        "imported": {
            "labels": len(payload.get("labels", [])),
            "projects": len(payload.get("projects", [])),
            "issues": len(payload.get("issues", [])),
            "relations": len(payload.get("relations", [])),
        },
        "nextIssueNumber": store["nextIssueNumber"],
    }, indent=2, sort_keys=True))


def import_cmd(action, args):
    if action == "linear":
        import_linear_cmd(args)
        return
    sys.exit(f"tracker import: unknown source '{action}'")


def parse_structured_query(text):
    args = []
    free_terms = []
    tokens = shlex.split(text)
    skip = {"issue", "issues", "where", "and"}
    for token in tokens:
        if token.lower() in skip:
            continue
        if ":" not in token:
            free_terms.append(token)
            continue
        key, value = token.split(":", 1)
        key = key.strip().lower()
        value = value.strip()
        if key in {"text", "query", "search"}:
            free_terms.append(value)
        elif key == "label":
            for item in value.split(","):
                if item:
                    args.extend(["--label", item])
        elif key in {"not-label", "notlabel"}:
            for item in value.split(","):
                if item:
                    args.extend(["--not-label", item])
        elif key == "state":
            # issue list supports one state, so comma states are handled by query_cmd.
            args.extend(["--state", value])
        elif key == "project":
            args.extend(["--project", value])
        elif key == "parent":
            args.extend(["--parent", value])
        elif key == "assignee":
            args.extend(["--assignee", value])
        elif key in {"blocked", "blocks", "blocked-by", "kind", "updated-before", "updated-after", "created-before", "created-after", "closed-before", "closed-after"}:
            args.extend([f"--{key}", value])
        elif key == "unassigned" and bool_opt(value):
            args.append("--unassigned")
        else:
            free_terms.append(token)
    if free_terms:
        args.extend(["--query", " ".join(free_terms)])
    return args


def project_matches_search(project, query):
    terms = [term.lower() for term in re.findall(r'"([^"]+)"|(\S+)', query) for term in term if term]
    blob = "\n".join([
        project.get("id", ""),
        project.get("name", ""),
        project.get("description", ""),
        project.get("state", ""),
    ]).lower()
    return all(term in blob for term in terms) if terms else True


def search_cmd(args):
    if not args:
        sys.exit("tracker search: missing search text")
    query_text = args[0]
    _, opts = parse_opts(args[1:])
    result_type = first(opts, "type", "issue") or "issue"
    limit = int(first(opts, "limit", "20") or "20")
    json_fields = first(opts, "json", "")
    jq_expr = first(opts, "jq", "")
    if result_type in {"issue", "issues", "all"}:
        issue_args = ["--query", query_text, "--limit", str(limit)]
        for key in ["state", "state-type", "project", "parent", "assignee", "blocked", "blocks", "blocked-by", "kind", "updated-before", "updated-after", "created-before", "created-after"]:
            if first(opts, key, ""):
                issue_args.extend([f"--{key}", first(opts, key)])
        for key in ["label", "not-label"]:
            for value in all_values(opts, key):
                issue_args.extend([f"--{key}", value])
        for flag in ["no-project", "has-comments", "has-children", "unassigned"]:
            if opts.get(flag):
                issue_args.append(f"--{flag}")
        if json_fields:
            issue_args.extend(["--json", json_fields])
        if jq_expr:
            issue_args.extend(["--jq", jq_expr])
        issue_cmd("list", issue_args)
        return
    if result_type in {"project", "projects"}:
        projects = [project for project in store["projects"].values() if project_matches_search(project, query_text)][:limit]
        if json_fields:
            fields = [field.strip() for field in json_fields.split(",") if field.strip()]
            data = [{field: project.get(field, "") for field in fields} for project in projects]
            print_jq(data, jq_expr) if jq_expr else print(json.dumps(data, indent=2))
        elif jq_expr:
            print_jq(projects, jq_expr)
        else:
            for project in projects:
                print(f"{project['id']}\t{project['name']}\t{project.get('state','started')}")
        return
    sys.exit(f"tracker search: unknown type '{result_type}'")


def query_cmd(args):
    if not args:
        sys.exit("tracker query: missing query")
    query_text = args[0]
    rest = args[1:]
    _, opts = parse_opts(rest)
    built = parse_structured_query(query_text)
    # Expand state:a,b by running a normal list when there is only one state;
    # otherwise filter after matching so agents can express compact unions.
    state_values = []
    for index, token in enumerate(built):
        if token == "--state" and index + 1 < len(built) and "," in built[index + 1]:
            state_values = [item for item in built[index + 1].split(",") if item]
    if state_values:
        remove_next = False
        filtered = []
        for token in built:
            if remove_next:
                remove_next = False
                continue
            if token == "--state":
                remove_next = True
                continue
            filtered.append(token)
        built = filtered
    for key in ["limit", "json", "jq"]:
        if first(opts, key, ""):
            built.extend([f"--{key}", first(opts, key)])
    if not first(opts, "limit", ""):
        built.extend(["--limit", "50"])
    if state_values:
        _, built_opts = parse_opts(built)
        issues = [
            normalize_issue(issue)
            for issue in sorted(store["issues"].values(), key=lambda x: x.get("updatedAt", ""), reverse=True)
            if issue.get("state") in state_values and issue_matches(issue, built_opts)
        ][: int(first(built_opts, "limit", "50") or "50")]
        json_fields = first(built_opts, "json", "")
        jq_expr = first(built_opts, "jq", "")
        if json_fields:
            fields = [field.strip() for field in json_fields.split(",") if field.strip()]
            raw_by_id = {issue["identifier"]: issue for issue in store["issues"].values()}
            data = [{field: issue_field(raw_by_id[issue["identifier"]], field) for field in fields} for issue in issues]
            print_jq(data, jq_expr) if jq_expr else print(json.dumps(data, indent=2))
        elif jq_expr:
            print_jq(issues, jq_expr)
        else:
            for issue in issues:
                labels = ", ".join(label["name"] for label in issue["labels"]["nodes"])
                print(f"{issue['identifier']}\t{issue['title']}\t{issue['state']['name']}\t{labels}")
        return
    issue_cmd("list", built)


def view_cmd(name, args):
    if not name:
        sys.exit("tracker view: missing view name")
    mapping = {
        "active-stack": ["--label", "active-stack", "--state", "open"],
        "ready-runnable": ["--state", "Ready", "--blocked", "false"],
        "blocked": ["--blocked", "true", "--state", "open"],
        "stakeholder-blockers": ["--label", "type:stakeholder-decision", "--state", "open"],
        "delivery": ["--state", "In Progress", "--dev-progress", "ready for export,exporting"],
        "stale": ["--state", "open", "--updated-before", "7d"],
        "orphaned": ["--state", "open", "--no-project"],
    }
    if name in {"project-manager", "pm"}:
        snapshot_cmd("project-manager", args)
        return
    if name not in mapping:
        sys.exit(f"tracker view: unknown view '{name}'")
    issue_cmd("list", mapping[name] + args)


def api_split_args(args):
    opts = {}
    i = 0
    while i < len(args):
        if args[i].startswith("--") and i + 1 < len(args):
            opts[args[i][2:]] = args[i + 1]
            i += 2
        elif args[i].startswith("--"):
            opts[args[i][2:]] = "true"
            i += 1
        else:
            i += 1
    return opts


def graphql_strings(value):
    return re.findall(r'"([^"]+)"', value or "")


def graphql_arg_value(args, name):
    match = re.search(rf"\b{name}\s*:\s*\"([^\"]*)\"", args or "")
    if match:
        return match.group(1)
    match = re.search(rf"\b{name}\s*:\s*([A-Za-z0-9_.:-]+)", args or "")
    return match.group(1) if match else ""


def graphql_arg_int(args, name, default):
    try:
        return int(graphql_arg_value(args, name))
    except ValueError:
        return default


def graphql_find_call(query, name):
    match = re.search(rf"\b{name}\s*\(", query)
    if not match:
        return None
    start = match.end()
    depth = 1
    for i in range(start, len(query)):
        if query[i] == "(":
            depth += 1
        elif query[i] == ")":
            depth -= 1
            if depth == 0:
                return query[start:i]
    return ""


def graphql_block_after(args, name):
    marker = re.search(rf"\b{name}\s*:\s*\{{", args or "")
    if not marker:
        return ""
    start = marker.end()
    depth = 1
    for i in range(start, len(args)):
        if args[i] == "{":
            depth += 1
        elif args[i] == "}":
            depth -= 1
            if depth == 0:
                return args[start:i]
    return ""


def graphql_input_block(query, name):
    match = re.search(rf"\b{name}\s*\(\s*input\s*:\s*\{{", query)
    if not match:
        return ""
    start = match.end()
    depth = 1
    for i in range(start, len(query)):
        if query[i] == "{":
            depth += 1
        elif query[i] == "}":
            depth -= 1
            if depth == 0:
                return query[start:i]
    return ""


def api_issue(issue):
    data = normalize_issue(issue)
    data["blockers"] = blockers_for(issue)
    data["blocks"] = blocks_for(issue)
    data["recentComments"] = store["comments"].get(issue["id"], [])[-5:]
    return data


def api_project(project):
    issues = [api_issue(issue) for issue in store["issues"].values() if issue.get("projectId") == project["id"]]
    return {**project, "issues": {"nodes": issues}, "progress": 0}


def api_opts_from_filter(filter_block):
    opts = {}
    if not filter_block:
        return opts
    text = graphql_arg_value(filter_block, "text") or graphql_arg_value(filter_block, "query") or graphql_arg_value(filter_block, "search")
    if text:
        opts["query"] = [text]
    for key in ["project", "assignee", "blocked", "kind"]:
        value = graphql_arg_value(filter_block, key)
        if value:
            opts[key] = [value]
    labels = graphql_strings(graphql_block_after(filter_block, "labels"))
    if labels:
        opts["label"] = labels
    state_block = graphql_block_after(filter_block, "state")
    state_type_block = graphql_block_after(state_block, "type")
    if state_type_block:
        state_types = graphql_strings(state_type_block)
        if state_types:
            opts["state-type-nin" if re.search(r"\bnin\s*:", state_type_block) else "state-type-in"] = state_types
        else:
            state_type = graphql_arg_value(state_block, "type")
            if state_type:
                opts["state-type"] = [state_type]
    else:
        states = graphql_strings(state_block)
        if states:
            opts["state"] = [",".join(states)]
        else:
            state = graphql_arg_value(filter_block, "state")
            if state:
                opts["state"] = [state]
    return opts


def api_query_issues(args):
    limit = graphql_arg_int(args, "first", 50)
    opts = api_opts_from_filter(graphql_block_after(args, "filter"))
    state = first(opts, "state", "")
    state_values = [item for item in state.split(",") if item] if "," in state else []
    if state_values:
        opts.pop("state", None)
    raw = [
        issue
        for issue in store["issues"].values()
        if (not state_values or issue.get("state") in state_values) and issue_matches(issue, opts)
    ]
    search_text = first(opts, "query", "") or first(opts, "search", "")
    if search_text:
        raw = sorted(raw, key=lambda issue: (text_score(issue, search_text), issue.get("updatedAt", "")), reverse=True)
    else:
        raw = sorted(raw, key=lambda issue: issue.get("updatedAt", ""), reverse=True)
    return {"nodes": [api_issue(issue) for issue in raw[:limit]]}


def api_search_results(args):
    text = graphql_arg_value(args, "text") or graphql_arg_value(args, "query") or graphql_arg_value(args, "search")
    fts = fts_query(text)
    if not fts:
        return {"nodes": []}
    opts = api_opts_from_filter(graphql_block_after(args, "filter"))
    limit = graphql_arg_int(args, "first", 20)
    state = first(opts, "state", "")
    state_values = [item for item in state.split(",") if item] if "," in state else []
    if state_values:
        opts.pop("state", None)
    raw = [
        issue
        for issue in store["issues"].values()
        if (not state_values or issue.get("state") in state_values) and issue_matches(issue, opts)
    ]
    raw = sorted(raw, key=lambda issue: (text_score(issue, text), issue.get("updatedAt", "")), reverse=True)
    return {"nodes": [{"kind": "issue", "ref": issue["identifier"], "score": text_score(issue, text), "issue": api_issue(issue), "project": None, "highlights": []} for issue in raw[:limit] if text_score(issue, text) > 0]}


def execute_graphql(query, variables=None):
    refresh_store()
    variables = variables or {}
    query = query or ""
    if "$" in query and variables:
        for key, value in variables.items():
            query = query.replace(f"${key}", json.dumps(value))

    if re.search(r"\blabelCreate\b", query):
        data = graphql_input_block(query, "labelCreate")
        name = graphql_arg_value(data, "name")
        if not name:
            return {"errors": [{"message": "labelCreate.input.name is required"}]}
        label = ensure_label(name)
        save_store()
        return {"labelCreate": {"success": True, "label": {"name": label["name"]}}}

    if re.search(r"\bissueCreate\b", query):
        data = graphql_input_block(query, "issueCreate")
        title = graphql_arg_value(data, "title")
        if not title:
            return {"errors": [{"message": "issueCreate.input.title is required"}]}
        number = int(store.get("nextIssueNumber", 1))
        identifier = f"{team_key}-{number}"
        store["nextIssueNumber"] = number + 1
        labels = graphql_strings(graphql_block_after(data, "labels"))
        for label in labels:
            ensure_label(label)
        state = graphql_arg_value(data, "state") or "Todo"
        project_ref = graphql_arg_value(data, "project")
        project_id = project_id_from_ref(project_ref) if project_ref else ""
        created_at = now()
        issue = {
            "id": identifier,
            "identifier": identifier,
            "title": title,
            "body": graphql_arg_value(data, "body") or graphql_arg_value(data, "description"),
            "state": "Draft",
            "stateType": "open",
            "priority": 0,
            "labels": labels,
            "assignee": graphql_arg_value(data, "assignee"),
            "projectId": project_id if project_id in store["projects"] else "",
            "parentId": issue_id_from_ref(graphql_arg_value(data, "parent")) if graphql_arg_value(data, "parent") else "",
            "branchName": f"{team_key.lower()}-{number}-{slug(title)}",
            "url": f"local://tracker/issue/{identifier}",
            "createdAt": created_at,
            "updatedAt": created_at,
            "completedAt": None,
            "canceledAt": None,
        }
        apply_state(issue, state)
        store["issues"][identifier] = issue
        save_store()
        return {"issueCreate": {"success": True, "issue": api_issue(issue)}}

    if re.search(r"\bissueUpdate\b|\bissueClose\b", query):
        mutation = "issueClose" if re.search(r"\bissueClose\b", query) else "issueUpdate"
        data = graphql_input_block(query, mutation)
        issue = store["issues"].get(issue_id_from_ref(graphql_arg_value(data, "id") or graphql_arg_value(data, "issueId") or graphql_arg_value(data, "issue")))
        if not issue:
            return {mutation: {"success": False, "issue": None}}
        state = "Canceled" if graphql_arg_value(data, "reason") == "canceled" else "Done" if mutation == "issueClose" else graphql_arg_value(data, "state")
        if graphql_arg_value(data, "title"):
            issue["title"] = graphql_arg_value(data, "title")
        body = graphql_arg_value(data, "body") or graphql_arg_value(data, "description")
        if body and mutation == "issueUpdate":
            issue["body"] = body
        if state:
            apply_state(issue, state)
        comment_body = (body if mutation == "issueClose" else "") or graphql_arg_value(data, "comment")
        if comment_body:
            store["comments"].setdefault(issue["id"], []).append({"body": comment_body, "createdAt": now(), "user": {"name": graphql_arg_value(data, "user") or "local"}})
        issue["updatedAt"] = now()
        save_store()
        return {mutation: {"success": True, "issue": api_issue(issue)}}

    if re.search(r"\bcommentCreate\b", query):
        data = graphql_input_block(query, "commentCreate")
        issue_id = issue_id_from_ref(graphql_arg_value(data, "issueId") or graphql_arg_value(data, "issue"))
        body = graphql_arg_value(data, "body")
        if issue_id not in store["issues"] or not body:
            return {"commentCreate": {"success": False, "comment": None}}
        comment = {"body": body, "createdAt": now(), "user": {"name": graphql_arg_value(data, "user") or "local"}}
        store["comments"].setdefault(issue_id, []).append(comment)
        store["issues"][issue_id]["updatedAt"] = now()
        save_store()
        return {"commentCreate": {"success": True, "comment": comment}}

    if re.search(r"\bissueRelationCreate\b", query):
        data = graphql_input_block(query, "issueRelationCreate")
        source = issue_id_from_ref(graphql_arg_value(data, "issueId") or graphql_arg_value(data, "issue"))
        target = issue_id_from_ref(graphql_arg_value(data, "relatedIssueId") or graphql_arg_value(data, "relatedIssue"))
        relation_type = graphql_arg_value(data, "type") or "blocks"
        if source not in store["issues"] or target not in store["issues"]:
            return {"issueRelationCreate": {"success": False}}
        store["relations"].append({"issueId": source, "relatedIssueId": target, "type": relation_type, "createdAt": now()})
        save_store()
        return {"issueRelationCreate": {"success": True}}

    search_args = graphql_find_call(query, "search")
    if search_args is not None:
        return {"search": api_search_results(search_args)}
    if re.search(r"\bsnapshot\b", query):
        return {"snapshot": pm_snapshot_model()}
    issue_args = graphql_find_call(query, "issue")
    if issue_args is not None:
        issue_id = graphql_arg_value(issue_args, "id") or graphql_arg_value(issue_args, "identifier")
        issue = store["issues"].get(issue_id_from_ref(issue_id))
        return {"issue": api_issue(issue) if issue else None}
    issues_args = graphql_find_call(query, "issues")
    if issues_args is not None:
        return {"issues": api_query_issues(issues_args)}
    project_args = graphql_find_call(query, "project")
    if project_args is not None:
        ref = graphql_arg_value(project_args, "id") or graphql_arg_value(project_args, "name")
        project = store["projects"].get(project_id_from_ref(ref))
        return {"project": api_project(project) if project else None}
    projects_args = graphql_find_call(query, "projects")
    if projects_args is not None:
        limit = graphql_arg_int(projects_args, "first", 50)
        projects = sorted(store["projects"].values(), key=lambda item: item["name"])[:limit]
        return {"projects": {"nodes": [api_project(project) for project in projects]}}
    return {"errors": [{"message": "Unsupported tracker GraphQL query root"}]}


def api_response_for(payload):
    with tracker_process_lock():
        result = execute_graphql(payload.get("query", ""), payload.get("variables") or {})
    if "errors" in result:
        return result
    return {"data": result}


class ApiHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/graphql":
            self.send_response(404)
            self.end_headers()
            return
        body = self.rfile.read(int(self.headers.get("content-length", "0"))).decode("utf-8")
        try:
            result = api_response_for(json.loads(body or "{}"))
            status = 200
        except Exception as exc:
            result = {"errors": [{"message": str(exc)}]}
            status = 500
        encoded = json.dumps(result, indent=2, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        print(f"tracker api: {fmt % args}", file=sys.stderr)


def api_cmd(action, args):
    opts = api_split_args(args)
    if action == "query":
        query = opts.get("query", "")
        if not query:
            sys.exit("tracker api query: --query required")
        variables = json.loads(opts.get("variables", "{}"))
        print(json.dumps(api_response_for({"query": query, "variables": variables}), indent=2, sort_keys=True))
        return
    if action == "serve":
        host = opts.get("host", "127.0.0.1")
        port = int(opts.get("port", "8765"))
        server = ThreadingHTTPServer((host, port), ApiHandler)
        actual_host, actual_port = server.server_address
        print(f"tracker api listening on http://{actual_host}:{actual_port}/graphql", file=sys.stderr)
        server.serve_forever()
        return
    sys.exit(f"tracker api: unknown action '{action}'")


def poll_closed():
    print(json.dumps([issue["identifier"] for issue in store["issues"].values() if issue.get("stateType") in {"completed", "canceled"}]))


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: bash scripts/tracker <resource> <action> [args...]")
    resource = sys.argv[1]
    args = sys.argv[2:]
    action = args[0] if args else ""
    rest = args[1:] if args else []
    if resource == "issue":
        issue_cmd(action, rest)
    elif resource in {"project", "milestone"}:
        project_cmd(action, rest)
    elif resource == "label":
        label_cmd(action, rest)
    elif resource == "sprint":
        sprint_cmd(action, rest)
    elif resource == "state":
        state_cmd(action, rest)
    elif resource == "user":
        user_cmd(action, rest)
    elif resource == "search":
        search_cmd(args)
    elif resource == "query":
        query_cmd(args)
    elif resource == "view":
        view_cmd(action, rest)
    elif resource == "api":
        api_cmd(action, rest)
    elif resource == "import":
        import_cmd(action, rest)
    elif resource == "snapshot":
        snapshot_cmd(action, rest)
    elif resource == "extract-issue-ref":
        text = sys.stdin.read()
        known = sorted(store["issues"].keys(), key=len, reverse=True)
        for identifier in known:
            if re.search(rf"(?<![A-Z0-9-]){re.escape(identifier)}(?![A-Z0-9-])", text, re.IGNORECASE):
                print(identifier)
                return
        match = re.search(r"[A-Z][A-Z0-9]+-\d+", text)
        print(match.group(0) if match else "")
    elif resource == "format-issue-ref":
        if not args:
            sys.exit("tracker format-issue-ref: missing id")
        ref = args[0] if not args[0].isdigit() else f"{team_key}-{args[0]}"
        print(f"Closes {ref}")
    elif resource == "format-issue-url":
        if not args:
            sys.exit("tracker format-issue-url: missing id")
        ref = args[0] if not args[0].isdigit() else f"{team_key}-{args[0]}"
        issue = store["issues"].get(issue_id_from_ref(ref))
        print(issue.get("url") if issue and issue.get("url") else f"local://tracker/issue/{ref}")
    elif resource == "poll-closed":
        poll_closed()
    else:
        sys.exit(f"tracker: unknown resource '{resource}'")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "api":
        main()
    else:
        with tracker_process_lock():
            refresh_store()
            main()
