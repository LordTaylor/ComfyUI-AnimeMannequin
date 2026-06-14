# Interactive Two-Bone IK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag a wrist/ankle handle and have the arm/leg solve automatically via analytic two-bone IK.

**Architecture:** A pure-math solver (`ik-solver.js`) computes the mid-joint position; a bridge (`ik-controller.js`) reads the live bone chain, calls the solver, and applies the result to the two limb bones using axis-agnostic incremental rotations (`Quaternion.setFromUnitVectors`). The editor adds an "IK" toolbar toggle that shows four draggable target spheres; dragging a handle drives the controller; drag-end commits an undoable multi-bone command.

**Tech Stack:** Vanilla JS ES modules, vendored Three.js (`static/lib/three.module.js`), Vitest + jsdom. No build step.

---

## Background for the implementer

This is a static-file Three.js app. Key existing pieces you will use:

- **Bones:** `renderer.bones` is a `Map<string, THREE.Object3D>`. Each bone Object3D's *origin* (world position) is the joint. Reading a bone's world position with `bone.getWorldPosition(v)` forces a world-matrix update up the parent chain, so it is always current.
- **Chains** (parent → child): `upper_arm_L → forearm_L → hand_L`, `thigh_L → shin_L → foot_L`, and the `_R` mirror. IK rotates the first two bones of each chain; the effector is the *origin* of the third bone (`hand_*` = wrist, `foot_*` = ankle).
- **Gizmo:** `this._transform` is a single shared `TransformControls` in `mannequin-editor.js`. It is attached to one object at a time. `setMode('rotate'|'translate')` switches mode. Drag lifecycle: `mouseDown` → `dragging-changed`(value=true) → `change`(repeated) → `dragging-changed`(value=false).
- **Commands / undo:** see `static/src/commands.js`. `store.setPose(poseObj)` replaces the whole pose; `store.setPoseBone(name, quat)` sets one bone. Undo commands snapshot prev/next and re-apply via the store; the renderer reacts through `subscribe`.
- **Render loop:** `editor.update()` is called every frame (currently `this._orbit.update()`). `renderer.markDirty()` requests a redraw.
- **Vectors in the solver are plain `[x, y, z]` arrays** (per spec).

A precedent for headless Three.js scene-graph tests with rotation exists in `tests/js/hand-keypoints.test.js` (build `THREE.Object3D` hierarchy, rotate, assert world positions). Tests import Three with `import * as THREE from '../../static/lib/three.module.js';`.

---

## File Structure

- **Create `static/src/ik-solver.js`** — pure two-bone math, plain-array vectors, no Three/DOM.
- **Create `static/src/ik-controller.js`** — chain table + bone application (imports Three for `Vector3`/`Quaternion`).
- **Modify `static/src/commands.js`** — add `IKPoseCommand`.
- **Modify `static/src/mannequin-renderer.js`** — IK target handles (create/show/hide/position, effector lookup).
- **Modify `static/src/mannequin-editor.js`** — IK mode, handle picking, drag → solve → commit.
- **Modify `static/index.html`** — `#btn-ik` toolbar button + CSS.
- **Modify `static/src/main.js`** — wire `#btn-ik` to the editor.
- **Create tests:** `tests/js/ik-solver.test.js`, `tests/js/ik-controller.test.js`, `tests/js/commands.test.js` (extend), `tests/js/ik-handles.test.js`.

Run the whole suite at any time with: `npm test` (expected baseline before this work: all passing).

---

## Task 1: Pure two-bone solver

