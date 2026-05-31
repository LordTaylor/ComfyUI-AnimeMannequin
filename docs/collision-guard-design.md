# Collision Guard — Design Document

## Problem

FK mannequin segments (arms, legs, torso) pass through each other freely.
No physics, no constraints beyond angle limits in `RANDOM_LIMITS_SAFE`.
Results in anatomically impossible poses that confuse ControlNet.

Worst offenders observed in practice:
- Forearm folding into upper arm (hinge overshoot)
- Thigh/shin crossing the opposite leg  
- Upper arm penetrating the torso when raised forward
- Hand passing through the hip/thigh

---

## Why it's hard

Each segment is a THREE.Group with a mesh child. Collision detection
requires knowing:
1. The actual shape of each segment in world space (not trivial — GLB meshes)
2. Whether two shapes overlap (intersection test)
3. How to correct the overlap without cascading artifacts

The GLB uses stylized geometry — not capsules, not convex hulls. Raw mesh
intersection is O(n²) triangles per pair, not feasible at 60 fps.

---

## Chosen Architecture: Two-layer system

### Layer 1 — Angle Clamping (implemented, extend this)

`RANDOM_LIMITS_SAFE` in `mannequin-editor.js` already clamps random pose
generation. **Extend this to interactive drag** by clamping the quaternion
after every `TransformControls` drag-end event.

Location: `_saveUndoSnapshot()` is called after every drag. Add clamping
before snapshot.

```js
// In MannequinEditor._saveUndoSnapshot() — called after drag ends:
if (this._selectedBone) {
    CollisionGuard.clampBone(this._selectedBone, this._renderer.bones);
}
```

This is fast (O(1) per bone, no geometry) and catches the worst offenders.

### Layer 2 — Capsule Proximity Rejection (new, phased in)

Each bone gets an axis-aligned capsule defined in its local space.
At drag end, check capsule-capsule overlaps for a predefined set of
"dangerous pairs." If overlap detected, reject the drag (restore previous
quaternion) and flash the bone red briefly.

---

## Phase 1: Angle clamping at drag time

### Data needed

```js
// In mannequin-editor.js — add DRAG_LIMITS (same structure as RANDOM_LIMITS_SAFE
// but tighter on the anatomically dangerous axes)
static DRAG_LIMITS = {
    forearm_L:  [0, 150, -8, 8, -8, 8],   // hinge — cannot fold backwards
    forearm_R:  [0, 150, -8, 8, -8, 8],
    shin_L:     [-150, 0, -8, 8, -8, 8],  // hinge — cannot extend forward
    shin_R:     [-150, 0, -8, 8, -8, 8],
    // torso: no limit — FK root
    // arms/legs: generous but prevent 180° flips
    upper_arm_L: [-130, 90, -120, 120, -90, 90],
    upper_arm_R: [-130, 90, -120, 120, -90, 90],
    thigh_L:     [-120, 80, -70, 70, -90, 60],
    thigh_R:     [-120, 80, -70, 70, -60, 90],
};
```

### Clamp function

```js
// New file: static/src/collision-guard.js
import * as THREE from '../lib/three.module.js';

const DEG = Math.PI / 180;

export class CollisionGuard {
    // Clamp bone quaternion to DRAG_LIMITS.
    // Returns true if clamping was applied (caller can flash visual feedback).
    static clampBone(boneName, bone, limits = CollisionGuard.DRAG_LIMITS) {
        const lim = limits[boneName];
        if (!lim) return false;
        const euler = new THREE.Euler().setFromQuaternion(bone.quaternion, 'XYZ');
        const [x0,x1,y0,y1,z0,z1] = lim.map(d => d * DEG);
        const clamped = new THREE.Euler(
            Math.max(x0, Math.min(x1, euler.x)),
            Math.max(y0, Math.min(y1, euler.y)),
            Math.max(z0, Math.min(z1, euler.z)),
            'XYZ'
        );
        // Only apply if clamping actually changed anything
        const diff = Math.abs(clamped.x - euler.x) + Math.abs(clamped.y - euler.y) + Math.abs(clamped.z - euler.z);
        if (diff < 0.001) return false;
        bone.quaternion.setFromEuler(clamped);
        return true;
    }
}
```

### Hook in editor

In `MannequinEditor`, change the drag-end handler:

