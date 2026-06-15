# Predefined Pose Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 13 built-in one-click body poses that set bone rotations only (gender/proportions/props untouched; attached props follow).

**Architecture:** A pure data+conversion module (`pose-presets.js`) holds presets as Euler-degree angle maps and converts them to a full bone-quaternion pose. The editor gains `applyPosePreset(id)` that applies the pose imperatively to renderer bones and commits an undoable `PosePresetCommand` (mirrors how `applyFingerPreset` works). The Poses panel renders a "Presets" section (Basic / Combat) above the saved-pose list.

**Tech Stack:** Vanilla JS ES modules, vendored Three.js (`static/lib/three.module.js`), Vitest + jsdom. No build step.

---

## Background for the implementer

- **Pose shape:** the store pose is `{ [boneName]: { x, y, z, w } }` (quaternions). `BONE_NAMES` (48 bones: body + finger phalanges) is exported from `static/src/mannequin-model.js`.
- **How poses apply to the 3D view:** the renderer does NOT apply `pose` via store subscription — bones are mutated imperatively. So `applyPosePreset` must (a) set `bone.quaternion` on each renderer bone, AND (b) commit a command so undo works. `undo()`/`redo()` in the editor call `_applyPoseFromStore()` which re-applies the store pose to bones. This is exactly the pattern `applyFingerPreset` (mannequin-editor.js ~line 290) already uses with `ResetPoseCommand`.
- **Props follow automatically:** props are children of bone `Object3D`s, so changing bone quaternions moves attached props. The store `props` array is not touched by pose application.
- **Euler convention:** `generateRandomPose` builds quaternions with `new THREE.Euler(xRad, yRad, zRad, 'XYZ')`. Use the SAME order `'XYZ'` and convert degrees→radians (`deg * Math.PI / 180`).
- **Panel:** `static/src/panels/pose-library.js` exports `PoseLibrary`, constructed in main.js as `new PoseLibrary(editor, renderer)`. Its `mount(container)` builds a header + a scrollable `_listEl` of saved poses. The class already holds `this._editor`. No main.js change is needed (the panel imports presets itself).
- **THREE import in modules:** `import * as THREE from '../lib/three.module.js';` (from `static/src/`). Tests import `import * as THREE from '../../static/lib/three.module.js';`.

The preset **angle values below are mechanically reasonable first-pass values** authored from joint angles; their visual naturalness will be tuned later in the browser with the user. The unit tests validate STRUCTURE and CONVERSION MATH only — never aesthetic correctness — so the exact angle numbers do not affect whether tests pass.

---

## File Structure

- **Create `static/src/pose-presets.js`** — `POSE_PRESETS` data, `presetToPose(preset)`, `presetById(id)`.
- **Modify `static/src/commands.js`** — add `PosePresetCommand`.
- **Modify `static/src/mannequin-editor.js`** — add `applyPosePreset(id)`.
- **Modify `static/src/panels/pose-library.js`** — render the "Presets" section.
- **Create tests:** `tests/js/pose-presets.test.js`, extend `tests/js/commands.test.js`, extend `tests/js/mannequin-editor-commands.test.js`, `tests/js/pose-presets-panel.test.js`.

Baseline: `npm test` (all passing) before starting.

---

## Task 1: Pose preset data + conversion (`pose-presets.js`)