**Files:**
- Create: `static/src/ik-solver.js`
- Test: `tests/js/ik-solver.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/js/ik-solver.test.js
import { describe, it, expect } from 'vitest';
import { solveTwoBone, sub, len } from '../../static/src/ik-solver.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('solveTwoBone', () => {
    it('reachable target: end lands on target, bone lengths preserved', () => {
        const r = solveTwoBone({ root: [0, 0, 0], target: [1, -1, 0], lenA: 1, lenB: 1, pole: [1, 0, 0] });
        expect(r.reachable).toBe(true);
        // endClamped equals target when reachable
        expect(close(r.endClamped[0], 1)).toBe(true);
        expect(close(r.endClamped[1], -1)).toBe(true);
        // |mid-root| == lenA, |end-mid| == lenB
        expect(close(len(sub(r.mid, [0, 0, 0])), 1, 1e-5)).toBe(true);
        expect(close(len(sub(r.endClamped, r.mid)), 1, 1e-5)).toBe(true);
    });

    it('pole controls bend side', () => {
        const a = solveTwoBone({ root: [0, 0, 0], target: [0, -2 + 0.001, 0], lenA: 1.2, lenB: 1.2, pole: [1, 0, 0] });
        const b = solveTwoBone({ root: [0, 0, 0], target: [0, -2 + 0.001, 0], lenA: 1.2, lenB: 1.2, pole: [-1, 0, 0] });
        // mid bulges toward +x for pole +x, toward -x for pole -x
        expect(a.mid[0]).toBeGreaterThan(0);
        expect(b.mid[0]).toBeLessThan(0);
    });

    it('out of reach: straightens and clamps, reachable=false', () => {
        const r = solveTwoBone({ root: [0, 0, 0], target: [10, 0, 0], lenA: 1, lenB: 1, pole: [0, 1, 0] });
        expect(r.reachable).toBe(false);
        // clamped end at ~lenA+lenB along the axis
        expect(close(r.endClamped[0], 2, 1e-3)).toBe(true);
        // mid on the root→target line (≈ [1,0,0]) — minimal perpendicular offset
        expect(close(r.mid[0], 1, 1e-3)).toBe(true);
        expect(close(r.mid[1], 0, 1e-3)).toBe(true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/js/ik-solver.test.js`
Expected: FAIL — "Failed to resolve import ... ik-solver.js" / `solveTwoBone is not a function`.

- [ ] **Step 3: Implement the solver**

```javascript
// static/src/ik-solver.js
// Pure two-bone analytic IK. Vectors are plain [x, y, z] arrays. No Three.js, no DOM.

const EPS = 1e-6;

export const sub   = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add   = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot   = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len   = (a)    => Math.sqrt(dot(a, a));
export function normalize(a) {
    const l = len(a);
    return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}
export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Any unit vector perpendicular to n. */
function anyPerp(n) {
    const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return normalize(cross(n, ref));
}

/**
 * Solve a two-bone chain.
 * @param {{root:number[], target:number[], lenA:number, lenB:number, pole:number[]}} p
 *   root  — world position of the root joint (shoulder/hip)
 *   target — desired world position of the end effector (wrist/ankle)
 *   lenA  — upper bone length (root→mid)
 *   lenB  — lower bone length (mid→end)
 *   pole  — direction the mid joint bends toward (any vector; projected perpendicular to the axis)
 * @returns {{mid:number[], endClamped:number[], reachable:boolean}}
 */
export function solveTwoBone({ root, target, lenA, lenB, pole }) {
    const axis = sub(target, root);
    const d0   = len(axis);
    const n    = d0 < EPS ? [0, -1, 0] : scale(axis, 1 / d0);

    const dMin = Math.abs(lenA - lenB) + EPS;
    const dMax = lenA + lenB - EPS;
    const d    = clamp(d0, dMin, dMax);
    const reachable = d0 <= lenA + lenB && d0 >= Math.abs(lenA - lenB);

    const endClamped = add(root, scale(n, d));

    // angle at root between upper bone and the root→end axis
    const cosA  = clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1);
    const angle = Math.acos(cosA);

    // perpendicular bend direction in the plane defined by n and pole
    let p = sub(pole, scale(n, dot(pole, n)));
    p = len(p) < EPS ? anyPerp(n) : normalize(p);

    const mid = add(root, add(scale(n, lenA * Math.cos(angle)), scale(p, lenA * Math.sin(angle))));
    return { mid, endClamped, reachable };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/js/ik-solver.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add static/src/ik-solver.js tests/js/ik-solver.test.js
git commit -m "feat(ik): pure two-bone analytic solver"
```

---

## Task 2: IKPoseCommand (undoable multi-bone change)

**Files:**
- Modify: `static/src/commands.js` (append after `RandomPoseCommand`)
- Test: `tests/js/commands.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/js/commands.test.js` (it already imports from `commands.js` and constructs a fake store — match the existing fake-store style in that file; the minimal store below is self-contained if the file has no shared helper):

