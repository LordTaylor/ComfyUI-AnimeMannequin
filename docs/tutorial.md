# AnimeMannequin — Full Reference

## Contents

1. [Quick start](#quick-start)
2. [Toolbar reference](#toolbar-reference)
3. [Proportions panel](#proportions-panel)
4. [Bust config panel](#bust-config-panel)
5. [Pose library](#pose-library)
6. [Overlays panel](#overlays-panel)
7. [Custom GLB models](#custom-glb-models)
8. [Using via ComfyUI API](#using-via-comfyui-api)
9. [Bone naming reference](#bone-naming-reference)

---

## Quick start

1. Add the **Anime Mannequin** node to your workflow.
2. Set `width` and `height` (or wire them from upstream nodes).
3. Pick `gender`: `F` (female) or `M` (male).
4. Click **Open Mannequin Editor**.
5. Pose the model — click any joint and drag to rotate.
6. Click **Close & Save**.
7. Wire `pose`, `depth`, `canny`, or `openpose` outputs to ControlNet.

---

## Toolbar reference

| Button | Shortcut | Description |
|--------|----------|-------------|
| **F / M** | — | Toggle gender. Reloads model, resets custom GLB. |
| **Undo** | Ctrl+Z | Undo last bone rotation. |
| **Redo** | Ctrl+Shift+Z | Redo. |
| **Reset** | — | Reset all bones to T-pose. |
| **L→R** | — | Mirror left-side bones onto right side. |
| **R→L** | — | Mirror right-side bones onto left side. |
| **Poses** | — | Open saved pose library. |
| **Random** | — | Generate a random pose. |
| **🔒 / 🔓** | — | Safe mode (anatomically limited) / Wild mode (anything goes). |
| **Model** | — | Open proportions panel. |
| **OpenPose / Flat** | — | Toggle joint colour scheme. |
| **Bust⚙** | — | Open bust fine-tuning panel. |
| **Overlays** | — | Open overlays panel (reference image, crop frame). |
| **Model ⬆** | — | Load custom GLB humanoid. |
| **Close & Save** | — | Capture images and send them back to the ComfyUI node. |

---

## Proportions panel

Controls uniform scale multipliers applied to body regions.

| Slider | Affects |
|--------|---------|
| Head | Head sphere. |
| Bust | Chest mesh + bust geometry. |
| Waist | Spine + mid-torso. |
| Hips | Pelvis mesh. |
| Legs | Thighs, shins, feet. |
| Arms | Shoulders, upper arms, forearms, hands. |

Values are stored per-scene and restored when you reopen the editor.

---

## Bust config panel

Fine-grained control over bust positioning and rotation.  
Open with **Bust⚙** in the toolbar. Use **Copy as JS** to capture the current values as a code snippet.

All parameters are relative to the bust scale slider value (`s`).  
`growth = halfH * (s - 1)` where `halfH` is half the breast mesh height at `s = 1`.

### Local offset (bone-relative, scales with bust size)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `loc_x` | 0.10 | Lateral spread per unit of growth. |
| `loc_y` | 0.00 | Vertical spread per unit of growth. |
| `loc_z` | 0.55 | Forward push per unit of growth. |
| `loc_z_base` | 0.00 | Constant forward offset (independent of size). |

### Global offset (world-space, independent of bone orientation)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `glob_y_base` | 0.00 | Constant vertical separation (always active). |
| `glob_y` | 0.00 | Vertical separation per `(s−1)`. |
| `glob_z` | 0.20 | Downward sag per unit of growth. |

### Rotation (applied to each breast mesh)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `rot_x` | 0.050 | Forward tilt per `(s−1)`. |
| `rot_y` | −0.50 | Left/right splay per `(s−1)`. |
| `rot_z` | 0.750 | Lateral roll per `(s−1)`. |
| `grot_x` | 0.00 | Global X rotation per `(s−1)`. |
| `grot_y` | 0.00 | Global Y rotation per `(s−1)`. |
| `grot_z` | 0.00 | Global Z rotation per `(s−1)`. |

### Scale

| Parameter | Default | Description |
|-----------|---------|-------------|
| `scale_x` | 1.00 | X-axis scale multiplier (< 1 narrows each breast). |

---

## Pose library

Click **Poses** to open. Poses are saved to browser `localStorage`.

- **Save current** — stores the current bone rotations under a name you provide.
- Click any saved pose to apply it.
- **Delete** removes it from storage.

---

## Overlays panel

Click **Overlays** to open.

- **Load reference image** — picks a PNG/JPG from disk and shows it as a semi-transparent layer over the canvas (editor only, not included in exports).
- **Opacity** slider — controls reference image transparency.
- **Zoom** slider — scales the reference image.
- **Crop frame** — draws the output aspect ratio as a framing guide over the canvas.

---

## Custom GLB models

Click **Model ⬆** to load your own `.glb` file. The model must be a rigged humanoid.

### How auto-detection works

The loader scans every mesh node name in the GLB and tries to match it against the keyword lists below. Matched bones get the full skin mesh; unmatched bones fall back to the capsule skeleton. Open the browser console to see which bones were matched.

### Bone keyword table

The first keyword match wins (case-insensitive substring match against the GLB node name).

| AnimeMannequin bone | Accepted keywords |
|---------------------|-------------------|
| `torso` | *(virtual root — no mesh, always skipped)* |
| `head` | `head` |
| `neck` | `neck` |
| `spine` | `spine`, `belly`, `abdomen` |
| `chest` | `chest`, `trunk`, `upperbody`, `upper_body` |
| `pelvis` | `pelvis`, `hip` |
| `shoulder_L` | `shoulder_l`, `shoulder.l`, `l_shoulder`, `shoulderl` |
| `upper_arm_L` | `upper_arm_l`, `upperarm_l`, `arm_upper_l`, `l_upper_arm`, `l_arm` |
| `forearm_L` | `forearm_l`, `arm_lower_l`, `lowerarm_l`, `l_forearm` |
| `hand_L` | `hand_l`, `hand.l`, `l_hand` |
| `shoulder_R` | `shoulder_r`, `shoulder.r`, `r_shoulder`, `shoulderr` |
| `upper_arm_R` | `upper_arm_r`, `upperarm_r`, `arm_upper_r`, `r_upper_arm`, `r_arm` |
| `forearm_R` | `forearm_r`, `arm_lower_r`, `lowerarm_r`, `r_forearm` |
| `hand_R` | `hand_r`, `hand.r`, `r_hand` |
| `thigh_L` | `thigh_l`, `leg_upper_l`, `upperleg_l`, `thigh.l`, `l_thigh` |
| `shin_L` | `shin_l`, `leg_lower_l`, `lowerleg_l`, `calf_l`, `l_shin` |
| `foot_L` | `foot_l`, `foot.l`, `l_foot` |
| `thigh_R` | `thigh_r`, `leg_upper_r`, `upperleg_r`, `thigh.r`, `r_thigh` |
| `shin_R` | `shin_r`, `leg_lower_r`, `lowerleg_r`, `calf_r`, `r_shin` |
| `foot_R` | `foot_r`, `foot.r`, `r_foot` |

### Tips for compatible models

- Bone naming is the only hard requirement — skin weights, topology, and UV maps are all ignored.
- If your model uses a different convention, rename the mesh nodes in Blender before exporting.
- The model is scaled automatically to match the built-in character height.
- Custom models are only loaded for the current session; switching gender resets to the built-in model.

---

## Using via ComfyUI API

AnimeMannequin supports workflows submitted via the ComfyUI HTTP API (`POST /prompt`).

### Minimal workflow (no images yet)

```json
{
  "1": {
    "class_type": "AnimeMannequinNode",
    "inputs": {
      "width": 768,
      "height": 1024,
      "gender": "F"
    }
  }
}
```

Without pre-uploaded image files all four outputs are black — this is the expected behaviour when no editor session has run yet.

### Full workflow (with saved images)

After using the editor and clicking **Close & Save**, four files are uploaded to the ComfyUI input directory:

| Widget | File |
|--------|------|
| `pose_file` | `mannequin_pose.png` |
| `depth_file` | `mannequin_depth.png` |
| `canny_file` | `mannequin_canny.png` |
| `openpose_file` | `mannequin_openpose.png` |

You can re-use them by passing the filenames in subsequent API calls:

```json
{
  "1": {
    "class_type": "AnimeMannequinNode",
    "inputs": {
      "width": 768,
      "height": 1024,
      "gender": "F",
      "pose_file":     "mannequin_pose.png",
      "depth_file":    "mannequin_depth.png",
      "canny_file":    "mannequin_canny.png",
      "openpose_file": "mannequin_openpose.png"
    }
  }
}
```

> **Note:** Server-side rendering from scene JSON is not yet implemented. For automated pipelines, generate the images once via the editor, then reuse the uploaded PNGs in your API workflow.

---

## Bone naming reference

The full skeleton used internally:

```
torso
├── spine
│   └── chest
│       ├── neck
│       │   └── head
│       ├── shoulder_L → upper_arm_L → forearm_L → hand_L
│       └── shoulder_R → upper_arm_R → forearm_R → hand_R
└── pelvis
    ├── thigh_L → shin_L → foot_L
    └── thigh_R → shin_R → foot_R
```

These are the names used in scene JSON (`bones` object), pose library exports, and the `GetSceneData` / `SetSceneData` bridge messages.