**Files:**
- Create: `static/src/pose-presets.js`
- Test: `tests/js/pose-presets.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/js/pose-presets.test.js
import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { POSE_PRESETS, presetToPose, presetById } from '../../static/src/pose-presets.js';
import { BONE_NAMES } from '../../static/src/mannequin-model.js';

describe('POSE_PRESETS data', () => {
    it('has 13 presets with unique ids', () => {
        expect(POSE_PRESETS).toHaveLength(13);
        const ids = POSE_PRESETS.map(p => p.id);
        expect(new Set(ids).size).toBe(13);
    });

    it('every preset has a name and a basic|combat group', () => {
        for (const p of POSE_PRESETS) {
            expect(typeof p.name).toBe('string');
            expect(p.name.length).toBeGreaterThan(0);
            expect(['basic', 'combat']).toContain(p.group);
        }
    });

    it('every angle entry targets a real bone and is a 3-number array', () => {
        const valid = new Set(BONE_NAMES);
        for (const p of POSE_PRESETS) {
            for (const [bone, angle] of Object.entries(p.angles)) {
                expect(valid.has(bone)).toBe(true);
                expect(Array.isArray(angle)).toBe(true);
                expect(angle).toHaveLength(3);
                for (const a of angle) expect(typeof a).toBe('number');
            }
        }
    });

    it('includes the 5 combat poses by id', () => {
        const ids = POSE_PRESETS.map(p => p.id);
        for (const id of ['rifle', 'pistol', 'saber', 'sword_shield', 'rapier']) {
            expect(ids).toContain(id);
        }
    });
});

describe('presetToPose', () => {
    it('returns a quaternion for every bone in BONE_NAMES', () => {
        const pose = presetToPose(POSE_PRESETS[0]);
        for (const name of BONE_NAMES) {
            expect(pose[name]).toBeDefined();
            const q = pose[name];
            expect(typeof q.x).toBe('number');
            expect(typeof q.w).toBe('number');
        }
    });

    it('unlisted bones are identity', () => {
        // t_pose lists arms but not e.g. head → head must be identity
        const tpose = presetById('t_pose');
        const pose = presetToPose(tpose);
        expect(pose.head).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    });

    it('listed bone matches the quaternion from its Euler degrees (XYZ)', () => {
        const preset = { id: 'x', name: 'x', group: 'basic', angles: { upper_arm_L: [0, 0, 90] } };
        const pose = presetToPose(preset);
        const expected = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, 0, 90 * Math.PI / 180, 'XYZ'));
        expect(pose.upper_arm_L.x).toBeCloseTo(expected.x, 6);
        expect(pose.upper_arm_L.y).toBeCloseTo(expected.y, 6);
        expect(pose.upper_arm_L.z).toBeCloseTo(expected.z, 6);
        expect(pose.upper_arm_L.w).toBeCloseTo(expected.w, 6);
    });
});

describe('presetById', () => {
    it('returns the preset or null', () => {
        expect(presetById('t_pose').id).toBe('t_pose');
        expect(presetById('nope')).toBeNull();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/js/pose-presets.test.js`
Expected: FAIL — cannot resolve `pose-presets.js`.

- [ ] **Step 3: Implement the module**

