# Anime Mannequin Studio — Design Spec

**Date:** 2026-05-31
**Status:** Approved — updated after dual-agent review
**Repo:** New — `ComfyUI-AnimeMannequin` (standalone repo, deployed as ComfyUI custom node)

---

## Problem

Existing pose tools for anime/toon image generation have a fundamental gap:

- **OpenPoseEditor** (ZhUyU1997): stick skeleton only — depth map is nearly flat, no body volume
- **VNCCS Pose Studio**: full MakeHuman mesh — too realistic, wrong proportions for anime ControlNet, complex to use

Neither produces high-quality depth maps with anime-correct proportions. A segmented 3D mannequin (like Design Doll) fills this gap: each body segment has real volume, so depth maps carry genuine 3D information. The mannequin uses anime proportions so the ControlNet signal matches the target style.

---

## Goals

1. **Segmented anime mannequin** in Three.js — simple capsule/cylinder geometry per segment, proper joint spheres
2. **Two presets**: Female (larger head, narrow waist, wide hips, long legs) and Male (wide shoulders, narrower hips)
3. **Outputs**: Phase 1: POSE (toon-shaded) + DEPTH (MeshDepthMaterial, normalized). Phase 2: + CANNY (OpenCV edge detection)
4. **Dual mode**: runs as ComfyUI node (iframe modal) AND as standalone web app (no ComfyUI required)
5. **Node preview**: thumbnail of current pose shown directly on the ComfyUI node widget
6. **Pose persistence**: scene saved to `node.properties`, restored on reopen (same pattern as OpenPoseEditor fix)
7. **Testable**: pure logic modules testable in isolation without DOM, WebGL, or ComfyUI

---

## Non-Goals (Phase 1)

- IK (Inverse Kinematics) — Phase 2
- Canny output — Phase 2 (Phase 1: pose + depth only)
- Pose library / random pose — Phase 2
- Mirror pose (L↔R) — Phase 2
- Hand/finger detail — Phase 2

---

## Architecture

### Repo layout

```
ComfyUI-AnimeMannequin/
├── static/                        ← standalone Three.js web app
│   ├── index.html                 ← entry point, works without ComfyUI
│   ├── lib/                       ← vendored: three.module.js, OrbitControls.js, TransformControls.js
│   └── src/
│       ├── mannequin-model.js     ← pure logic: bone defs, proportions, serialization (NO Three.js)
│       ├── mannequin-renderer.js  ← Three.js scene, meshes, depth render
│       ├── mannequin-editor.js    ← UI: controls, gizmo, camera, toolbar
│       └── comfyui-bridge.js      ← postMessage API (ComfyUI ↔ editor)
├── web/
│   └── js/
│       └── mannequin_node.js      ← ComfyUI extension: node def, modal, upload, node preview
├── tests/
│   ├── js/
│   │   └── mannequin-model.test.js  ← Vitest unit tests (no DOM/WebGL required)
│   └── python/
│       └── test_image_processing.py ← pytest: depth norm, canny (no ComfyUI required)
├── nodes.py                       ← ComfyUI Python node (thin wrapper)
├── image_processing.py            ← pure functions: depth normalization, canny via OpenCV
└── __init__.py                    ← route: /mannequin_editor/{filename:.*}
```

### Module responsibilities & decoupling

```
mannequin-model.js          (no deps — pure JS functions)
    ↑
geometry-adapter.js         (geometry source — swap here only)
    ↑
mannequin-renderer.js       (depends on: Three.js + mannequin-model + geometry-adapter)
    ↑
mannequin-editor.js         (depends on: renderer + TransformControls + OrbitControls)
    ↑
comfyui-bridge.js           (depends on: editor, wires postMessage API)
    ↑
index.html                  (composes all, detects mode: standalone vs comfyui)
```

The key invariant: **`mannequin-model.js` has zero Three.js imports**. All bone definitions, proportions, scene data structure, and serialization live here and are fully testable in Node.js with Vitest.

