import asyncio
import json
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sdk"))

if "websockets" not in sys.modules:
    stub = types.ModuleType("websockets")
    stub.ConnectionClosed = type("ConnectionClosed", (Exception,), {})
    sys.modules["websockets"] = stub

from localbarreplay import Bridge  # noqa: E402

REJECT = {"error": "A股数量必须是整数手（1手=100股）", "market": "ashare"}


class FakeChart:
    """Plays the browser: sends one candle, answers every request with REJECT."""

    def __init__(self):
        self.inbox = asyncio.Queue()
        self.sent = []
        self.inbox.put_nowait({"type": "event", "event": "candle",
                               "data": {"time": 1, "open": 1, "high": 1, "low": 1, "close": 1}})

    async def send(self, raw):
        msg = json.loads(raw)
        self.sent.append(msg)
        if msg.get("request_id"):
            self.inbox.put_nowait({"type": "response", "request_id": msg["request_id"], "data": REJECT})

    def __aiter__(self):
        return self

    async def __anext__(self):
        msg = await self.inbox.get()
        if msg is None:
            raise StopAsyncIteration
        return json.dumps(msg)


class BridgeOrderTest(unittest.TestCase):
    def test_order_from_candle_handler_gets_rejection_reason(self):
        bridge = Bridge()
        chart = FakeChart()
        results = {}

        @bridge.on_candle
        async def on_candle(candle, history):
            results["place"] = await bridge.place_trade(side="buy", lots=0.5)
            results["close"] = await bridge.close_trade(1)
            results["close_all"] = await bridge.close_all()
            chart.inbox.put_nowait(None)

        asyncio.run(asyncio.wait_for(bridge._handler(chart), timeout=3))

        self.assertEqual(results["place"], REJECT)
        self.assertEqual(results["close"], REJECT)
        self.assertEqual(results["close_all"], REJECT)
        sent = [m["type"] for m in chart.sent if m.get("request_id")]
        self.assertEqual(sent, ["place_trade", "close_trade", "close_all"])


if __name__ == "__main__":
    unittest.main()
