"""Start the fused replay app.

Open http://127.0.0.1:8765
Database: data/replay.sqlite
"""

from app import create_app
from app.config import Config

app = create_app()

if __name__ == "__main__":
    print("Replay server: http://%s:%s" % (Config.HOST, Config.PORT))
    print("Database: %s" % Config.DATABASE)
    app.run(host=Config.HOST, port=Config.PORT, debug=False, use_reloader=False)