### Geometry adapter — capsule → mesh swap path

`geometry-adapter.js` is the **single point of change** when swapping geometry source. It exposes one function:

```js
// geometry-adapter-capsule.js  (Phase 1 — procedural)
export function buildSegments(boneTree, proportions) {
    // returns Map<boneName, THREE.Mesh> built from CapsuleGeometry
}

// geometry-adapter-gltf.js  (Phase 2 — Blender asset)
export function buildSegments(boneTree, proportions) {
    // loads female.glb / male.glb, returns Map<boneName, THREE.Mesh>
    // same interface — renderer doesn't change
}
```

`mannequin-renderer.js` only ever calls `buildSegments()` — it never knows if geometry came from code or a file. Swap = replace one import line in `index.html`.

**GLB naming convention** (Blender export): mesh objects named exactly as bone names (`torso`, `upper_arm_L`, etc.) so the adapter maps them 1:1 without configuration.

---

## Mannequin Model

### Bone hierarchy

```
root (Object3D, no mesh)
└── torso              ← center of mass, main rotation
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

Each bone is a Three.js `Object3D`. Its visual segment is a `CapsuleGeometry` child mesh, sized to span from the bone's origin to its child's local position. Joint intersections use `SphereGeometry`.

### Proportion presets (relative to total height = 1.0)

| Segment       | Female            | Male              |
|---------------|-------------------|-------------------|
| Head radius   | 0.115             | 0.100             |
| Neck length   | 0.055             | 0.055             |
| Chest height  | 0.175 (narrow)    | 0.185 (wide)      |
| Waist width   | 0.090             | 0.115             |
| Hip width     | 0.155             | 0.130             |
| Upper arm     | 0.155             | 0.165             |
| Forearm       | 0.130             | 0.140             |
| Thigh         | 0.230             | 0.220             |
| Shin          | 0.210             | 0.210             |
| Shoulder span | 0.270             | 0.340             |

These are defined as plain JS objects in `mannequin-model.js` — no Three.js, fully testable.

### Scene data format (JSON, stored in `node.properties.mannequin_scene`)

Rotations stored as **quaternions** (not Euler) — unambiguous, no gimbal lock, no axis-order drift.

```json
{
  "version": "1.0",
  "gender": "F",
  "bones": {
    "torso":       { "rotation": [0, 0, 0, 1] },
    "spine":       { "rotation": [0, 0, 0] },
    "chest":       { "rotation": [0, 0, 0] },
    "neck":        { "rotation": [0, 0, 0] },
    "head":        { "rotation": [0.04, 0, 0, 0.999] },
    "shoulder_L":  { "rotation": [0, 0, -0.087, 0.996] },
    "upper_arm_L": { "rotation": [0, 0, -0.383, 0.924] },
    "forearm_L":   { "rotation": [0, 0, -0.174, 0.985] },
    "hand_L":      { "rotation": [0, 0, 0, 1] },
    "shoulder_R":  { "rotation": [0, 0, 0.087, 0.996] },
    "upper_arm_R": { "rotation": [0, 0, 0.383, 0.924] },
    "forearm_R":   { "rotation": [0, 0, 0.174, 0.985] },
    "hand_R":      { "rotation": [0, 0, 0, 1] },
    "pelvis":      { "rotation": [0, 0, 0, 1] },
    "thigh_L":     { "rotation": [0, 0, 0.044, 0.999] },
    "shin_L":      { "rotation": [0, 0, 0, 1] },
    "foot_L":      { "rotation": [0, 0, 0, 1] },
    "thigh_R":     { "rotation": [0, 0, -0.044, 0.999] },
    "shin_R":      { "rotation": [0, 0, 0, 1] },
    "foot_R":      { "rotation": [0, 0, 0, 1] }
  },
  "camera": { "azimuth": 0, "elevation": 5, "distance": 2.5 }
}
```

---

## Rendering

### Three outputs from `MakeImages`

All rendered at the `OutputWidth × OutputHeight` resolution specified from the ComfyUI node.

| Output | Technique | Notes |
|--------|-----------|-------|
| POSE   | `MeshToonMaterial` + back-face scaled outline (Three.js native, no post-processing) | Clean anime-look, no shadows |
| DEPTH  | `MeshDepthMaterial` on separate WebGLRenderTarget, auto-fit near/far | near=white, far=black |
| CANNY  | Python `cv2.Canny()` applied to POSE image | Phase 2 only |

### Depth normalization

Near/far clipping planes **auto-fit to the mannequin's bounding box** before every depth render — not to the orbit camera's global frustum. Guarantees full 0–255 range regardless of camera distance or orbit position.

```js
function fitDepthCamera(camera, mannequinRoot) {
    const bbox = new THREE.Box3().setFromObject(mannequinRoot);
    const center = bbox.getCenter(new THREE.Vector3());
    const size   = bbox.getSize(new THREE.Vector3()).length();
    const dist   = camera.position.distanceTo(center);
    camera.near  = Math.max(0.01, dist - size * 0.6);
    camera.far   = dist + size * 0.6;
    camera.updateProjectionMatrix();
}
```

Called immediately before the depth render pass, camera restored after.

### Standalone vs ComfyUI mode detection

Mode is **explicit via URL param only** — no fragile `window.parent` heuristic.

```js
// index.html
const mode = new URLSearchParams(location.search).get('mode') ?? 'standalone';
// ComfyUI iframe src: EDITOR_URL + '?mode=comfyui'
```

- `comfyui`: shows "Close & Save" button, registers postMessage API via `comfyui-bridge.js`
- `standalone`: shows "Save pose.png" + "Save depth.png" buttons, "Copy Scene JSON"

(ZIP deferred to Phase 2 — avoids JSZip dependency in Phase 1.)

---

## postMessage API

Every message carries a `requestId` — the reply echoes it back. This prevents response mismatches when multiple calls are in flight.

### Message envelope

```js
// Request (parent → iframe)
{ cmd: "mannequin", requestId: "uuid-v4", method: "MakeImages", type: "call", payload: [] }