```javascript
// static/src/pose-presets.js
// Built-in body poses. Angles are LOCAL Euler degrees (order 'XYZ') applied on top of
// the GLB A-pose rest, matching generateRandomPose's convention. Only the bones a pose
// cares about are listed; presetToPose fills every other bone with identity so a preset
// is deterministic regardless of the prior pose. Finger bones are left neutral (the user
// adds a grip via the Hands finger presets).
//
// NOTE: these angle values are a mechanically-reasonable first pass and are expected to be
// tuned visually in the browser. Combat / sitting / walking especially.
import * as THREE from '../lib/three.module.js';
import { BONE_NAMES } from './mannequin-model.js';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export const POSE_PRESETS = [
    // ── Basic ────────────────────────────────────────────────────────────────
    { id: 't_pose', name: 'T-poza', group: 'basic', angles: {
        upper_arm_L: [0, 0, 55], upper_arm_R: [0, 0, -55],
    } },
    { id: 'arms_up', name: 'Ręce w górze', group: 'basic', angles: {
        upper_arm_L: [0, 0, 160], upper_arm_R: [0, 0, -160],
    } },
    { id: 'hands_on_hips', name: 'Ręce na biodrach', group: 'basic', angles: {
        upper_arm_L: [0, -10, 25], forearm_L: [85, 0, 0],
        upper_arm_R: [0, 10, -25], forearm_R: [85, 0, 0],
    } },
    { id: 'arms_crossed', name: 'Ręce skrzyżowane', group: 'basic', angles: {
        upper_arm_L: [30, 0, 18], forearm_L: [100, 0, 0],
        upper_arm_R: [30, 0, -18], forearm_R: [100, 0, 0],
    } },
    { id: 'contrapposto', name: 'Kontrapost', group: 'basic', angles: {
        pelvis: [0, 0, 8], thigh_L: [2, 0, -6], thigh_R: [-4, 0, 4],
        upper_arm_L: [0, 0, 8], upper_arm_R: [0, 0, -10],
    } },
    { id: 'waving', name: 'Machanie', group: 'basic', angles: {
        upper_arm_R: [0, 0, -150], forearm_R: [55, 0, 0],
        upper_arm_L: [0, 0, 10],
    } },
    { id: 'sitting', name: 'Siad', group: 'basic', angles: {
        thigh_L: [90, 0, 4], shin_L: [-95, 0, 0],
        thigh_R: [90, 0, -4], shin_R: [-95, 0, 0],
    } },
    { id: 'walking', name: 'Krok / marsz', group: 'basic', angles: {
        thigh_L: [28, 0, 0], shin_L: [-15, 0, 0],
        thigh_R: [-22, 0, 0], shin_R: [-30, 0, 0],
        upper_arm_L: [-25, 0, 0], upper_arm_R: [25, 0, 0],
    } },
    // ── Combat (body only — weapon/shield attached as a prop) ──────────────────
    { id: 'rifle', name: 'Strzelecka — karabin', group: 'combat', angles: {
        upper_arm_L: [70, 0, 12], forearm_L: [45, 0, 0],
        upper_arm_R: [62, 0, -12], forearm_R: [65, 0, 0],
        thigh_R: [-12, 0, 0], shin_R: [-10, 0, 0],
    } },
    { id: 'pistol', name: 'Strzelecka — pistolet', group: 'combat', angles: {
        upper_arm_L: [82, 0, 6], forearm_L: [10, 0, 0],
        upper_arm_R: [82, 0, -6], forearm_R: [10, 0, 0],
    } },
    { id: 'saber', name: 'Szermiercza — szabla', group: 'combat', angles: {
        upper_arm_R: [80, 0, -6], forearm_R: [10, 0, 0],
        upper_arm_L: [-30, 0, 14], forearm_L: [30, 0, 0],
        thigh_R: [22, 0, 0], shin_R: [-18, 0, 0], thigh_L: [-10, 0, 0],
    } },
    { id: 'sword_shield', name: 'Szermiercza — miecz + tarcza', group: 'combat', angles: {
        upper_arm_L: [72, 0, 12], forearm_L: [50, 0, 0],
        upper_arm_R: [70, 0, -12], forearm_R: [55, 0, 0],
        thigh_L: [22, 0, 0], shin_L: [-18, 0, 0], thigh_R: [-10, 0, 0],
    } },
    { id: 'rapier', name: 'Szermiercza — rapier (en-garde)', group: 'combat', angles: {
        upper_arm_R: [80, 0, -6], forearm_R: [8, 0, 0],
        upper_arm_L: [-40, 0, 40], forearm_L: [70, 0, 0],
        thigh_R: [22, 0, 0], shin_R: [-18, 0, 0], thigh_L: [-10, 0, 0],
    } },
];

const _byId = new Map(POSE_PRESETS.map(p => [p.id, p]));

export function presetById(id) {
    return _byId.get(id) ?? null;
}

/**
 * Convert a preset to a full pose map { boneName: {x,y,z,w} } covering every BONE_NAMES
 * entry. Listed bones get the quaternion from their Euler degrees ('XYZ'); all others
 * get identity.
 */
export function presetToPose(preset) {
    const pose = {};
    const euler = new THREE.Euler();
    const quat  = new THREE.Quaternion();
    const DEG   = Math.PI / 180;
    const angles = preset?.angles ?? {};
    for (const name of BONE_NAMES) {
        const a = angles[name];
        if (a) {
            euler.set(a[0] * DEG, a[1] * DEG, a[2] * DEG, 'XYZ');
            quat.setFromEuler(euler);
            pose[name] = { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
        } else {
            pose[name] = { ...IDENTITY };
        }
    }
    return pose;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/js/pose-presets.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add static/src/pose-presets.js tests/js/pose-presets.test.js
git commit -m "feat(poses): pose preset data + presetToPose conversion"
```

