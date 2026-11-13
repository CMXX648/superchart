import shutil
import subprocess
import unittest
from pathlib import Path

JS_TESTS = Path(__file__).resolve().parent / "js"


@unittest.skipUnless(shutil.which("node"), "node not installed")
class FrontendJsTest(unittest.TestCase):
    def _run(self, name):
        run = subprocess.run(["node", str(JS_TESTS / name)], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr or run.stdout)

    def test_bridge_orders_follow_market_rules(self):
        self._run("bridge_rules.test.js")

    def test_origin_pointer_and_lookback(self):
        self._run("lookback.test.js")

    def test_stalled_binance_page_rejects(self):
        self._run("binance_fetch.test.js")

    def test_user_drawings(self):
        self._run("drawings.test.js")


if __name__ == "__main__":
    unittest.main()