// Response (iframe → parent)
{ cmd: "mannequin", requestId: "uuid-v4", method: "MakeImages", type: "return", payload: {pose, depth} }

// Error response
{ cmd: "mannequin", requestId: "uuid-v4", method: "MakeImages", type: "error", error: "message" }
```

`mannequin_node.js` wraps every outbound call in a `Promise` that resolves on matching `requestId` reply with a configurable timeout (default 20s for `MakeImages`, 5s for others).

### Methods

| Method          | Payload            | Returns                        |
|-----------------|--------------------|--------------------------------|
| `GetWidth`      | —                  | `number` (readiness check)     |
| `OutputWidth`   | `[w: number]`      | `true`                         |
| `OutputHeight`  | `[h: number]`      | `true`                         |
| `GetSceneData`  | —                  | scene JSON object              |
| `SetSceneData`  | `[scene: object]`  | `true`                         |
| `SetGender`     | `["F"│"M"]`        | `true`                         |
| `MakeImages`    | —                  | `{ pose, depth }` as dataURLs  |

Scene restore on open: `iframe.src = EDITOR_URL + '?mode=comfyui&scene=' + encodeURIComponent(JSON.stringify(scene))` — editor reads `scene` param on init and calls `SetSceneData` internally.

---

## Editor Interaction Model

### Bone selection & rotation
- Click on a **joint sphere** → selects the bone; TransformControls gizmo appears in **rotation mode, local space**
- Selected bone highlighted (emissive color change on sphere)
- Gizmo uses arc handles (not XYZ rings) — easier to drive for rotation-only workflow
- OrbitControls disabled while dragging gizmo (re-enabled on `dragend`)
- Clicking empty space deselects
- For occluded bones: orbit camera, click bone, orbit back — no special occlusion handling in Phase 1

### Undo / Reset (Phase 1 requirement)
- **Ctrl+Z**: undo last bone rotation — ring buffer, 20 steps max, stored as scene JSON snapshots
- **Reset Pose button** in toolbar: restores T-pose (all quaternions → identity), clears undo stack
- Undo state captured after every `TransformControls` `change` event ends (on mouseup, not per-frame)

### Gender switch behavior
- Switching F↔M: **preserves bone rotations, swaps proportions** (segment lengths/widths change)
- Visual result may look different due to different proportions — this is expected and documented in UI tooltip
- No warning dialog in Phase 1

### Default camera
- Azimuth: 0° (front view), Elevation: 5° (slightly above), Distance: auto-fit to mannequin height
- Mannequin centered at world origin, feet on y=0 plane

## ComfyUI Node

### Python (nodes.py)

```python
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
                "pose_file":  ("STRING", {"default": ""}),
                "depth_file": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("pose", "depth")
    FUNCTION = "get_outputs"
    CATEGORY = "AnimeMannequin"
