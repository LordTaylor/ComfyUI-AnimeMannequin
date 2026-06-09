# Finger Output Follows Pose — Plan (1a fix)

> Executes via subagent-driven TDD. Steps use checkbox syntax.

**Goal:** Make the OpenPose hand keypoints (`hands.png` + fingers in `pose.png`) reflect the actual finger pose. Currently `_computeHandKeypoints` derives joints purely from bone *positions* (`base − wrist`), ignoring the finger bone's rotation — so the exported control image is identical regardless of preset. Also fixes finger-length estimation (was `|knuckle − wrist|`, anatomically wrong).

**Approach:** Store, per finger bone, a rest-space "tip offset" vector derived from the finger's segment geometry (`bone.userData.fingerTipLocal`). Keypoints then use `fingerBone.localToWorld(fingerTipLocal * frac)` so tip + sub-joints swing as the bone rotates. Knuckle (base, kp index `start`) stays the pivot = bone world position.

**Out of scope:** per-finger curl axis (🟠#2 — needs visual confirmation), 3-phalange articulation (🟡 — iteration 2).

**Tech:** Three.js, Vitest+jsdom (real `three.module.js` works in tests). Worktree: `.claude/worktrees/finger-control-1a`. Tests: `npm test`.

---

### Task A: keypoints follow finger rotation (renderer method)

**File:** `static/src/mannequin-renderer.js` (`_computeHandKeypoints`); test `tests/js/hand-keypoints.test.js`.

Rewrite so that, for each finger:
- `base` (kp `start`) = `fingerBone.getWorldPosition()` (knuckle — unchanged, the pivot).
- If `fingerBone.userData.fingerTipLocal` (a THREE.Vector3 in bone-local space) is present:
  - `tipWorld = fingerBone.localToWorld(fingerTipLocal.clone())`
  - sub-joints at 1/3, 2/3 = `fingerBone.localToWorld(fingerTipLocal.clone().multiplyScalar(frac))`
- Else fallback to the existing `base − wrist` heuristic (so nothing breaks before Task B populates userData).
- Project all to screen as before.

Tests (use real THREE objects; build a small hand→finger hierarchy, set `userData.fingerTipLocal`, add to a scene, `updateMatrixWorld(true)`):
- tip keypoint MOVES when the finger bone is rotated 90° (vs identity) — the core fix.
- base keypoint does NOT move under the bone's own rotation (pivot stays).
- fallback path (no fingerTipLocal) still returns 21 points.

### Task B: populate `fingerTipLocal` from segment geometry at build

**File:** `static/src/mannequin-renderer.js` (`buildMannequin` + new `_computeFingerTipLocals()`).

After segments are attached to bones in `buildMannequin`, for each of the 10 finger bones:
- Find its segment mesh (descendant mesh with `userData.boneName === fingerName`, not a joint).
- Compute the geometry bounding box; transform its 8 corners by the mesh's local matrix relative to the finger bone (mesh is a child of the bone's group, group is identity relative to the bone).
- The corner farthest from the bone origin (0,0,0 in bone-local) = `fingerTipLocal` (bone-local tip point). This yields both correct direction and correct finger length automatically.
- Store on `fingerBone.userData.fingerTipLocal`.
- Guard: missing mesh/geometry → leave unset (Task A falls back).

Test: construct a fake finger bone with a child mesh whose geometry has a known boundingBox + a mesh transform; call the helper; assert `userData.fingerTipLocal` equals the expected farthest corner in bone-local. (Geometry/bbox can be faked with a minimal object exposing `boundingBox`.)