```javascript
import { IKPoseCommand } from '../../static/src/commands.js';

describe('IKPoseCommand', () => {
    function makeStore(initialPose) {
        let pose = { ...initialPose };
        return {
            setPose: (p) => { pose = { ...p }; },
            getPose: () => pose,
        };
    }

    it('execute sets next pose, undo restores prev pose', () => {
        const prev = { upper_arm_L: { x: 0, y: 0, z: 0, w: 1 } };
        const next = { upper_arm_L: { x: 0, y: 0, z: 0.1, w: 0.99 }, forearm_L: { x: 0.2, y: 0, z: 0, w: 0.97 } };
        const store = makeStore(prev);
        const cmd = new IKPoseCommand(prev, next);
        cmd.execute(store);
        expect(store.getPose()).toEqual(next);
        cmd.undo(store);
        expect(store.getPose()).toEqual(prev);
    });

    it('description names IK', () => {
        const cmd = new IKPoseCommand({}, {});
        expect(cmd.description).toBe('IK pose');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/js/commands.test.js`
Expected: FAIL — `IKPoseCommand is not a constructor` / undefined import.

- [ ] **Step 3: Implement the command**

Append to `static/src/commands.js`:

```javascript
/**
 * IK solve result — snapshots the full pose before/after a drag so the whole
 * change (two limb bones) undoes/redoes as one step. Mirrors RandomPoseCommand.
 */
export class IKPoseCommand extends Command {
    constructor(prevPose, nextPose) {
        super();
        this._prev = { ...prevPose };
        this._next = { ...nextPose };
    }

    execute(store) { store.setPose(this._next); }
    undo(store)    { store.setPose(this._prev); }
    get description() { return 'IK pose'; }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/js/commands.test.js`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add static/src/commands.js tests/js/commands.test.js
git commit -m "feat(ik): IKPoseCommand for undoable two-bone IK"
```

---

## Task 3: IK controller (chain table + bone application)

**Files:**
- Create: `static/src/ik-controller.js`
- Test: `tests/js/ik-controller.test.js`

The controller reads the live chain, derives bone lengths and the auto-pole from the *current* limb configuration, calls the solver, and applies the result using `Quaternion.setFromUnitVectors` (rotate each bone's current child-direction onto the desired direction). This is axis-agnostic, so it needs no knowledge of which local axis runs along a bone.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/js/ik-controller.test.js
import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { IKController, IK_CHAINS } from '../../static/src/ik-controller.js';

// Build a bent two-bone arm: upper_arm at origin, forearm 1 below, hand 1 below that,
// with a slight initial bend so the auto-pole is well-defined.
function makeArmChain() {
    const scene = new THREE.Scene();
    const upper = new THREE.Object3D(); upper.position.set(0, 2, 0);          // shoulder joint (world)
    const fore  = new THREE.Object3D(); fore.position.set(0, -1, 0);           // elbow: 1 below shoulder
    const hand  = new THREE.Object3D(); hand.position.set(0.0, -1, 0.0);       // wrist: 1 below elbow
    upper.add(fore); fore.add(hand); scene.add(upper);
    // pre-bend the elbow a little so the limb is not perfectly straight
    fore.rotation.set(0.3, 0, 0);
    scene.updateMatrixWorld(true);
    const bones = new Map([['upper_arm_L', upper], ['forearm_L', fore], ['hand_L', hand]]);
    return { scene, bones, upper, fore, hand };
}

describe('IK_CHAINS', () => {
    it('defines four chains: arms and legs', () => {
        const ids = IK_CHAINS.map(c => c.id).sort();
        expect(ids).toEqual(['arm_L', 'arm_R', 'leg_L', 'leg_R']);
    });
    it('arm_L chain bones are upper_arm/forearm/hand', () => {
        const arm = IK_CHAINS.find(c => c.id === 'arm_L');
        expect(arm.root).toBe('upper_arm_L');
        expect(arm.mid).toBe('forearm_L');
        expect(arm.end).toBe('hand_L');
    });
});

describe('IKController.solve', () => {
    it('moves the effector to a reachable target', () => {
        const { scene, bones, hand } = makeArmChain();
        const ctrl = new IKController({ bones });
        const target = new THREE.Vector3(0.4, 0.4, 0.3); // within reach (≤ 2 from shoulder)
        ctrl.solve('arm_L', target);
        scene.updateMatrixWorld(true);
        const got = hand.getWorldPosition(new THREE.Vector3());
        expect(got.distanceTo(target)).toBeLessThan(1e-2);
    });

    it('leaves the end bone local rotation untouched', () => {
        const { scene, bones, hand } = makeArmChain();
        hand.quaternion.set(0.1, 0.2, 0.0, 0.974); // arbitrary hand orientation
        const before = hand.quaternion.clone();
        const ctrl = new IKController({ bones });
        ctrl.solve('arm_L', new THREE.Vector3(0.5, 0.5, 0.2));
        expect(hand.quaternion.x).toBeCloseTo(before.x, 6);
        expect(hand.quaternion.y).toBeCloseTo(before.y, 6);
        expect(hand.quaternion.z).toBeCloseTo(before.z, 6);
        expect(hand.quaternion.w).toBeCloseTo(before.w, 6);
    });

    it('out-of-reach target straightens the limb toward the target', () => {
        const { scene, bones, upper, hand } = makeArmChain();
        const ctrl = new IKController({ bones });
        const far = new THREE.Vector3(0, -10, 0);
        ctrl.solve('arm_L', far);
        scene.updateMatrixWorld(true);
        const shoulder = upper.getWorldPosition(new THREE.Vector3());
        const wrist    = hand.getWorldPosition(new THREE.Vector3());
        // wrist is ~2 units (lenA+lenB) below the shoulder, roughly straight down
        expect(wrist.distanceTo(shoulder)).toBeCloseTo(2, 1);
        expect(wrist.x).toBeCloseTo(0, 1);
        expect(wrist.z).toBeCloseTo(0, 1);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/js/ik-controller.test.js`
