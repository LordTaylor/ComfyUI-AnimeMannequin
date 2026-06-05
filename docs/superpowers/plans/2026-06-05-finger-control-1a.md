# Finger Control — Plan 1a (Editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preset-driven finger control to the mannequin editor — 10 finger bones (1 per finger), a Hands preset panel, and OpenPose hand output (`hands.png` + fingers drawn into `pose.png`) in the browser/standalone JS renderer.

**Architecture:** Each finger becomes a single FK bone pivoting at the knuckle. The existing GLB finger meshes (currently rigid `EXTRA_NODES`) are promoted to real bone segments via `MESH_MAP`, so rotating a finger bone rotates its mesh. Presets are constant quaternion maps applied through the existing Command pattern (undo/redo, mirror, serialization come for free). The JS renderer projects finger bone world positions into a 21-keypoint OpenPose hand layout (knuckle + extrapolated tip, interpolated mid-joints).

**Tech Stack:** Three.js (vendored ES module), vanilla JS ES modules, Vitest + jsdom for unit tests. No build step — files served statically.

**Scope boundary:** This plan is editor + JS renderer only. Server-side renderers (`headless_render.js`, `glb_renderer.py`) and the ComfyUI node 5th output (`hands`) are **Plan 1b** — out of scope here. Manual per-finger gizmo editing and camera auto-zoom are **iteration 2**.

**Spec:** `docs/superpowers/specs/2026-06-05-finger-control-design.md`

**Run tests:** `npm test` (all) or `npx vitest run tests/js/<file>` (one file).

---

### Task 1: Add 10 finger bones to the model

**Files:**
- Modify: `static/src/mannequin-model.js`
- Test: `tests/js/mannequin-model.test.js`

- [ ] **Step 1: Update the failing bone-count test**

In `tests/js/mannequin-model.test.js`, replace the `BONE_NAMES` describe block's count test and add finger assertions:

```javascript
describe('BONE_NAMES', () => {
    it('contains exactly 30 bones (20 body + 10 fingers)', () => {
        expect(BONE_NAMES).toHaveLength(30);
    });

    it('contains all required body bones', () => {
        const required = [
            'torso','spine','chest','neck','head',
            'shoulder_L','upper_arm_L','forearm_L','hand_L',
            'shoulder_R','upper_arm_R','forearm_R','hand_R',
            'pelvis','thigh_L','shin_L','foot_L',
            'thigh_R','shin_R','foot_R'
        ];
        for (const b of required) expect(BONE_NAMES).toContain(b);
    });

    it('contains 10 finger bones (5 per hand)', () => {
        const fingers = [
            'thumb_L','index_L','middle_L','ring_L','pinky_L',
            'thumb_R','index_R','middle_R','ring_R','pinky_R',
        ];
        for (const f of fingers) expect(BONE_NAMES).toContain(f);
    });
});

describe('BONE_CHILDREN finger hierarchy', () => {
    it('hand_L has 5 finger children, hand_R too', () => {
        for (const f of ['thumb_L','index_L','middle_L','ring_L','pinky_L'])
            expect(BONE_CHILDREN.hand_L).toContain(f);
        for (const f of ['thumb_R','index_R','middle_R','ring_R','pinky_R'])
            expect(BONE_CHILDREN.hand_R).toContain(f);
    });

    it('each finger bone is a leaf', () => {
        for (const f of ['thumb_L','index_L','middle_L','ring_L','pinky_L',
                         'thumb_R','index_R','middle_R','ring_R','pinky_R'])
            expect(BONE_CHILDREN[f]).toEqual([]);
    });
});

describe('PROPORTIONS finger entries', () => {
    it('F and M have all 10 finger bones with radius', () => {
        for (const g of ['F','M'])
            for (const f of ['thumb_L','index_L','middle_L','ring_L','pinky_L',
                             'thumb_R','index_R','middle_R','ring_R','pinky_R'])
                expect(PROPORTIONS[g][f]).toHaveProperty('radius');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/js/mannequin-model.test.js`
Expected: FAIL — `BONE_NAMES` has 20, finger bones missing.

- [ ] **Step 3: Add finger bones to the model**

In `static/src/mannequin-model.js`:

Append finger names to `BONE_NAMES` (after `'thigh_R', 'shin_R', 'foot_R',`):

```javascript
    'thumb_L', 'index_L', 'middle_L', 'ring_L', 'pinky_L',
    'thumb_R', 'index_R', 'middle_R', 'ring_R', 'pinky_R',
```

In `BONE_CHILDREN`, change `hand_L` and `hand_R` from `[]` to finger lists and add leaf entries:

