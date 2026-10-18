import json
import os
import sqlite3
import psycopg
from psycopg.rows import dict_row
from contextlib import contextmanager

DB_PATH = os.getenv("DABLAB_DB", os.path.join(os.path.dirname(__file__), "..", "dablab.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    name       TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dances (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    bpm        REAL NOT NULL,
    builtin    INTEGER NOT NULL DEFAULT 0,
    difficulty INTEGER NOT NULL DEFAULT 1,
    data       TEXT NOT NULL,  -- full dance JSON (see docs/dance-format.md)
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attempts (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    dance_id      INTEGER NOT NULL REFERENCES dances(id),
    step_index    INTEGER NOT NULL,
    overall       REAL NOT NULL,
    joint_scores  TEXT NOT NULL,  -- {"leftElbow": 0.82, ...}
    timing_offset REAL NOT NULL DEFAULT 0,  -- seconds; + early, - late
    speed         REAL NOT NULL DEFAULT 1,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    time_spent    REAL NOT NULL DEFAULT 0,
    passed        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id),
    skills      TEXT NOT NULL DEFAULT '{}',  -- EMA skill per joint and body part
    last_report TEXT,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


class PgCursor:
    def __init__(self, cursor):
        self._cursor = cursor
        self.rowcount = cursor.rowcount
        self.lastrowid = None
        if cursor.description and cursor.description[0].name == "id":
            row = cursor.fetchone()
            if row:
                self.lastrowid = row["id"]

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()


class PgConnection:
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        query = sql.replace("?", "%s")
        inserting = query.lstrip().upper().startswith("INSERT INTO")
        if inserting and "RETURNING" not in query.upper():
            query += " RETURNING user_id AS id" if "INSERT INTO profiles" in query else " RETURNING id"
        cursor = self._conn.execute(query, params)
        return PgCursor(cursor) if inserting else cursor

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def connect():
    if os.getenv('DATABASE_URL'):
        return PgConnection(psycopg.connect(os.environ['DATABASE_URL'], row_factory=dict_row))
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    if os.getenv('DATABASE_URL'):
        return
    with session() as conn:
        conn.executescript(SCHEMA)


def get_or_create_user(conn, name: str) -> int:
    row = conn.execute("SELECT id FROM users WHERE name = ?", (name,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO users (name) VALUES (?)", (name,))
    conn.execute("INSERT INTO profiles (user_id) VALUES (?)", (cur.lastrowid,))
    return cur.lastrowid


def loads(value, default=None):
    return json.loads(value) if value else default
