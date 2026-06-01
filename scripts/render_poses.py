#!/usr/bin/env python3
"""
render_poses.py  —  submit T-pose + random pose to AnimeMannequin via API
and display all 8 output images (pose/depth/canny/openpose × 2).

Usage:
    python3 scripts/render_poses.py [--gender F|M] [--seed 42]
"""

import argparse
import base64
import json
import math
import os
import random
import time
import urllib.request
import uuid
from pathlib import Path

SERVER = "http://192.168.50.199:8188"
W, H   = 1024, 1024

# ── Quaternion helpers ────────────────────────────────────────────────────────

def quat_from_axis_angle(ax, ay, az, angle_rad):
    """Unit quaternion from axis + angle.  axis need not be normalised."""
    n = math.sqrt(ax*ax + ay*ay + az*az)
    if n < 1e-9:
        return [0.0, 0.0, 0.0, 1.0]
    ax, ay, az = ax/n, ay/n, az/n
    s = math.sin(angle_rad / 2)
    return [ax*s, ay*s, az*s, math.cos(angle_rad / 2)]

def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return [
        aw*bx + ax*bw + ay*bz - az*by,
        aw*by - ax*bz + ay*bw + az*bx,
        aw*bz + ax*by - ay*bx + az*bw,
        aw*bw - ax*bx - ay*by - az*bz,
    ]

def identity():
    return [0.0, 0.0, 0.0, 1.0]

# ── Anatomical rotation limits (radians) for "safe" random pose ──────────────
# Each entry: (axis_x, axis_y, axis_z, min_angle, max_angle)
# Bones not listed stay at identity.

BONE_LIMITS = {
    # Torso / spine
    "torso":       [(0, 1, 0, -0.3,  0.3)],
    "spine":       [(1, 0, 0, -0.2,  0.2), (0, 1, 0, -0.2, 0.2)],
    "chest":       [(1, 0, 0, -0.2,  0.2)],

    # Head
    "neck":        [(1, 0, 0, -0.3,  0.3), (0, 1, 0, -0.4, 0.4)],
    "head":        [(1, 0, 0, -0.2,  0.2), (0, 1, 0, -0.3, 0.3)],

    # Left arm
    "shoulder_L":  [(0, 0, 1, -0.4,  0.4), (1, 0, 0, -0.3, 0.3)],
    "upper_arm_L": [(0, 0, 1, -1.4,  0.2), (0, 1, 0, -0.5, 0.5)],
    "forearm_L":   [(0, 0, 1, -1.8,  0.0)],
    "hand_L":      [(0, 0, 1, -0.4,  0.4), (1, 0, 0, -0.3, 0.3)],

    # Right arm
    "shoulder_R":  [(0, 0, 1, -0.4,  0.4), (1, 0, 0, -0.3, 0.3)],
    "upper_arm_R": [(0, 0, 1, -0.2,  1.4), (0, 1, 0, -0.5, 0.5)],
    "forearm_R":   [(0, 0, 1,  0.0,  1.8)],
    "hand_R":      [(0, 0, 1, -0.4,  0.4), (1, 0, 0, -0.3, 0.3)],

    # Left leg
    "thigh_L":     [(1, 0, 0, -0.8,  0.4), (0, 0, 1, -0.2, 0.5)],
    "shin_L":      [(1, 0, 0,  0.0,  1.4)],
    "foot_L":      [(1, 0, 0, -0.4,  0.2)],

    # Right leg
    "thigh_R":     [(1, 0, 0, -0.8,  0.4), (0, 0, 1, -0.5, 0.2)],
    "shin_R":      [(1, 0, 0,  0.0,  1.4)],
    "foot_R":      [(1, 0, 0, -0.4,  0.2)],
}

def make_tpose(gender="F"):
    bones = {name: {"rotation": identity()} for name in [
        "torso","spine","chest","neck","head",
        "shoulder_L","upper_arm_L","forearm_L","hand_L",
        "shoulder_R","upper_arm_R","forearm_R","hand_R",
        "pelvis","thigh_L","shin_L","foot_L","thigh_R","shin_R","foot_R",
    ]}
    return {
        "version": "1.0", "gender": gender, "bones": bones,
        "camera": {"azimuth": 0, "elevation": 5, "distance": 2.5},
        "proportions": {"head":1,"bust":1,"hips":1,"waist":1,"legs":1,"arms":1},
    }