```javascript
    hand_L:     ['thumb_L', 'index_L', 'middle_L', 'ring_L', 'pinky_L'],
    thumb_L: [], index_L: [], middle_L: [], ring_L: [], pinky_L: [],
    hand_R:     ['thumb_R', 'index_R', 'middle_R', 'ring_R', 'pinky_R'],
    thumb_R: [], index_R: [], middle_R: [], ring_R: [], pinky_R: [],
```

(Remove the old `hand_L: [],` and `hand_R: [],` lines.)

In `PROPORTIONS.F` and `PROPORTIONS.M`, add a radius entry for each finger bone (length comes from the GLB geometry, only radius is used for optional joints). Add before `shoulderSpan` in each:

```javascript
        thumb_L: { radius: 0.012 }, index_L: { radius: 0.011 }, middle_L: { radius: 0.011 },
        ring_L:  { radius: 0.010 }, pinky_L: { radius: 0.009 },
        thumb_R: { radius: 0.012 }, index_R: { radius: 0.011 }, middle_R: { radius: 0.011 },
        ring_R:  { radius: 0.010 }, pinky_R: { radius: 0.009 },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/js/mannequin-model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/src/mannequin-model.js tests/js/mannequin-model.test.js
git commit -m "feat(fingers): add 10 finger bones to model (1 per finger)"
```

---

### Task 2: Promote finger meshes from rigid extras to bone segments

**Files:**
- Modify: `static/src/geometry-adapter-gltf.js`
- Test: `tests/js/geometry-adapter-gltf.test.js`

**Context:** Today fingers live in `EXTRA_NODES[*].hand_L/hand_R` as rigid sub-meshes of the hand bone. To make them posable, move each finger's GLB node into `MESH_MAP` so it becomes its own bone segment. `computeBoneOffsets` then derives the bone pivot from the finger node's GLB world position (the knuckle), and `buildSegments` builds the mesh on that bone. Toes stay rigid (untouched).

- [ ] **Step 1: Write the failing test**

Add to `tests/js/geometry-adapter-gltf.test.js`:

```javascript
import { MESH_MAP } from '../../static/src/geometry-adapter-gltf.js';

describe('MESH_MAP finger nodes', () => {
    it('maps every finger bone to a GLB node for F and M', () => {
        const expect_ = {
            female: {
                thumb_L:  'GEO-thumb_female_primitive_stylized.L',
                index_L:  'GEO-finger_index_female_primitive_stylized.L',
                middle_L: 'GEO-finger_middle_female_primitive_stylized.L',
                ring_L:   'GEO-finger_ring_female_primitive_stylized.L',
                pinky_L:  'GEO-finger_pinky_female_primitive_stylized.L',
            },
            male: {
                thumb_R:  'GEO-thumb_male_primitive_stylized.R',
                index_R:  'GEO-finger_index_male_primitive_stylized.R',
            },
        };
        for (const [key, bones] of Object.entries(expect_))
            for (const [bone, node] of Object.entries(bones))
                expect(MESH_MAP[key][bone]).toBe(node);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/js/geometry-adapter-gltf.test.js`
Expected: FAIL — `MESH_MAP.female.thumb_L` is undefined.

- [ ] **Step 3: Move finger nodes into MESH_MAP, remove from EXTRA_NODES**

In `static/src/geometry-adapter-gltf.js`:

(a) **Delete** the `hand_L` and `hand_R` arrays from `EXTRA_NODES.female` and `EXTRA_NODES.male` (keep `head`, `chest`, `foot_L`, `foot_R`).

(b) Add finger entries to `MESH_MAP.female` (after `hand_R`):

```javascript
        thumb_L:  'GEO-thumb_female_primitive_stylized.L',
        index_L:  'GEO-finger_index_female_primitive_stylized.L',
        middle_L: 'GEO-finger_middle_female_primitive_stylized.L',
        ring_L:   'GEO-finger_ring_female_primitive_stylized.L',
        pinky_L:  'GEO-finger_pinky_female_primitive_stylized.L',
        thumb_R:  'GEO-thumb_female_primitive_stylized.R',
        index_R:  'GEO-finger_index_female_primitive_stylized.R',
        middle_R: 'GEO-finger_middle_female_primitive_stylized.R',
        ring_R:   'GEO-finger_ring_female_primitive_stylized.R',
        pinky_R:  'GEO-finger_pinky_female_primitive_stylized.R',
```

(c) Add finger entries to `MESH_MAP.male` (note `_male_` and the male typo `primitve` is NOT in node names for hands — male hand finger nodes ARE `_primitive_stylized`; verified by GLB strings):

