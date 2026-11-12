"""Post-session review. The API key stays on the server and is never returned."""

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

from app.config import Config

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
MAX_TRADES = 40


class ReviewError(Exception):
    def __init__(self, message, status=400, code="review_error"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def config_path():
    override = os.environ.get("LBR_AI_CONFIG")
    if override:
        return Path(override)
    return Config.ROOT / "data" / "ai_config.json"


def mask_key(key):
    text = (key or "").strip()
    if not text:
        return ""
    if len(text) <= 8:
        return "...." + text[-2:]
    return text[:3] + "..." + text[-4:]


def _read_file():
    path = config_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {}
    return data if isinstance(data, dict) else {}


def load_config():
    data = _read_file()
    base_url = str(data.get("base_url") or DEFAULT_BASE_URL).strip().rstrip("/")
    model = str(data.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    api_key = str(data.get("api_key") or "").strip()
    return {"base_url": base_url, "model": model[:80], "api_key": api_key}


def public_config(cfg=None):
    cfg = cfg or load_config()
    key = cfg.get("api_key") or ""
    return {
        "configured": bool(key),
        "model": cfg.get("model") or DEFAULT_MODEL,
        "base_url": cfg.get("base_url") or DEFAULT_BASE_URL,
        "key_mask": mask_key(key),
    }


def _validate_base_url(base_url):
    text = (base_url or "").strip().rstrip("/")
    if not text.startswith("http://") and not text.startswith("https://"):
        raise ReviewError("base_url 必须以 http:// 或 https:// 开头", 400, "bad_config")
    host = text.split("://", 1)[1].split("/")[0]
    if not host or "@" in host:
        raise ReviewError("base_url 不能包含账号或密码", 400, "bad_config")
    return text


def save_config(payload):
    payload = payload or {}
    current = load_config()
    base_url = _validate_base_url(payload.get("base_url") or current.get("base_url") or DEFAULT_BASE_URL)
    model = str(payload.get("model") or current.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if payload.get("clear_key"):
        api_key = ""
    else:
        incoming = payload.get("api_key")
        if incoming is None or not str(incoming).strip():
            api_key = current.get("api_key") or ""
        else:
            api_key = str(incoming).strip()
            if api_key.lower().startswith("bearer "):
                api_key = api_key.split(None, 1)[1].strip()
            masked = mask_key(current.get("api_key") or "")
            if "..." in api_key or api_key == masked:
                raise ReviewError("请粘贴完整 Key，不要保存掩码", 400, "bad_config")
    if len(api_key) > 512:
        raise ReviewError("API Key 过长", 400, "bad_config")
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {"base_url": base_url, "model": model[:80], "api_key": api_key}
    path.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return public_config(body)


def _num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _trade_line(trade, index):
    return (
        "%d. side=%s lots=%s leverage=%s entry=%s exit=%s pnl=%s fee=%s date=%s tp=%s sl=%s"
        % (
            index,
            trade.get("side") or "-",
            trade.get("lots"),
            trade.get("leverage"),
            trade.get("entry_price"),
            trade.get("exit_price"),
            trade.get("pnl"),
            trade.get("fee"),
            trade.get("open_date") or "-",
            trade.get("tp") if trade.get("tp") is not None else "-",
            trade.get("sl") if trade.get("sl") is not None else "-",
        )
    )


def normalize_report(payload):
    payload = payload or {}
    market = str(payload.get("market") or "").strip().lower()
    if market not in ("ashare", "crypto"):
        raise ReviewError("市场必须是 ashare 或 crypto", 400, "bad_report")
    symbol = str(payload.get("symbol") or "").strip()
    if not symbol:
        raise ReviewError("缺少代码，不能点评", 400, "bad_report")
    total_return = _num(payload.get("total_return"))
    if total_return is None:
        raise ReviewError("缺少收益率，不能点评", 400, "bad_report")
    trades = payload.get("trades") or []
    if not isinstance(trades, list):
        raise ReviewError("成交明细格式不对", 400, "bad_report")
    slim = []
    for trade in trades[:MAX_TRADES]:
        if not isinstance(trade, dict):
            continue
        slim.append({
            "symbol": str(trade.get("symbol") or symbol)[:32],
            "side": str(trade.get("side") or "")[:8],
            "lots": _num(trade.get("lots")),
            "leverage": _num(trade.get("leverage")),
            "entry_price": _num(trade.get("entry_price")),
            "exit_price": _num(trade.get("exit_price")),
            "pnl": _num(trade.get("pnl")),
            "fee": _num(trade.get("fee")),
            "open_date": str(trade.get("open_date") or "")[:32],
            "tp": None if trade.get("tp") in (None, "") else _num(trade.get("tp")),
            "sl": None if trade.get("sl") in (None, "") else _num(trade.get("sl")),
        })
    return {
        "session_id": str(payload.get("session_id") or "")[:64],
        "market": market,
        "symbol": symbol[:32],
        "lang": "en" if str(payload.get("lang") or "").lower().startswith("en") else "zh",
        "initial_capital": _num(payload.get("initial_capital")),
        "final_capital": _num(payload.get("final_capital")),
        "total_return": total_return,
        "trade_count": len(slim),
        "trades": slim,
    }


def market_rules(market):
    if market == "ashare":
        return (
            "A股规则：只做多，不能开空；数量必须是整手，1手=100股；"
            "T+1，买入当日不能卖出；模拟佣金为成交额的 0.0003，单笔最低 5；"
            "印花税为卖出成交额的 0.001，买入不收；不能使用杠杆。"
        )
    return (
        "加密货币规则：多空都可以；可以使用杠杆；"
        "可以设置止盈和止损；盈亏公式是价差 × 手数 × 杠杆。"
    )


def build_messages(report):
    lines = [
        "Review only the facts below. Do not invent trades that are not listed.",
        "The review must mention the symbol, the return, and at least one trade's side, entry and exit. If there are no closed trades, say so.",
        "Use these four headings exactly:",
        "优点：",
        "风险：",
        "改进：",
        "评分：",
        "The score must be an integer from 0 to 100.",
        "",
        "market: %s" % report["market"],
        "symbol: %s" % report["symbol"],
        "rules: %s" % market_rules(report["market"]),
        "initial_capital: %s" % report["initial_capital"],
        "final_capital: %s" % report["final_capital"],
        "total_return: %s%%" % report["total_return"],
        "closed_trades: %s" % report["trade_count"],
        "trades:",
    ]
    if not report["trades"]:
        lines.append("(no closed trades)")
    else:
        for index, trade in enumerate(report["trades"], 1):
            lines.append(_trade_line(trade, index))
    if report["lang"] == "en":
        lines.append("Write the body in English. Keep the four headings as 优点： 风险： 改进： 评分：")
    else:
        lines.append("Write the body in Chinese. Keep the four headings unchanged.")
    return [
        {
            "role": "system",
            "content": "You are a replay coach. Comment on the given record only. Do not place orders.",
        },
        {"role": "user", "content": "\n".join(lines)},
    ]


_HEADING = re.compile(r"(?:^|\n)\s*(?:[#>*\-\d\.\)\s`*])*(优点|风险|改进|评分)\s*[*`]*\s*[:：]\s*")


def parse_review(text):
    raw = (text or "").strip()
    empty = {"parsed": False, "sections": None, "score": None, "raw": raw}
    if not raw:
        return empty
    matches = list(_HEADING.finditer(raw))
    if len(matches) < 4:
        return empty
    chunks = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
        chunks[match.group(1)] = raw[match.end():end].strip()
    if any(not chunks.get(name) for name in ("优点", "风险", "改进", "评分")):
        return empty
    first_line = chunks["评分"].strip().splitlines()[0].strip()
    score_match = re.fullmatch(r"(\d{1,3})(?:分)?", first_line)
    if not score_match:
        return empty
    score = int(score_match.group(1))
    if score > 100:
        return empty
    return {
        "parsed": True,
        "sections": {
            "strengths": chunks["优点"],
            "risks": chunks["风险"],
            "improvements": chunks["改进"],
            "score": score,
        },
        "score": score,
        "raw": raw,
    }


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _default_opener():
    return urllib.request.build_opener(_NoRedirect)


http_opener = None


def _redact(text, secret):
    cleaned = text or ""
    if secret:
        cleaned = cleaned.replace(secret, "***")
    return re.sub(r"(?i)bearer\s+\S+", "Bearer ***", cleaned)


def chat_complete(config, messages, opener=None):
    url = config["base_url"].rstrip("/") + "/chat/completions"
    body = json.dumps({
        "model": config["model"],
        "temperature": 0.4,
        "messages": messages,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + config["api_key"],
            "Content-Type": "application/json",
        },
    )
    chosen = opener if opener is not None else http_opener
    send = chosen.open if chosen is not None else _default_opener().open
    try:
        with send(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = _redact(exc.read().decode("utf-8", "replace")[:400], config.get("api_key"))
        raise ReviewError("AI 接口请求失败：%s %s" % (exc.code, detail[:180]), 502, "upstream") from None
    except ReviewError:
        raise
    except Exception as exc:
        detail = _redact(str(exc), config.get("api_key"))
        raise ReviewError("AI 接口请求失败：%s" % detail[:180], 502, "upstream") from None
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise ReviewError("AI 接口没有返回点评正文", 502, "upstream")
    if not str(content or "").strip():
        raise ReviewError("AI 接口没有返回点评正文", 502, "upstream")
    return str(content)


def review_report(payload, opener=None):
    report = normalize_report(payload)
    config = load_config()
    if not config.get("api_key"):
        raise ReviewError("未配置 AI API Key，不能点评。请先在服务端保存 Key。", 400, "missing_key")
    raw = chat_complete(config, build_messages(report), opener=opener)
    parsed = parse_review(raw)
    sample = report["trades"][0] if report["trades"] else None
    return {
        "ok": True,
        "parsed": parsed["parsed"],
        "sections": parsed["sections"],
        "score": parsed["score"],
        "raw": parsed["raw"],
        "facts": {
            "market": report["market"],
            "symbol": report["symbol"],
            "total_return": report["total_return"],
            "trade_count": report["trade_count"],
            "trade": sample,
        },
    }
