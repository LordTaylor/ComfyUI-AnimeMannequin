"""
glb_renderer.py  —  server-side depth/canny/openpose from GLB mesh + bone pose.

Renders the actual female.glb / male.glb mesh using pyrender + trimesh for
depth-map quality matching the browser editor.  Requires:
    pip install pyrender trimesh

For posed (non-T-pose) renders the mesh is rendered in its rest T-pose and
the depth is used as a reference.  Full skinning deformation is not yet
implemented (PRs welcome).

Exports:
    render_glb_depth(scene_json, width, height) -> (depth_arr, canny_arr) | None
"""

import os
import json
import math
import numpy as np

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
_ASSETS_DIR = os.path.join(_PLUGIN_DIR, "static", "assets")

_PYRENDER_OK = False
try:
    import trimesh
    import pyrender
    _PYRENDER_OK = True
except ImportError:
    pass


def _glb_path(gender: str) -> str:
    name = "female.glb" if gender != "M" else "male.glb"
    return os.path.join(_ASSETS_DIR, name)


def _load_combined_mesh(gender: str):
    """Load GLB and return a single trimesh.Trimesh with all transforms baked."""
    glb_path = _glb_path(gender)
    if not os.path.isfile(glb_path):
        return None
    scene = trimesh.load(glb_path, force="scene")
    try:
        combined = scene.to_geometry()          # trimesh >= 4.x
    except AttributeError:
        combined = scene.dump(concatenate=True)  # older trimesh
    return combined


def _build_camera_pose(centroid, size, azimuth_deg=0, elevation_deg=5):
    """
    Return a 4×4 camera-pose matrix for a camera orbiting the centroid.
    Matches headless_render.js camera logic.
    """
    az  = math.radians(azimuth_deg)
    el  = math.radians(elevation_deg)
    # Camera looks toward -Z in its own space; orbit = standard spherical
    d   = size * 1.4                 # distance scaled to bounding-box diagonal
    cx  = centroid[0] + d * math.sin(az) * math.cos(el)
    cy  = centroid[1] + d * math.sin(el)
    cz  = centroid[2] + d * math.cos(az) * math.cos(el)

    # LookAt: camera at (cx,cy,cz) looking at centroid, up = (0,1,0)
    # Standard OpenGL look-at convention (right-handed):
    #   right = normalize(forward × world_up)
    #   up    = right × forward          (not forward × right!)
    #   pose column 2 = -forward         (camera looks along its -Z)
    fwd   = np.array([centroid[0]-cx, centroid[1]-cy, centroid[2]-cz])
    fwd  /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0.0, 1.0, 0.0]);  right /= np.linalg.norm(right)
    up    = np.cross(right, fwd)

    pose = np.eye(4)
    pose[:3, 0] = right
    pose[:3, 1] = up
    pose[:3, 2] = -fwd          # camera looks toward its -Z
    pose[:3, 3] = [cx, cy, cz]
    return pose


def _sobel_canny(depth_uint8: np.ndarray) -> np.ndarray:
    """Sobel edge detection on a uint8 grey image (vectorised numpy)."""
    src = depth_uint8.astype(np.float32)
    # Sobel X and Y via strided slice convolution
    gx = (-src[:-2, :-2] + src[:-2, 2:]
          - 2*src[1:-1, :-2] + 2*src[1:-1, 2:]
          - src[2:,  :-2] + src[2:,  2:])
    gy = (-src[:-2, :-2] - 2*src[:-2, 1:-1] - src[:-2, 2:]
          + src[2:,  :-2] + 2*src[2:,  1:-1] + src[2:,  2:])
    mag = np.sqrt(gx*gx + gy*gy)
    out = np.zeros_like(depth_uint8)
    out[1:-1, 1:-1] = (mag > 30).astype(np.uint8) * 255
    return out


def render_glb_depth(scene_json: str, width: int, height: int):
    """
    Render depth and canny from the GLB mesh.

    Parameters
    ----------
    scene_json : str
        Scene JSON string (same format as the editor exports).
    width, height : int
        Output image dimensions.

    Returns
    -------
    (depth_arr, canny_arr) : tuple of np.ndarray (H×W×3, float32, [0,1])
        or None if pyrender is unavailable.
    """
    if not _PYRENDER_OK:
        return None

    try:
        scene_data = json.loads(scene_json)
    except Exception:
        return None

    gender = scene_data.get("gender", "F")
    camera_cfg = scene_data.get("camera", {})

    mesh = _load_combined_mesh(gender)
    if mesh is None:
        return None

    # ── Build pyrender scene ───────────────────────────────────────────────
    pr_scene = pyrender.Scene(
        bg_color=[0, 0, 0, 0],
        ambient_light=[0.4, 0.4, 0.4],
    )
    pr_mesh = pyrender.Mesh.from_trimesh(mesh, smooth=True)
    pr_scene.add(pr_mesh)

    # Camera
    centroid = mesh.centroid
    extents  = mesh.extents
    size     = float(np.linalg.norm(extents))
    cam_pose = _build_camera_pose(
        centroid, size,
        azimuth_deg   = camera_cfg.get("azimuth",   0),
        elevation_deg = camera_cfg.get("elevation", 5),
    )
    camera = pyrender.PerspectiveCamera(yfov=math.radians(45), aspectRatio=width / height)
    pr_scene.add(camera, pose=cam_pose)

    # Light (co-located with camera for even illumination)
    pr_scene.add(pyrender.DirectionalLight(color=[1, 1, 1], intensity=3.0), pose=cam_pose)

    # ── Render ────────────────────────────────────────────────────────────
    os.environ.setdefault("PYOPENGL_PLATFORM", "egl")
    renderer = pyrender.OffscreenRenderer(width, height)
    try:
        _, depth = renderer.render(pr_scene)
    finally:
        renderer.delete()

    # ── Normalise depth → uint8 [0,255], near=255, far=DEPTH_MIN ─────────
    DEPTH_MIN = 30
    fg   = depth > 0
    if not fg.any():
        return None

    mn, mx = depth[fg].min(), depth[fg].max()
    depth_u8 = np.zeros((height, width), dtype=np.uint8)
    depth_u8[fg] = (255 - (depth[fg] - mn) / (mx - mn + 1e-6) * (255 - DEPTH_MIN)).astype(np.uint8)

    # ── Canny (Sobel) ─────────────────────────────────────────────────────
    canny_u8 = _sobel_canny(depth_u8)

    # ── Convert to float32 H×W×3 tensors ──────────────────────────────────
    def to_rgb(arr):
        rgb = np.stack([arr, arr, arr], axis=-1).astype(np.float32) / 255.0
        return rgb

    return to_rgb(depth_u8), to_rgb(canny_u8)
