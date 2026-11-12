"""Flask application factory."""

from flask import Flask

from app.config import Config
from app.db import init_db


def create_app():
    application = Flask(__name__)
    application.config.from_object(Config)
    init_db()
    try:
        from flask_cors import CORS
        CORS(application, resources={r"/api/*": {"origins": "*"}})
    except ImportError:
        pass

    from app.routes.api import bp as api_bp
    from app.routes.web import bp as web_bp
    application.register_blueprint(web_bp)
    application.register_blueprint(api_bp, url_prefix="/api")
    return application
