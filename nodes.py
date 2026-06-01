import base64
import json
import os
import shutil
import subprocess
import tempfile
from typing import Optional

import folder_paths
import numpy as np
from PIL import Image

from .image_processing import load_image, image_to_tensor


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_node() -> Optional[str]:
    """Return path to node executable, or None if not found."""
    return shutil.which("node")


def _render_from_scene(scene_json: str, width: int, height: int) -> Optional[dict]:
    """
    Render mannequin from scene JSON using headless_render.js.
    Returns dict {pose, depth, canny, openpose} with data-URLs, or None on failure.
    Output is written to a temp file to avoid pipe-buffer truncation on large images.
    """
    node_exe = _find_node()
    if not node_exe:
        return None

    plugin_dir  = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(plugin_dir, "static", "headless_render.js")
    if not os.path.isfile(script_path):
        return None

    scene_b64 = base64.b64encode(scene_json.encode()).decode()
    out_fd, out_path = tempfile.mkstemp(suffix=".json", prefix="mannequin_render_")
    os.close(out_fd)
    try:
        result = subprocess.run(
            [node_exe, script_path, str(width), str(height), scene_b64, out_path],
            capture_output=True, text=True, timeout=60,
            cwd=os.path.join(plugin_dir, "static"),
        )
        if result.returncode != 0:
            print(f"[AnimeMannequin] headless_render error: {result.stderr[:500]}")
            return None
        with open(out_path, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"[AnimeMannequin] headless_render exception: {e}")
        return None
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


def _dataurl_to_array(data_url: str, width: int, height: int) -> np.ndarray:
    """Decode a PNG data-URL to float32 HxWx3 array, resized to (width, height)."""
    header, b64 = data_url.split(",", 1)
    raw = base64.b64decode(b64)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(raw)
        tmp_path = f.name
    try:
        arr = load_image(tmp_path, width, height)
    finally:
        os.unlink(tmp_path)
    return arr


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class AnimeMannequinNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width":  ("INT", {"default": 768, "min": 64, "max": 2048, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 2048, "step": 64}),
                "gender": (["F", "M"],),
            },
            "optional": {
                "scene":         ("STRING", {"default": ""}),
                "pose_file":     ("STRING", {"default": ""}),
                "depth_file":    ("STRING", {"default": ""}),
                "canny_file":    ("STRING", {"default": ""}),
                "openpose_file": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES  = ("IMAGE", "IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES  = ("pose", "depth", "canny", "openpose")
    FUNCTION      = "get_outputs"
    CATEGORY      = "AnimeMannequin"
    OUTPUT_NODE   = True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # NaN forces ComfyUI to re-execute on every queue run (no caching).
        return float("nan")

    @staticmethod
    def _safe_join(base: str, filename: str) -> str:
        if not filename:
            return ""
        real = os.path.realpath(os.path.join(base, filename))
        if not real.startswith(base + os.sep):
            return ""  # silently reject path traversal attempts
        return real

    def get_outputs(
        self,
        width: int,
        height: int,
        gender: str = "F",
        scene: str = "",
        pose_file: str = "",
        depth_file: str = "",
        canny_file: str = "",
        openpose_file: str = "",
    ):
        # ── Path 1: scene JSON provided → server-side render ────────────────
        if scene.strip():
            # Patch gender into scene JSON if not already set
            try:
                scene_obj = json.loads(scene)
                if not scene_obj.get("gender"):
                    scene_obj["gender"] = gender
                scene_str = json.dumps(scene_obj)
            except Exception:
                scene_str = scene

            rendered = _render_from_scene(scene_str, width, height)
            if rendered:
                pose     = image_to_tensor(_dataurl_to_array(rendered["pose"],     width, height))
                depth    = image_to_tensor(_dataurl_to_array(rendered["depth"],    width, height))
                canny    = image_to_tensor(_dataurl_to_array(rendered["canny"],    width, height))
                openpose = image_to_tensor(_dataurl_to_array(rendered["openpose"], width, height))
                return (pose, depth, canny, openpose)
            # Rendering failed — fall through to file-based path

        # ── Path 2: pre-uploaded PNG files (saved by the editor) ─────────────
        input_dir     = os.path.realpath(folder_paths.get_input_directory())
        pose_path     = self._safe_join(input_dir, pose_file)
        depth_path    = self._safe_join(input_dir, depth_file)
        canny_path    = self._safe_join(input_dir, canny_file)
        openpose_path = self._safe_join(input_dir, openpose_file)

        pose     = image_to_tensor(load_image(pose_path,     width, height))
        depth    = image_to_tensor(load_image(depth_path,    width, height))
        canny    = image_to_tensor(load_image(canny_path,    width, height))
        openpose = image_to_tensor(load_image(openpose_path, width, height))
        return (pose, depth, canny, openpose)


NODE_CLASS_MAPPINGS = {
    "AnimeMannequinNode": AnimeMannequinNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimeMannequinNode": "Anime Mannequin",
}
