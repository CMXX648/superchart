"""JSON API for candles, users, sessions and trades."""

import random
import uuid

from flask import Blueprint, jsonify, request

from app import db
from app.services.ashare import date_to_unix, fetch_frame, frame_to_candles

bp = Blueprint("api", __name__)

LOOKBACK_BARS = 30
MIN_REMAINING_BARS = 60


def lookback_window(candles, start_unix, lookback):
    """Bars from up to `lookback` bars before the first bar at or after start, to the end.

    Counts bars, not calendar days. Returns (bars, origin_time); empty when start is after the data.
    """
    origin = next((i for i, bar in enumerate(candles) if bar["time"] >= start_unix), None)
    if origin is None:
        return [], None
    return candles[max(0, origin - lookback):], candles[origin]["time"]


def pick_random_origin(candles, lookback, remaining, rng=random):
    """Draw a calendar day that leaves `lookback` bars before it and `remaining` bars from it.

    A non-trading day snaps to the next bar. Returns the bar time, or None when history is too short.
    """
    if len(candles) < lookback + remaining:
        return None
    lo = candles[lookback]["time"] // 86400
    hi = candles[len(candles) - remaining]["time"] // 86400
    day = rng.randint(lo, hi) * 86400
    return next(bar["time"] for bar in candles if bar["time"] >= day)


def _int_arg(name, limit):
    try:
        return max(0, min(int(request.args.get(name) or 0), limit))
    except ValueError:
        return 0


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
    lookback = _int_arg("lookback", LOOKBACK_BARS)
    cached = [] if refresh else db.load_candles("ashare", code, "1d", adjust)
    if cached and not refresh:
        candles, extra = cached, {"name": code, "source": "database", "from_cache": True}
    else:
        try:
            frame, name, chosen = fetch_frame(code, source, adjust)
        except Exception as exc:
            if not cached:
                return jsonify({"error": "failed to load A-share bars: %s" % exc}), 502
            candles, extra = cached, {"name": code, "source": "database", "from_cache": True, "warning": str(exc)}
        else:
            candles = frame_to_candles(frame)
            db.upsert_candles("ashare", code, "1d", adjust, candles)
            extra = {"name": name, "source": chosen, "from_cache": False}
    start_unix = date_to_unix(start) if start else None
    if request.args.get("random") == "1":
        start_unix = pick_random_origin(candles, lookback, MIN_REMAINING_BARS)
        if start_unix is None:
            return jsonify({
                "error": "history too short for a random start", "code": "too_short",
                "need": lookback + MIN_REMAINING_BARS, "have": len(candles),
            }), 422
    origin_time = None
    if start_unix is not None:
        candles, origin_time = lookback_window(candles, start_unix, lookback)
    return jsonify(dict(extra, symbol=code, adjust=adjust, base_interval="1d",
                        candles=candles, origin_time=origin_time))


@bp.get("/ai/config")
def get_ai_config():
    from app.services import ai_review
    return jsonify(ai_review.public_config())


@bp.post("/ai/config")
def post_ai_config():
    from app.services import ai_review
    try:
        saved = ai_review.save_config(request.get_json(silent=True) or {})
    except ai_review.ReviewError as exc:
        return jsonify({"error": exc.message, "code": exc.code}), exc.status
    return jsonify(saved)


@bp.post("/ai/review")
def post_ai_review():
    from app.services import ai_review
    try:
        result = ai_review.review_report(request.get_json(silent=True) or {})
    except ai_review.ReviewError as exc:
        return jsonify({"error": exc.message, "code": exc.code}), exc.status
    return jsonify(result)
