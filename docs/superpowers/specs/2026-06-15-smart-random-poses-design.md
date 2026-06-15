# Smart Random Poses — Design

**Date:** 2026-06-15
**Status:** Approved (design)
**Sub-project:** C of the "IK + poses" group (the last one). A (interactive IK) and B (predefined poses) are done.

## Goal

Replace the per-bone independent Euler randomization behind the **Random** button with a hybrid
generator that produces natural-looking, varied poses: a random preset gives the "intention", a
bounded jitter varies the torso, and IK settles the limbs to slightly randomized reachable targets.

## Problem with the current generator

`generateRandomPose(mode)` randomizes each bone independently within an Euler range
(`RANDOM_LIMITS_SAFE`/`WILD`). With no coordination between bones, poses look incoherent — limbs
fling in unrelated directions, elbows/knees can break, no postural intent.

## Approach (hybrid "D")

`Random` becomes a smart generator; the `safe`/`wild` toggle becomes an **intensity** control.
Old pure per-bone chaos is removed.

Flow per Random click:
1. Pick a random base preset from an eligible pool (natural intent).
2. Build the full bone pose from the preset (`presetToPose`, from sub-project B).
3. Add bounded random jitter to the torso bones (spine, chest, neck, head, pelvis, shoulders) for variation.
4. Apply that pose to the renderer bones.
5. For each of the 4 IK chains (arms + legs), read the current effector world position, offset it by a random vector within a per-chain radius, and IK-solve (`IKController`, from sub-project A) so elbows/knees stay natural.
6. Read the resulting full pose back from the bones.
7. Commit a `RandomPoseCommand` (existing) and `markDirty()`.

## Architecture

### `static/src/smart-pose.js` — pure, testable helpers (rng injected for determinism)
- `ELIGIBLE_PRESET_IDS`: the base pool. **Now: the 8 `basic` preset ids** (`t_pose`, `arms_up`,
  `hands_on_hips`, `arms_crossed`, `contrapposto`, `waving`, `sitting`, `walking`). A comment marks
  that switching to all 13 (include combat) is a one-line change for the eventual default.
- `TORSO_BONES`: `['spine','chest','neck','head','pelvis','shoulder_L','shoulder_R']` — the bones jitter touches (limbs come from IK; fingers untouched).
- `INTENSITY`: `{ safe: { jitterDeg, reachFrac }, wild: { jitterDeg, reachFrac } }`.
  `jitterDeg` is the max per-axis jitter in degrees; `reachFrac` is the IK target offset radius as a **fraction of the limb's total length** (`lenA+lenB`) — so the offset scales with the limb instead of being an absolute distance. Starting values: `safe { jitterDeg: 8, reachFrac: 0.12 }`, `wild { jitterDeg: 22, reachFrac: 0.30 }` (tunable).
- `pickBasePreset(rng)`: returns a preset object chosen uniformly from `ELIGIBLE_PRESET_IDS` (resolved via `presetById`). `rng` is a `() => [0,1)` function (defaults to `Math.random`).
- `jitterPose(pose, rng, jitterDeg, bones = TORSO_BONES)`: returns a NEW pose map; for each listed bone, composes a small random Euler rotation (each axis uniform in `[-jitterDeg, +jitterDeg]`, order `'XYZ'`) onto that bone's existing quaternion. Bones not listed are copied unchanged. Pure.
- `randomOffsetVec(rng, radius)`: returns a `THREE.Vector3` random offset with magnitude ≤ `radius` (uniform direction). Used to perturb IK targets.

### `static/src/mannequin-editor.js` — `generateRandomPose(mode)` rewritten
Orchestrates the flow above using the live renderer bones (IK requires world positions, exactly as
the current generator already reads bones). Reuses `IKController` (held by the editor since sub-project A),
`presetToPose`/`presetById`, the `smart-pose.js` helpers, and the existing `RandomPoseCommand`. The
method keeps its signature `generateRandomPose(mode = 'safe')` and accepts an optional injected `rng`
for tests (`generateRandomPose(mode, rng = Math.random)`).

Per-chain IK target: read effector world pos → add `randomOffsetVec(rng, reachFrac * limbLen)`
where `limbLen` = `dist(root,mid) + dist(mid,end)` computed by the editor from the chain's three bone
world positions (the same quantities `IKController.solve` derives internally) → `ikController.solve(chain, target)`.
The chain bone names come from `IK_CHAINS` (exported by `ik-controller.js`).

## Intensity mapping

- `safe`: small jitter (~8°) + small target offset (~12% of limb length) → pose close to the preset, subtle variation.
- `wild`: larger jitter (~22°) + larger offset (~30%) → bigger departure, wilder but still natural limbs (IK keeps elbows/knees valid).

## UI — no changes

The `Random` button and the `safe`/`wild` toggle (`#btn-random`, `#btn-random-mode`) keep working as
today; only the behavior behind `generateRandomPose(mode)` changes. The old `RANDOM_LIMITS_SAFE`/`WILD`
static tables and per-bone Euler loop are removed.

## Testing

- **`smart-pose.js`** (pure, seeded rng):
  - `pickBasePreset(seededRng)` returns a preset whose id is in `ELIGIBLE_PRESET_IDS` (only `basic`); deterministic for a fixed rng.
  - `jitterPose`: only `TORSO_BONES` change; each changed bone differs from the input but stays bounded (decompose the delta and assert per-axis ≤ jitterDeg + epsilon); bones outside the list are unchanged; deterministic for a fixed rng.
  - `randomOffsetVec`: magnitude ≤ radius; deterministic for a fixed rng.
  - `INTENSITY` has `safe` and `wild`, each with numeric `jitterDeg`/`reachFrac`.
- **`generateRandomPose` orchestration** (stub renderer with a `bones` Map + a real/stub `IKController`, seeded rng): commits exactly one `RandomPoseCommand`; the resulting pose is a full bone map and differs from all-identity; the chosen base is from the eligible pool. (IK math itself is covered by sub-project A's tests.)
- **Visual (browser, manual):** click Random repeatedly in `safe` and `wild`; poses look natural and varied; no broken elbows/knees; undo restores. Tune `jitterDeg`/`reachFrac` if needed.

## No serialization changes

The generator only writes ordinary bone quaternions into the pose via `RandomPoseCommand`. Scene JSON
and the export pipeline (pose/depth/canny/openpose/hands) are unaffected.