```js
this._transform.addEventListener('dragging-changed', (e) => {
    this._orbit.enabled = !e.value;
    if (!e.value) {
        // Drag ended — clamp before snapshot
        if (this._selectedBone) {
            const bone = this._renderer.bones.get(this._selectedBone);
            const clamped = CollisionGuard.clampBone(this._selectedBone, bone);
            if (clamped) this._flashBone(this._selectedBone); // optional visual
        }
        this._saveUndoSnapshot();
    }
});
```

### Cost

Zero per-frame cost. Runs once per drag-end event (user-triggered).
No geometry queries.

---

## Phase 2: Capsule-pair proximity check

### When to add this

After Phase 1 is stable. Needed for:
- Arm-through-torso (angle clamping alone doesn't prevent this — arm can
  be anatomically valid angle-wise but still clip through the body)
- Cross-legged poses where thigh/shin of one leg clips the other

### Architecture

1. Define capsule per bone in bone-local space (center + radius + half-length
   along the bone's primary axis). Empirical values from GLB inspection.

2. At drag-end only (not every frame), compute world-space capsule transforms
   for the "dangerous pairs" set (a small fixed list, ~8 pairs).

3. Capsule-capsule distance test: if distance < sum of radii, reject the drag
   by restoring the pre-drag quaternion (already saved in undo stack).

4. Flash the colliding segment red for 400ms (visual feedback).

### Dangerous pairs (estimated, to be tuned after testing)

```js
const COLLISION_PAIRS = [
    ['upper_arm_L', 'chest'],   // arm raised into torso
    ['upper_arm_R', 'chest'],
    ['upper_arm_L', 'spine'],
    ['upper_arm_R', 'spine'],
    ['thigh_L',     'thigh_R'], // cross-legged
    ['shin_L',      'shin_R'],
    ['forearm_L',   'chest'],
    ['forearm_R',   'chest'],
    ['hand_L',      'pelvis'],
    ['hand_R',      'pelvis'],
];
```

### Capsule definition (approximate GLB values, to be measured)

```js
// [half_length, radius] in scene units (WORLD_HEIGHT = 2.0)
const CAPSULE_DEF = {
    chest:     { axis: 'y', halfLen: 0.18, r: 0.14 },
    spine:     { axis: 'y', halfLen: 0.12, r: 0.12 },
    pelvis:    { axis: 'y', halfLen: 0.10, r: 0.13 },
    upper_arm_L: { axis: 'y', halfLen: 0.18, r: 0.055 },
    upper_arm_R: { axis: 'y', halfLen: 0.18, r: 0.055 },
    forearm_L:   { axis: 'y', halfLen: 0.16, r: 0.045 },
    forearm_R:   { axis: 'y', halfLen: 0.16, r: 0.045 },
    thigh_L:     { axis: 'y', halfLen: 0.22, r: 0.07  },
    thigh_R:     { axis: 'y', halfLen: 0.22, r: 0.07  },
    shin_L:      { axis: 'y', halfLen: 0.20, r: 0.055 },
    shin_R:      { axis: 'y', halfLen: 0.20, r: 0.055 },
    hand_L:      { axis: 'y', halfLen: 0.07, r: 0.04  },
    hand_R:      { axis: 'y', halfLen: 0.07, r: 0.04  },
};
```

### Capsule-capsule distance algorithm

Standard segment-to-segment closest point, then compare to sum of radii.
Three.js has no built-in; implement as a ~40-line function in collision-guard.js.

```js
// Closest point between two line segments, returns squared distance.
// Used for capsule-capsule: if dist² < (r1 + r2)² → collision.
function segSegDistSq(p1, p2, p3, p4) {
    // ... standard Shoemake/Ericson algorithm ...
}
```

---

## Non-goals (explicitly out of scope)

- Continuous collision detection (CCD) during drag
- Soft pushing/repulsion (too complex, wrong UX for a pose editor)  
- Collision response / physics simulation
- Per-vertex mesh intersection (too slow)
- Collision between non-adjacent bones in the same limb chain
  (e.g., hand/forearm — covered by angle clamping)

---

## Implementation order

1. ✅ `RANDOM_LIMITS_SAFE` — already exists, prevents worst cases in random mode
2. 🔜 Phase 1: `CollisionGuard.clampBone()` at drag-end — ~60 lines, no new deps
3. 🔜 Phase 2: Capsule pairs — ~150 lines, needs GLB measurement pass first

Estimate: Phase 1 = 2-3 hours. Phase 2 = full day including tuning.
