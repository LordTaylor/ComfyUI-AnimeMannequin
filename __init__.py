import os
from aiohttp import web
from server import PromptServer

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
routes = PromptServer.instance.routes

async def _serve_static(request):
    filename = request.match_info["filename"]
    static_root = os.path.realpath(STATIC_DIR)
    filepath = os.path.realpath(os.path.join(STATIC_DIR, filename))
    if not filepath.startswith(static_root + os.sep) or not os.path.isfile(filepath):
        raise web.HTTPNotFound()
    return web.FileResponse(filepath)

routes.get("/mannequin_editor/{filename:.*}")(_serve_static)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
