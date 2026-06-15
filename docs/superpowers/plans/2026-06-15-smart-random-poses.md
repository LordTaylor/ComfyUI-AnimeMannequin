# Smart Random Poses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Random button produce natural, varied poses by seeding from a preset, jittering the torso, and IK-settling the limbs (safe/wild = intensity).

**Architecture:** A pure helper module (`smart-pose.js`) picks a base preset, jitters torso bones, and produces random IK-target offsets — all with an injectable RNG for deterministic tests. The editor's `generateRandomPose(mode, rng)` orchestrates: build preset pose → jitter → apply to bones → IK-solve each limb to an offset target → commit the existing `RandomPoseCommand`. Reuses sub-projects A (IK) and B (presets).

**Tech Stack:** Vanilla JS ES modules, vendored Three.js, Vitest + jsdom. No build step.

---

## Background for the implementer

- **Existing `generateRandomPose(mode='safe')`** (mannequin-editor.js ~line 336) loops over `MannequinEditor.RANDOM_LIMITS_SAFE`/`WILD` static tables, setting each bone to an independent random Euler rotation, commits a `RandomPoseCommand`, and returns `this._renderer.getSceneData(this._gender)`. You will REPLACE its body and REMOVE the two static `RANDOM_LIMITS_*` tables. Keep the signature/return.
- **Callers** (unchanged): `main.js` (`#btn-random` → `editor.generateRandomPose(randomMode)`) and `comfyui-bridge.js` (`generateRandomPose(arg ?? 'safe')`). Keep `mode` as first arg; add an optional second `rng` arg defaulting to `Math.random`.
- **Reusable pieces already on `main`:**
  - `pose-presets.js`: `POSE_PRESETS`, `presetById(id)`, `presetToPose(preset)` → full `{bone:{x,y,z,w}}` map over all `BONE_NAMES`.
  - `ik-controller.js`: `IK_CHAINS` (array of `{id, root, mid, end, defaultPole}`) and `IKController`. The editor already holds `this._ikController = new IKController({ bones: renderer.bones })` and `this._ikActiveChain` (IK drag state).
  - `commands.js`: `RandomPoseCommand(prevPose, nextPose)` (setPose/undo).
- **Pose shape:** `{ boneName: {x,y,z,w} }`. THREE imported in modules as `import * as THREE from '../lib/three.module.js';` (tests: `../../static/lib/three.module.js`).
- **Bone world positions:** `bone.getWorldPosition(vec3)` updates matrices up the chain (current).
- **Renderer applies pose imperatively** (not via store subscription); `undo()/redo()` call `_applyPoseFromStore()`. So `generateRandomPose` must set bone quaternions AND commit the command (same as the old code and `applyFingerPreset`/`applyPosePreset`).

Baseline: `npm test` all passing before starting.

---

## File Structure

- **Create `static/src/smart-pose.js`** — pure helpers: pool, jitter, target offset, intensity config.
- **Modify `static/src/mannequin-editor.js`** — rewrite `generateRandomPose`, remove `RANDOM_LIMITS_*`.
- **Create test `tests/js/smart-pose.test.js`**; **update `tests/js/mannequin-editor-commands.test.js`** (`generateRandomPose` block).

---

## Task 1: Pure smart-pose helpers (`smart-pose.js`)