def make_random_pose(gender="F", seed=None):
    rng = random.Random(seed)
    scene = make_tpose(gender)
    for bone, axes in BONE_LIMITS.items():
        q = identity()
        for (ax, ay, az, lo, hi) in axes:
            angle = rng.uniform(lo, hi)
            q = quat_mul(q, quat_from_axis_angle(ax, ay, az, angle))
        scene["bones"][bone]["rotation"] = q
    return scene

# ── ComfyUI helpers ───────────────────────────────────────────────────────────

def _post(path, body):
    data = json.dumps(body).encode()
    req  = urllib.request.Request(
        f"{SERVER}{path}", data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def _get(path):
    with urllib.request.urlopen(f"{SERVER}{path}", timeout=10) as r:
        return json.loads(r.read())

def submit_scene(scene_dict, label="pose"):
    scene_str = json.dumps(scene_dict)
    workflow = {
        "1": {"class_type": "AnimeMannequinNode",
              "inputs": {"width": W, "height": H,
                         "gender": scene_dict["gender"], "scene": scene_str}},
        "2": {"class_type": "SaveImage",
              "inputs": {"images": ["1", 0], "filename_prefix": f"{label}_pose"}},
        "3": {"class_type": "SaveImage",
              "inputs": {"images": ["1", 1], "filename_prefix": f"{label}_depth"}},
        "4": {"class_type": "SaveImage",
              "inputs": {"images": ["1", 2], "filename_prefix": f"{label}_canny"}},
        "5": {"class_type": "SaveImage",
              "inputs": {"images": ["1", 3], "filename_prefix": f"{label}_openpose"}},
    }
    resp = _post("/prompt", {"prompt": workflow, "client_id": str(uuid.uuid4())})
    return resp["prompt_id"]

def wait_for(pid, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        hist = _get(f"/history/{pid}")
        if pid in hist and hist[pid]["status"]["completed"]:
            return hist[pid]
        time.sleep(1)
    raise TimeoutError(f"Prompt {pid} did not finish in {timeout}s")

def download_outputs(entry, out_dir):
    paths = {}
    for nid, nout in entry.get("outputs", {}).items():
        for img in nout.get("images", []):
            fname  = img["filename"]
            prefix = fname.rsplit("_", 1)[0]   # e.g. "tpose_pose"
            url    = f"{SERVER}/view?filename={fname}&subfolder=&type={img.get('type','output')}"
            dest   = out_dir / fname
            urllib.request.urlretrieve(url, dest)
            paths[prefix] = dest
    return paths

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gender", default="F", choices=["F","M"])
    ap.add_argument("--seed",   default=42,  type=int)
    args = ap.parse_args()

    out_dir = Path("/tmp/mannequin_render")
    out_dir.mkdir(exist_ok=True)

    # Check queue
    q = _get("/queue")
    running = len(q.get("queue_running", []))
    pending = len(q.get("queue_pending", []))
    if running or pending:
        print(f"⚠  Queue busy: {running} running, {pending} pending — waiting...")

    print(f"🎭  Generating T-pose (gender={args.gender}, {W}×{H}) …")
    tpose   = make_tpose(args.gender)
    pid_t   = submit_scene(tpose, label="tpose")
    print(f"    submitted → {pid_t}")

    print(f"🎲  Generating random pose (seed={args.seed}) …")
    rpose   = make_random_pose(args.gender, seed=args.seed)
    pid_r   = submit_scene(rpose, label="random")
    print(f"    submitted → {pid_r}")

    print("⏳  Waiting for renders …")
    result_t = wait_for(pid_t)
    print(f"    T-pose   done — {result_t['status']['status_str']}")
    result_r = wait_for(pid_r)
    print(f"    Random   done — {result_r['status']['status_str']}")

    print(f"\n📥  Downloading to {out_dir} …")
    paths_t = download_outputs(result_t, out_dir)
    paths_r = download_outputs(result_r, out_dir)

    print("\n✅  Done!\n")
    print("T-pose outputs:")
    for k, p in sorted(paths_t.items()):
        print(f"  {k:30s}  {p.stat().st_size:,} bytes  →  {p}")

    print("\nRandom-pose outputs:")
    for k, p in sorted(paths_r.items()):
        print(f"  {k:30s}  {p.stat().st_size:,} bytes  →  {p}")

    # Open all images in Preview (macOS)
    all_files = sorted(paths_t.values()) + sorted(paths_r.values())
    os.system(f"open {' '.join(str(p) for p in all_files)}")

if __name__ == "__main__":
    main()
