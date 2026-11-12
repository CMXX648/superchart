import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flask import Flask

from app.routes.api import bp
from app.services import ai_review


SAMPLE = {
    "market": "ashare",
    "symbol": "600519",
    "total_return": 3.25,
    "initial_capital": 100000,
    "final_capital": 103250,
    "trades": [{
        "side": "buy",
        "lots": 1,
        "leverage": 1,
        "entry_price": 1680.5,
        "exit_price": 1710.0,
        "pnl": 2800,
        "fee": 12.5,
        "open_date": "2024-03-01",
        "tp": None,
        "sl": 1600,
    }],
}


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def read(self):
        return self.payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeOpener:
    def __init__(self, content):
        self.content = content
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        return FakeResponse({"choices": [{"message": {"content": self.content}}]})


class AiReviewTest(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
        handle.close()
        self.tmp = handle.name
        os.environ["LBR_AI_CONFIG"] = self.tmp
        Path(self.tmp).write_text("{}\n", encoding="utf-8")
        application = Flask(__name__)
        application.register_blueprint(bp, url_prefix="/api")
        self.client = application.test_client()
        self.previous = ai_review.http_opener
        ai_review.http_opener = None

    def tearDown(self):
        ai_review.http_opener = self.previous
        os.environ.pop("LBR_AI_CONFIG", None)
        try:
            os.remove(self.tmp)
        except OSError:
            pass

    def test_config_hides_key(self):
        secret = "sk-test-secret-key-9001"
        saved = self.client.post("/api/ai/config", json={
            "base_url": "https://example.test/v1",
            "model": "demo-model",
            "api_key": secret,
        })
        self.assertEqual(saved.status_code, 200)
        body = saved.get_json()
        self.assertNotIn("api_key", body)
        self.assertNotIn(secret, json.dumps(body))
        self.assertTrue(body["configured"])
        self.assertEqual(body["model"], "demo-model")
        self.assertTrue(body["key_mask"].endswith("9001"))
        self.assertNotEqual(body["key_mask"], secret)
        fetched = self.client.get("/api/ai/config")
        self.assertNotIn(secret, fetched.get_data(as_text=True))
        self.assertNotIn("api_key", fetched.get_json())

    def test_blank_key_keeps_existing_and_mask_is_rejected(self):
        self.client.post("/api/ai/config", json={"api_key": "sk-keep-this-key"})
        kept = self.client.post("/api/ai/config", json={"model": "other", "api_key": "  "})
        self.assertEqual(kept.status_code, 200)
        stored = json.loads(Path(self.tmp).read_text(encoding="utf-8"))
        self.assertEqual(stored["api_key"], "sk-keep-this-key")
        self.assertEqual(stored["model"], "other")
        masked = self.client.post("/api/ai/config", json={"api_key": kept.get_json()["key_mask"]})
        self.assertEqual(masked.status_code, 400)
        stored = json.loads(Path(self.tmp).read_text(encoding="utf-8"))
        self.assertEqual(stored["api_key"], "sk-keep-this-key")

    def test_review_without_key_is_explicit(self):
        response = self.client.post("/api/ai/review", json=SAMPLE)
        self.assertEqual(response.status_code, 400)
        body = response.get_json()
        self.assertEqual(body["code"], "missing_key")
        self.assertIn("Key", body["error"])
        dumped = json.dumps(body, ensure_ascii=False)
        self.assertNotIn("raw", body)
        self.assertNotIn("sections", body)
        self.assertNotIn("优点", dumped)
        self.assertNotIn("评分", dumped)

    def test_prompt_contains_market_facts(self):
        text = ai_review.build_messages(ai_review.normalize_report(SAMPLE))[1]["content"]
        for token in ("600519", "3.25", "1680.5", "T+1", "整手", "佣金", "印花税"):
            self.assertIn(token, text)
        crypto = ai_review.normalize_report({
            "market": "crypto",
            "symbol": "BTCUSDT",
            "total_return": -1.5,
            "trades": [{
                "side": "sell",
                "lots": 0.2,
                "leverage": 3,
                "entry_price": 42000,
                "exit_price": 41000,
                "pnl": 600,
                "tp": 40000,
                "sl": 43000,
            }],
        })
        crypto_text = ai_review.build_messages(crypto)[1]["content"]
        for token in ("BTCUSDT", "-1.5", "42000", "杠杆", "多空", "止盈", "止损", "价差"):
            self.assertIn(token, crypto_text)

    def test_parse_score_only_when_complete(self):
        parsed = ai_review.parse_review("优点：纪律\n风险：追高\n改进：等确认\n评分：72")
        self.assertTrue(parsed["parsed"])
        self.assertEqual(parsed["score"], 72)
        failed = ai_review.parse_review("这局还行，大概 80 分，但没有分节。")
        self.assertFalse(failed["parsed"])
        self.assertIsNone(failed["score"])
        self.assertIn("80", failed["raw"])
        decimal = ai_review.parse_review("优点：纪律\n风险：追高\n改进：等确认\n评分：64.5")
        self.assertFalse(decimal["parsed"])
        self.assertIsNone(decimal["score"])

    def test_review_with_key_includes_facts_and_hides_key(self):
        secret = "sk-live-do-not-leak"
        self.client.post("/api/ai/config", json={
            "base_url": "https://llm.example/v1",
            "model": "coach",
            "api_key": secret,
        })
        opener = FakeOpener("优点：按计划卖出\n风险：仓位偏大\n改进：少做冲动单\n评分：64")
        ai_review.http_opener = opener
        response = self.client.post("/api/ai/review", json=SAMPLE)
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertNotIn(secret, json.dumps(body))
        self.assertEqual(body["facts"]["symbol"], "600519")
        self.assertEqual(body["facts"]["total_return"], 3.25)
        self.assertEqual(body["facts"]["trade"]["entry_price"], 1680.5)
        self.assertEqual(body["score"], 64)
        self.assertTrue(body["parsed"])
        request = opener.requests[0]
        sent = json.loads(request.data.decode("utf-8"))
        prompt = sent["messages"][1]["content"]
        self.assertIn("600519", prompt)
        self.assertIn("3.25", prompt)
        self.assertIn("1680.5", prompt)
        self.assertNotIn(secret, prompt)
        self.assertTrue(request.full_url.endswith("/chat/completions"))
        self.assertIn(secret, request.get_header("Authorization"))

    def test_unparsed_model_text_has_no_invented_score(self):
        self.client.post("/api/ai/config", json={"api_key": "sk-another-secret"})
        ai_review.http_opener = FakeOpener("模型没有按格式输出，提到了 88 但不是评分。")
        body = self.client.post("/api/ai/review", json=SAMPLE).get_json()
        self.assertFalse(body["parsed"])
        self.assertIsNone(body["score"])
        self.assertIsNone(body["sections"])
        self.assertIn("88", body["raw"])


if __name__ == "__main__":
    unittest.main()
