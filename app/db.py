"""SQLite storage for cached candles and user trade records."""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "replay.sqlite"
_LOCK = threading.Lock()


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _LOCK, connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS candles (
                market TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                adjust TEXT NOT NULL,
                time INTEGER NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume REAL NOT NULL,
                PRIMARY KEY (market, symbol, interval, adjust, time)
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                market TEXT NOT NULL,
                symbol TEXT,
                adjust TEXT,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                initial_capital REAL,
                final_capital REAL,
                total_return REAL,
                trade_count INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                username TEXT NOT NULL,
                market TEXT NOT NULL,
                symbol TEXT,
                side TEXT,
                lots REAL,
                leverage REAL,
                entry_price REAL,
                exit_price REAL,
                pnl REAL,
                fee REAL,
                open_date TEXT,
                close_time TEXT,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT OR IGNORE INTO users(username, created_at) VALUES (?, ?)",
            ("local", utc_now()),
        )


def ensure_user(username):
    name = (username or "local").strip()[:32] or "local"
    with _LOCK, connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO users(username, created_at) VALUES (?, ?)",
            (name, utc_now()),
        )
    return name


def list_users():
    with _LOCK, connect() as conn:
        rows = conn.execute("SELECT username, created_at FROM users ORDER BY username").fetchall()
    return [dict(row) for row in rows]


def upsert_candles(market, symbol, interval, adjust, candles):
    rows = []
    for bar in candles or []:
        try:
            rows.append((
                market, symbol, interval, adjust, int(bar["time"]),
                float(bar["open"]), float(bar["high"]), float(bar["low"]),
                float(bar["close"]), float(bar.get("volume") or 0),
            ))
        except (KeyError, TypeError, ValueError):
            continue
    if not rows:
        return 0
    with _LOCK, connect() as conn:
        conn.executemany(
            """
            INSERT INTO candles(market, symbol, interval, adjust, time, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(market, symbol, interval, adjust, time) DO UPDATE SET
                open=excluded.open, high=excluded.high, low=excluded.low,
                close=excluded.close, volume=excluded.volume
            """,
            rows,
        )
    return len(rows)


def load_candles(market, symbol, interval, adjust):
    with _LOCK, connect() as conn:
        rows = conn.execute(
            """
            SELECT time, open, high, low, close, volume
            FROM candles
            WHERE market=? AND symbol=? AND interval=? AND adjust=?
            ORDER BY time
            """,
            (market, symbol, interval, adjust),
        ).fetchall()
    return [dict(row) for row in rows]


def create_session(session):
    ensure_user(session["username"])
    with _LOCK, connect() as conn:
        conn.execute(
            """
            INSERT INTO sessions(id, username, market, symbol, adjust, started_at, initial_capital, trade_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                session["id"], session["username"], session["market"], session.get("symbol"),
                session.get("adjust"), session.get("started_at") or utc_now(),
                session.get("initial_capital"),
            ),
        )
    return session["id"]


def complete_session(session_id, data):
    with _LOCK, connect() as conn:
        conn.execute(
            """
            UPDATE sessions
            SET ended_at=?, final_capital=?, total_return=?, trade_count=?
            WHERE id=?
            """,
            (
                data.get("ended_at") or utc_now(),
                data.get("final_capital"),
                data.get("total_return"),
                data.get("trade_count"),
                session_id,
            ),
        )


def insert_trade(trade):
    username = ensure_user(trade.get("username"))
    payload = json.dumps(trade.get("payload") or trade, ensure_ascii=False)
    with _LOCK, connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO trades(
                session_id, username, market, symbol, side, lots, leverage,
                entry_price, exit_price, pnl, fee, open_date, close_time, payload, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade.get("session_id"), username, trade.get("market") or "crypto",
                trade.get("symbol"), trade.get("side"), trade.get("lots"), trade.get("leverage"),
                trade.get("entry_price"), trade.get("exit_price"), trade.get("pnl"), trade.get("fee"),
                trade.get("open_date"), trade.get("close_time"), payload, utc_now(),
            ),
        )
        if trade.get("session_id"):
            conn.execute(
                "UPDATE sessions SET trade_count = trade_count + 1 WHERE id=?",
                (trade["session_id"],),
            )
        return cur.lastrowid


def list_sessions(username, limit=50):
    with _LOCK, connect() as conn:
        rows = conn.execute(
            """
            SELECT id, username, market, symbol, adjust, started_at, ended_at,
                   initial_capital, final_capital, total_return, trade_count
            FROM sessions WHERE username=? ORDER BY started_at DESC LIMIT ?
            """,
            (username, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def list_trades(username, limit=100):
    with _LOCK, connect() as conn:
        rows = conn.execute(
            """
            SELECT id, session_id, username, market, symbol, side, lots, leverage,
                   entry_price, exit_price, pnl, fee, open_date, close_time, created_at
            FROM trades WHERE username=? ORDER BY id DESC LIMIT ?
            """,
            (username, limit),
        ).fetchall()
    return [dict(row) for row in rows]