```

Image loading/saving logic lives in `image_processing.py` (pure functions, no ComfyUI imports) — tested with pytest independently.

### JS extension (mannequin_node.js)

Mirrors `openpose_editor.js` in structure. Adds one new behavior: after `captureFromEditor`, the pose dataURL is displayed as a DOM `<img>` element inside a `addDOMWidget("preview", ...)` widget on the node — 128×128px, updated every Close & Save.

---

## Testability

### JS unit tests (Vitest, no DOM/WebGL)

`tests/js/mannequin-model.test.js` covers:
- Bone definitions completeness (all bones present in both F and M presets)
- Proportion values in valid range (0 < value < 1.0)
- `sceneToJSON` → `jsonToScene` roundtrip fidelity
- Gender switching preserves bone rotations, swaps proportions only
- Default T-pose scene is valid (no NaN rotations)

### Python unit tests (pytest, no ComfyUI)

`tests/python/test_image_processing.py` covers:
- `normalize_depth(arr)`: min→255, max→0, linear
- `load_image_from_file`: black placeholder on missing file
- Correct tensor shape (1, H, W, 3) from `image_to_tensor`

### Manual integration (standalone mode)

`http://localhost:8188/mannequin_editor/` (or `python -m http.server` in `static/`) provides full manual test harness without ComfyUI. All features exercisable without node infrastructure.

---

## Phases

### Phase 1 — MVP (joint rotation)
- [ ] Repo scaffold + Three.js vendored libs
- [ ] `mannequin-model.js` bone definitions + proportions (F/M) + serialization
- [ ] Vitest setup + unit tests for model
- [ ] `mannequin-renderer.js` — segments, joint spheres, toon material, depth pass
- [ ] `mannequin-editor.js` — TransformControls on joints, OrbitControls, gender toggle toolbar
- [ ] `comfyui-bridge.js` + `index.html` dual-mode
- [ ] `nodes.py` + `image_processing.py` + pytest
- [ ] `mannequin_node.js` — ComfyUI node, modal, pose save/restore, node thumbnail
- [ ] `__init__.py` static routes
- [ ] README + deploy instructions

### Phase 2 — IK + extras
- [ ] CCD IK on arms and legs (drag hand/foot)
- [ ] Canny output (cv2.Canny in Python)
- [ ] Pose library (JSON preset gallery)
- [ ] Mirror pose (L↔R)
- [ ] Random pose generator

---

## Dependencies

| Dependency | Version | Reason |
|------------|---------|--------|
| three.js | r165+ | 3D rendering |
| Vitest | latest | JS unit tests |
| opencv-python | ≥4.5 | Canny (Phase 2) |
| numpy | ≥1.24 | depth normalization |
| pytest | latest | Python unit tests |

`OrbitControls.js` and `TransformControls.js` vendored from VNCCS (`ComfyUI_VNCCS_Utils/web/`) — no npm required.
