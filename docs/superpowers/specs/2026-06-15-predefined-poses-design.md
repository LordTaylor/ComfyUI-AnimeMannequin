# Predefined Pose Library — Design

**Date:** 2026-06-15
**Status:** Approved (design)
**Sub-project:** B of the "IK + poses" group. Sequence built so far: A (interactive IK, done) → **B (predefined poses, this doc)** → C (smarter random, later).

## Goal

Ship a curated set of built-in, one-click body poses. Clicking a preset sets the mannequin's bone
rotations to a ready-made stance, keeping the current gender, proportions, and attached props.

## Scope

**In scope:**
- A built-in set of **13 poses** (8 basic/stance + 5 combat), gender-agnostic (same bone rotations for F and M).
- Applying a preset changes **bone rotations only** — gender, proportions, and the `props` array are untouched. Props attached to bones follow automatically (they are children of bone objects).
- Undoable via a single command.
- A "Presets" section at the top of the existing Poses panel, grouped Basic / Combat.

**Out of scope (deferred):**
- Finger curl for weapon grips (presets leave fingers neutral; the user applies a finger preset via "Hands" separately).
- Thumbnails for built-in poses (text rows only).
- Editing/deleting built-ins from the UI (they are constants; users author their own via the existing save/export).
- Smarter random poses (sub-project C).

## The 13 poses

**Basic (group: `basic`):**
1. `t_pose` — T-pose (arms straight out to the sides)
2. `arms_up` — both arms raised overhead
3. `hands_on_hips` — hands on hips, elbows out
4. `arms_crossed` — arms crossed over the chest
5. `contrapposto` — relaxed stance, weight on one leg (slight hip tilt)
6. `waving` — one arm raised (wave)
7. `sitting` — hips + knees bent ~90° (mid-air, no chair — fine as a ControlNet pose reference)
8. `walking` — one leg forward, arms in opposite swing

**Combat (group: `combat`) — body only; weapon/shield is attached separately as a prop:**
9. `rifle` — rifle shooting stance: both arms raised to shoulder a rifle (one hand on grip, one under the barrel), slightly bladed stance (one leg back), aiming forward
10. `pistol` — pistol shooting stance: both arms extended forward (isosceles), at eye level
11. `saber` — saber fencing: **right hand and right leg forward**, saber arm extended, left arm back for balance
12. `sword_shield` — sword + shield: **left leg forward**, **both arms forward** (shield advanced as a guard, sword ready)
13. `rapier` — court-sword / rapier en-garde: right leg forward, right arm with rapier extended forward, left arm raised back (classic guard)

Combat, `sitting`, and `walking` are the hardest to nail from joint angles; expect iterative tuning after visual review.

## Architecture

### `static/src/pose-presets.js` — pure data + conversion (no DOM)
- `POSE_PRESETS`: array of `{ id, name, group, angles }`, where `angles` is `{ [boneName]: [xDeg, yDeg, zDeg] }`. Only the bones the pose cares about are listed.
- `presetToPose(preset)`: pure function → a full pose map `{ [boneName]: { x, y, z, w } }`. Every bone in `BONE_NAMES` is included: bones present in `angles` get the quaternion from their Euler degrees (order `'XYZ'`, matching `generateRandomPose`); all other bones get identity `{0,0,0,1}`. This makes a preset deterministic regardless of the prior pose.
- `presetById(id)`: lookup helper, returns the preset or `null`.

Angles are stored in **degrees** (human-readable, tunable) and converted with `THREE.Euler`→`THREE.Quaternion` inside `presetToPose`.

### `static/src/commands.js` — `PosePresetCommand`
Mirrors `RandomPoseCommand`: constructor `(prevPose, nextPose)`, `execute(store)` → `store.setPose(next)`, `undo(store)` → `store.setPose(prev)`, `description` → `'Apply pose preset'`.

### `static/src/mannequin-editor.js` — `applyPosePreset(id)`
1. `const preset = presetById(id)`; bail if missing.
2. Snapshot `prevPose = store.getState().pose`.
3. `nextPose = presetToPose(preset)`.
4. `this._history.execute(new PosePresetCommand(prevPose, nextPose), this._store)`.
5. `renderer.markDirty()`.
Only bone quaternions change; the store `props`/`proportions`/`gender` are not touched, so attached props follow the new bone orientations automatically.

### `static/src/panels/pose-library.js` — Presets section
- In `mount()`, add a "Presets" block ABOVE the saved-poses list: a labeled section with two sub-groups (`Basic`, `Combat`) listing `POSE_PRESETS` as clickable name rows. No thumbnail, no delete/export per row.
- Clicking a preset row calls `this._editor.applyPosePreset(id)`.
- The existing saved-pose list, save/import/export controls, and `loadPose` stay unchanged below.

## Data flow

Click preset row → `editor.applyPosePreset(id)` → `presetToPose` builds full bone pose → `PosePresetCommand` → `store.setPose` → renderer subscription applies bone quaternions → attached props (bone children) follow → `markDirty`. Undo restores the prior pose in one step.

## Testing

- **`pose-presets.js`**: all 13 ids present and unique; every `angles` key is a valid `BONE_NAMES` entry; every angle is a 3-number array; groups are `basic`/`combat`. `presetToPose`: unlisted bones are identity; a listed bone's quaternion matches the expected quaternion for a known Euler angle (e.g. `[0,0,90]`); the returned map covers all `BONE_NAMES`.
- **`PosePresetCommand`**: execute sets next pose, undo restores prev (fake store, like existing command tests).
- **`applyPosePreset`**: snapshots prev pose and commits a `PosePresetCommand`; unknown id is a no-op; verify the store `props`/`gender`/`proportions` are unchanged after applying.
- **Panel**: renders 13 preset rows under Basic/Combat; clicking a row calls `applyPosePreset` with the right id (light DOM test).
- **Visual (browser, manual):** apply each preset; stances look natural; attached props follow; undo restores. Combat/sitting/walking angles tuned iteratively after review.

## No serialization changes

A preset only writes ordinary bone quaternions into the pose. Scene JSON, the export pipeline (pose/depth/canny/openpose/hands), and the props/proportions systems are unaffected.
