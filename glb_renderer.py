"""
glb_renderer.py  —  server-side depth/canny from GLB mesh + FK bone transforms.

Renders female.glb / male.glb using pyrender + trimesh.

When bone_transforms (from headless_render.js) are provided the character is posed:
  - FK traversal runs in GLB-world-space using the mesh's own rest joint positions
  - Each segment is rotated by the FK world quaternion composed with its GLB rest rotation
  - The FK world quaternions are converted to GLB space (GLB has X-axis flipped vs FK)

Without bone_transforms the mesh is rendered in rest T-pose (combined mesh).

Exports:
    render_glb_depth(scene_json, width, height, bone_transforms=None)
        -> (depth_arr, canny_arr) | None
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

# ── FK hierarchy (mirrors headless_render.js BONE_CHILDREN / BONE_PARENT) ─────

_BONE_CHILDREN = {
    "torso":       ["spine", "pelvis"],
    "spine":       ["chest"],
    "chest":       ["neck", "shoulder_L", "shoulder_R"],
    "neck":        ["head"],
    "head":        [],
    "shoulder_L":  ["upper_arm_L"],
    "upper_arm_L": ["forearm_L"],
    "forearm_L":   ["hand_L"],
    "hand_L":      [],
    "shoulder_R":  ["upper_arm_R"],
    "upper_arm_R": ["forearm_R"],
    "forearm_R":   ["hand_R"],
    "hand_R":      [],
    "pelvis":      ["thigh_L", "thigh_R"],
    "thigh_L":     ["shin_L"],
    "shin_L":      ["foot_L"],
    "foot_L":      [],
    "thigh_R":     ["shin_R"],
    "shin_R":      ["foot_R"],
    "foot_R":      [],
}
_BONE_PARENT = {}
for _p, _cs in _BONE_CHILDREN.items():
    for _c in _cs:
        _BONE_PARENT[_c] = _p

# ── Bone → GLB node name mappings (mirrors geometry-adapter-gltf.js MESH_MAP) ─

MESH_MAP = {
    "female": {
        "torso":       None,
        "spine":       "GEO-belly_female_primitive_stylized",
        "chest":       "GEO-chest_female_primitive_stylized",
        "neck":        "GEO-neck_female_primitive_stylized",
        "head":        "GEO-head_female_primitive_stylized",
        "shoulder_L":  "GEO-shoulder_female_primitive_stylized.L",
        "upper_arm_L": "GEO-arm_upper_female_primitive_stylized.L",
        "forearm_L":   "GEO-arm_lower_female_primitive_stylized.L",
        "hand_L":      "GEO-hand_female_primitive_stylized.L",
        "shoulder_R":  "GEO-shoulder_female_primitive_stylized.R",
        "upper_arm_R": "GEO-arm_upper_female_primitive_stylized.R",
        "forearm_R":   "GEO-arm_lower_female_primitive_stylized.R",
        "hand_R":      "GEO-hand_female_primitive_stylized.R",
        "pelvis":      "GEO-pelvis_female_primitive_stylized",
        "thigh_L":     "GEO-leg_upper_female_primitive_stylized.L",
        "shin_L":      "GEO-leg_lower_female_primitive_stylized.L",
        "foot_L":      "GEO-foot_female_primitive_stylized.L",
        "thigh_R":     "GEO-leg_upper_female_primitive_stylized.R",
        "shin_R":      "GEO-leg_lower_female_primitive_stylized.R",
        "foot_R":      "GEO-foot_female_primitive_stylized.R",
    },
    "male": {
        "torso":       None,
        "spine":       "GEO-belly_male_primitive_stylized",
        "chest":       "GEO-chest_male_primitive_stylized",
        "neck":        "GEO-neck_male_primitive_stylized",
        "head":        "GEO-head_male_primitive_stylized",
        "shoulder_L":  "GEO-shoulder_male_primitive_stylized.L",
        "upper_arm_L": "GEO-arm_upper_male_primitive_stylized.L",
        "forearm_L":   "GEO-arm_lower_male_primitive_stylized.L",
        "hand_L":      "GEO-hand_male_primitive_stylized.L",
        "shoulder_R":  "GEO-shoulder_male_primitive_stylized.R",
        "upper_arm_R": "GEO-arm_upper_male_primitive_stylized.R",
        "forearm_R":   "GEO-arm_lower_male_primitive_stylized.R",
        "hand_R":      "GEO-hand_male_primitive_stylized.R",
        "pelvis":      "GEO-pelvis_male_primitive_stylized",
        "thigh_L":     "GEO-leg_upper_male_primitive_stylized.L",
        "shin_L":      "GEO-leg_lower_male_primitive_stylized.L",
        "foot_L":      "GEO-foot_male_primitive_stylized.L",
        "thigh_R":     "GEO-leg_upper_male_primitive_stylized.R",
        "shin_R":      "GEO-leg_lower_male_primitive_stylized.R",
        "foot_R":      "GEO-foot_male_primitive_stylized.R",
    },
}

# Sub-meshes rigidly attached to a bone (fingers, toes, breasts, face parts).
EXTRA_NODES = {
    "female": {
        "chest": [
            "GEO-breast_female_primitive_stylized.L",
            "GEO-breast_female_primitive_stylized.R",
        ],
        "head": [
            "GEO-ear_female_primitive_stylized.L",
            "GEO-ear_female_primitive_stylized.R",
            "GEO-eye_female_primitive_stylized.L",
            "GEO-eye_female_primitive_stylized.R",
            "GEO-eyelid_upper_female_primitive_stylized.L",
            "GEO-eyelid_upper_female_primitive_stylized.R",
            "GEO-eyelid_lower_female_primitive_stylized.L",
            "GEO-eyelid_lower_female_primitive_stylized.R",
            "GEO-nose_female_primitive_stylized",
            "GEO-nose_bridge_female_primitive_stylized",
        ],
        "hand_L": [
            "GEO-thumb_female_primitive_stylized.L",
            "GEO-finger_index_female_primitive_stylized.L",
            "GEO-finger_middle_female_primitive_stylized.L",
            "GEO-finger_ring_female_primitive_stylized.L",
            "GEO-finger_pinky_female_primitive_stylized.L",
        ],
        "hand_R": [
            "GEO-thumb_female_primitive_stylized.R",
            "GEO-finger_index_female_primitive_stylized.R",
            "GEO-finger_middle_female_primitive_stylized.R",
            "GEO-finger_ring_female_primitive_stylized.R",
            "GEO-finger_pinky_female_primitive_stylized.R",
        ],
        "foot_L": [
            "GEO-toe_big_female_primitive_stylized.L",
            "GEO-toe_index_female_primitive_stylized.L",
            "GEO-toe_middle_female_primitive_stylized.L",
            "GEO-toe_ring_female_primitive_stylized.L",
            "GEO-toe_pinky_female_primitive_stylized.L",
        ],
        "foot_R": [
            "GEO-toe_big_female_primitive_stylized.R",
            "GEO-toe_index_female_primitive_stylized.R",
            "GEO-toe_middle_female_primitive_stylized.R",
            "GEO-toe_ring_female_primitive_stylized.R",
            "GEO-toe_pinky_female_primitive_stylized.R",
        ],
    },
    "male": {
        "head": [
            "GEO-ear_male_primitive_stylized.L",
            "GEO-ear_male_primitive_stylized.R",
            "GEO-eye_male_primitive_stylized.L",
            "GEO-eye_male_primitive_stylized.R",
            "GEO-nose_male_primitive_stylized",
            "GEO-nose_bridge_male_primitive_stylized",
        ],
        "hand_L": [
            "GEO-thumb_male_primitive_stylized.L",
            "GEO-finger_index_male_primitive_stylized.L",
            "GEO-finger_middle_male_primitive_stylized.L",
            "GEO-finger_ring_male_primitive_stylized.L",
            "GEO-finger_pinky_male_primitive_stylized.L",
        ],
        "hand_R": [
            "GEO-thumb_male_primitive_stylized.R",
            "GEO-finger_index_male_primitive_stylized.R",
            "GEO-finger_middle_male_primitive_stylized.R",
            "GEO-finger_ring_male_primitive_stylized.R",
            "GEO-finger_pinky_male_primitive_stylized.R",
        ],
        "foot_L": [
            "GEO-toe_big_male_primitive_stylized.L",
            "GEO-toe_index_male_primitive_stylized.L",
            "GEO-toe_middle_male_primitive_stylized.L",
            "GEO-toe_ring_male_primitive_stylized.L",
            "GEO-toe_pinky_male_primitive_stylized.L",
        ],
        "foot_R": [
            "GEO-toe_big_male_primitive_stylized.R",
            "GEO-toe_index_male_primitive_stylized.R",
            "GEO-toe_middle_male_primitive_stylized.R",
            "GEO-toe_ring_male_primitive_stylized.R",
            "GEO-toe_pinky_male_primitive_stylized.R",
        ],
    },
}

# Coordinate-change matrix: GLB X-axis is flipped relative to FK/Three.js X-axis.
# To apply a FK-space rotation in GLB space: R_glb = _C @ R_fk @ _C
_C = np.diag([-1.0, 1.0, 1.0])


# ── Helpers ────────────────────────────────────────────────────────────────────

def _glb_path(gender: str) -> str:
    name = "female.glb" if gender != "M" else "male.glb"
    return os.path.join(_ASSETS_DIR, name)


def _gender_key(gender: str) -> str:
    return "female" if gender != "M" else "male"


def _quat_to_matrix(q) -> np.ndarray:
    """[x,y,z,w] quaternion → 3×3 rotation matrix."""
    x, y, z, w = float(q[0]), float(q[1]), float(q[2]), float(q[3])
    return np.array([
        [1 - 2*(y*y + z*z),     2*(x*y - z*w),     2*(x*z + y*w)],
        [    2*(x*y + z*w), 1 - 2*(x*x + z*z),     2*(y*z - x*w)],
        [    2*(x*z - y*w),     2*(y*z + x*w), 1 - 2*(x*x + y*y)],
    ], dtype=np.float64)


def _fk_quat_to_glb_R(quat) -> np.ndarray:
    """
    Convert a FK-space world quaternion to a GLB-space rotation matrix.
    GLB has X-axis flipped vs FK: R_glb = C @ R_fk @ C (C = diag(-1,1,1)).
    """
    R_fk = _quat_to_matrix(quat)
    return _C @ R_fk @ _C


def _decompose_RS(M3: np.ndarray):
    """Decompose 3×3 = R×S into (rotation_3×3, scale_3vec). Preserves sign of determinant."""
    sx = np.linalg.norm(M3[:, 0])
    sy = np.linalg.norm(M3[:, 1])
    sz = np.linalg.norm(M3[:, 2])
    eps = 1e-9
    R = M3 / np.maximum([sx, sy, sz], eps)
    # Preserve mirror flip: if det<0, negate one scale component so R has det=+1
    if np.linalg.det(R) < 0:
        sx = -sx
        R[:, 0] = -R[:, 0]
    return R, np.array([sx, sy, sz])


def _get_geom(scene, node_name):
    """Return (T_world_4x4, trimesh.Trimesh) for a named node, or None."""
    if node_name not in scene.graph.nodes:
        return None
    T, geo_name = scene.graph[node_name]
    if geo_name is None or geo_name not in scene.geometry:
        return None
    return T, scene.geometry[geo_name]


# ── Posed rendering core ──────────────────────────────────────────────────────

def _build_posed_segments(scene, gender: str, bone_transforms: dict):
    """
    Compute (trimesh.Trimesh, T_world_4x4) for every segment in posed configuration.

    Strategy — FK traversal in GLB world space:
      1. Use GLB node world positions as T-pose joint pivots.
      2. For each bone, new_pos = parent_new_pos + R_parent_glb @ local_rest_offset
         where R_parent_glb = C @ R_fk_parent_world @ C  (FK rotation in GLB coords)
      3. Segment orientation = R_fk_glb @ R_rest_glb (posed rotation × rest rotation)
      4. In T-pose (all FK quaternions = identity): new_pos = rest_pos,
         orientation = I @ R_rest_glb → reproduces GLB rest pose exactly. ✓
    """
    key      = _gender_key(gender)
    mesh_map = MESH_MAP.get(key, {})
    extra_map = EXTRA_NODES.get(key, {})

    # ── Collect rest-pose data ────────────────────────────────────────────────
    rest_pos: dict[str, np.ndarray] = {}   # bone → world position (GLB space)
    rest_R:   dict[str, np.ndarray] = {}   # bone → rotation matrix (GLB space)
    rest_S:   dict[str, np.ndarray] = {}   # bone → scale vector

    for bone_name, node_name in mesh_map.items():
        if node_name is None:
            continue
        result = _get_geom(scene, node_name)
        if result is None:
            continue
        T, _ = result
        rest_pos[bone_name] = T[:3, 3].copy()
        R, S = _decompose_RS(T[:3, :3])
        rest_R[bone_name] = R
        rest_S[bone_name] = S

    # 'torso' has no GLB mesh — use pelvis position as root reference
    if "pelvis" in rest_pos:
        rest_pos["torso"] = rest_pos["pelvis"].copy()

    # ── FK traversal in GLB space ─────────────────────────────────────────────
    new_pos: dict[str, np.ndarray] = {}

    def _traverse(bone_name: str, parent_new_pos: np.ndarray, parent_R_glb: np.ndarray):
        bt = bone_transforms.get(bone_name)
        if bt is None:
            bone_R_glb = np.eye(3)
            bn_new_pos = rest_pos.get(bone_name, parent_new_pos)
        else:
            # FK world rotation → GLB-space rotation matrix
            bone_R_glb = _fk_quat_to_glb_R(bt["quat"])

            if bone_name == "torso":
                # Root stays at rest position
                bn_new_pos = rest_pos.get("torso", np.zeros(3))
            else:
                parent_bone = _BONE_PARENT.get(bone_name, "torso")
                r_bone   = rest_pos.get(bone_name)
                r_parent = rest_pos.get(parent_bone)

                if r_bone is not None and r_parent is not None:
                    # GLB rest offset between joints.  The GLB segment geometry is built
                    # along this offset, so rotating it by parent_R_glb keeps the
                    # kinematic chain connected (child joint lands at parent mesh tip).
                    local_offset = r_bone - r_parent
                    bn_new_pos = parent_new_pos + parent_R_glb @ local_offset
                else:
                    bn_new_pos = rest_pos.get(bone_name, parent_new_pos)

        new_pos[bone_name] = bn_new_pos
        for child in _BONE_CHILDREN.get(bone_name, []):
            _traverse(child, bn_new_pos, bone_R_glb)

    torso_rest = rest_pos.get("torso", np.zeros(3))
    _traverse("torso", torso_rest, np.eye(3))

    # ── Build world transforms for pyrender ───────────────────────────────────
    results = []

    for bone_name, node_name in mesh_map.items():
        if node_name is None:
            continue
        bt = bone_transforms.get(bone_name)
        if bt is None:
            continue
        result = _get_geom(scene, node_name)
        if result is None:
            continue
        T_glb, geom = result

        bone_R_glb = _fk_quat_to_glb_R(bt["quat"])
        R_rest = rest_R.get(bone_name, np.eye(3))
        S_rest = rest_S.get(bone_name, np.ones(3))

        T_new = np.eye(4, dtype=np.float64)
        T_new[:3, :3] = (bone_R_glb @ R_rest) * S_rest
        T_new[:3,  3] = new_pos.get(bone_name, T_glb[:3, 3])

        results.append((geom, T_new))

        # Extras: rigidly attached sub-meshes (move with parent bone)
        bone_new_pos = T_new[:3, 3]
        for extra_name in extra_map.get(bone_name, []):
            er = _get_geom(scene, extra_name)
            if er is None:
                continue
            T_extra_glb, extra_geom = er

            extra_R_rest, extra_S_rest = _decompose_RS(T_extra_glb[:3, :3])
            rel_offset = T_extra_glb[:3, 3] - T_glb[:3, 3]   # GLB-space offset

            T_extra = np.eye(4, dtype=np.float64)
            T_extra[:3, :3] = (bone_R_glb @ extra_R_rest) * extra_S_rest
            T_extra[:3,  3] = bone_new_pos + bone_R_glb @ rel_offset

            results.append((extra_geom, T_extra))

    return results, new_pos


# ── Camera ────────────────────────────────────────────────────────────────────

def _build_camera_pose(centroid, size, azimuth_deg=0, elevation_deg=5):
    """4×4 camera-pose matrix orbiting the centroid (matches headless_render.js).

    GLB has X-axis flipped vs FK/Three.js (upper_arm_L at +X in GLB, -X in FK).
    The bone rotation conversion R_glb = C @ R_fk @ C is correct when the camera
    looks from the -Z side in GLB space, so we negate cx and cz to mirror the
    azimuth, keeping depth/canny aligned with the pose/openpose images.
    """
    az  = math.radians(azimuth_deg)
    el  = math.radians(elevation_deg)
    d   = size * 1.4
    cx  = centroid[0] + d * math.sin(az) * math.cos(el)
    cy  = centroid[1] + d * math.sin(el)
    cz  = centroid[2] + d * math.cos(az) * math.cos(el)

    fwd   = np.array([centroid[0]-cx, centroid[1]-cy, centroid[2]-cz])
    fwd  /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0.0, 1.0, 0.0])
    right /= np.linalg.norm(right)
    up    = np.cross(right, fwd)

    pose = np.eye(4)
    pose[:3, 0] = right
    pose[:3, 1] = up
    pose[:3, 2] = -fwd
    pose[:3, 3] = [cx, cy, cz]
    return pose


# ── T-pose helper (combined mesh, original behaviour) ────────────────────────

def _load_combined_mesh(gender: str):
    """Load GLB and return a single combined trimesh.Trimesh (rest T-pose)."""
    glb_path = _glb_path(gender)
    if not os.path.isfile(glb_path):
        return None
    scene = trimesh.load(glb_path, force="scene")
    try:
        combined = scene.to_geometry()
    except AttributeError:
        combined = scene.dump(concatenate=True)
    return combined


# ── Canny (Sobel edge detection) ──────────────────────────────────────────────

def _sobel_canny(depth_uint8: np.ndarray) -> np.ndarray:
    src = depth_uint8.astype(np.float32)
    gx = (-src[:-2, :-2] + src[:-2, 2:]
          - 2*src[1:-1, :-2] + 2*src[1:-1, 2:]
          - src[2:,  :-2] + src[2:,  2:])
    gy = (-src[:-2, :-2] - 2*src[:-2, 1:-1] - src[:-2, 2:]
          + src[2:,  :-2] + 2*src[2:,  1:-1] + src[2:,  2:])
    mag = np.sqrt(gx*gx + gy*gy)
    out = np.zeros_like(depth_uint8)
    out[1:-1, 1:-1] = (mag > 30).astype(np.uint8) * 255
    return out


# ── OpenPose from GLB joints ──────────────────────────────────────────────────
# Single source of truth: the openpose skeleton is drawn from the SAME posed GLB
# joint positions as the depth mesh, projected with the SAME camera.  This makes
# the skeleton overlay the mesh exactly — no second (FK) generator, no drift.

_OPENPOSE_COLORS = {
    "head": (255, 0, 0),    "neck": (255, 85, 0),   "chest": (255, 170, 0),
    "shoulder_R": (255, 255, 0), "shoulder_L": (170, 255, 0),
    "upper_arm_R": (85, 255, 0), "upper_arm_L": (0, 255, 85),
    "forearm_R": (0, 255, 170),  "forearm_L": (0, 255, 255),
    "hand_R": (0, 170, 255),     "hand_L": (0, 85, 255),
    "pelvis": (170, 0, 255),
    "thigh_R": (255, 0, 170),    "thigh_L": (170, 0, 170),
    "shin_R": (0, 0, 255),       "shin_L": (85, 0, 255),
    "foot_R": (170, 170, 255),   "foot_L": (255, 85, 255),
    "spine": (136, 136, 136),
}

_SKELETON_LIMBS = [
    # head / spine
    ("neck",        "head",       (255,   0,   0)),
    # right arm  (shoulder → upper_arm → forearm → hand)
    ("neck",        "shoulder_R", (255, 170,   0)),
    ("shoulder_R",  "upper_arm_R",(255, 213,   0)),
    ("upper_arm_R", "forearm_R",  (255, 255,   0)),
    ("forearm_R",   "hand_R",     (170, 255,   0)),
    # left arm
    ("neck",        "shoulder_L", ( 85, 255,   0)),
    ("shoulder_L",  "upper_arm_L",(  0, 255,  43)),
    ("upper_arm_L", "forearm_L",  (  0, 255,  85)),
    ("forearm_L",   "hand_L",     (  0, 255, 170)),
    # right leg (pelvis → thigh → shin → foot)
    ("pelvis",      "thigh_R",    (  0, 255, 170)),
    ("thigh_R",     "shin_R",     (  0, 255, 255)),
    ("shin_R",      "foot_R",     (  0, 170, 255)),
    # left leg
    ("pelvis",      "thigh_L",    (  0,  85, 255)),
    ("thigh_L",     "shin_L",     (  0,   0, 255)),
    ("shin_L",      "foot_L",     ( 85,   0, 255)),
    # torso spine
    ("neck",        "pelvis",     (136, 136, 136)),
]


def _project_joints(joints, cam_pose, yfov, aspect, width, height):
    """
    Project 3D world joint positions to 2D pixel coords using the same pinhole
    camera as the depth render (pyrender PerspectiveCamera, looks down -Z).

    Returns {bone: (px, py, view_z)}; view_z < 0 means in front of the camera.
    """
    world_to_cam = np.linalg.inv(cam_pose)
    t = math.tan(yfov / 2.0)
    out = {}
    for name, pos in joints.items():
        p = world_to_cam @ np.array([pos[0], pos[1], pos[2], 1.0])
        vz = p[2]
        if vz >= -1e-6:           # behind / on camera plane → skip
            continue
        ndc_x = (p[0] / (-vz)) / (aspect * t)
        ndc_y = (p[1] / (-vz)) / t
        px = (ndc_x * 0.5 + 0.5) * width
        py = (1.0 - (ndc_y * 0.5 + 0.5)) * height
        out[name] = (px, py, vz)
    return out


def _render_openpose_from_joints(joints2d, width, height):
    """Draw the OpenPose-18 skeleton (grey bg, small colour dots + skeleton lines).

    Dot radius: ~4-6 px (ControlNet-style, not the big reference blobs from the
    headless editor which used r = (W/14) * frac * 18 → 100-150 px at 1024 px).
    """
    from PIL import Image, ImageDraw

    img  = Image.new("RGB", (width, height), (74, 74, 74))
    draw = ImageDraw.Draw(img, "RGBA")

    # Small fixed dot radius — independent of joint type (standard ControlNet size)
    r = max(3, round(width / 160))

    # Joint dots
    for name, (px, py, _vz) in joints2d.items():
        col = _OPENPOSE_COLORS.get(name)
        if col is None:
            continue
        draw.ellipse([px - r, py - r, px + r, py + r], fill=col)

    # Skeleton lines (thin, alpha 0.7)
    line_w = max(1, round(width / 256))
    for a, b, col in _SKELETON_LIMBS:
        pa = joints2d.get(a)
        pb = joints2d.get(b)
        if pa is None or pb is None:
            continue
        draw.line([pa[0], pa[1], pb[0], pb[1]], fill=(col[0], col[1], col[2], 179), width=line_w)

    arr = np.asarray(img).astype(np.float32) / 255.0
    return arr


# ── Main API ──────────────────────────────────────────────────────────────────

def render_glb_depth(scene_json: str, width: int, height: int, bone_transforms=None):
    """
    Render depth and canny maps from the GLB mesh.

    Parameters
    ----------
    scene_json : str
        Scene JSON (editor export format).
    width, height : int
        Output dimensions.
    bone_transforms : dict | None
        {bone_name: {pos, quat}} world transforms from headless_render.js.
        When provided, character is posed.  None → T-pose (combined mesh).

    Returns
    -------
    (depth_arr, canny_arr, openpose_arr) : each H×W×3 float32 [0,1], or None.
        openpose_arr is generated from the SAME posed GLB joints as the depth
        mesh (projected with the same camera), so it overlays the mesh exactly.
        openpose_arr is None for the T-pose fallback (no posed joints available).
    """
    if not _PYRENDER_OK:
        return None

    os.environ.setdefault("PYOPENGL_PLATFORM", "egl")

    try:
        scene_data = json.loads(scene_json)
    except Exception:
        return None

    gender     = scene_data.get("gender", "F")
    camera_cfg = scene_data.get("camera", {})
    az         = camera_cfg.get("azimuth",   0)
    el         = camera_cfg.get("elevation", 5)
    aspect     = width / height

    pr_scene = pyrender.Scene(bg_color=[0, 0, 0, 0], ambient_light=[0.4, 0.4, 0.4])

    if bone_transforms:
        # ── Posed render ──────────────────────────────────────────────────────
        # Strategy: bake FK transforms into geometry copies then concatenate.
        # This avoids pyrender issues with negative-scale (mirrored) pose matrices.
        glb_path = _glb_path(gender)
        if not os.path.isfile(glb_path):
            return None
        scene = trimesh.load(glb_path, force="scene")
        segments, joints3d = _build_posed_segments(scene, gender, bone_transforms)

        if not segments:
            return None

        baked = []
        for geom, T in segments:
            g = geom.copy()
            g.apply_transform(T)
            baked.append(g)

        try:
            mesh = trimesh.util.concatenate(baked)
        except Exception:
            return None

        pr_scene.add(pyrender.Mesh.from_trimesh(mesh, smooth=True))
        centroid = mesh.centroid
        size     = float(np.linalg.norm(mesh.extents))

    else:
        # ── T-pose fallback (original combined-mesh behaviour) ────────────────
        mesh = _load_combined_mesh(gender)
        if mesh is None:
            return None
        pr_scene.add(pyrender.Mesh.from_trimesh(mesh, smooth=True))
        centroid = mesh.centroid
        size     = float(np.linalg.norm(mesh.extents))
        joints3d = None

    # ── Camera + light (shared by both paths) ─────────────────────────────────
    yfov     = math.radians(45)
    cam_pose = _build_camera_pose(centroid, size, az, el)
    camera   = pyrender.PerspectiveCamera(yfov=yfov, aspectRatio=aspect)
    pr_scene.add(camera, pose=cam_pose)
    pr_scene.add(pyrender.DirectionalLight(color=[1, 1, 1], intensity=3.0), pose=cam_pose)

    # ── Render ────────────────────────────────────────────────────────────────
    try:
        renderer = pyrender.OffscreenRenderer(width, height)
    except Exception as e:
        print(f"[AnimeMannequin] OffscreenRenderer init failed: {e}")
        return None
    try:
        _, depth = renderer.render(pr_scene)
    finally:
        renderer.delete()

    # ── Normalise depth → uint8, near=255, far=DEPTH_MIN ─────────────────────
    DEPTH_MIN = 30
    fg = depth > 0
    if not fg.any():
        return None

    mn, mx   = depth[fg].min(), depth[fg].max()
    depth_u8 = np.zeros((height, width), dtype=np.uint8)
    depth_u8[fg] = (
        255 - (depth[fg] - mn) / (mx - mn + 1e-6) * (255 - DEPTH_MIN)
    ).astype(np.uint8)

    canny_u8 = _sobel_canny(depth_u8)

    def to_rgb(arr):
        return np.stack([arr, arr, arr], axis=-1).astype(np.float32) / 255.0

    # OpenPose from the same posed GLB joints + same camera → overlays the mesh.
    openpose_arr = None
    if joints3d:
        joints2d = _project_joints(joints3d, cam_pose, yfov, aspect, width, height)
        if joints2d:
            openpose_arr = _render_openpose_from_joints(joints2d, width, height)

    return to_rgb(depth_u8), to_rgb(canny_u8), openpose_arr
