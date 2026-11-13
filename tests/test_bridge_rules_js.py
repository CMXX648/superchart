import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "js" / "bridge_rules.test.js"


@unittest.skipUnless(shutil.which("node"), "node not installed")
class BridgeRulesJsTest(unittest.TestCase):
    def test_bridge_orders_follow_market_rules(self):
        run = subprocess.run(["node", str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr or run.stdout)


if __name__ == "__main__":
    unittest.main()