**Files:**
- Create: `static/src/smart-pose.js`
- Test: `tests/js/smart-pose.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/js/smart-pose.test.js
import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { ELIGIBLE_PRESET_IDS, TORSO_BONES, INTENSITY, pickBasePreset, jitterPose, randomOffsetVec } from '../../static/src/smart-pose.js';

// Deterministic RNG: a simple LCG so tests don't depend on Math.random.
function seededRng(seed = 1) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

describe('config', () => {
    it('ELIGIBLE_PRESET_IDS is the 8 basic ids', () => {
        expect(ELIGIBLE_PRESET_IDS).toEqual(
            ['t_pose', 'arms_up', 'hands_on_hips', 'arms_crossed', 'contrapposto', 'waving', 'sitting', 'walking']);
    });
    it('TORSO_BONES lists torso + shoulders only (no limbs/fingers)', () => {
        expect(TORSO_BONES).toEqual(['spine', 'chest', 'neck', 'head', 'pelvis', 'shoulder_L', 'shoulder_R']);
    });
    it('INTENSITY has safe and wild with numeric jitterDeg/reachFrac', () => {
        for (const k of ['safe', 'wild']) {
            expect(typeof INTENSITY[k].jitterDeg).toBe('number');
            expect(typeof INTENSITY[k].reachFrac).toBe('number');
        }
        expect(INTENSITY.wild.jitterDeg).toBeGreaterThan(INTENSITY.safe.jitterDeg);
    });
});

describe('pickBasePreset', () => {
    it('returns a preset whose id is in the eligible pool', () => {
        const rng = seededRng(42);
        for (let i = 0; i < 20; i++) {
            const p = pickBasePreset(rng);
            expect(ELIGIBLE_PRESET_IDS).toContain(p.id);
        }
    });
    it('is deterministic for a fixed rng', () => {
        expect(pickBasePreset(seededRng(7)).id).toBe(pickBasePreset(seededRng(7)).id);
    });
});

describe('jitterPose', () => {
    it('only changes TORSO_BONES; other bones copied unchanged', () => {
        const pose = { spine: { x: 0, y: 0, z: 0, w: 1 }, forearm_L: { x: 0.1, y: 0, z: 0, w: 0.995 } };
        const out = jitterPose(pose, seededRng(3), 10);
        expect(out.forearm_L).toEqual(pose.forearm_L);          // not a torso bone → unchanged
        expect(out.spine).not.toEqual(pose.spine);              // torso bone → jittered
    });
    it('keeps each jitter axis within ±jitterDeg of identity input', () => {
        const jitterDeg = 12;
        const pose = { head: { x: 0, y: 0, z: 0, w: 1 } };
        const out = jitterPose(pose, seededRng(9), jitterDeg);
        const e = new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion(out.head.x, out.head.y, out.head.z, out.head.w), 'XYZ');
        const lim = (jitterDeg + 1e-6) * Math.PI / 180;
        expect(Math.abs(e.x)).toBeLessThanOrEqual(lim);
        expect(Math.abs(e.y)).toBeLessThanOrEqual(lim);
        expect(Math.abs(e.z)).toBeLessThanOrEqual(lim);
    });
    it('is deterministic for a fixed rng', () => {
        const pose = { spine: { x: 0, y: 0, z: 0, w: 1 } };
        expect(jitterPose(pose, seededRng(5), 10)).toEqual(jitterPose(pose, seededRng(5), 10));
    });
});

describe('randomOffsetVec', () => {
    it('magnitude never exceeds radius', () => {
        const rng = seededRng(11);
        for (let i = 0; i < 50; i++) {
            const v = randomOffsetVec(rng, 0.5);
            expect(v.length()).toBeLessThanOrEqual(0.5 + 1e-9);
        }
    });
    it('is deterministic for a fixed rng', () => {
        const a = randomOffsetVec(seededRng(2), 1);
        const b = randomOffsetVec(seededRng(2), 1);
        expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z]);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/js/smart-pose.test.js`
Expected: FAIL — cannot resolve `smart-pose.js`.

- [ ] **Step 3: Implement the module**