Expected: FAIL — cannot resolve `ik-controller.js`.

- [ ] **Step 3: Implement the controller**

```javascript
// static/src/ik-controller.js
import * as THREE from '../lib/three.module.js';
import { solveTwoBone } from './ik-solver.js';

export const IK_CHAINS = [
    { id: 'arm_L', root: 'upper_arm_L', mid: 'forearm_L', end: 'hand_L', defaultPole: [0, 0, -1] },
    { id: 'arm_R', root: 'upper_arm_R', mid: 'forearm_R', end: 'hand_R', defaultPole: [0, 0, -1] },
    { id: 'leg_L', root: 'thigh_L',     mid: 'shin_L',    end: 'foot_L', defaultPole: [0, 0,  1] },
    { id: 'leg_R', root: 'thigh_R',     mid: 'shin_R',    end: 'foot_R', defaultPole: [0, 0,  1] },
];

const v2a = (v) => [v.x, v.y, v.z];

export class IKController {
    /** @param {{ bones: Map<string, THREE.Object3D> }} deps */
    constructor({ bones }) {
        this._bones = bones;
        this._chainById = new Map(IK_CHAINS.map(c => [c.id, c]));
    }

    chain(id) { return this._chainById.get(id) ?? null; }

    /**
     * Solve a chain so its effector reaches targetWorld (THREE.Vector3),
     * mutating the root and mid bone quaternions. End bone untouched.
     */
    solve(chainId, targetWorld) {
        const chain = this._chainById.get(chainId);
        if (!chain) return;
        const rootB = this._bones.get(chain.root);
        const midB  = this._bones.get(chain.mid);
        const endB  = this._bones.get(chain.end);
        if (!rootB || !midB || !endB) return;

        const tmp = new THREE.Vector3();
        const rootW = rootB.getWorldPosition(new THREE.Vector3());
        const midW0 = midB.getWorldPosition(new THREE.Vector3());
        const endW0 = endB.getWorldPosition(new THREE.Vector3());

        const lenA = midW0.distanceTo(rootW);
        const lenB = endW0.distanceTo(midW0);

        // auto-pole: current bulge direction = component of (mid-root) perpendicular
        // to the root→end axis. Fall back to per-chain default if degenerate.
        const axis = endW0.clone().sub(rootW);
        let pole;
        if (axis.lengthSq() > 1e-10) {
            const n = axis.clone().normalize();
            const rm = midW0.clone().sub(rootW);
            const perp = rm.sub(n.clone().multiplyScalar(rm.dot(n)));
            pole = perp.lengthSq() > 1e-8 ? v2a(perp) : chain.defaultPole;
        } else {
            pole = chain.defaultPole;
        }

        const res = solveTwoBone({
            root: v2a(rootW), target: v2a(targetWorld), lenA, lenB, pole,
        });
        const midTarget = new THREE.Vector3(res.mid[0], res.mid[1], res.mid[2]);
        const endTarget = new THREE.Vector3(res.endClamped[0], res.endClamped[1], res.endClamped[2]);

        // 1) Rotate root bone so its child (mid) moves toward midTarget.
        this._aimBoneChildTo(rootB, midB, rootW, midTarget);

        // refresh world matrices before reading post-rotation positions
        rootB.updateWorldMatrix(true, true);
        const midW1 = midB.getWorldPosition(new THREE.Vector3());
        const endW1 = endB.getWorldPosition(new THREE.Vector3());

        // 2) Rotate mid bone so its child (end) moves toward endTarget.
        this._aimBoneChildTo(midB, endB, midW1, endTarget);
        midB.updateWorldMatrix(true, true);
    }

    /**
     * Rotate `bone` (whose origin world position is boneW) so that its descendant
     * joint `childB` aims from its current world direction toward childTargetW.
     * Axis-agnostic: uses the minimal rotation between the two world directions.
     */
    _aimBoneChildTo(bone, childB, boneW, childTargetW) {
        const childW = childB.getWorldPosition(new THREE.Vector3());
        const cur = childW.clone().sub(boneW);
        const des = childTargetW.clone().sub(boneW);
        if (cur.lengthSq() < 1e-12 || des.lengthSq() < 1e-12) return;
        cur.normalize(); des.normalize();

        const qWorldDelta = new THREE.Quaternion().setFromUnitVectors(cur, des);

        // newWorldQuat = qWorldDelta * currentWorldQuat
        const curWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
        const newWorldQ = qWorldDelta.clone().multiply(curWorldQ);

        // convert to local: parentWorldQ^-1 * newWorldQ
        const parentWorldQ = bone.parent
            ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
            : new THREE.Quaternion();
        const localQ = parentWorldQ.invert().multiply(newWorldQ);
        bone.quaternion.copy(localQ);
        bone.updateMatrix();
    }

    /** Effector world position for a chain (for placing/reading handles). */
    effectorWorld(chainId, out = new THREE.Vector3()) {
        const chain = this._chainById.get(chainId);
        const endB = chain && this._bones.get(chain.end);
        if (!endB) return out.set(0, 0, 0);
        return endB.getWorldPosition(out);
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/js/ik-controller.test.js`
Expected: PASS (5 tests). If the "moves the effector" test is slightly over tolerance, the two-pass aim may need a second iteration — see note below before changing tolerances.

