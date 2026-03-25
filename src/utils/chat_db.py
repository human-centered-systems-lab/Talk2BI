import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, List


# Determine project root (two levels up from this utils module)
BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "chat_logs.db"


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Ensure the SQLite schema for chat message logging exists.

    The DB schema stores messages keyed by ``session_id`` and ``user_id``.

    Existing databases remain compatible:
    - If the table does not yet exist, it is created with a ``user_id``
      column.
    - If the table exists but lacks ``user_id``, the column is added via
      ``ALTER TABLE``.
    """

    # Create the table if it does not exist yet. For new databases this
    # already includes the ``user_id`` column.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            user_id TEXT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )

    # For existing databases that may have been created without a
    # ``user_id`` column, add it if necessary.
    cur = conn.execute("PRAGMA table_info(chat_messages)")
    columns = [row[1] for row in cur.fetchall()]
    if "user_id" not in columns:
        conn.execute("ALTER TABLE chat_messages ADD COLUMN user_id TEXT")


def log_message(
    session_id: Optional[str],
    role: str,
    content: str,
    user_id: Optional[str] = None,
) -> None:
    """Append a chat message to the local SQLite DB under ./data.

    Args:
        session_id: The logical chat session identifier (may be None).
        role: "user" or "assistant".
        content: The full message text to log.
    """

    # Normalise identifiers to strings for storage.
    session = session_id or ""
    user = user_id or ""
    ts = datetime.now(timezone.utc).isoformat()

    with sqlite3.connect(DB_PATH) as conn:
        _ensure_schema(conn)

        # Check the last stored message for this (session_id, user_id, role).
        # If the content is identical, skip inserting to avoid duplicate
        # rows when the same payload is sent multiple times (e.g., due to
        # reruns).
        cur = conn.execute(
            """
            SELECT content
            FROM chat_messages
            WHERE session_id = ? AND user_id = ? AND role = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (session, user, role),
        )
        row = cur.fetchone()
        if row is not None and row[0] == content:
            return

        conn.execute(
            "INSERT INTO chat_messages (session_id, user_id, role, content, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (session, user, role, content, ts),
        )
        conn.commit()


def get_messages(session_id: str) -> List[Dict[str, str]]:
    """Return all messages for a given session_id ordered by insertion.

    The result is a list of dicts with keys: ``role``, ``content``,
    and ``created_at``.
    """

    session = session_id or ""

    with sqlite3.connect(DB_PATH) as conn:
        _ensure_schema(conn)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(
            """
            SELECT role, content, created_at
            FROM chat_messages
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session,),
        )
        rows = cur.fetchall()

    return [
        {
            "role": row["role"],
            "content": row["content"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def get_recent_sessions_for_user(
    user_id: str,
    limit: int = 10,
) -> List[Dict[str, str]]:
    """Return up to ``limit`` most recent chat sessions for a given user.

    "Recent" is defined by the latest ``created_at`` timestamp among all
    messages for that (user_id, session_id) pair. For each session we also
    return the content of the first user message so the UI can display a
    short preview.

    Each returned dict has the keys:
    - ``session_id``
    - ``first_message`` (first user message content in that session)
    - ``last_activity`` (ISO timestamp of most recent message)
    """

    if not user_id:
        return []

    with sqlite3.connect(DB_PATH) as conn:
        _ensure_schema(conn)
        conn.row_factory = sqlite3.Row

        cur = conn.execute(
            """
            SELECT s.session_id,
                   m.content AS first_message,
                   s.last_activity
            FROM (
                SELECT session_id,
                       MIN(id) AS first_user_msg_id,
                       MAX(created_at) AS last_activity
                FROM chat_messages
                WHERE user_id = ? AND role = 'user'
                GROUP BY session_id
                ORDER BY last_activity DESC
                LIMIT ?
            ) AS s
            JOIN chat_messages AS m
              ON m.id = s.first_user_msg_id
            ORDER BY s.last_activity DESC
            """,
            (user_id, limit),
        )

        rows = cur.fetchall()

    return [
        {
            "session_id": row["session_id"],
            "first_message": row["first_message"],
            "last_activity": row["last_activity"],
        }
        for row in rows
    ]

