import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd
from flask import Flask

from app.routes import api
from app.services.ashare import date_to_unix


def trading_days():
    """Weekdays from 2023-12-01, with the 2024-02-09..02-17 Spring Festival closed."""
    days, d = [], date(2023, 12, 1)
    while len(days) < 120:
        if d.weekday() < 5 and not (date(2024, 2, 9) <= d <= date(2024, 2, 17)):
            days.append(d)
        d += timedelta(days=1)
    return days


DAYS = trading_days()
BARS = [{"time": date_to_unix(d.isoformat()), "open": 1.0, "high": 1.0, "low": 1.0,
         "close": 1.0, "volume": 1.0} for d in DAYS]


class LookbackWindowTest(unittest.TestCase):
    def test_counts_trading_days_not_calendar_days(self):
        # 2024-02-18 is a Sunday right after the holiday: origin is 02-19.
        bars, origin = api.lookback_window(BARS, date_to_unix("2024-02-18"), 30)
        self.assertEqual(origin, date_to_unix("2024-02-19"))
        i = next(i for i, b in enumerate(bars) if b["time"] == origin)
        self.assertEqual(i, 30)
        self.assertEqual(bars[-1], BARS[-1])
        self.assertLess(bars[0]["time"], origin - 30 * 86400, "30 bars span more than 30 calendar days")

    def test_short_history_returns_what_exists(self):
        bars, origin = api.lookback_window(BARS, date_to_unix(DAYS[5].isoformat()), 30)
        self.assertEqual(bars, BARS)
        self.assertEqual(origin, BARS[5]["time"])

    def test_zero_lookback_is_old_filter(self):
        start = date_to_unix("2024-03-01")
        bars, _ = api.lookback_window(BARS, start, 0)
        self.assertEqual(bars, [b for b in BARS if b["time"] >= start])

    def test_start_after_data_is_empty(self):
        self.assertEqual(api.lookback_window(BARS, BARS[-1]["time"] + 86400, 30), ([], None))


class AshareRouteTest(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(api.bp, url_prefix="/api")
        self.client = app.test_client()

    def get(self, **params):
        query = {"code": "600519", "start": "2024-02-18", "lookback": "30"}
        query.update(params)
        return self.client.get("/api/ashare/klines", query_string=query)

    def test_database_and_fresh_paths_match(self):
        frame = pd.DataFrame([{"date": d.isoformat(), "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1}
                              for d in DAYS])
        with mock.patch.object(api.db, "load_candles", return_value=list(BARS)):
            cached = self.get().get_json()
        with mock.patch.object(api.db, "load_candles", return_value=[]), \
                mock.patch.object(api.db, "upsert_candles") as upsert, \
                mock.patch.object(api, "fetch_frame", return_value=(frame, "X", "akshare")):
            fresh = self.get().get_json()
        self.assertTrue(cached["from_cache"])
        self.assertFalse(fresh["from_cache"])
        self.assertEqual(cached["candles"], fresh["candles"])
        self.assertEqual(cached["origin_time"], fresh["origin_time"])
        self.assertEqual(len(upsert.call_args[0][4]), len(BARS), "database still stores everything")
        self.assertEqual(len(cached["candles"]), 30 + sum(1 for b in BARS if b["time"] >= cached["origin_time"]))

    def test_without_lookback_keeps_old_behavior(self):
        with mock.patch.object(api.db, "load_candles", return_value=list(BARS)):
            data = self.get(lookback="").get_json()
        self.assertEqual(data["candles"][0]["time"], date_to_unix("2024-02-19"))


if __name__ == "__main__":
    unittest.main()