---

## Task 2: `PosePresetCommand`

**Files:**
- Modify: `static/src/commands.js` (append after `RandomPoseCommand`)
- Test: `tests/js/commands.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/js/commands.test.js`:

```javascript
import { PosePresetCommand } from '../../static/src/commands.js';

describe('PosePresetCommand', () => {
    function makeStore(initialPose) {
        let pose = { ...initialPose };
        return { setPose: (p) => { pose = { ...p }; }, getPose: () => pose };
    }

    it('execute sets next pose, undo restores prev pose', () => {
        const prev = { upper_arm_L: { x: 0, y: 0, z: 0, w: 1 } };
        const next = { upper_arm_L: { x: 0, y: 0, z: 0.7, w: 0.7 } };
        const store = makeStore(prev);
        const cmd = new PosePresetCommand(prev, next);
        cmd.execute(store);
        expect(store.getPose()).toEqual(next);
        cmd.undo(store);
        expect(store.getPose()).toEqual(prev);
    });

    it('description names the preset action', () => {
        expect(new PosePresetCommand({}, {}).description).toBe('Apply pose preset');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/js/commands.test.js`
Expected: FAIL — `PosePresetCommand is not a constructor`.

- [ ] **Step 3: Implement the command**

Append to `static/src/commands.js`:

```javascript
/**
 * Apply a built-in pose preset — snapshots the full pose before/after so the whole
 * change undoes/redoes as one step. Mirrors RandomPoseCommand.
 */
export class PosePresetCommand extends Command {
    constructor(prevPose, nextPose) {
        super();
        this._prev = { ...prevPose };
        this._next = { ...nextPose };
    }

    execute(store) { store.setPose(this._next); }
    undo(store)    { store.setPose(this._prev); }
    get description() { return 'Apply pose preset'; }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/js/commands.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add static/src/commands.js tests/js/commands.test.js
git commit -m "feat(poses): PosePresetCommand for undoable preset apply"
```

---

## Task 3: `applyPosePreset(id)` in the editor

**Files:**
- Modify: `static/src/mannequin-editor.js`
- Test: `tests/js/mannequin-editor-commands.test.js` (append)

- [ ] **Step 1: Add imports**

In `static/src/mannequin-editor.js`:
- Add `PosePresetCommand` to the existing grouped import from `./commands.js`.
- Add `import { presetById, presetToPose } from './pose-presets.js';`

- [ ] **Step 2: Write the failing test**

Append to `tests/js/mannequin-editor-commands.test.js`. Reuse the file's existing editor + store + renderer-stub setup (the same one used by the finger-preset / IK tests). The renderer stub must have a `bones` Map; ensure it contains at least `upper_arm_L` (a `THREE.Object3D` or any object with a `.quaternion` that has `.set`). If the existing stub's bones lack quaternions, use `new THREE.Object3D()` entries.

```javascript
it('applyPosePreset commits a PosePresetCommand and leaves props/gender/proportions untouched', () => {
    // `editor` and `store` come from this file's existing setup
    const before = store.getState();
    const propsBefore = JSON.stringify(before.props ?? []);
    const genderBefore = before.gender;
    const propsBeforeProportions = JSON.stringify(before.proportions);

    editor.applyPosePreset('t_pose');

    const after = store.getState();
    // pose changed (t_pose sets upper_arm_L away from identity)
    expect(after.pose.upper_arm_L).not.toEqual({ x: 0, y: 0, z: 0, w: 1 });
    // undoable in one step
    expect(editor.history.canUndo).toBe(true);
    // untouched dimensions
    expect(JSON.stringify(after.props ?? [])).toBe(propsBefore);
    expect(after.gender).toBe(genderBefore);
    expect(JSON.stringify(after.proportions)).toBe(propsBeforeProportions);
});

it('applyPosePreset with unknown id is a no-op', () => {
    const undoBefore = editor.history.canUndo;
    editor.applyPosePreset('does_not_exist');
    expect(editor.history.canUndo).toBe(undoBefore);
});
```

