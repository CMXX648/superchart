"""Runtime paths for the fused replay app."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Config:
    ROOT = ROOT
    DATABASE = ROOT / "data" / "replay.sqlite"
    KLINE_ROOT = ROOT / "KLinePlayground"
    HOST = "127.0.0.1"
    PORT = 8765
