# Interactive Two-Bone IK — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Sub-project:** A of three. Sequence: **A (interactive IK) → C (smarter random) → B (predefined poses).**
Each sub-project gets its own spec → plan → implementation cycle. This document covers **A only**.

## Goal

Let the user pose arms and legs by dragging an end-effector handle (wrist / ankle). The two
limb bones solve automatically via analytic two-bone IK, so manual posing is fast and the
elbow/knee bends naturally instead of requiring per-bone FK rotation.

## Scope

**In scope (sub-project A):**
- Four two-bone chains: both arms, both legs.
- A toolbar "IK" toggle that shows draggable target handles at the four effectors.
- Analytic two-bone solver with auto-derived pole (bend direction) from the limb's current plane.
- Undo/redo via the existing drag-end command pattern.

**Out of scope (deferred):**
- Spine / torso lean IK, head look-at (multi-bone chains needing CCD/FABRIK).
- A separate pole-vector handle (auto-pole only in v1).
- Foot-flat / world-locked end-effector orientation (option C from brainstorm) — possible later as a per-limb option.
- Smarter random poses (sub-project C) and predefined pose library (sub-project B).

## Chains

| Chain    | root joint (rotates) | mid joint = bend (rotates) | end = effector (handle) | fixed |
|----------|----------------------|----------------------------|-------------------------|-------|
| arm L/R  | `upper_arm_*`        | `forearm_*` (elbow)        | `hand_*` origin (wrist) | `shoulder_*` |
| leg L/R  | `thigh_*`            | `shin_*` (knee)            | `foot_*` origin (ankle) | pelvis |

IK rotates exactly the two bones per chain (`upper_arm`+`forearm`, or `thigh`+`shin`).
The shoulder and pelvis stay put — they remain posable via FK.

## Architecture

New units, each with one clear responsibility:

### `static/src/ik-solver.js` — pure math, no Three.js / no DOM
- `solveTwoBone({ root, target, lenA, lenB, pole })` → `{ mid, endClamped, reachable }`
  - `root`, `target`, `pole`: 3-component vectors (plain arrays or `{x,y,z}` — pick one and be consistent: **plain `[x,y,z]` arrays**).
  - `lenA` = upper bone length (root→mid), `lenB` = lower bone length (mid→end).
  - Returns `mid` (computed mid-joint position), `endClamped` (the reachable end position; equals `target` when reachable, else the clamped point), and `reachable` (bool).
- Math: clamp `d = |target-root|` to `[|lenA-lenB|+eps, lenA+lenB-eps]`. Law of cosines for the
  root-side angle. Place `mid` in the plane spanned by axis `(target-root)` and the `pole`
  vector. Fully unit-testable.

### `static/src/ik-controller.js` — bridges solver ↔ renderer bones
- Holds the chain table above and resolves bones from `renderer.bones`.
- `solve(chainId, targetWorld)`:
  1. Read root world position (root bone origin), current mid + end world positions.
  2. Derive `lenA`, `lenB` from current bone world positions (so it tracks proportion changes).
  3. Derive auto-pole from the current limb plane (cross product of (mid-root) and (end-root));
     if degenerate (limb straight), fall back to a per-chain default pole
     (elbows bend backward, knees bend forward).
  4. Call `solveTwoBone`.
  5. Convert the two resulting world-space bone directions into **local quaternions**, accounting
     for each bone's parent world quaternion, and write them to `upper`/`lower` bone `.quaternion`.
  6. Leave the end bone (hand/foot) local rotation untouched (brainstorm decision A).
- Pure-data inputs/outputs where possible so the bone-application step is testable in jsdom with a
  constructed `THREE.Object3D` chain (no WebGL needed).

### Target handles + toolbar
- Four small spheres (one per effector) created in the renderer, hidden by default.
- `#btn-ik` toolbar button toggles IK mode; CSS mirrors `#btn-hands` / `#btn-objects`.
- In IK mode the handles are visible and pickable; clicking one attaches the existing
  `TransformControls` in **translate** mode to that handle's target object.

## Data flow

1. Click **IK** → IK mode on → handles appear at current effector world positions.
2. Click a handle → translate gizmo attaches to that target object.
3. Drag → on `objectChange`: read target world position → `IKController.solve(chain, targetWorld)`
   → writes new quaternions to the two limb bones → `renderer.markDirty()`.
4. Drag end (`dragging-changed` false) → commit a command with pose snapshot before/after →
   undo/redo works; pose synced to store (same pattern as the current bone gizmo at
   `mannequin-editor.js:81`).
5. Click **IK** again → hide handles, detach gizmo, return to FK. FK click-select keeps working
   alongside IK mode; handles take click priority when hit.

## Edge cases

- **Out of reach** (`d ≥ lenA+lenB`): limb straightens and points at the target; body does not move.
- **Too close** (`d < |lenA-lenB|`): clamp to the minimum reachable distance.
- **Degenerate pole** (limb perfectly straight when solve starts): use per-chain default pole.

## Testing

- **`ik-solver.js`** — full unit tests: reachable target → `endClamped == target` and
  `|mid-root| == lenA`, `|end-mid| == lenB`; out-of-reach → `reachable=false`, limb straightened
  (mid on the root→target line); pole flips the bend side; left/right symmetry.
- **`ik-controller.js`** — build a minimal `THREE.Object3D` chain with known bone lengths in jsdom;
  assert the effector world position ≈ target after `solve` (within tolerance), and that the end
  bone local rotation is unchanged. No WebGL required.
- **Toggle / handles** — light DOM tests: button toggles mode flag; handles created and shown/hidden.
- **Visual (browser, manual):** drag each of the 4 handles; elbow/knee bend looks natural;
  out-of-reach straightens; undo/redo restores; FK still works with IK on.

## No serialization changes

IK is purely an editing aid. The result is ordinary bone quaternions stored in `pose` exactly as
today. Handles are derived from effector positions and are never serialized. The export pipeline
(pose.png / depth / canny / hands) is unaffected.