> If the existing setup does not expose `store`/`editor` at describe scope, add a dedicated `describe('applyPosePreset', ...)` block that builds the same editor/store/renderer stub the other blocks in this file use (a real `AppStore` from `app-store.js` with a `defaultState()`, and a renderer stub exposing `bones` Map, `scene`, `camera`, `markDirty()`). Match the existing pattern in the file — do not invent a new harness.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/js/mannequin-editor-commands.test.js`
Expected: FAIL — `editor.applyPosePreset is not a function`.

- [ ] **Step 4: Implement `applyPosePreset`**

Add this method to the `MannequinEditor` class, right after `applyFingerPreset` (mirror its structure):

```javascript
/**
 * Apply a built-in pose preset by id. Sets bone rotations only — gender, proportions,
 * and props are untouched (attached props follow because they are bone children).
 * Commits a PosePresetCommand so undo/redo works.
 */
applyPosePreset(id) {
    const preset = presetById(id);
    if (!preset) return;
    const prevPose = this._store?.getState().pose ?? {};
    const nextPose = presetToPose(preset);
    for (const [name, q] of Object.entries(nextPose)) {
        const bone = this._renderer.bones.get(name);
        if (bone) bone.quaternion.set(q.x, q.y, q.z, q.w);
    }
    if (this._store) {
        this._history.execute(new PosePresetCommand(prevPose, nextPose), this._store);
    }
    this._renderer.markDirty();
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/js/mannequin-editor-commands.test.js`
Expected: PASS (existing + 2 new).
Then full suite: `npx vitest run` → all pass.

- [ ] **Step 6: Commit**

```bash
git add static/src/mannequin-editor.js tests/js/mannequin-editor-commands.test.js
git commit -m "feat(poses): applyPosePreset — bones-only, undoable"
```

---

## Task 4: "Presets" section in the Poses panel

**Files:**
- Modify: `static/src/panels/pose-library.js`
- Test: `tests/js/pose-presets-panel.test.js`

Add a non-deletable "Presets" section ABOVE the saved-pose list, grouped Basic / Combat, each row clicking `this._editor.applyPosePreset(id)`.

- [ ] **Step 1: Add the import**

At the top of `static/src/panels/pose-library.js`:
```javascript
import { POSE_PRESETS } from '../pose-presets.js';
```

- [ ] **Step 2: Write the failing test**

```javascript
// tests/js/pose-presets-panel.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoseLibrary } from '../../static/src/panels/pose-library.js';
import { POSE_PRESETS } from '../../static/src/pose-presets.js';

function setup() {
    document.body.innerHTML = '';
    const editor = { applyPosePreset: vi.fn(), getSceneData: () => ({}) };
    const renderer = { _renderer: { domElement: { toDataURL: () => '' } } };
    const lib = new PoseLibrary(editor, renderer);
    lib.mount(document.body);
    return { lib, editor };
}

describe('Poses panel — presets section', () => {
    beforeEach(() => { localStorage.clear(); });

    it('renders one row per built-in preset', () => {
        setup();
        const rows = document.querySelectorAll('[data-preset-id]');
        expect(rows.length).toBe(POSE_PRESETS.length);
    });

    it('clicking a preset row calls applyPosePreset with its id', () => {
        const { editor } = setup();
        const row = document.querySelector('[data-preset-id="t_pose"]');
        expect(row).toBeTruthy();
        row.click();
        expect(editor.applyPosePreset).toHaveBeenCalledWith('t_pose');
    });

    it('shows Basic and Combat group labels', () => {
        setup();
        const text = document.body.textContent;
        expect(text).toContain('Basic');
        expect(text).toContain('Combat');
    });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/js/pose-presets-panel.test.js`
Expected: FAIL — no `[data-preset-id]` rows.

- [ ] **Step 4: Implement the presets section**

In `static/src/panels/pose-library.js`, add a private method that builds the presets block, and call it from `mount()` so the block is inserted between the `header` and `this._listEl` (i.e. `this._panel.appendChild(presetsEl)` after `appendChild(header)` and before `appendChild(this._listEl)`).

Add the method to the class:

```javascript
_buildPresetsSection() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'flex-shrink:0;border-bottom:1px solid #444;max-height:40%;overflow-y:auto;padding:4px;';

    const groups = [
        { key: 'basic',  label: 'Basic'  },
        { key: 'combat', label: 'Combat' },
    ];
    for (const g of groups) {
        const presets = POSE_PRESETS.filter(p => p.group === g.key);
        if (!presets.length) continue;

        const gLabel = document.createElement('div');
        gLabel.textContent = g.label;
        gLabel.style.cssText = 'color:#888;font-size:10px;text-transform:uppercase;letter-spacing:1px;padding:4px 4px 2px;';
        wrap.appendChild(gLabel);

        for (const p of presets) {
            const row = document.createElement('button');
            row.dataset.presetId = p.id;
            row.textContent = p.name;
            row.style.cssText = 'display:block;width:100%;text-align:left;padding:5px 6px;margin:1px 0;background:#2b2b2b;color:#ddd;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
            row.onmouseenter = () => { row.style.background = '#3a3a3a'; };
            row.onmouseleave = () => { row.style.background = '#2b2b2b'; };
            row.onclick = () => this._editor.applyPosePreset(p.id);
            wrap.appendChild(row);
        }
    }
    return wrap;
}
```

Then in `mount()`, change the assembly so the presets section is added before the saved list. Locate this existing block near the end of `mount()`:

```javascript
        this._panel.appendChild(header);
        this._panel.appendChild(this._listEl);
        container.appendChild(this._panel);
        this._renderList();
```

and change it to:

```javascript
        this._panel.appendChild(header);
        this._panel.appendChild(this._buildPresetsSection());
        this._panel.appendChild(this._listEl);
        container.appendChild(this._panel);
        this._renderList();
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/js/pose-presets-panel.test.js`
Expected: PASS (3 tests).
Then full suite: `npx vitest run` → all pass.

- [ ] **Step 6: Commit**

```bash
git add static/src/panels/pose-library.js tests/js/pose-presets-panel.test.js
git commit -m "feat(poses): Presets section (Basic/Combat) in Poses panel"
```

- [ ] **Step 7: Manual browser verification + angle tuning (cannot be unit-tested — WebGL)**

Serve `static/` locally (or use the live Pages site after deploy). Open the Poses panel and click each preset:
- Body assumes the expected stance; the gizmo/selection is unaffected.
- Attached props (if any) follow the new bone orientations.
- Undo (Ctrl+Z) restores the previous pose in one step; redo re-applies.
- Gender/proportions/saved-props are unchanged after applying a preset.
- **Tune angles:** for any pose that looks off (especially combat / sitting / walking), adjust the degree values in `pose-presets.js` and re-check. This is the expected iterative step with the user.

---

## Self-Review (done by plan author)

**Spec coverage:**
- 13 poses (8 basic + 5 combat), gender-agnostic → Task 1 `POSE_PRESETS`. ✓
- Bones-only apply, props follow, gender/proportions/props untouched → Task 3 (test asserts untouched dimensions). ✓
- Undoable single step → Tasks 2 + 3. ✓
- Euler degrees 'XYZ' → identity for unlisted bones → Task 1 `presetToPose` (test). ✓
- Presets section above saved list, Basic/Combat, no thumbnails/delete → Task 4 (tests). ✓
- No serialization changes → nothing touches scene JSON / store schema beyond `pose`. ✓
- Fingers neutral → `presetToPose` leaves unlisted finger bones identity. ✓

**Type consistency:** `presetToPose`/`presetById` signatures match across Tasks 1, 3. Pose map shape `{x,y,z,w}` consistent with store pose and `PosePresetCommand`. `POSE_PRESETS` entry shape `{id,name,group,angles}` used identically in data, panel (`p.id`/`p.name`/`p.group`), and tests. `data-preset-id` attribute matches the panel test selector.

**Placeholder scan:** no TBD/TODO; all code steps contain complete code. (Angle values are concrete first-pass numbers flagged for visual tuning — not placeholders; tests don't depend on them.)
