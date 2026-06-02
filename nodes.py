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

try:
    from .glb_renderer import render_glb_depth
    _GLB_RENDERER_OK = True
except Exception:
    _GLB_RENDERER_OK = False


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
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(raw)
            tmp_path = f.name
        arr = load_image(tmp_path, width, height)
    finally:
        if tmp_path is not None:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
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
                # headless_render.js uses FK convention: R arm at +X → right side of image
                # (character viewed from behind).  The GLB renderer faces the camera
                # (R arm on the LEFT).  Flip headless outputs horizontally when used as
                # a fallback so they match the GLB front-facing convention.
                def _flip_h(arr: np.ndarray) -> np.ndarray:
                    return np.ascontiguousarray(arr[:, ::-1, :])

                # Single source of truth: the GLB renderer produces pose, depth, canny
                # AND openpose from the SAME posed joints + same camera.
                #   pose     = shaded clay render of the model (editor-style screenshot)
                #   openpose = clean OpenPose skeleton (the ControlNet input)
                # Both overlay depth exactly — no second (FK) generator, no drift.
                pose = depth = canny = openpose = None
                if _GLB_RENDERER_OK:
                    # Wrap the whole GLB path: any failure inside (malformed bone data,
                    # trimesh/pyrender errors, degenerate mesh) must degrade to the
                    # headless fallback below — never crash the node.
                    try:
                        bone_transforms = rendered.get("bones")
                        glb_result = render_glb_depth(scene_str, width, height, bone_transforms)
                    except Exception as e:
                        print(f"[AnimeMannequin] GLB render failed, falling back: {e}")
                        glb_result = None
                    if glb_result is not None:
                        pose_arr, depth_arr, canny_arr, openpose_arr = glb_result
                        pose  = image_to_tensor(pose_arr)
                        depth = image_to_tensor(depth_arr)
                        canny = image_to_tensor(canny_arr)
                        if openpose_arr is not None:
                            openpose = image_to_tensor(openpose_arr)

                # Fallbacks (GLB unavailable / failed) — flipped headless outputs.
                # The subprocess JSON is external: a missing/garbled key must yield a
                # black frame, not a KeyError/ValueError that crashes this fallback path.
                def _safe_headless(key: str) -> np.ndarray:
                    url = rendered.get(key)
                    if not isinstance(url, str) or "," not in url:
                        return np.zeros((height, width, 3), dtype=np.float32)
                    try:
                        return _flip_h(_dataurl_to_array(url, width, height))
                    except Exception:
                        return np.zeros((height, width, 3), dtype=np.float32)

                if depth is None:
                    depth = image_to_tensor(_safe_headless("depth"))
                if canny is None:
                    canny = image_to_tensor(_safe_headless("canny"))
                if pose is None:
                    pose = image_to_tensor(_safe_headless("pose"))
                if openpose is None:
                    openpose = image_to_tensor(_safe_headless("openpose"))

                return (pose, depth, canny, openpose)
            # Rendering failed — fall through to file-based path

        # ── Path 2: pre-uploaded PNG files (saved by the editor) ─────────────
        input_dir     = os.path.realpath(folder_paths.get_input_directory())
        pose_path     = self._safe_join(input_dir, pose_file)
        depth_path    = self._safe_join(input_dir, depth_file)
        canny_path    = self._safe_join(input_dir, canny_file)
        openpose_path = self._safe_join(input_dir, openpose_file)

        def _load_or_blank(path: str) -> np.ndarray:
            if path and os.path.isfile(path):
                return load_image(path, width, height)
            return np.zeros((height, width, 3), dtype=np.float32)

        pose     = image_to_tensor(_load_or_blank(pose_path))
        depth    = image_to_tensor(_load_or_blank(depth_path))
        canny    = image_to_tensor(_load_or_blank(canny_path))
        openpose = image_to_tensor(_load_or_blank(openpose_path))
        return (pose, depth, canny, openpose)


NODE_CLASS_MAPPINGS = {
    "AnimeMannequinNode": AnimeMannequinNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimeMannequinNode": "Anime Mannequin",
}
