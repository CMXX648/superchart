"""JSON API for candles, users, sessions and trades."""

import uuid

from flask import Blueprint, jsonify, request

from app import db
from app.services.ashare import date_to_unix, fetch_frame, frame_to_candles

bp = Blueprint("api", __name__)


@bp.get("/health")
def health():
    return jsonify({"ok": True, "database": str(db.DB_PATH)})


@bp.get("/users")
def get_users():
    return jsonify(db.list_users())


@bp.post("/users")
def post_user():
    payload = request.get_json(silent=True) or {}
    return jsonify({"username": db.ensure_user(payload.get("username"))})


@bp.get("/users/<username>/sessions")
def get_sessions(username):
    return jsonify(db.list_sessions(db.ensure_user(username)))


@bp.get("/users/<username>/trades")
def get_user_trades(username):
    return jsonify(db.list_trades(db.ensure_user(username)))


@bp.post("/sessions")
def post_session():
    payload = request.get_json(silent=True) or {}
    session = {
        "id": payload.get("id") or uuid.uuid4().hex,
        "username": db.ensure_user(payload.get("username")),
        "market": payload.get("market") or "crypto",
        "symbol": payload.get("symbol") or "",
        "adjust": payload.get("adjust") or "",
        "started_at": payload.get("started_at") or db.utc_now(),
        "initial_capital": payload.get("initial_capital"),
    }
    db.create_session(session)
    return jsonify(session)


@bp.post("/sessions/<session_id>/complete")
def post_complete(session_id):
    db.complete_session(session_id, request.get_json(silent=True) or {})
    return jsonify({"ok": True, "id": session_id})


@bp.post("/trades")
def post_trade():
    return jsonify({"ok": True, "id": db.insert_trade(request.get_json(silent=True) or {})})


@bp.get("/candles")
def get_candles():
    market = request.args.get("market") or "crypto"
    symbol = (request.args.get("symbol") or "").upper()
    interval = request.args.get("interval") or "5m"
    adjust = request.args.get("adjust") or "none"
    candles = db.load_candles(market, symbol, interval, adjust)
    return jsonify({"market": market, "symbol": symbol, "candles": candles, "from_cache": True})


@bp.post("/candles")
def post_candles():
    payload = request.get_json(silent=True) or {}
    count = db.upsert_candles(
        payload.get("market") or "crypto",
        (payload.get("symbol") or "").upper(),
        payload.get("interval") or "5m",
        payload.get("adjust") or "none",
        payload.get("candles") or [],
    )
    return jsonify({"ok": True, "saved": count})


@bp.get("/ashare/klines")
def ashare_klines():
    code = "".join(ch for ch in (request.args.get("code") or "") if ch.isdigit())
    if len(code) != 6:
        return jsonify({"error": "stock code must be 6 digits"}), 400
    adjust = request.args.get("adjust") or "qfq"
    if adjust not in ("qfq", "hfq", "none", "forward", "backward"):
        adjust = "qfq"
    source = request.args.get("source") or "auto"
    refresh = request.args.get("refresh") == "1"
    start = request.args.get("start") or ""
    cached = [] if refresh else db.load_candles("ashare", code, "1d", adjust)
    if cached and not refresh:
        if start:
            start_unix = date_to_unix(start)
            cached = [bar for bar in cached if bar["time"] >= start_unix]
        return jsonify({
            "symbol": code, "name": code, "adjust": adjust, "source": "database",
            "base_interval": "1d", "candles": cached, "from_cache": True,
        })
    try:
        frame, name, chosen = fetch_frame(code, source, adjust)
    except Exception as exc:
        if cached:
            return jsonify({
                "symbol": code, "name": code, "adjust": adjust, "source": "database",
                "base_interval": "1d", "candles": cached, "from_cache": True,
                "warning": str(exc),
            })
        return jsonify({"error": "failed to load A-share bars: %s" % exc}), 502
    candles = frame_to_candles(frame)
    db.upsert_candles("ashare", code, "1d", adjust, candles)
    if start:
        start_unix = date_to_unix(start)
        candles = [bar for bar in candles if bar["time"] >= start_unix]
    return jsonify({
        "symbol": code, "name": name, "adjust": adjust, "source": chosen,
        "base_interval": "1d", "candles": candles, "from_cache": False,
    })
