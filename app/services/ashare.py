"""A-share daily bars, adjusted and stored by the caller."""

import sys
from datetime import datetime, timezone

from app.config import Config

if str(Config.KLINE_ROOT) not in sys.path:
    sys.path.insert(0, str(Config.KLINE_ROOT))


def date_to_unix(value):
    text = str(value)[:10]
    return int(datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())


def frame_to_candles(frame):
    candles = []
    for row in frame.itertuples(index=False):
        candles.append({
            "time": date_to_unix(row.date),
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(getattr(row, "volume", 0) or 0),
        })
    return candles


def apply_adjust(frame, factors, mode):
    import pandas as pd
    data = frame.copy()
    if mode in ("", "none", None):
        return data
    if factors is None or getattr(factors, "empty", True) or "factor" not in factors.columns:
        return data
    factor = factors[["date", "factor"]].copy()
    factor["date"] = pd.to_datetime(factor["date"])
    data["date"] = pd.to_datetime(data["date"])
    merged = data.merge(factor, on="date", how="left")
    merged["factor"] = merged["factor"].ffill().fillna(1.0)
    if mode in ("qfq", "forward"):
        base = float(merged["factor"].iloc[-1] or 1.0)
    elif mode in ("hfq", "backward"):
        base = float(merged["factor"].iloc[0] or 1.0)
    else:
        return data
    if base == 0:
        base = 1.0
    ratio = merged["factor"] / base
    for col in ("open", "high", "low", "close"):
        merged[col] = (merged[col] * ratio).round(2)
    return merged.drop(columns=["factor"], errors="ignore")


def fetch_frame(code, source, adjust):
    from backend.data_manager import DataManager
    manager = DataManager(data_dir=str(Config.KLINE_ROOT / "data"))
    chosen = source if source in ("akshare", "mootdx", "offline") else "akshare"
    frame = manager.get_stock_data(code, source=chosen, interval="daily")
    if frame is None or frame.empty:
        raise RuntimeError("no daily bars for %s" % code)
    factors = manager.get_factor_data(code, source=chosen, interval="daily")
    name = manager.get_stock_name(code)
    return apply_adjust(frame, factors, adjust), name, chosen