```javascript
        thumb_L:  'GEO-thumb_male_primitive_stylized.L',
        index_L:  'GEO-finger_index_male_primitive_stylized.L',
        middle_L: 'GEO-finger_middle_male_primitive_stylized.L',
        ring_L:   'GEO-finger_ring_male_primitive_stylized.L',
        pinky_L:  'GEO-finger_pinky_male_primitive_stylized.L',
        thumb_R:  'GEO-thumb_male_primitive_stylized.R',
        index_R:  'GEO-finger_index_male_primitive_stylized.R',
        middle_R: 'GEO-finger_middle_male_primitive_stylized.R',
        ring_R:   'GEO-finger_ring_male_primitive_stylized.R',
        pinky_R:  'GEO-finger_pinky_male_primitive_stylized.R',
```

(d) Add the 10 finger bones to `SEGMENT_PROPORTION_GROUP` with group `'arms'`:

```javascript
    thumb_L: 'arms', index_L: 'arms', middle_L: 'arms', ring_L: 'arms', pinky_L: 'arms',
    thumb_R: 'arms', index_R: 'arms', middle_R: 'arms', ring_R: 'arms', pinky_R: 'arms',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/js/geometry-adapter-gltf.test.js`
Expected: PASS.

- [ ] **Step 5: Verify full suite still green**

Run: `npm test`
Expected: PASS (no regressions in existing geometry/model tests).

- [ ] **Step 6: Commit**

```bash
git add static/src/geometry-adapter-gltf.js tests/js/geometry-adapter-gltf.test.js
git commit -m "feat(fingers): promote finger meshes to bone segments (MESH_MAP)"
```

---

### Task 3: Finger preset data module

**Files:**
- Create: `static/src/finger-presets.js`
- Test: `tests/js/finger-presets.test.js`

**Context:** A preset is a map `{ boneName: [x,y,z,w] }` over the 10 finger bones. Presets are defined as *curl angles* (degrees) per finger and converted to quaternions by a helper, so they're readable and tunable. Curl axis is a single constant (`CURL_AXIS`) confirmed during visual verification (Task 5, Step 7). Default: curl around local X. The thumb uses a separate axis blend. L and R share the same curl magnitudes; the helper mirrors the axis sign per side.

- [ ] **Step 1: Write the failing test**

Create `tests/js/finger-presets.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { FINGER_PRESETS, buildPresetPose, FINGER_BONES } from '../../static/src/finger-presets.js';

describe('finger presets', () => {
    it('exposes the 6 named presets', () => {
        for (const n of ['Pięść','Otwarta dłoń','Wskazywanie','Peace','OK','Półzgięte'])
            expect(FINGER_PRESETS).toHaveProperty(n);
    });

    it('buildPresetPose returns a quaternion for all 10 finger bones', () => {
        const pose = buildPresetPose('Pięść');
        expect(Object.keys(pose).sort()).toEqual([...FINGER_BONES].sort());
        for (const q of Object.values(pose)) {
            expect(q).toHaveLength(4);
            const len = Math.hypot(...q);
            expect(len).toBeCloseTo(1, 5); // normalized quaternion
        }
    });

    it('Otwarta dłoń is (near) identity for all fingers', () => {
        const pose = buildPresetPose('Otwarta dłoń');
        for (const q of Object.values(pose)) {
            expect(q[3]).toBeCloseTo(1, 3); // w≈1 → no rotation
        }
    });

    it('Wskazywanie leaves index straight but curls pinky', () => {
        const pose = buildPresetPose('Wskazywanie');
        expect(pose.index_L[3]).toBeCloseTo(1, 3);          // index straight
        expect(Math.abs(pose.pinky_L[3])).toBeLessThan(0.99); // pinky curled
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/js/finger-presets.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the preset module**

Create `static/src/finger-presets.js`:

```javascript
import * as THREE from '../lib/three.module.js';

export const FINGER_BONES = [
    'thumb_L','index_L','middle_L','ring_L','pinky_L',
    'thumb_R','index_R','middle_R','ring_R','pinky_R',
];

const FINGERS = ['thumb','index','middle','ring','pinky'];

// Local-space curl axis for the four fingers. Confirmed/flipped during visual
// verification (Plan 1a Task 5). Fingers curl toward the palm around this axis.
const CURL_AXIS  = new THREE.Vector3(1, 0, 0);
// Thumb opposes across the palm — blend of curl + inward yaw.
const THUMB_AXIS = new THREE.Vector3(0, 0, 1);

// Curl magnitude in degrees per finger, per preset. 0 = straight.
// Order: [thumb, index, middle, ring, pinky]
const PRESET_CURLS = {
    'Pięść':        [70,  95,  95,  95,  95],
    'Otwarta dłoń': [ 0,   0,   0,   0,   0],
    'Wskazywanie':  [60,   0,  95,  95,  95],
    'Peace':        [60,   0,   0,  95,  95],
    'OK':           [45,  45,   0,   0,   0],
    'Półzgięte':    [15,  25,  25,  25,  25],
};