```javascript
// static/src/smart-pose.js
// Pure helpers for the smart Random generator. RNG is injected (a () => [0,1) function)
// so behavior is deterministic in tests. No DOM. (Imports THREE for quaternion math and
// pose-presets for the eligible pool.)
import * as THREE from '../lib/three.module.js';
import { presetById } from './pose-presets.js';

// Base pose pool. NOW: the 8 'basic' presets. To include combat poses in the eventual
// default, extend this array with: 'rifle','pistol','saber','sword_shield','rapier'.
export const ELIGIBLE_PRESET_IDS = [
    't_pose', 'arms_up', 'hands_on_hips', 'arms_crossed', 'contrapposto', 'waving', 'sitting', 'walking',
];

// Bones the jitter perturbs (limbs come from IK; fingers are left neutral).
export const TORSO_BONES = ['spine', 'chest', 'neck', 'head', 'pelvis', 'shoulder_L', 'shoulder_R'];

// Intensity for the safe/wild toggle. jitterDeg = max per-axis torso jitter (degrees);
// reachFrac = IK target offset radius as a fraction of the limb's total length.
export const INTENSITY = {
    safe: { jitterDeg: 8,  reachFrac: 0.12 },
    wild: { jitterDeg: 22, reachFrac: 0.30 },
};

const DEG = Math.PI / 180;

/** Pick a base preset uniformly from the eligible pool. rng: () => [0,1). */
export function pickBasePreset(rng) {
    const idx = Math.min(ELIGIBLE_PRESET_IDS.length - 1, Math.floor(rng() * ELIGIBLE_PRESET_IDS.length));
    return presetById(ELIGIBLE_PRESET_IDS[idx]);
}

/**
 * Return a NEW pose map with a small random rotation composed onto each listed bone.
 * Each axis is uniform in [-jitterDeg, +jitterDeg] (Euler 'XYZ'), applied in the bone's
 * local frame (q_out = q_in * q_jitter). Bones not in `bones` are copied unchanged.
 */
export function jitterPose(pose, rng, jitterDeg, bones = TORSO_BONES) {
    const out = {};
    const set = new Set(bones);
    const euler = new THREE.Euler();
    const jq = new THREE.Quaternion();
    const base = new THREE.Quaternion();
    for (const [name, q] of Object.entries(pose)) {
        if (!set.has(name)) { out[name] = { ...q }; continue; }
        const rx = (rng() * 2 - 1) * jitterDeg * DEG;
        const ry = (rng() * 2 - 1) * jitterDeg * DEG;
        const rz = (rng() * 2 - 1) * jitterDeg * DEG;
        euler.set(rx, ry, rz, 'XYZ');
        jq.setFromEuler(euler);
        base.set(q.x, q.y, q.z, q.w).multiply(jq);
        out[name] = { x: base.x, y: base.y, z: base.z, w: base.w };
    }
    return out;
}

/** Random offset vector with uniform direction and magnitude in [0, radius]. */
export function randomOffsetVec(rng, radius) {
    // uniform direction on the unit sphere
    const u = rng() * 2 - 1;            // cos(theta) in [-1,1]
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const dir = new THREE.Vector3(s * Math.cos(phi), s * Math.sin(phi), u);
    return dir.multiplyScalar(rng() * radius);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/js/smart-pose.test.js`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add static/src/smart-pose.js tests/js/smart-pose.test.js