> **Implementer note:** A single root-then-mid pass reaches the target exactly in the ideal case because the solver already guarantees `|mid-root|=lenA` and `|end-mid|=lenB`. If a test shows residual error > 1e-2, do NOT loosen the assertion — instead run the two aim steps twice (loop the `solve` body's steps 1–2 a second time). Keep the loop count fixed (≤2), no convergence heuristics.

- [ ] **Step 5: Commit**

```bash
git add static/src/ik-controller.js tests/js/ik-controller.test.js
git commit -m "feat(ik): IK controller applies solver to live bone chain"
```

---

## Task 4: IK target handles in the renderer

**Files:**
- Modify: `static/src/mannequin-renderer.js`
- Test: `tests/js/ik-handles.test.js`

Add four small spheres (one per chain) to the scene, hidden by default. They are `userData.isIKHandle = true` and carry `userData.chainId`. The renderer exposes methods to show/hide them and to sync their positions to the current effector positions.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/js/ik-handles.test.js
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';

// We test the handle helper in isolation against a minimal stub that mimics the
// renderer's scene + bones, to avoid constructing a full WebGL renderer.
import { createIKHandles, setIKHandlesVisible, syncIKHandles } from '../../static/src/mannequin-renderer.js';

function stub() {
    const scene = new THREE.Scene();
    const bones = new Map();
    for (const [name, pos] of [
        ['hand_L', [0.5, 1.2, 0]], ['hand_R', [-0.5, 1.2, 0]],
        ['foot_L', [0.2, 0.0, 0]], ['foot_R', [-0.2, 0.0, 0]],
    ]) {
        const b = new THREE.Object3D(); b.position.set(...pos); scene.add(b);
        bones.set(name, b);
    }
    scene.updateMatrixWorld(true);
    return { scene, bones };
}

describe('IK handles', () => {
    it('creates four hidden handles tagged with chainId', () => {
        const { scene } = stub();
        const handles = createIKHandles(scene);
        expect(handles.size).toBe(4);
        for (const h of handles.values()) {
            expect(h.userData.isIKHandle).toBe(true);
            expect(h.visible).toBe(false);
        }
        expect([...handles.keys()].sort()).toEqual(['arm_L', 'arm_R', 'leg_L', 'leg_R']);
    });

    it('syncIKHandles positions handles at effector world positions', () => {
        const { scene, bones } = stub();
        const handles = createIKHandles(scene);
        syncIKHandles(handles, bones);
        const armL = handles.get('arm_L');
        expect(armL.position.x).toBeCloseTo(0.5, 5);
        expect(armL.position.y).toBeCloseTo(1.2, 5);
    });

    it('setIKHandlesVisible toggles visibility', () => {
        const { scene } = stub();
        const handles = createIKHandles(scene);
        setIKHandlesVisible(handles, true);
        expect(handles.get('leg_R').visible).toBe(true);
        setIKHandlesVisible(handles, false);
        expect(handles.get('leg_R').visible).toBe(false);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/js/ik-handles.test.js`
Expected: FAIL — `createIKHandles is not a function`.

- [ ] **Step 3: Implement the handle helpers**

Add near the top-level exports of `static/src/mannequin-renderer.js` (after the imports; these are module-level pure helpers so they are unit-testable without a WebGL context):

```javascript
// ── IK target handles ───────────────────────────────────────────────────────
// Map chainId → effector bone name (kept local to avoid importing ik-controller
// into the renderer; must stay in sync with IK_CHAINS in ik-controller.js).
const IK_HANDLE_EFFECTORS = {
    arm_L: 'hand_L', arm_R: 'hand_R', leg_L: 'foot_L', leg_R: 'foot_R',
};
const IK_HANDLE_RADIUS = 0.03;
const IK_HANDLE_COLOR  = 0x22d3ee; // cyan

export function createIKHandles(scene) {
    const handles = new Map();
    for (const chainId of Object.keys(IK_HANDLE_EFFECTORS)) {
        const geo = new THREE.SphereGeometry(IK_HANDLE_RADIUS, 16, 12);
        const mat = new THREE.MeshBasicMaterial({ color: IK_HANDLE_COLOR, depthTest: false, transparent: true, opacity: 0.85 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 999;
        mesh.visible = false;
        mesh.userData.isIKHandle = true;
        mesh.userData.chainId = chainId;
        scene.add(mesh);
        handles.set(chainId, mesh);
    }
    return handles;
}

export function setIKHandlesVisible(handles, visible) {
    for (const h of handles.values()) h.visible = !!visible;
}

/** Position each handle at its chain's effector world position. */
export function syncIKHandles(handles, bones) {
    const tmp = new THREE.Vector3();
    for (const [chainId, mesh] of handles) {
        const bone = bones.get(IK_HANDLE_EFFECTORS[chainId]);
        if (!bone) continue;
        bone.getWorldPosition(tmp);
        mesh.position.copy(tmp);
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/js/ik-handles.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add static/src/mannequin-renderer.js tests/js/ik-handles.test.js
git commit -m "feat(ik): IK target handle helpers in renderer"
```

---

## Task 5: IK mode in the editor (toggle, picking, drag → solve → commit)

**Files:**
- Modify: `static/src/mannequin-editor.js`
- Test: `tests/js/mannequin-editor-commands.test.js` (append a light state test)

Wire everything: create handles on construction, add `setIKMode`, route handle clicks to attach the gizmo in translate mode, drive the controller on drag, commit `IKPoseCommand` on drag-end, and keep handles synced each frame.

- [ ] **Step 1: Add imports and IK state (no test yet — wiring step)**

At the top of `static/src/mannequin-editor.js`, add to the existing imports:

```javascript
import { IKController } from './ik-controller.js';
import { createIKHandles, setIKHandlesVisible, syncIKHandles } from './mannequin-renderer.js';
import { IKPoseCommand } from './commands.js'; // add IKPoseCommand to the existing commands import instead of a new line if commands are imported as a group
```

In the constructor (after `this._transform` is set up and `renderer.scene.add(this._transform)`), add:

```javascript
// ── IK mode ───────────────────────────────────────────────────────────────
this._ikMode        = false;
this._ikController  = new IKController({ bones: renderer.bones });
this._ikHandles     = createIKHandles(renderer.scene);
this._ikActiveChain = null;          // chainId currently driven by the gizmo
this._poseBeforeIK  = null;          // full pose snapshot for undo
```

- [ ] **Step 2: Write the failing test for `setIKMode`**

Append to `tests/js/mannequin-editor-commands.test.js` (match how that file constructs an editor + fake renderer; if it uses a real renderer stub with a `bones` Map and a `scene`, reuse it — otherwise add a minimal `THREE.Scene` + empty `bones` Map to the stub):

```javascript
// IK mode toggle
it('setIKMode toggles flag and handle visibility', () => {
    // `editor` and `renderer` are created by this file's existing setup
    expect(editor._ikMode).toBe(false);
    editor.setIKMode(true);
    expect(editor._ikMode).toBe(true);
    for (const h of editor._ikHandles.values()) expect(h.visible).toBe(true);
    editor.setIKMode(false);
    expect(editor._ikMode).toBe(false);
    for (const h of editor._ikHandles.values()) expect(h.visible).toBe(false);
});
```

> If the existing setup in this file does not expose `editor`/`renderer` at describe scope, add a small dedicated `describe('IK mode', ...)` block that builds a renderer stub with `{ scene: new THREE.Scene(), bones: new Map(), camera: new THREE.PerspectiveCamera(), markDirty(){} }` and a canvas stub, then constructs `new MannequinEditor(...)` the same way other blocks do.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/js/mannequin-editor-commands.test.js`
Expected: FAIL — `editor.setIKMode is not a function`.

- [ ] **Step 4: Implement `setIKMode` and handle sync**

Add these methods to the `MannequinEditor` class (near `setGizmoMode`):

```javascript
setIKMode(on) {
    this._ikMode = !!on;
    if (!this._ikMode) {
        // leaving IK: detach if a handle was selected, clear active chain
        if (this._ikActiveChain) { this._transform.detach(); this._ikActiveChain = null; }
    } else {
        this._deselect();                       // drop any FK bone/prop selection
        syncIKHandles(this._ikHandles, this._renderer.bones);
    }
    setIKHandlesVisible(this._ikHandles, this._ikMode);
    this._renderer.markDirty();
}

get ikMode() { return this._ikMode; }
```

Extend `update()` so handles track the pose when IK is on and nothing is being dragged:

```javascript
update() {
    this._orbit.update();
    if (this._ikMode && !this._ikActiveChain) {
        syncIKHandles(this._ikHandles, this._renderer.bones);
    }
}
```

- [ ] **Step 5: Route handle clicks in `_onCanvasClick`**

At the very start of `_onCanvasClick(e)`, after computing `this._mouse` and `this._raycaster.setFromCamera(...)`, add an IK-handle pass that takes priority when in IK mode:

```javascript
if (this._ikMode) {
    const handleMeshes = [...this._ikHandles.values()];
    const ikHits = this._raycaster.intersectObjects(handleMeshes, false);
    if (ikHits.length > 0) {
        const handle = ikHits[0].object;
        this._deselect();
        this._ikActiveChain = handle.userData.chainId;
        this._transform.setMode('translate');
        this._transform.setSpace('world');
        this._transform.attach(handle);
        this._renderer.markDirty();
        return;
    }
}
```

> Place this block *before* the existing `const pickables = [];` traversal so a handle hit wins over a bone hit. The early `return` skips FK selection. (The raycaster is already set from the camera earlier in the method — reuse it; do not call `setFromCamera` twice.)

- [ ] **Step 6: Drive the controller during drag and commit on drag-end**

In the constructor's `mouseDown` listener, add an IK snapshot branch (alongside the bone/prop branches):

```javascript
if (this._ikActiveChain) {
    const pose = this._store?.getState().pose ?? {};
    this._poseBeforeIK = { ...pose };
}
```

Add a dedicated `objectChange` listener that solves while the handle moves (add after the existing `change` listener registration):

```javascript
this._transform.addEventListener('objectChange', () => {
    if (!this._ikActiveChain) return;
    const handle = this._ikHandles.get(this._ikActiveChain);
    if (!handle) return;
    const target = handle.getWorldPosition(new THREE.Vector3());
    this._ikController.solve(this._ikActiveChain, target);
    this._syncPoseToStore();    // keep store in step with renderer bones
    this._renderer.markDirty();
});
```

In the `dragging-changed` listener, inside the `if (!e.value) { ... }` block (drag ended), add an IK commit branch:

```javascript
// IK drag ended
if (this._ikActiveChain && this._poseBeforeIK && this._store) {
    const nextPose = this._store.getState().pose;   // already synced during objectChange
    const prev = this._poseBeforeIK;
    const changed = JSON.stringify(prev) !== JSON.stringify(nextPose);
    if (changed) {
        // setPose already applied via _syncPoseToStore during drag; record for undo
        this._history.execute(new IKPoseCommand(prev, nextPose), this._store);
    }
    this._poseBeforeIK = null;
}
```

> **Important ordering subtlety:** `_syncPoseToStore()` during the drag has *already* mutated the store to the new pose. `IKPoseCommand.execute` will call `setPose(next)` again — that is idempotent (same value) and keeps the renderer subscription consistent, so it is safe. Do not try to "skip execute"; the command must be on the undo stack with both snapshots.

- [ ] **Step 7: Run the suite**

Run: `npx vitest run tests/js/mannequin-editor-commands.test.js`
Expected: PASS (existing + new IK-mode test).

- [ ] **Step 8: Commit**

```bash
git add static/src/mannequin-editor.js tests/js/mannequin-editor-commands.test.js
git commit -m "feat(ik): IK mode — handle picking, drag-solve, undoable commit"
```

---

## Task 6: Toolbar button + main.js wiring

**Files:**
- Modify: `static/index.html`
- Modify: `static/src/main.js`

- [ ] **Step 1: Add the toolbar button and CSS**

In `static/index.html`, add a CSS rule next to the `#btn-hands` rules (around line 26–29):

```css
#btn-ik { background: #333; color: #aaa; }
#btn-ik.active { background: #155e63; color: #cff; }
```

Add the button right after `#btn-objects` (line 131):

```html
  <button id="btn-ik" title="Interactive IK — drag wrist/ankle handles">IK</button>
```

- [ ] **Step 2: Wire the button in main.js**

In `static/src/main.js`, near the other toolbar wiring (e.g. after the `#btn-hands`/`#btn-objects` handlers), add:

```javascript
// ── IK toggle ────────────────────────────────────────────────────────────────
const btnIK = document.getElementById('btn-ik');
btnIK?.addEventListener('click', () => {
    const next = !editor.ikMode;
    editor.setIKMode(next);
    btnIK.classList.toggle('active', next);
});
```

- [ ] **Step 3: Verify nothing regressed**

Run: `npm test`
Expected: all test files pass (no new failures).

- [ ] **Step 4: Commit**

```bash
git add static/index.html static/src/main.js
git commit -m "feat(ik): IK toolbar toggle + wiring"
```

- [ ] **Step 5: Manual browser verification (cannot be unit-tested — WebGL)**

Serve `static/` locally (or use the live Pages site after deploy) and confirm:
- Clicking **IK** highlights the button and shows four cyan handles at both wrists and both ankles.
- Dragging a wrist handle bends the elbow naturally and the wrist follows the handle; dragging an ankle bends the knee.
- Dragging a handle far away straightens the limb toward it; the torso/pelvis does not move.
- The hand/foot keeps its own orientation while the limb solves.
- Ctrl+Z undoes the whole IK drag in one step; Ctrl+Shift+Z redoes it.
- Turning IK off hides the handles; normal FK click-select and per-bone rotation still work.
- Handles re-track the limbs after an FK edit when IK is toggled back on.

---

## Self-Review (done by plan author)

**Spec coverage:**
- Four chains (arms+legs), two bones each, shoulder/pelvis fixed → Task 3 `IK_CHAINS`. ✓
- IK toolbar toggle + draggable handles → Tasks 4, 5, 6. ✓
- Analytic two-bone solver + auto-pole → Tasks 1, 3. ✓
- Undo/redo via drag-end command → Tasks 2, 5. ✓
- End-effector orientation left alone → Task 3 (test asserts hand quat unchanged). ✓
- Out-of-reach straighten, no body move → Tasks 1, 3 (tests). ✓
- No serialization changes → nothing touches scene JSON / store schema. ✓

**Type consistency:** chain ids (`arm_L/arm_R/leg_L/leg_R`) identical across `ik-controller.js`, handle helpers (`IK_HANDLE_EFFECTORS`), and tests. Solver vectors are `[x,y,z]` arrays everywhere; controller converts Three `Vector3` ↔ arrays via `v2a`. `IKPoseCommand(prevPose, nextPose)` signature matches Task 2 and Task 5 usage.

**Placeholder scan:** no TBD/TODO; every code step has complete code.
