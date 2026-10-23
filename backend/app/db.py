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


class PostgresConnection:
    """Small compatibility layer for the original SQLite-style queries."""
    def __init__(self, conn):
        self.conn = conn

    def execute(self, query, params=()):
        query = query.replace("?", "%s")
        is_insert = query.lstrip().upper().startswith("INSERT INTO")
        if is_insert and "RETURNING" not in query.upper():
            query += " RETURNING id" if "INSERT INTO profiles" not in query else " RETURNING user_id"
        cursor = self.conn.execute(query, params)
        if is_insert:
            row = cursor.fetchone()
            return InsertResult(row["id"] if "id" in row else row["user_id"])
        return cursor

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


class InsertResult:
    def __init__(self, id):
        self.lastrowid = id
        self.rowcount = 1


def connect():
    if url := os.getenv("DATABASE_URL"):
        return PostgresConnection(psycopg.connect(url, row_factory=dict_row))
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
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    # The Supabase project already has the PostgreSQL schema. Do not run SQLite DDL there.
    if os.getenv("DATABASE_URL"):
        return
    with session() as conn:
        conn.executescript(SCHEMA)


def get_or_create_user(conn: sqlite3.Connection, name: str) -> int:
    row = conn.execute("SELECT id FROM users WHERE name = ?", (name,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO users (name) VALUES (?)", (name,))
    conn.execute("INSERT INTO profiles (user_id) VALUES (?)", (cur.lastrowid,))
    return cur.lastrowid


def loads(value, default=None):
    return json.loads(value) if value else default