git commit -m "feat(random): smart-pose pure helpers (pool, jitter, target offset)"
```

---

## Task 2: Rewrite `generateRandomPose` to orchestrate the smart generator

**Files:**
- Modify: `static/src/mannequin-editor.js` (rewrite `generateRandomPose`; remove `RANDOM_LIMITS_SAFE`/`WILD`)
- Test: `tests/js/mannequin-editor-commands.test.js` (update the `generateRandomPose` block)

- [ ] **Step 1: Add imports**

In `static/src/mannequin-editor.js`:
- Add `IK_CHAINS` to the existing import from `./ik-controller.js` (it currently imports `IKController`).
- Add `import { ELIGIBLE_PRESET_IDS, INTENSITY, pickBasePreset, jitterPose, randomOffsetVec } from './smart-pose.js';` (`ELIGIBLE_PRESET_IDS` is used by the test via the editor's behavior; import the ones used: `INTENSITY, pickBasePreset, jitterPose, randomOffsetVec`).
- `presetToPose` is already imported (from `./pose-presets.js`, added in sub-project B). `RandomPoseCommand` is already imported from `./commands.js`. THREE is already imported.

- [ ] **Step 2: Update the failing test**

Replace the existing `describe('generateRandomPose', ...)` block in `tests/js/mannequin-editor-commands.test.js` with the following. This file already `vi.mock`s `pose-presets.js`; to keep the orchestration test isolated and deterministic, ALSO mock `smart-pose.js` here so the editor uses controllable stubs (the real helpers are covered by Task 1's own test file).

Add this mock near the file's other `vi.mock` calls (top of file, before importing the editor):

```javascript
vi.mock('../../static/src/smart-pose.js', () => ({
    ELIGIBLE_PRESET_IDS: ['t_pose'],
    INTENSITY: { safe: { jitterDeg: 8, reachFrac: 0.12 }, wild: { jitterDeg: 22, reachFrac: 0.30 } },
    // deterministic, non-identity base for 'head' so the committed pose differs from identity
    pickBasePreset: () => ({ id: 't_pose', name: 'T', group: 'basic', angles: {} }),
    jitterPose: (pose) => ({ ...pose, head: { x: 0, y: 0, z: 0.2, w: 0.9797958971 } }),
    randomOffsetVec: () => ({ clone() { return this; }, add() { return this; }, x: 0, y: 0, z: 0,
                             length() { return 0; }, multiplyScalar() { return this; } }),
}));
```

Then the block:

```javascript
describe('generateRandomPose', () => {
    it('creates an undo-able RandomPoseCommand', () => {
        const { editor } = mkEditor(['head', 'neck', 'chest']);
        editor.generateRandomPose('safe');
        expect(editor.history.canUndo).toBe(true);
        expect(editor.history.undoDescription).toBe('Random pose');
    });

    it('writes a full pose to the store (head changed by the jittered base)', () => {
        const { editor, store } = mkEditor(['head']);
        editor.generateRandomPose('safe');
        expect(store.getState().pose.head).not.toEqual({ x: 0, y: 0, z: 0, w: 1 });
    });

    it('undo restores the pose before random', () => {
        const { editor, store } = mkEditor(['head']);
        store.setPoseBone('head', { x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
        const before = store.getState().pose;
        editor.generateRandomPose('safe');
        editor.undo();
        expect(store.getState().pose).toEqual(before);
    });

    it('accepts an injected rng (deterministic) and still commits', () => {
        const { editor } = mkEditor(['head']);
        const rng = () => 0.5;
        editor.generateRandomPose('wild', rng);
        expect(editor.history.canUndo).toBe(true);
    });
});
```

> If `mkEditor` builds the editor such that `this._ikController` needs a `bones` Map (it does — the constructor does `new IKController({ bones: renderer.bones })`), the existing stub already provides one. The smart generator's IK loop guards on each chain bone existing (`upper_arm_L`, etc.); with a minimal bones list those chains are simply skipped, which is fine for these tests.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/js/mannequin-editor-commands.test.js`
Expected: FAIL — the new test expects `undoDescription === 'Random pose'` and the rng arg / new behavior not yet implemented (or a reference error once you start editing). (If it still passes by luck before editing, proceed — the real verification is Step 5.)

- [ ] **Step 4: Rewrite `generateRandomPose` and remove the old tables**

Replace the entire existing `generateRandomPose(mode = 'safe') { ... }` method body with:

```javascript
generateRandomPose(mode = 'safe', rng = Math.random) {
    const intensity = INTENSITY[mode] ?? INTENSITY.safe;
    const prevPose  = this._store?.getState().pose ?? {};

    // If an IK handle is mid-drag, clear it so handles re-sync to the new pose.
    if (this._ikActiveChain) this._deselect();

    // 1) base preset → 2) jitter torso
    const preset   = pickBasePreset(rng);
    const base     = presetToPose(preset);
    const jittered = jitterPose(base, rng, intensity.jitterDeg);

    // 3) apply base+jitter to renderer bones
    for (const [name, q] of Object.entries(jittered)) {
        const bone = this._renderer.bones.get(name);
        if (bone) bone.quaternion.set(q.x, q.y, q.z, q.w);
    }

    // 4) IK-settle each limb to a randomly offset reachable target
    for (const chain of IK_CHAINS) {
        const rootB = this._renderer.bones.get(chain.root);
        const midB  = this._renderer.bones.get(chain.mid);
        const endB  = this._renderer.bones.get(chain.end);
        if (!rootB || !midB || !endB) continue;
        const rootW = rootB.getWorldPosition(new THREE.Vector3());
        const midW  = midB.getWorldPosition(new THREE.Vector3());
        const endW  = endB.getWorldPosition(new THREE.Vector3());
        const limbLen = rootW.distanceTo(midW) + midW.distanceTo(endW);
        const target  = endW.clone().add(randomOffsetVec(rng, intensity.reachFrac * limbLen));
        this._ikController.solve(chain.id, target);
    }

    // 5) read the final pose back from the bones
    const nextPose = {};
    for (const [name, bone] of this._renderer.bones) {
        const q = bone.quaternion;
        nextPose[name] = { x: q.x, y: q.y, z: q.z, w: q.w };
    }

    if (this._store) {
        this._history.execute(new RandomPoseCommand(prevPose, nextPose), this._store);
    }
    this._renderer.markDirty();
    return this._renderer.getSceneData(this._gender);
}
```

Then DELETE the two static tables `static RANDOM_LIMITS_SAFE = { ... };` and `static RANDOM_LIMITS_WILD = { ... };` from the class (they are now unused). Search the file to confirm no remaining references to `RANDOM_LIMITS`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/js/mannequin-editor-commands.test.js`
Expected: PASS (updated `generateRandomPose` block + all other blocks).
Then full suite: `npx vitest run`
Expected: all pass. Grep to confirm cleanup: `grep -rn "RANDOM_LIMITS" static/src` → no matches.

- [ ] **Step 6: Commit**

```bash
git add static/src/mannequin-editor.js tests/js/mannequin-editor-commands.test.js
git commit -m "feat(random): smart Random — preset + jitter + IK-settled limbs"
```

- [ ] **Step 7: Manual browser verification + tuning (cannot be unit-tested — WebGL)**

Serve `static/` locally (or use the live Pages site after deploy):
- Click **Random** repeatedly in `safe`: poses look natural and stay close to recognizable stances with subtle variation; elbows/knees never break; no limbs intersecting wildly.
- Toggle to `wild` (🔓) and click Random: bigger variation, still natural limbs.
- Undo (Ctrl+Z) restores the previous pose in one step.
- If poses are too tame / too wild, tune `INTENSITY` (`jitterDeg`, `reachFrac`) in `smart-pose.js`.
- (Optional future) To include combat poses in the pool, add their ids to `ELIGIBLE_PRESET_IDS`.

---

## Self-Review (done by plan author)

**Spec coverage:**
- Random = smart, safe/wild = intensity, old per-bone chaos removed → Task 2 (rewrite + delete RANDOM_LIMITS). ✓
- Flow: preset → jitter torso → IK-settle limbs to offset targets → commit RandomPoseCommand → Task 2. ✓
- `smart-pose.js` pure helpers with injected rng (pool, jitter, offset, intensity) → Task 1. ✓
- `reach` = fraction of limb length (`limbLen` from root/mid/end distances) → Task 2 IK loop. ✓
- Pool = 8 basic now, one-line switch to all → `ELIGIBLE_PRESET_IDS` + comment (Task 1). ✓
- UI unchanged (Random button + safe/wild) → signature `generateRandomPose(mode, rng)` preserved; callers untouched. ✓
- No serialization changes → only writes bone quaternions via RandomPoseCommand. ✓
- IK staleness consistency (clear active chain) → handled at top of the rewrite. ✓

**Type consistency:** `pickBasePreset`/`jitterPose`/`randomOffsetVec`/`INTENSITY`/`ELIGIBLE_PRESET_IDS`/`TORSO_BONES` names identical across Task 1 module, Task 2 imports, and tests. `IK_CHAINS` entry shape `{id,root,mid,end}` matches usage. Pose map `{x,y,z,w}` consistent. `RandomPoseCommand` description is `'Random pose'` (matches the existing command and the test assertion).

**Placeholder scan:** no TBD/TODO; all code steps contain complete code. Intensity numbers are concrete tunable values, not placeholders.