export const FINGER_PRESETS = PRESET_CURLS;

const DEG = Math.PI / 180;

/** Quaternion for one finger at a given curl (deg), for side 'L' or 'R'. */
function fingerQuat(finger, deg, side) {
    if (!deg) return [0, 0, 0, 1];
    const axis = (finger === 'thumb' ? THUMB_AXIS : CURL_AXIS).clone();
    // Mirror the curl direction for the right hand so both hands close inward.
    const sign = side === 'R' ? -1 : 1;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, sign * deg * DEG);
    return [q.x, q.y, q.z, q.w];
}

/** Build a { boneName: [x,y,z,w] } pose for all 10 finger bones from a preset name. */
export function buildPresetPose(name) {
    const curls = PRESET_CURLS[name];
    if (!curls) throw new Error(`Unknown finger preset: ${name}`);
    const pose = {};
    FINGERS.forEach((finger, i) => {
        pose[`${finger}_L`] = fingerQuat(finger, curls[i], 'L');
        pose[`${finger}_R`] = fingerQuat(finger, curls[i], 'R');
    });
    return pose;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/js/finger-presets.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/src/finger-presets.js tests/js/finger-presets.test.js
git commit -m "feat(fingers): preset data module (curl-angle → quaternion)"
```

---

### Task 4: Apply preset via editor + extend mirror pairs

**Files:**
- Modify: `static/src/mannequin-editor.js`
- Test: `tests/js/mannequin-editor-commands.test.js`

**Context:** `applyFingerPreset` reads the current pose from the store, overlays the preset's 10 finger quaternions, and commits a `ResetPoseCommand(prevPose, nextPose)` (already imported) so undo/redo works. It also writes the quaternions onto the renderer bones so the 3-D view updates immediately. Mirror pairs gain the 5 finger pairs so Mirror L→R / R→L copies fingers too.

- [ ] **Step 1: Write the failing test**

Add to `tests/js/mannequin-editor-commands.test.js` (follow the file's existing setup for constructing an editor with a fake/real store + renderer; reuse its existing test harness/mocks):

```javascript
import { buildPresetPose } from '../../static/src/finger-presets.js';

describe('applyFingerPreset', () => {
    it('sets finger quaternions in the store and leaves body bones untouched', () => {
        // editor, store from the existing harness in this file
        const before = store.getState().pose;
        editor.applyFingerPreset(buildPresetPose('Pięść'));
        const after = store.getState().pose;
        // a finger bone changed
        expect(after.index_L).toBeDefined();
        expect(after.index_L.w).toBeCloseTo(buildPresetPose('Pięść').index_L[3], 5);
        // a body bone is unchanged
        expect(after.forearm_L ?? before.forearm_L).toEqual(before.forearm_L ?? after.forearm_L);
    });

    it('is undoable', () => {
        const before = JSON.stringify(store.getState().pose);
        editor.applyFingerPreset(buildPresetPose('Pięść'));
        editor.undo();
        expect(JSON.stringify(store.getState().pose)).toBe(before);
    });
});

describe('MIRROR_PAIRS fingers', () => {
    it('includes all 5 finger pairs', () => {
        const flat = MannequinEditor.MIRROR_PAIRS.map(p => p.join('|'));
        for (const f of ['thumb','index','middle','ring','pinky'])
            expect(flat).toContain(`${f}_L|${f}_R`);
    });
});
```

If the file's harness does not expose `store`/`editor` at describe scope, replicate the construction pattern used by the existing tests in that file (same imports, same fake renderer with a `bones` Map).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/js/mannequin-editor-commands.test.js`
Expected: FAIL — `applyFingerPreset` is not a function; finger pairs missing.

- [ ] **Step 3: Implement applyFingerPreset and extend MIRROR_PAIRS**

In `static/src/mannequin-editor.js`, extend `MIRROR_PAIRS` (append inside the array):

```javascript
        ['thumb_L',  'thumb_R'],  ['index_L', 'index_R'],
        ['middle_L', 'middle_R'], ['ring_L',  'ring_R'],
        ['pinky_L',  'pinky_R'],
```

Add the method (near `applySceneWithUndo`):

```javascript
    /**
     * Apply a finger preset (map { boneName: [x,y,z,w] } over the 10 finger bones).
     * Body bones are preserved. Commits a ResetPoseCommand so undo/redo works.
     */
    applyFingerPreset(presetPose) {
        const prevPose = this._store?.getState().pose ?? {};
        const nextPose = { ...prevPose };
        for (const [name, rot] of Object.entries(presetPose)) {
            if (!Array.isArray(rot) || rot.length < 4) continue;
            const [x, y, z, w] = rot;
            nextPose[name] = { x, y, z, w };
            const bone = this._renderer.bones.get(name);
            if (bone) bone.quaternion.set(x, y, z, w);
        }
        if (this._store) {
            this._history.execute(new ResetPoseCommand(prevPose, nextPose), this._store);
        }
        this._renderer.markDirty();
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/js/mannequin-editor-commands.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/src/mannequin-editor.js tests/js/mannequin-editor-commands.test.js
git commit -m "feat(fingers): applyFingerPreset + finger mirror pairs"
```

---

### Task 5: Hands panel + toolbar button + wiring

**Files:**
- Create: `static/src/panels/hands-panel.js`
- Modify: `static/index.html`
- Modify: `static/src/main.js`
- Test: `tests/js/hands-panel.test.js`

**Context:** `HandsPanel` mirrors `PoseLibrary`'s mount/show/hide/isVisible contract (so it slots into the `SIDE_PANELS` coordinator). It renders one button per preset; clicking calls `editor.applyFingerPreset(buildPresetPose(name))`.

- [ ] **Step 1: Write the failing test**

Create `tests/js/hands-panel.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HandsPanel } from '../../static/src/panels/hands-panel.js';

describe('HandsPanel', () => {
    let editor, panel;
    beforeEach(() => {
        document.body.innerHTML = '';
        editor = { applyFingerPreset: vi.fn() };
        panel = new HandsPanel(editor);
        panel.mount(document.body);
    });

    it('mounts hidden and toggles visibility', () => {
        expect(panel.isVisible()).toBe(false);
        panel.show(); expect(panel.isVisible()).toBe(true);
        panel.hide(); expect(panel.isVisible()).toBe(false);
    });

    it('renders one button per preset', () => {
        const btns = document.querySelectorAll('[data-finger-preset]');
        expect(btns.length).toBe(6);
    });

    it('clicking a preset button applies it via the editor', () => {
        const btn = document.querySelector('[data-finger-preset="Pięść"]');
        btn.click();
        expect(editor.applyFingerPreset).toHaveBeenCalledTimes(1);
        const arg = editor.applyFingerPreset.mock.calls[0][0];
        expect(arg).toHaveProperty('index_L');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/js/hands-panel.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement HandsPanel**

Create `static/src/panels/hands-panel.js`:

```javascript
import { FINGER_PRESETS, buildPresetPose } from '../finger-presets.js';

export class HandsPanel {
    constructor(editor) {
        this._editor  = editor;
        this._panel   = null;
        this._visible = false;
    }

    isVisible() { return this._visible; }
    show() { this._visible = true;  if (this._panel) this._panel.style.display = 'flex'; }
    hide() { this._visible = false; if (this._panel) this._panel.style.display = 'none'; }
    toggle() {
        this._visible = !this._visible;
        if (this._panel) this._panel.style.display = this._visible ? 'flex' : 'none';
    }

    mount(container) {
        this._panel = document.createElement('div');
        this._panel.style.cssText = [
            'position:fixed', 'right:0', 'top:40px', 'bottom:0', 'width:200px',
            'background:#222', 'border-left:1px solid #444', 'overflow:hidden',
            'z-index:100', 'display:none', 'flex-direction:column',
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'padding:8px;border-bottom:1px solid #444;display:flex;align-items:center;';
        const title = document.createElement('span');
        title.textContent = 'Hands';
        title.style.cssText = 'color:#fff;font-size:12px;font-weight:bold;flex:1;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.title = 'Close panel';
        closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:0 2px;';
        closeBtn.onclick = () => this.toggle();
        header.appendChild(title);
        header.appendChild(closeBtn);

        const list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:6px;';
        for (const name of Object.keys(FINGER_PRESETS)) {
            const btn = document.createElement('button');
            btn.textContent = name;
            btn.dataset.fingerPreset = name;
            btn.style.cssText = 'width:100%;padding:8px;background:#333;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:12px;text-align:left;';
            btn.onmouseenter = () => { btn.style.background = '#444'; };
            btn.onmouseleave = () => { btn.style.background = '#333'; };
            btn.onclick = () => this._editor.applyFingerPreset(buildPresetPose(name));
            list.appendChild(btn);
        }

        this._panel.appendChild(header);
        this._panel.appendChild(list);
        container.appendChild(this._panel);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/js/hands-panel.test.js`
Expected: PASS.

- [ ] **Step 5: Add the toolbar button**

In `static/index.html`, add after the `btn-overlays` button (line ~125):

```html
  <button id="btn-hands" title="Finger pose presets">Hands</button>
```

Add a style rule alongside the other button styles (near `#btn-overlays`):

```css
#btn-hands { background: #333; color: #aaa; }
#btn-hands.active { background: #5a2a6a; color: #ecd; }
```

- [ ] **Step 6: Wire the panel into main.js**

In `static/src/main.js`:

Add the import (with the other panel imports):

```javascript
import { HandsPanel } from './panels/hands-panel.js';
```

Instantiate + mount after `propsPanel` is mounted:

```javascript
const handsPanel = new HandsPanel(editor);
handsPanel.mount(document.body);
```

Add it to the `SIDE_PANELS` array so it participates in the one-open-at-a-time coordinator:

```javascript
const SIDE_PANELS = [
    { panel: poseLib,    btn: document.getElementById('btn-poses') },
    { panel: propsPanel, btn: btnProps },
    { panel: handsPanel, btn: document.getElementById('btn-hands') },
];
```

- [ ] **Step 7: Visual verification — confirm curl axis**

Run the standalone editor (serve `static/` and open `index.html`). Click **Hands → Pięść**.
- Expected: all fingers curl toward the palm into a fist on BOTH hands.
- If fingers bend backward or splay sideways: edit `CURL_AXIS` / `THUMB_AXIS` in
  `static/src/finger-presets.js` (flip a sign or swap axis component) until the fist looks
  correct, then re-check `Wskazywanie` (only index straight) and `Peace`.
- Re-run `npx vitest run tests/js/finger-presets.test.js` to confirm tests still pass after tuning.

- [ ] **Step 8: Commit**

```bash
git add static/src/panels/hands-panel.js static/index.html static/src/main.js tests/js/hands-panel.test.js
git commit -m "feat(fingers): Hands preset panel + toolbar button + wiring"
```

---

### Task 6: Hand keypoint computation in the renderer

**Files:**
- Modify: `static/src/mannequin-renderer.js`
- Test: `tests/js/renderer-store-sync.test.js` (or a new `tests/js/hand-keypoints.test.js`)

**Context:** `_computeHandKeypoints(side)` returns 21 screen-space points `{x,y}` for one hand. wrist = projected `hand_L/R`. For each finger: base = projected finger bone world position (knuckle/MCP); tip = base + (fingerDir × length) projected; the two middle joints (PIP, DIP) are linear interpolations at 1/3 and 2/3 between base and tip in screen space. Finger length comes from the segment bounding box stored at build time, or a fixed fraction of character height as fallback.

- [ ] **Step 1: Write the failing test**

Create `tests/js/hand-keypoints.test.js`. Build a renderer with a fake bones Map placing the hand and finger bones at known world positions (reuse the fake-bone pattern from existing renderer tests; each bone needs `getWorldPosition(v)` writing a known vector). Assert:

```javascript
import { describe, it, expect } from 'vitest';
import { MannequinRenderer } from '../../static/src/mannequin-renderer.js';

// Helper: a fake bone whose getWorldPosition writes a fixed vec.
function fakeBone(x, y, z) {
    return { getWorldPosition: v => { v.set(x, y, z); return v; }, quaternion: {x:0,y:0,z:0,w:1} };
}

describe('_computeHandKeypoints', () => {
    it('returns 21 points with wrist first', () => {
        const canvas = { getContext: () => ({}), width: 10, height: 10, addEventListener(){}, style:{} };
        // Construct renderer without store; inject fake bones directly.
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = makeOrthoLikeCamera();      // see note below
        r._bones = new Map([
            ['hand_L', fakeBone(0, 1, 0)],
            ['thumb_L', fakeBone(0.1, 1, 0)],  ['index_L', fakeBone(0.2, 1, 0)],
            ['middle_L', fakeBone(0.2, 1.05, 0)], ['ring_L', fakeBone(0.2, 1.1, 0)],
            ['pinky_L', fakeBone(0.2, 1.15, 0)],
        ]);
        r._outputWidth = 100; r._outputHeight = 100;
        const kps = r._computeHandKeypoints('L');
        expect(kps).toHaveLength(21);
        for (const p of kps) { expect(p).toHaveProperty('x'); expect(p).toHaveProperty('y'); }
    });
});
```

Note: `makeOrthoLikeCamera()` returns a minimal object with a `project` compatible path — simplest is to use a real `THREE.PerspectiveCamera` from `../../static/lib/three.module.js`, positioned at `(0,1,3)` looking at `(0,1,0)`, with `updateMatrixWorld()` + `updateProjectionMatrix()` called. Use the real camera to avoid mocking projection math.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/js/hand-keypoints.test.js`
Expected: FAIL — `_computeHandKeypoints` is not a function.

- [ ] **Step 3: Implement _computeHandKeypoints**

In `static/src/mannequin-renderer.js`, add the method (near `_captureOpenPose`):

```javascript
    // Finger order and the OpenPose 21-kp index where each finger's 4 points start.
    static _HAND_FINGERS = [
        { bone: 'thumb',  start: 1  },
        { bone: 'index',  start: 5  },
        { bone: 'middle', start: 9  },
        { bone: 'ring',   start: 13 },
        { bone: 'pinky',  start: 17 },
    ];

    /**
     * 21 OpenPose hand keypoints in screen space for one side ('L'|'R').
     * kp[0]=wrist; each finger: base(MCP), 1/3, 2/3, tip. PIP/DIP interpolated,
     * tip extrapolated from base along the finger direction.
     */
    _computeHandKeypoints(side) {
        const W = this._outputWidth, H = this._outputHeight;
        const tmp = new THREE.Vector3();
        const project = (v3) => {
            const p = v3.clone().project(this._camera);
            return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H };
        };
        const wristBone = this._bones.get(`hand_${side}`);
        const kps = new Array(21).fill(null);
        if (wristBone) {
            wristBone.getWorldPosition(tmp);
            kps[0] = project(tmp);
        }
        const wristWorld = new THREE.Vector3();
        if (wristBone) wristBone.getWorldPosition(wristWorld);

        for (const { bone, start } of MannequinRenderer._HAND_FINGERS) {
            const fb = this._bones.get(`${bone}_${side}`);
            if (!fb) continue;
            const base = new THREE.Vector3();
            fb.getWorldPosition(base);
            // Finger direction = away from wrist (fallback when no per-bone axis).
            const dir = base.clone().sub(wristWorld);
            const len = dir.length() || 0.04;
            dir.normalize();
            const tip = base.clone().add(dir.multiplyScalar(len));
            const pBase = project(base);
            const pTip  = project(tip);
            kps[start]     = pBase;
            kps[start + 1] = { x: pBase.x + (pTip.x - pBase.x) / 3, y: pBase.y + (pTip.y - pBase.y) / 3 };
            kps[start + 2] = { x: pBase.x + (pTip.x - pBase.x) * 2 / 3, y: pBase.y + (pTip.y - pBase.y) * 2 / 3 };
            kps[start + 3] = pTip;
        }
        return kps;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/js/hand-keypoints.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/src/mannequin-renderer.js tests/js/hand-keypoints.test.js
git commit -m "feat(fingers): compute 21-kp OpenPose hand keypoints"
```

---

### Task 7: Render hands.png + draw fingers into pose.png

**Files:**
- Modify: `static/src/mannequin-renderer.js`
- Test: `tests/js/hand-keypoints.test.js` (extend) or new render smoke test

**Context:** `_captureHands(W,H)` draws both hands' 21-kp onto a black canvas with the standard OpenPose hand palette (one color per finger, white-ish joints, connecting lines wrist→MCP→…→tip). `_captureOpenPose` is extended to also draw both hands. `captureImages()` returns `hands`.

- [ ] **Step 1: Write the failing test**

Add to `tests/js/hand-keypoints.test.js`:

```javascript
import { describe as d2, it as i2, expect as e2 } from 'vitest';

d2('captureImages hands output', () => {
    i2('returns a hands dataURL alongside pose/depth/canny', () => {
        // Build a real renderer on a node-canvas (the suite already uses `canvas` pkg
        // for other render smoke tests — reuse that setup helper).
        const r = makeRealRendererWithMannequin();   // existing helper pattern
        const out = r.captureImages();
        e2(out).toHaveProperty('hands');
        e2(typeof out.hands).toBe('string');
        e2(out.hands.startsWith('data:image/png')).toBe(true);
    });
});
```

If no `makeRealRendererWithMannequin` helper exists, this step's test may be marked as a smoke test that constructs the renderer the same way existing capture tests do. If the suite has NO existing renderer-capture test (capture needs WebGL, unavailable in jsdom), instead assert at the unit level that `captureImages` includes a `hands` key by stubbing the three sub-captures — follow whatever mocking the existing capture-related tests use. Do not introduce a real WebGL dependency.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/js/hand-keypoints.test.js`
Expected: FAIL — `hands` key missing.

- [ ] **Step 3: Implement _captureHands and extend pose + captureImages**

In `static/src/mannequin-renderer.js`:

Add finger palette + connection constants (module scope, near `SKELETON_LIMBS`):

```javascript
// OpenPose hand: per-finger color; chain wrist→base→j1→j2→tip.
const HAND_FINGER_COLORS = {
    thumb:  '#ff0000', index: '#ffaa00', middle: '#00ff00', ring: '#00aaff', pinky: '#aa00ff',
};
```

Add `_captureHands`:

```javascript
    _captureHands(W, H) {
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        for (const side of ['L', 'R']) this._drawHand(ctx, this._computeHandKeypoints(side), W);
        return canvas.toDataURL('image/png');
    }

    /** Draw one hand's 21 keypoints + bones onto ctx. */
    _drawHand(ctx, kps, W) {
        if (!kps || !kps[0]) return;
        const lineW = Math.max(2, Math.round(W / 140));
        const dotR  = Math.max(3, Math.round(W / 180));
        ctx.lineWidth = lineW; ctx.lineCap = 'round';
        const fingers = MannequinRenderer._HAND_FINGERS;
        for (const { bone, start } of fingers) {
            const col = HAND_FINGER_COLORS[bone];
            ctx.strokeStyle = col;
            // wrist → base → j1 → j2 → tip
            const chain = [kps[0], kps[start], kps[start+1], kps[start+2], kps[start+3]];
            for (let i = 0; i < chain.length - 1; i++) {
                const a = chain[i], b = chain[i+1];
                if (!a || !b) continue;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
        }
        // joints
        for (let i = 0; i < kps.length; i++) {
            const p = kps[i];
            if (!p) continue;
            ctx.fillStyle = i === 0 ? '#ffffff' : '#dddddd';
            ctx.beginPath(); ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2); ctx.fill();
        }
    }
```

In `_captureOpenPose`, before `return canvas.toDataURL(...)`, draw both hands onto the same context:

```javascript
        for (const side of ['L', 'R']) this._drawHand(ctx, this._computeHandKeypoints(side), W);
```

In `captureImages()`, after `poseDataUrl` is computed, add:

```javascript
        const handsDataUrl = this._captureHands(W, H);
```

and extend the return:

```javascript
        return { pose: poseDataUrl, depth: depthDataUrl, canny: cannyDataUrl, openpose: refDataUrl, hands: handsDataUrl };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/js/hand-keypoints.test.js`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add static/src/mannequin-renderer.js tests/js/hand-keypoints.test.js
git commit -m "feat(fingers): render hands.png and overlay fingers on pose.png"
```

---

### Task 8: Standalone download button for hands.png

**Files:**
- Modify: `static/index.html`
- Modify: `static/src/main.js`

**Context:** Add `⬇ hands.png` to the standalone `#export-bar`, wired with the existing `withFeedback` helper (same as pose/depth/canny).

- [ ] **Step 1: Add the button to index.html**

In `static/index.html`, inside `#export-bar` (after `btn-dl-canny`):

```html
    <button id="btn-dl-hands" title="Download OpenPose hand map as PNG">⬇ hands.png</button>
```

- [ ] **Step 2: Wire it in main.js**

In `static/src/main.js`, in the standalone block alongside the other `withFeedback(...)` calls:

```javascript
    withFeedback(document.getElementById('btn-dl-hands'), () => { const { hands } = renderer.captureImages(); download(hands, 'hands.png'); });
```

- [ ] **Step 3: Visual verification**

Serve `static/`, open standalone, pick a non-default finger preset, click **⬇ hands.png**.
- Expected: a PNG downloads showing two hands as colored 21-kp skeletons on black.
- Click **⬇ pose.png**: body OpenPose skeleton now includes the finger keypoints.

- [ ] **Step 4: Commit**

```bash
git add static/index.html static/src/main.js
git commit -m "feat(fingers): standalone hands.png download button"
```

---

## Final verification

- [ ] Run full suite: `npm test` — all green.
- [ ] Standalone smoke: load editor, toggle each preset (Pięść, Otwarta dłoń, Wskazywanie, Peace, OK, Półzgięte), confirm fingers move correctly on both hands.
- [ ] Mirror L→R / R→L copies finger poses.
- [ ] Undo/redo reverts/replays a preset.
- [ ] Gender toggle F↔M rebuilds with working fingers.
- [ ] Reset returns fingers to straight (identity).
- [ ] Download `hands.png` and `pose.png`; verify finger keypoints present.

## Notes for Plan 1b (next, not now)
- `headless_render.js` shares the JS renderer modules — `captureImages().hands` should flow once it forwards the new key.
- `glb_renderer.py` is a separate Python implementation: fingers are still rigid `EXTRA_NODES` there; needs finger-bone posing + 21-kp hand drawing.
- `nodes.py`: add 5th `RETURN_TYPES`/`RETURN_NAMES` entry `hands` + plumb through both render paths and the bridge save (`comfyui-bridge.js`).
