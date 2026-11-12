"""HTML page and project documents."""

from flask import Blueprint, abort, render_template, send_from_directory

from app.config import Config

bp = Blueprint("web", __name__)


@bp.get("/")
def index():
    return render_template("index.html")


@bp.get("/docs/<path:name>")
def project_doc(name):
    if not name.endswith(".md") or ".." in name.replace("\\", "/"):
        abort(404)
    target = (Config.ROOT / "docs" / name).resolve()
    docs_root = (Config.ROOT / "docs").resolve()
    if docs_root not in target.parents and target != docs_root:
        abort(404)
    if not target.is_file():
        abort(404)
    return send_from_directory(target.parent, target.name)
