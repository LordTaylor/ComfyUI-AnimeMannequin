# Anime Mannequin Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Three.js anime mannequin editor that works as a ComfyUI custom node (iframe modal) and as a standalone web app, outputting pose + depth images.

**Architecture:** New repo `ComfyUI-AnimeMannequin`. Pure-logic model module (no Three.js) + geometry adapter (capsules first, GLTF later via single file swap) + renderer + editor + postMessage bridge. ComfyUI node mirrors OpenPoseEditor pattern. Deploy to `/mnt/windows/Users/HerwinKomp/Documents/ComfyUI/custom_nodes/`.

**Tech Stack:** Three.js r165 (vendored), Vitest (JS tests), Python 3.10 + NumPy (depth normalization), pytest (Python tests), aiohttp (ComfyUI routes).

---

## File Map

| File | Role |
|------|------|
| `static/src/mannequin-model.js` | Pure logic: bone names, hierarchy, proportions, scene serialization. **No Three.js.** |
| `static/src/geometry-adapter-capsule.js` | Builds Three.js segment meshes from proportions. **Swap this file for GLTF later.** |
| `static/src/mannequin-renderer.js` | Three.js scene, materials, depth render pass, auto-fit near/far. |
| `static/src/mannequin-editor.js` | Bone selection, TransformControls, OrbitControls, undo stack, toolbar, gender toggle. |
| `static/src/comfyui-bridge.js` | postMessage API with requestId correlation. |
| `static/index.html` | Entry point, dual-mode detection, module composition. |
| `static/lib/` | Vendored: three.module.js, OrbitControls.js, TransformControls.js. |
| `web/js/mannequin_node.js` | ComfyUI extension: node widget, modal, resolveNodeSize, pose save/restore, thumbnail. |
| `nodes.py` | Thin ComfyUI node wrapper. |
| `image_processing.py` | Pure functions: normalize_depth, image_to_tensor, load_image. No ComfyUI imports. |
| `__init__.py` | Static route `/mannequin_editor/{filename:.*}`. |
| `tests/js/mannequin-model.test.js` | Vitest unit tests for mannequin-model.js. |
| `tests/python/test_image_processing.py` | pytest for image_processing.py. |
| `package.json` | Vitest config only — no bundler. |

---

## Task 1: Repo scaffold + Three.js libs

**Files:**
- Create: `/Users/jaroslawkrawczyk/Documents/LordTaylor/ComfyUI-AnimeMannequin/` (new repo)
- Create: `package.json`, `.gitignore`, `static/lib/` (vendored Three.js)

- [ ] **Step 1: Create repo and directory structure**

```bash
mkdir -p ~/Documents/LordTaylor/ComfyUI-AnimeMannequin/{static/{src,lib},web/js,tests/{js,python},docs}
cd ~/Documents/LordTaylor/ComfyUI-AnimeMannequin
git init
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
__pycache__/
*.pyc
.DS_Store
dist/
```

- [ ] **Step 3: Create package.json for Vitest**

```json
{
  "name": "comfyui-anime-mannequin",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 4: Install Vitest**

```bash
cd ~/Documents/LordTaylor/ComfyUI-AnimeMannequin
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Vendor Three.js libs from VNCCS**

```bash
VNCCS=/mnt/windows/Users/HerwinKomp/Documents/ComfyUI/custom_nodes/ComfyUI_VNCCS_Utils/web
# Or copy via SSH:
scp krawczyk@192.168.50.199:"$VNCCS/three.module.js" static/lib/
scp krawczyk@192.168.50.199:"$VNCCS/OrbitControls.js" static/lib/
scp krawczyk@192.168.50.199:"$VNCCS/TransformControls.js" static/lib/
```

Expected: 3 files in `static/lib/`, each >10KB.

- [ ] **Step 6: Verify Three.js version in vendored file**

```bash
head -3 static/lib/three.module.js
```

Expected: version comment showing r150+ (r160+ preferred). If older, download r165 from https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js

- [ ] **Step 7: Initial commit**

```bash
git add .
git commit -m "feat: repo scaffold and vendored Three.js libs"
```

---

## Task 2: mannequin-model.js + Vitest tests

**Files:**
- Create: `static/src/mannequin-model.js`
- Create: `tests/js/mannequin-model.test.js`

- [ ] **Step 1: Write the failing tests first**

Create `tests/js/mannequin-model.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
    BONE_NAMES, BONE_CHILDREN, PROPORTIONS,
    defaultScene, sceneToJSON, jsonToScene
} from '../../static/src/mannequin-model.js';

describe('BONE_NAMES', () => {
    it('contains exactly 20 bones', () => {
        expect(BONE_NAMES).toHaveLength(20);
    });

    it('contains all required bones', () => {
        const required = [
            'torso','spine','chest','neck','head',
            'shoulder_L','upper_arm_L','forearm_L','hand_L',
            'shoulder_R','upper_arm_R','forearm_R','hand_R',
            'pelvis','thigh_L','shin_L','foot_L',
            'thigh_R','shin_R','foot_R'
        ];
        for (const b of required) expect(BONE_NAMES).toContain(b);
    });
});

describe('BONE_CHILDREN', () => {
    it('chest has shoulder_L, shoulder_R, neck as children', () => {
        expect(BONE_CHILDREN.chest).toContain('shoulder_L');
        expect(BONE_CHILDREN.chest).toContain('shoulder_R');
        expect(BONE_CHILDREN.chest).toContain('neck');
    });

    it('pelvis has thigh_L and thigh_R', () => {
        expect(BONE_CHILDREN.pelvis).toContain('thigh_L');
        expect(BONE_CHILDREN.pelvis).toContain('thigh_R');
    });
});

describe('PROPORTIONS', () => {
    it('has F and M presets', () => {
        expect(PROPORTIONS).toHaveProperty('F');
        expect(PROPORTIONS).toHaveProperty('M');
    });

    it('all 20 bones defined in each preset', () => {
        for (const g of ['F', 'M']) {
            for (const bone of BONE_NAMES) {
                expect(PROPORTIONS[g], `${g}.${bone} missing`).toHaveProperty(bone);
            }
        }
    });

    it('all numeric values are non-negative', () => {
        for (const g of ['F', 'M']) {
            for (const [bone, props] of Object.entries(PROPORTIONS[g])) {
                for (const [k, v] of Object.entries(props)) {
                    if (typeof v === 'number') {
                        expect(v, `${g}.${bone}.${k}`).toBeGreaterThanOrEqual(0);
                    }
                }
            }
        }
    });

    it('M has wider shoulders than F', () => {
        expect(PROPORTIONS.M.shoulderSpan).toBeGreaterThan(PROPORTIONS.F.shoulderSpan);
    });

    it('F has wider hips than M', () => {
        expect(PROPORTIONS.F.pelvis.width).toBeGreaterThan(PROPORTIONS.M.pelvis.width);
    });
});

describe('defaultScene', () => {
    it('all bones have identity quaternion', () => {
        const scene = defaultScene('F');
        for (const bone of BONE_NAMES) {
            expect(scene.bones[bone].rotation).toEqual([0, 0, 0, 1]);
        }
    });

    it('sets the requested gender', () => {
        expect(defaultScene('F').gender).toBe('F');
        expect(defaultScene('M').gender).toBe('M');
    });

    it('no NaN values in any rotation', () => {
        const scene = defaultScene('F');
        for (const { rotation } of Object.values(scene.bones)) {
            for (const v of rotation) expect(Number.isNaN(v)).toBe(false);
        }
    });
});

describe('sceneToJSON / jsonToScene roundtrip', () => {
    it('preserves all bone rotations and camera', () => {
        const original = defaultScene('M');
        original.bones.head.rotation = [0.04, 0, 0, 0.999];
        original.camera.azimuth = 45;
        const restored = jsonToScene(sceneToJSON(original));
        expect(restored.gender).toBe('M');
        expect(restored.bones.head.rotation).toEqual([0.04, 0, 0, 0.999]);
        expect(restored.camera.azimuth).toBe(45);
    });

    it('throws on invalid JSON string', () => {
        expect(() => jsonToScene('not json')).toThrow();
    });

    it('throws on missing required fields', () => {
        expect(() => jsonToScene('{"version":"1.0"}')).toThrow();
    });

    it('fills missing bones with identity quaternion', () => {
        const partial = JSON.stringify({
            version: '1.0', gender: 'F', bones: {}, camera: { azimuth: 0, elevation: 5, distance: 2.5 }
        });
        const scene = jsonToScene(partial);
        for (const bone of BONE_NAMES) {
            expect(scene.bones[bone].rotation).toEqual([0, 0, 0, 1]);
        }
    });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/Documents/LordTaylor/ComfyUI-AnimeMannequin
npm test
```

Expected: FAIL — `Cannot find module '../../static/src/mannequin-model.js'`

- [ ] **Step 3: Implement mannequin-model.js**

Create `static/src/mannequin-model.js`:

```js
export const BONE_NAMES = [
    'torso', 'spine', 'chest', 'neck', 'head',
    'shoulder_L', 'upper_arm_L', 'forearm_L', 'hand_L',
    'shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R',
    'pelvis',
    'thigh_L', 'shin_L', 'foot_L',
    'thigh_R', 'shin_R', 'foot_R',
];

// parent → [children] (used by renderer to build Object3D tree)
export const BONE_CHILDREN = {
    torso:     ['spine', 'pelvis'],
    spine:     ['chest'],
    chest:     ['neck', 'shoulder_L', 'shoulder_R'],
    neck:      ['head'],
    head:      [],
    shoulder_L: ['upper_arm_L'],
    upper_arm_L: ['forearm_L'],
    forearm_L:  ['hand_L'],
    hand_L:     [],
    shoulder_R: ['upper_arm_R'],
    upper_arm_R: ['forearm_R'],
    forearm_R:  ['hand_R'],
    hand_R:     [],
    pelvis:    ['thigh_L', 'thigh_R'],
    thigh_L:   ['shin_L'],
    shin_L:    ['foot_L'],
    foot_L:    [],
    thigh_R:   ['shin_R'],
    shin_R:    ['foot_R'],
    foot_R:    [],
};

// All lengths/radii relative to total mannequin height = 1.0
// length: segment length along primary axis (Y)
// radius: segment radius
// width/depth: for box-shaped segments (chest, pelvis)
// shoulderSpan: horizontal distance between shoulder joints
export const PROPORTIONS = {
    F: {
        torso:       { length: 0 },
        spine:       { length: 0.060, radius: 0.038 },
        chest:       { length: 0.175, width: 0.130, depth: 0.085, radius: 0.050 },
        neck:        { length: 0.055, radius: 0.030 },
        head:        { radius: 0.115 },
        shoulder_L:  { length: 0.040, radius: 0.038 },
        upper_arm_L: { length: 0.155, radius: 0.028 },
        forearm_L:   { length: 0.130, radius: 0.022 },
        hand_L:      { length: 0.060, radius: 0.022 },
        shoulder_R:  { length: 0.040, radius: 0.038 },
        upper_arm_R: { length: 0.155, radius: 0.028 },
        forearm_R:   { length: 0.130, radius: 0.022 },
        hand_R:      { length: 0.060, radius: 0.022 },
        pelvis:      { length: 0.080, width: 0.155, depth: 0.090, radius: 0.050 },
        thigh_L:     { length: 0.230, radius: 0.042 },
        shin_L:      { length: 0.210, radius: 0.032 },
        foot_L:      { length: 0.080, radius: 0.028 },
        thigh_R:     { length: 0.230, radius: 0.042 },
        shin_R:      { length: 0.210, radius: 0.032 },
        foot_R:      { length: 0.080, radius: 0.028 },
        shoulderSpan: 0.270,
    },
    M: {
        torso:       { length: 0 },
        spine:       { length: 0.060, radius: 0.044 },
        chest:       { length: 0.185, width: 0.155, depth: 0.100, radius: 0.060 },
        neck:        { length: 0.055, radius: 0.036 },
        head:        { radius: 0.100 },
        shoulder_L:  { length: 0.040, radius: 0.044 },
        upper_arm_L: { length: 0.165, radius: 0.034 },
        forearm_L:   { length: 0.140, radius: 0.028 },
        hand_L:      { length: 0.065, radius: 0.028 },
        shoulder_R:  { length: 0.040, radius: 0.044 },
        upper_arm_R: { length: 0.165, radius: 0.034 },
        forearm_R:   { length: 0.140, radius: 0.028 },
        hand_R:      { length: 0.065, radius: 0.028 },
        pelvis:      { length: 0.080, width: 0.130, depth: 0.090, radius: 0.048 },
        thigh_L:     { length: 0.220, radius: 0.048 },
        shin_L:      { length: 0.210, radius: 0.038 },
        foot_L:      { length: 0.085, radius: 0.032 },
        thigh_R:     { length: 0.220, radius: 0.048 },
        shin_R:      { length: 0.210, radius: 0.038 },
        foot_R:      { length: 0.085, radius: 0.032 },
        shoulderSpan: 0.340,
    },
};

const IDENTITY_QUAT = [0, 0, 0, 1];

export function defaultScene(gender = 'F') {
    const bones = {};
    for (const name of BONE_NAMES) {
        bones[name] = { rotation: [...IDENTITY_QUAT] };
    }
    return {
        version: '1.0',
        gender,
        bones,
        camera: { azimuth: 0, elevation: 5, distance: 2.5 },
    };
}

export function sceneToJSON(scene) {
    return JSON.stringify(scene);
}

export function jsonToScene(json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch { throw new Error('Invalid JSON'); }
    if (!parsed.version || !parsed.gender || !parsed.bones || !parsed.camera) {
        throw new Error('Invalid scene: missing required fields');
    }
    for (const name of BONE_NAMES) {
        if (!parsed.bones[name]) parsed.bones[name] = { rotation: [...IDENTITY_QUAT] };
    }
    return parsed;
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm test
```

Expected: 14 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add static/src/mannequin-model.js tests/js/mannequin-model.test.js package.json
git commit -m "feat: mannequin-model pure logic module with Vitest tests"
```

---

## Task 3: geometry-adapter-capsule.js

**Files:**
- Create: `static/src/geometry-adapter-capsule.js`

This module is the **only file that changes** when swapping to GLTF mannequin. It exports one function with a stable interface.

- [ ] **Step 1: Create geometry-adapter-capsule.js**

Create `static/src/geometry-adapter-capsule.js`:

```js
import * as THREE from '../lib/three.module.js';
import { PROPORTIONS, BONE_NAMES } from './mannequin-model.js';

// Total mannequin height in Three.js world units
export const WORLD_HEIGHT = 2.0;

// Toon material shared across all segments (renderer applies gradient map)
function makeMaterial(color) {
    return new THREE.MeshToonMaterial({ color });
}

const JOINT_COLOR  = 0xaaaaaa;
const SEGMENT_COLOR = 0xcccccc;
const SELECT_COLOR  = 0x4fc3f7;

/**
 * Build segment groups for all bones.
 * Returns Map<boneName, THREE.Group> — each group contains:
 *   - a sphere mesh tagged userData.isJoint = true (clickable handle)
 *   - a capsule mesh (the visual segment), if the bone has length > 0
 *
 * The group's local origin is the joint position.
 * Capsule extends in -Y (toward the child bone).
 *
 * @param {string} gender - 'F' | 'M'
 * @returns {Map<string, THREE.Group>}
 */
export function buildSegments(gender) {
    const P = PROPORTIONS[gender];
    const S = WORLD_HEIGHT; // scale factor
    const groups = new Map();

    for (const name of BONE_NAMES) {
        const props = P[name];
        const group = new THREE.Group();
        group.name = name;

        // Joint sphere — clickable handle for selection
        const r = (props.radius ?? 0.035) * S;
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(r, 16, 12),
            makeMaterial(JOINT_COLOR)
        );
        sphere.userData.boneName = name;
        sphere.userData.isJoint = true;
        group.add(sphere);

        // Segment capsule — visual body of the bone
        const len = (props.length ?? 0) * S;
        if (len > 0.001) {
            const segR = r * 0.75;
            const capsule = new THREE.Mesh(
                new THREE.CapsuleGeometry(segR, len - segR * 2, 8, 16),
                makeMaterial(SEGMENT_COLOR)
            );
            capsule.userData.boneName = name;
            capsule.position.y = -len / 2;
            group.add(capsule);
        }

        groups.set(name, group);
    }

    return groups;
}

/**
 * Compute the local offset of each bone relative to its parent.
 * Used by the renderer to place bones in the Object3D hierarchy.
 *
 * Returns Map<boneName, THREE.Vector3>
 */
export function computeBoneOffsets(gender) {
    const P = PROPORTIONS[gender];
    const S = WORLD_HEIGHT;
    const offsets = new Map();

    // Torso sits at pelvis height (= thigh + shin + foot lengths from floor)
    const floorToTorso = (P.thigh_L.length + P.shin_L.length + P.foot_L.length) * S;

    offsets.set('torso',  new THREE.Vector3(0, floorToTorso, 0));
    offsets.set('spine',  new THREE.Vector3(0, P.pelvis.length * S, 0));
    offsets.set('chest',  new THREE.Vector3(0, P.spine.length * S, 0));
    offsets.set('neck',   new THREE.Vector3(0, P.chest.length * S, 0));
    offsets.set('head',   new THREE.Vector3(0, P.neck.length * S, 0));

    const halfSpan = (P.shoulderSpan / 2) * S;
    offsets.set('shoulder_L', new THREE.Vector3(-halfSpan, P.chest.length * S * 0.85, 0));
    offsets.set('upper_arm_L', new THREE.Vector3(-P.shoulder_L.length * S, 0, 0));
    offsets.set('forearm_L',   new THREE.Vector3(0, -P.upper_arm_L.length * S, 0));
    offsets.set('hand_L',      new THREE.Vector3(0, -P.forearm_L.length * S, 0));

    offsets.set('shoulder_R', new THREE.Vector3(halfSpan, P.chest.length * S * 0.85, 0));
    offsets.set('upper_arm_R', new THREE.Vector3(P.shoulder_R.length * S, 0, 0));
    offsets.set('forearm_R',   new THREE.Vector3(0, -P.upper_arm_R.length * S, 0));
    offsets.set('hand_R',      new THREE.Vector3(0, -P.forearm_R.length * S, 0));

    offsets.set('pelvis', new THREE.Vector3(0, 0, 0));
    const halfHip = (P.pelvis.width / 2) * S * 0.55;
    offsets.set('thigh_L', new THREE.Vector3(-halfHip, 0, 0));
    offsets.set('shin_L',  new THREE.Vector3(0, -P.thigh_L.length * S, 0));
    offsets.set('foot_L',  new THREE.Vector3(0, -P.shin_L.length * S, 0));
    offsets.set('thigh_R', new THREE.Vector3(halfHip, 0, 0));
    offsets.set('shin_R',  new THREE.Vector3(0, -P.thigh_R.length * S, 0));
    offsets.set('foot_R',  new THREE.Vector3(0, -P.shin_R.length * S, 0));

    return offsets;
}

export { SELECT_COLOR, JOINT_COLOR };
```

- [ ] **Step 2: Commit**

```bash
git add static/src/geometry-adapter-capsule.js
git commit -m "feat: geometry adapter (capsule phase — swap for GLTF adapter later)"
```

---

## Task 4: mannequin-renderer.js

**Files:**
- Create: `static/src/mannequin-renderer.js`

- [ ] **Step 1: Create mannequin-renderer.js**

Create `static/src/mannequin-renderer.js`:

```js
import * as THREE from '../lib/three.module.js';
import { BONE_NAMES, BONE_CHILDREN, defaultScene, jsonToScene } from './mannequin-model.js';
import { buildSegments, computeBoneOffsets, WORLD_HEIGHT } from './geometry-adapter-capsule.js';

export class MannequinRenderer {
    constructor(canvas) {
        this._canvas = canvas;
        this._scene = new THREE.Scene();
        this._scene.background = new THREE.Color(0x1a1a1a);

        this._camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
        this._outputWidth  = 768;
        this._outputHeight = 1024;

        this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this._renderer.setPixelRatio(window.devicePixelRatio);

        // Depth render target
        this._depthTarget = new THREE.WebGLRenderTarget(512, 512);
        this._depthCamera = this._camera.clone();

        // Bone Object3D map: name → Object3D
        this._bones   = new Map();
        // Segment group map: name → THREE.Group (from adapter)
        this._segments = new Map();

        this._gender = 'F';
        this._mannequinRoot = new THREE.Group();
        this._mannequinRoot.name = 'mannequinRoot';
        this._scene.add(this._mannequinRoot);

        // Ambient + directional light for toon shading
        this._scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(1, 2, 1);
        this._scene.add(dir);

        this._dirty = true;
    }

    get camera() { return this._camera; }
    get scene()  { return this._scene; }
    get bones()  { return this._bones; }
    get mannequinRoot() { return this._mannequinRoot; }
    get outputWidth()  { return this._outputWidth; }
    get outputHeight() { return this._outputHeight; }

    setOutputSize(w, h) {
        this._outputWidth  = w;
        this._outputHeight = h;
        this._depthTarget.setSize(w, h);
        this._dirty = true;
    }

    markDirty() { this._dirty = true; }

    buildMannequin(gender, sceneData) {
        this._gender = gender;
        this._mannequinRoot.clear();
        this._bones.clear();
        this._segments.clear();

        const segments = buildSegments(gender);
        const offsets  = computeBoneOffsets(gender);

        // Create Object3D per bone
        for (const name of this._boneNames()) {
            const obj = new THREE.Object3D();
            obj.name = name;
            this._bones.set(name, obj);
        }

        // Build hierarchy
        this._mannequinRoot.add(this._bones.get('torso'));
        this._buildHierarchy('torso', offsets);

        // Attach segments to bones
        for (const [name, group] of segments) {
            const bone = this._bones.get(name);
            if (bone) { bone.add(group); this._segments.set(name, group); }
        }

        // Restore pose from scene data
        if (sceneData) this.applyScene(sceneData);

        this._dirty = true;
    }

    _buildHierarchy(parentName, offsets) {
        const children = BONE_CHILDREN[parentName] ?? [];
        const parentObj = this._bones.get(parentName);
        for (const childName of children) {
            const childObj = this._bones.get(childName);
            const offset = offsets.get(childName) ?? new THREE.Vector3();
            childObj.position.copy(offset);
            parentObj.add(childObj);
            this._buildHierarchy(childName, offsets);
        }
    }

    _boneNames() { return BONE_NAMES; }

    applyScene(sceneData) {
        for (const [name, bone] of this._bones) {
            const data = sceneData.bones?.[name];
            if (!data?.rotation) continue;
            const [x, y, z, w] = data.rotation;
            bone.quaternion.set(x, y, z, w);
        }
        if (sceneData.camera) {
            this._applyCameraFromScene(sceneData.camera);
        }
        this._dirty = true;
    }

    _applyCameraFromScene(cam) {
        const r = cam.distance * WORLD_HEIGHT;
        const azRad = THREE.MathUtils.degToRad(cam.azimuth);
        const elRad = THREE.MathUtils.degToRad(cam.elevation);
        this._camera.position.set(
            r * Math.sin(azRad) * Math.cos(elRad),
            r * Math.sin(elRad) + WORLD_HEIGHT * 0.5,
            r * Math.cos(azRad) * Math.cos(elRad)
        );
        this._camera.lookAt(0, WORLD_HEIGHT * 0.5, 0);
    }

    getSceneData(gender, cameraAzimuth = 0, cameraElevation = 5) {
        const bones = {};
        for (const [name, obj] of this._bones) {
            const q = obj.quaternion;
            bones[name] = { rotation: [q.x, q.y, q.z, q.w] };
        }
        return {
            version: '1.0',
            gender: this._gender,
            bones,
            camera: { azimuth: cameraAzimuth, elevation: cameraElevation, distance: 2.5 },
        };
    }

    render(viewW, viewH) {
        this._renderer.setSize(viewW, viewH);
        this._camera.aspect = viewW / viewH;
        this._camera.updateProjectionMatrix();
        this._renderer.render(this._scene, this._camera);
        this._dirty = false;
    }

    captureImages() {
        const W = this._outputWidth;
        const H = this._outputHeight;

        // --- POSE render ---
        this._renderer.setSize(W, H);
        this._camera.aspect = W / H;
        this._camera.updateProjectionMatrix();
        this._renderer.render(this._scene, this._camera);
        const poseDataUrl = this._renderer.domElement.toDataURL('image/png');

        // --- DEPTH render ---
        this._fitDepthCamera(W, H);
        this._depthTarget.setSize(W, H);

        // Swap materials to depth
        const depthMat = new THREE.MeshDepthMaterial();
        this._scene.overrideMaterial = depthMat;
        this._renderer.setSize(W, H);
        this._renderer.setRenderTarget(this._depthTarget);
        this._renderer.render(this._scene, this._depthCamera);
        this._renderer.setRenderTarget(null);
        this._scene.overrideMaterial = null;

        // Read depth pixels into canvas
        const buf = new Uint8Array(W * H * 4);
        this._renderer.readRenderTargetPixels(this._depthTarget, 0, 0, W, H, buf);

        // Invert: MeshDepthMaterial encodes far=black, we want near=white
        // Red channel = depth value, already 0(near)=255-ish, 1(far)=0
        // Flip Y (WebGL is bottom-up)
        const depthCanvas = document.createElement('canvas');
        depthCanvas.width = W; depthCanvas.height = H;
        const ctx = depthCanvas.getContext('2d');
        const imgData = ctx.createImageData(W, H);
        for (let row = 0; row < H; row++) {
            for (let col = 0; col < W; col++) {
                const srcIdx = ((H - 1 - row) * W + col) * 4;
                const dstIdx = (row * W + col) * 4;
                const v = buf[srcIdx]; // red channel = depth
                imgData.data[dstIdx]     = v;
                imgData.data[dstIdx + 1] = v;
                imgData.data[dstIdx + 2] = v;
                imgData.data[dstIdx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        const depthDataUrl = depthCanvas.toDataURL('image/png');

        return { pose: poseDataUrl, depth: depthDataUrl };
    }

    _fitDepthCamera(W, H) {
        const bbox = new THREE.Box3().setFromObject(this._mannequinRoot);
        const center = bbox.getCenter(new THREE.Vector3());
        const size   = bbox.getSize(new THREE.Vector3()).length();
        const dist   = this._camera.position.distanceTo(center);

        this._depthCamera.copy(this._camera);
        this._depthCamera.aspect = W / H;
        this._depthCamera.near = Math.max(0.01, dist - size * 0.65);
        this._depthCamera.far  = dist + size * 0.65;
        this._depthCamera.updateProjectionMatrix();
    }

    dispose() {
        this._renderer.dispose();
        this._depthTarget.dispose();
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add static/src/mannequin-renderer.js
git commit -m "feat: mannequin renderer with toon shading and depth capture"
```

---

## Task 5: mannequin-editor.js

**Files:**
- Create: `static/src/mannequin-editor.js`

Handles: bone selection via raycasting, TransformControls (local rotation), OrbitControls, undo stack, toolbar DOM.

- [ ] **Step 1: Create mannequin-editor.js**

Create `static/src/mannequin-editor.js`:

```js
import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import { TransformControls } from '../lib/TransformControls.js';
import { SELECT_COLOR, JOINT_COLOR } from './geometry-adapter-capsule.js';
import { defaultScene } from './mannequin-model.js';

const UNDO_LIMIT = 20;

export class MannequinEditor {
    constructor(renderer, canvas) {
        this._renderer  = renderer;
        this._canvas    = canvas;
        this._raycaster = new THREE.Raycaster();
        this._mouse     = new THREE.Vector2();
        this._selectedBone = null;
        this._selectedSphere = null;

        this._undoStack = [];   // array of scene JSON snapshots
        this._gender    = 'F';

        // OrbitControls
        this._orbit = new OrbitControls(renderer.camera, canvas);
        this._orbit.target.set(0, 1.0, 0);   // look at torso center
        this._orbit.enableDamping = true;
        this._orbit.addEventListener('change', () => renderer.markDirty());

        // TransformControls — rotation in local space
        this._transform = new TransformControls(renderer.camera, canvas);
        this._transform.setMode('rotate');
        this._transform.setSpace('local');
        renderer.scene.add(this._transform);

        this._transform.addEventListener('dragging-changed', (e) => {
            this._orbit.enabled = !e.value;
            if (!e.value) this._saveUndoSnapshot(); // capture after drag ends
        });
        this._transform.addEventListener('change', () => renderer.markDirty());

        // Pointer events
        canvas.addEventListener('click',     this._onCanvasClick.bind(this));
        window.addEventListener('keydown',   this._onKeyDown.bind(this));
    }

    get gender() { return this._gender; }

    buildMannequin(gender, sceneData) {
        this._gender = gender;
        this._deselect();
        this._renderer.buildMannequin(gender, sceneData);
        this._undoStack = [];
        this._saveUndoSnapshot();
        this._renderer.markDirty();
    }

    setGender(gender) {
        const currentScene = this._renderer.getSceneData(this._gender);
        currentScene.gender = gender;
        this.buildMannequin(gender, currentScene);
    }

    getSceneData() {
        return this._renderer.getSceneData(this._gender);
    }

    undo() {
        if (this._undoStack.length <= 1) return;
        this._undoStack.pop();
        const snap = this._undoStack[this._undoStack.length - 1];
        this._renderer.applyScene(JSON.parse(snap));
        this._deselect();
        this._renderer.markDirty();
    }

    resetPose() {
        const scene = defaultScene(this._gender);
        this._renderer.applyScene(scene);
        this._undoStack = [];
        this._saveUndoSnapshot();
        this._deselect();
        this._renderer.markDirty();
    }

    _saveUndoSnapshot() {
        const json = JSON.stringify(this._renderer.getSceneData(this._gender));
        this._undoStack.push(json);
        if (this._undoStack.length > UNDO_LIMIT) this._undoStack.shift();
    }

    _onCanvasClick(e) {
        const rect = this._canvas.getBoundingClientRect();
        this._mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        this._mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this._renderer.camera);
        // Raycast against all joint spheres
        const joints = [];
        this._renderer.scene.traverse(obj => {
            if (obj.userData.isJoint) joints.push(obj);
        });
        const hits = this._raycaster.intersectObjects(joints, false);

        if (hits.length > 0) {
            const hit = hits[0].object;
            this._selectBone(hit.userData.boneName, hit);
        } else {
            this._deselect();
        }
        this._renderer.markDirty();
    }

    _selectBone(boneName, sphereMesh) {
        this._deselect();
        this._selectedBone   = boneName;
        this._selectedSphere = sphereMesh;
        sphereMesh.material.color.setHex(SELECT_COLOR);

        const boneObj = this._renderer.bones.get(boneName);
        if (boneObj) this._transform.attach(boneObj);
        this._renderer.markDirty();
    }

    _deselect() {
        if (this._selectedSphere) {
            this._selectedSphere.material.color.setHex(JOINT_COLOR);
            this._selectedSphere = null;
        }
        this._selectedBone = null;
        this._transform.detach();
    }

    _onKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
        }
    }

    update() {
        this._orbit.update();
    }

    dispose() {
        this._canvas.removeEventListener('click', this._onCanvasClick.bind(this));
        window.removeEventListener('keydown', this._onKeyDown.bind(this));
        this._orbit.dispose();
        this._transform.dispose();
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add static/src/mannequin-editor.js
git commit -m "feat: editor with bone selection, TransformControls, undo stack, reset"
```

---

## Task 6: comfyui-bridge.js

**Files:**
- Create: `static/src/comfyui-bridge.js`

postMessage API with `requestId` correlation. Every call returns a Promise that resolves on the matching reply.

- [ ] **Step 1: Create comfyui-bridge.js**

Create `static/src/comfyui-bridge.js`:

```js
import { jsonToScene } from './mannequin-model.js';

// Generate a simple unique ID (no crypto needed — just unique per session)
let _idCounter = 0;
function genId() { return `req-${Date.now()}-${++_idCounter}`; }

export class ComfyuiBridge {
    constructor(editor, renderer) {
        this._editor   = editor;
        this._renderer = renderer;
        this._pending  = new Map(); // requestId → { resolve, reject, timer }

        window.addEventListener('message', this._onMessage.bind(this));
    }

    _onMessage(e) {
        if (e.origin !== window.location.origin) return;
        const d = e.data;
        if (!d || d.cmd !== 'mannequin') return;

        if (d.type === 'call') {
            this._handleCall(d, e.source);
            return;
        }

        // return / error — resolve pending promise
        if (d.requestId && this._pending.has(d.requestId)) {
            const { resolve, reject, timer } = this._pending.get(d.requestId);
            this._pending.delete(d.requestId);
            clearTimeout(timer);
            if (d.type === 'error') reject(new Error(d.error));
            else resolve(d.payload);
        }
    }

    async _handleCall(msg, source) {
        const reply = (type, payload, error) => {
            source.postMessage(
                { cmd: 'mannequin', requestId: msg.requestId, method: msg.method, type, payload, error },
                window.location.origin
            );
        };

        try {
            let result;
            const [arg] = msg.payload ?? [];
            switch (msg.method) {
                case 'GetWidth':
                    result = this._renderer.outputWidth;
                    break;
                case 'OutputWidth':
                    this._renderer.setOutputSize(arg, this._renderer.outputHeight);
                    result = true;
                    break;
                case 'OutputHeight':
                    this._renderer.setOutputSize(this._renderer.outputWidth, arg);
                    result = true;
                    break;
                case 'GetSceneData':
                    result = this._editor.getSceneData();
                    break;
                case 'SetSceneData':
                    this._renderer.applyScene(arg);
                    this._renderer.markDirty();
                    result = true;
                    break;
                case 'SetGender':
                    this._editor.setGender(arg);
                    result = true;
                    break;
                case 'MakeImages':
                    result = this._renderer.captureImages();
                    break;
                default:
                    throw new Error(`Unknown method: ${msg.method}`);
            }
            reply('return', result);
        } catch (err) {
            reply('error', null, err.message);
        }
    }

    // Called by mannequin_node.js on the PARENT side to invoke editor methods
    // (Not used inside the iframe — only on the ComfyUI parent side)
    static invoke(iframeWin, method, payload = [], timeoutMs = 5000) {
        const requestId = genId();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for ${method} (${timeoutMs}ms)`));
            }, timeoutMs);

            function handler(e) {
                if (e.origin !== window.location.origin) return;
                const d = e.data;
                if (d?.cmd === 'mannequin' && d?.requestId === requestId) {
                    window.removeEventListener('message', handler);
                    clearTimeout(timer);
                    if (d.type === 'error') reject(new Error(d.error));
                    else resolve(d.payload);
                }
            }
            window.addEventListener('message', handler);
            iframeWin.postMessage(
                { cmd: 'mannequin', requestId, method, type: 'call', payload },
                window.location.origin
            );
        });
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add static/src/comfyui-bridge.js
git commit -m "feat: postMessage bridge with requestId correlation"
```

---

## Task 7: index.html — dual mode composition

**Files:**
- Create: `static/index.html`

- [ ] **Step 1: Create index.html**

Create `static/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Anime Mannequin Editor</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a1a; color: #eee; font-family: sans-serif; display: flex; flex-direction: column; height: 100vh; }
#toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #2a2a2a; border-bottom: 1px solid #444; flex-shrink: 0; }
#toolbar h1 { font-size: 13px; font-weight: bold; flex: 1; color: #fff; }
button { padding: 5px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; }
#btn-gender { background: #1565c0; color: #fff; min-width: 36px; }
#btn-undo   { background: #333; color: #aaa; }
#btn-reset  { background: #333; color: #aaa; }
#btn-save   { background: #2e7d32; color: #fff; display: none; }
#btn-dl-pose  { background: #1565c0; color: #fff; display: none; }
#btn-dl-depth { background: #1565c0; color: #fff; display: none; }
#status { font-size: 11px; color: #888; padding: 0 8px; }
#canvas-wrap { flex: 1; position: relative; overflow: hidden; }
canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="toolbar">
  <h1>✏️ Anime Mannequin</h1>
  <button id="btn-gender">F</button>
  <button id="btn-undo">↩ Undo</button>
  <button id="btn-reset">↺ Reset</button>
  <span id="status">Loading…</span>
  <button id="btn-save">✕ Close &amp; Save</button>
  <button id="btn-dl-pose">⬇ pose.png</button>
  <button id="btn-dl-depth">⬇ depth.png</button>
</div>
<div id="canvas-wrap">
  <canvas id="c"></canvas>
</div>

<script type="module">
import * as THREE from './lib/three.module.js';
import { MannequinRenderer } from './src/mannequin-renderer.js';
import { MannequinEditor }   from './src/mannequin-editor.js';
import { ComfyuiBridge }     from './src/comfyui-bridge.js';
import { defaultScene, jsonToScene } from './src/mannequin-model.js';

const params = new URLSearchParams(location.search);
const mode   = params.get('mode') ?? 'standalone'; // 'comfyui' | 'standalone'

const canvas   = document.getElementById('c');
const renderer = new MannequinRenderer(canvas);
const editor   = new MannequinEditor(renderer, canvas);

// Restore pose from URL ?scene= param (set by mannequin_node.js)
let initScene = null;
try {
    const sceneParam = params.get('scene');
    if (sceneParam) initScene = jsonToScene(decodeURIComponent(sceneParam));
} catch { /* malformed — start fresh */ }

const gender = params.get('gender') ?? initScene?.gender ?? 'F';
editor.buildMannequin(gender, initScene ?? defaultScene(gender));

// Wire toolbar
const btnGender = document.getElementById('btn-gender');
const btnUndo   = document.getElementById('btn-undo');
const btnReset  = document.getElementById('btn-reset');
const status    = document.getElementById('status');

btnGender.textContent = gender;
btnGender.addEventListener('click', () => {
    const next = editor.gender === 'F' ? 'M' : 'F';
    editor.setGender(next);
    btnGender.textContent = next;
});
btnUndo.addEventListener('click', () => editor.undo());
btnReset.addEventListener('click', () => editor.resetPose());

// ComfyUI mode
if (mode === 'comfyui') {
    const bridge = new ComfyuiBridge(editor, renderer);
    document.getElementById('btn-save').style.display = '';
    document.getElementById('btn-save').addEventListener('click', async () => {
        status.textContent = 'Capturing…';
        // Signal to parent via postMessage that user clicked save
        window.parent.postMessage({ cmd: 'mannequin', type: 'event', method: 'UserSaved' }, window.location.origin);
    });
}

// Standalone mode
if (mode === 'standalone') {
    document.getElementById('btn-dl-pose').style.display  = '';
    document.getElementById('btn-dl-depth').style.display = '';

    function download(dataUrl, name) {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = name; a.click();
    }
    document.getElementById('btn-dl-pose').addEventListener('click', () => {
        const { pose } = renderer.captureImages();
        download(pose, 'pose.png');
    });
    document.getElementById('btn-dl-depth').addEventListener('click', () => {
        const { depth } = renderer.captureImages();
        download(depth, 'depth.png');
    });
}

status.textContent = '✓ Ready';

// Render loop — only renders when dirty
function loop() {
    requestAnimationFrame(loop);
    editor.update(); // orbit damping
    if (renderer._dirty) {
        const wrap = document.getElementById('canvas-wrap');
        renderer.render(wrap.clientWidth, wrap.clientHeight);
    }
}
loop();
</script>
</body>
</html>
```

- [ ] **Step 2: Quick smoke-test in browser (standalone mode)**

```bash
cd ~/Documents/LordTaylor/ComfyUI-AnimeMannequin/static
python3 -m http.server 8765
```

Open `http://localhost:8765/` — should see toolbar + gray canvas (mannequin renders). No console errors. Gender toggle F↔M works. Undo and Reset buttons work.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: dual-mode index.html (standalone + comfyui)"
```

---

## Task 8: image_processing.py + pytest

**Files:**
- Create: `image_processing.py`
- Create: `tests/python/test_image_processing.py`

- [ ] **Step 1: Write failing tests**

Create `tests/python/test_image_processing.py`:

```python
import numpy as np
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))
from image_processing import normalize_depth, load_image, image_to_tensor


def test_normalize_depth_full_range():
    arr = np.array([[0.0, 0.5], [0.75, 1.0]], dtype=np.float32)
    result = normalize_depth(arr)
    assert result.dtype == np.uint8
    assert result.max() == 255
    assert result.min() == 0


def test_normalize_depth_flat_image():
    # All same value → should return midpoint or 128, not crash
    arr = np.ones((4, 4), dtype=np.float32) * 0.5
    result = normalize_depth(arr)
    assert result.dtype == np.uint8
    assert result.shape == (4, 4)


def test_normalize_depth_inverted():
    # Near (low depth value) should map to WHITE (255)
    arr = np.array([[0.0, 1.0]], dtype=np.float32)
    result = normalize_depth(arr)
    assert result[0, 0] == 255  # near = white
    assert result[0, 1] == 0    # far = black


def test_load_image_returns_black_on_missing_file(tmp_path):
    img = load_image(str(tmp_path / 'nonexistent.png'), 64, 64)
    assert img.shape == (64, 64, 3)
    assert img.max() == 0  # black


def test_load_image_returns_black_on_empty_path():
    img = load_image('', 128, 256)
    assert img.shape == (256, 128, 3)
    assert img.max() == 0


def test_image_to_tensor_shape():
    import torch
    arr = np.zeros((64, 64, 3), dtype=np.float32)
    t = image_to_tensor(arr)
    assert t.shape == (1, 64, 64, 3)
    assert t.dtype == torch.float32


def test_image_to_tensor_values_normalized():
    import torch
    arr = np.ones((4, 4, 3), dtype=np.uint8) * 128
    t = image_to_tensor(arr)
    assert abs(float(t[0, 0, 0, 0]) - 128/255.0) < 0.01
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/Documents/LordTaylor/ComfyUI-AnimeMannequin
python3 -m pytest tests/python/ -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'image_processing'`

- [ ] **Step 3: Implement image_processing.py**

Create `image_processing.py`:

```python
import os
import numpy as np
from PIL import Image
import torch


def normalize_depth(depth_arr: np.ndarray) -> np.ndarray:
    """
    Normalize float depth array to uint8 where near=255, far=0.
    depth_arr: 2D float array, values 0.0 (near) to 1.0 (far).
    Returns uint8 array same shape.
    """
    mn, mx = depth_arr.min(), depth_arr.max()
    if mx - mn < 1e-6:
        return np.full(depth_arr.shape, 128, dtype=np.uint8)
    normalized = (depth_arr - mn) / (mx - mn)
    inverted = 1.0 - normalized  # near → 1.0 → 255
    return (inverted * 255).clip(0, 255).astype(np.uint8)


def load_image(path: str, width: int, height: int) -> np.ndarray:
    """
    Load image from path, resize to (width, height).
    Returns float32 RGB array shape (height, width, 3) in range [0, 1].
    Returns black image on missing file or empty path.
    """
    if not path or not os.path.isfile(path):
        return np.zeros((height, width, 3), dtype=np.float32)
    with Image.open(path) as img:
        img_rgb = img.convert('RGB').resize((width, height), Image.LANCZOS)
    return np.array(img_rgb, dtype=np.float32) / 255.0


def image_to_tensor(arr: np.ndarray) -> torch.Tensor:
    """
    Convert HxWx3 float32 or uint8 array to ComfyUI-format tensor (1, H, W, 3).
    """
    if arr.dtype == np.uint8:
        arr = arr.astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
python3 -m pytest tests/python/ -v
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add image_processing.py tests/python/test_image_processing.py
git commit -m "feat: image_processing pure functions with pytest coverage"
```

---

## Task 9: nodes.py + __init__.py

**Files:**
- Create: `nodes.py`
- Create: `__init__.py`

- [ ] **Step 1: Create nodes.py**

```python
import os
import folder_paths
from .image_processing import load_image, image_to_tensor


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

    RETURN_TYPES  = ("IMAGE", "IMAGE")
    RETURN_NAMES  = ("pose", "depth")
    FUNCTION      = "get_outputs"
    CATEGORY      = "AnimeMannequin"
    OUTPUT_NODE   = False

    def get_outputs(self, width, height, gender="F", pose_file="", depth_file=""):
        input_dir = folder_paths.get_input_directory()
        pose_path  = os.path.join(input_dir, pose_file)  if pose_file  else ""
        depth_path = os.path.join(input_dir, depth_file) if depth_file else ""
        pose  = image_to_tensor(load_image(pose_path,  width, height))
        depth = image_to_tensor(load_image(depth_path, width, height))
        return (pose, depth)


NODE_CLASS_MAPPINGS = {
    "AnimeMannequinNode": AnimeMannequinNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimeMannequinNode": "Anime Mannequin",
}
```

- [ ] **Step 2: Create __init__.py**

```python
import os
from aiohttp import web
from server import PromptServer

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
routes = PromptServer.instance.routes

async def _serve_static(request):
    filename = request.match_info["filename"]
    static_root = os.path.realpath(STATIC_DIR)
    filepath = os.path.realpath(os.path.join(STATIC_DIR, filename))
    if not filepath.startswith(static_root + os.sep) or not os.path.isfile(filepath):
        raise web.HTTPNotFound()
    return web.FileResponse(filepath)

routes.get("/mannequin_editor/{filename:.*}")(_serve_static)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
```

- [ ] **Step 3: Commit**

```bash
git add nodes.py __init__.py
git commit -m "feat: ComfyUI node Python + static file route"
```

---

## Task 10: mannequin_node.js — ComfyUI extension

**Files:**
- Create: `web/js/mannequin_node.js`

Mirrors `openpose_editor.js` pattern. Adds: `resolveNodeSize` (upstream INT nodes), `applyOutputSize` with retry, pose save/restore, node thumbnail.

- [ ] **Step 1: Create web/js/mannequin_node.js**

```js
import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const EXT_NAME   = "AnimeMannequin";
const NODE_NAME  = "AnimeMannequinNode";
const EDITOR_URL = "/mannequin_editor/index.html";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resolve width/height — follows upstream links (same as OpenPoseEditor fix)
function readUpstreamNumber(node, inputName) {
    const input = node.inputs?.find(i => i.name === inputName);
    if (!input || input.link == null) return null;
    const link = app.graph.links?.[input.link];
    if (!link) return null;
    const src = app.graph.getNodeById?.(link.origin_id);
    return src?.widgets?.find(w => typeof w.value === "number")?.value ?? null;
}

function resolveNodeSize(node) {
    const w = readUpstreamNumber(node, "width")  ?? node.widgets?.find(w => w.name === "width")?.value  ?? 768;
    const h = readUpstreamNumber(node, "height") ?? node.widgets?.find(w => w.name === "height")?.value ?? 1024;
    const g = node.widgets?.find(w => w.name === "gender")?.value ?? "F";
    return { w, h, g };
}

// postMessage invoke with requestId (matches comfyui-bridge.js protocol)
let _reqCounter = 0;
function invoke(iframeWin, method, payload = [], timeoutMs = 5000) {
    const requestId = `node-${Date.now()}-${++_reqCounter}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener("message", handler);
            reject(new Error(`Timeout: ${method}`));
        }, timeoutMs);
        function handler(e) {
            if (e.origin !== window.location.origin) return;
            const d = e.data;
            if (d?.cmd === "mannequin" && d?.requestId === requestId) {
                window.removeEventListener("message", handler);
                clearTimeout(timer);
                if (d.type === "error") reject(new Error(d.error));
                else resolve(d.payload);
            }
        }
        window.addEventListener("message", handler);
        iframeWin.postMessage({ cmd: "mannequin", requestId, method, type: "call", payload }, window.location.origin);
    });
}

async function waitForEditorReady(iframeWin, retries = 40) {
    for (let i = 0; i < retries; i++) {
        try {
            const w = await invoke(iframeWin, "GetWidth", [], 1000);
            if (typeof w === "number" && w > 0) return true;
        } catch { /* not ready */ }
        await sleep(300);
    }
    return false;
}

async function applyOutputSize(iframeWin, w, h) {
    for (let i = 0; i < 8; i++) {
        try {
            const okW = await invoke(iframeWin, "OutputWidth",  [w], 800);
            const okH = await invoke(iframeWin, "OutputHeight", [h], 800);
            if (okW === true && okH === true) return true;
        } catch { /* retry */ }
        await sleep(200);
    }
    return false;
}

function dataUrlToBlob(dataUrl) {
    if (!dataUrl?.includes(",")) throw new Error("Invalid data URL");
    const [header, data] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1];
    if (!mime) throw new Error("Invalid mime in data URL");
    const bytes = atob(data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

async function uploadImage(dataUrl, filename) {
    const form = new FormData();
    form.append("image", dataUrlToBlob(dataUrl), filename);
    form.append("overwrite", "true");
    const resp = await api.fetchApi("/upload/image", { method: "POST", body: form });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    const json = await resp.json();
    if (!json.name) throw new Error("Upload missing filename");
    return json.name;
}

function openMannequinModal(node) {
    const { w, h, g } = resolveNodeSize(node);
    const savedScene = node.properties?.mannequin_scene;

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10000;";

    const container = document.createElement("div");
    container.style.cssText = "width:90vw;height:90vh;display:flex;flex-direction:column;background:#1a1a1a;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);";

    const statusBar = document.createElement("div");
    statusBar.style.cssText = "padding:4px 16px;background:#111;color:#aaa;font-size:11px;flex-shrink:0;min-height:22px;";
    statusBar.textContent = "Loading editor…";
    const setStatus = (msg, color = "#aaa") => { statusBar.textContent = msg; statusBar.style.color = color; };

    // Build iframe URL
    let src = `${EDITOR_URL}?mode=comfyui&gender=${g}`;
    if (savedScene) src += `&scene=${encodeURIComponent(savedScene)}`;

    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.style.cssText = "flex:1;border:none;width:100%;";

    container.appendChild(iframe);
    container.appendChild(statusBar);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    let closing = false;

    // Listen for UserSaved event from editor
    async function onMessage(e) {
        if (e.origin !== window.location.origin) return;
        const d = e.data;
        if (d?.cmd !== "mannequin" || d?.method !== "UserSaved") return;
        if (closing) return;
        closing = true;
        window.removeEventListener("message", onMessage);

        try {
            setStatus("Capturing…", "#FFA500");
            const images = await invoke(iframe.contentWindow, "MakeImages", [], 20000);

            // Upload pose + depth
            const poseFile  = await uploadImage(images.pose,  "mannequin_pose.png");
            const depthFile = await uploadImage(images.depth, "mannequin_depth.png");

            // Update node widgets
            const pw = node.widgets?.find(w => w.name === "pose_file");
            const dw = node.widgets?.find(w => w.name === "depth_file");
            if (pw) pw.value = poseFile;
            if (dw) dw.value = depthFile;

            // Save scene for restore
            const scene = await invoke(iframe.contentWindow, "GetSceneData", [], 5000);
            node.properties = node.properties || {};
            node.properties.mannequin_scene = JSON.stringify(scene);

            // Update thumbnail
            if (node._thumbnailImg) node._thumbnailImg.src = images.pose;

            app.graph.setDirtyCanvas(true, true);
            setStatus("✓ Saved to node", "#4CAF50");
            setTimeout(() => overlay.remove(), 600);
        } catch (err) {
            console.error("[AnimeMannequin] save error:", err);
            setStatus(`⚠ ${err.message}`, "#f44");
            closing = false;
        }
    }
    window.addEventListener("message", onMessage);

    iframe.onload = async () => {
        const ready = await waitForEditorReady(iframe.contentWindow);
        if (!ready) { setStatus("⚠ Editor failed to load", "#f44"); return; }
        const sized = await applyOutputSize(iframe.contentWindow, w, h);
        setStatus(
            sized ? `✓ Ready — ${w}×${h} — pose then Close & Save` : `⚠ Ready (size ${w}×${h} may not have applied)`,
            sized ? "#4CAF50" : "#FFA500"
        );
    };

    // ESC to cancel
    const keyHandler = e => {
        if (e.key === "Escape") { window.removeEventListener("keydown", keyHandler); overlay.remove(); }
    };
    window.addEventListener("keydown", keyHandler);
}

app.registerExtension({
    name: EXT_NAME,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const orig = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            orig?.apply(this, arguments);

            // Open editor button
            const btn = document.createElement("button");
            btn.textContent = "✏️ Open Mannequin Editor";
            btn.style.cssText = [
                "width:calc(100% - 16px)", "margin:6px 8px 2px 8px",
                "padding:8px 12px", "background:#1565c0", "color:#fff",
                "border:none", "border-radius:6px", "cursor:pointer",
                "font-size:13px", "font-weight:bold", "display:block",
            ].join(";");
            const self = this;
            btn.onclick = e => { e.stopPropagation(); openMannequinModal(self); };
            this.addDOMWidget("open_editor_btn", "btn", btn, {
                getValue() { return ""; }, setValue() {},
                computeSize() { return [0, 42]; }, serialize: false,
            });

            // Thumbnail preview image
            const img = document.createElement("img");
            img.style.cssText = "width:calc(100% - 16px);margin:2px 8px;border-radius:4px;display:block;background:#111;min-height:40px;object-fit:contain;";
            img.alt = "No pose captured yet";
            this._thumbnailImg = img;
            const savedScene = this.properties?.mannequin_scene;
            // Thumbnail is restored from pose_file widget on next open — placeholder for now
            this.addDOMWidget("thumbnail", "thumbnail", img, {
                getValue() { return ""; }, setValue() {},
                computeSize() { return [0, 80]; }, serialize: false,
            });

            // Make file widgets read-only
            setTimeout(() => {
                for (const w of this.widgets ?? []) {
                    if (["pose_file", "depth_file"].includes(w.name)) w.disabled = true;
                }
            }, 100);
        };
    },
});
```

- [ ] **Step 2: Commit**

```bash
git add web/js/mannequin_node.js
git commit -m "feat: ComfyUI JS extension — node widget, modal, save/restore, thumbnail"
```

---

## Task 11: Deploy + integration test

**Files:**
- Deploy to: `/mnt/windows/Users/HerwinKomp/Documents/ComfyUI/custom_nodes/ComfyUI-AnimeMannequin/`

- [ ] **Step 1: Create deploy script**

Create `deploy.sh`:

```bash
#!/bin/bash
set -e
TARGET="krawczyk@192.168.50.199:/mnt/windows/Users/HerwinKomp/Documents/ComfyUI/custom_nodes/ComfyUI-AnimeMannequin/"
rsync -az --delete --exclude '.git' --exclude 'node_modules' --exclude 'tests/js' --exclude 'package*.json' ./ "$TARGET"
echo "✓ Deployed"
```

```bash
chmod +x deploy.sh
```

- [ ] **Step 2: Deploy and restart ComfyUI**

```bash
./deploy.sh

ssh krawczyk@192.168.50.199 '
  kill $(pgrep -f "main.py --listen") 2>/dev/null; sleep 2
  cd /mnt/windows/Users/HerwinKomp/Documents/ComfyUI
  nohup setsid /home/krawczyk/comfyui-venv/bin/python main.py \
    --listen 0.0.0.0 --port 8188 \
    --output-directory /mnt/dane/ComfyUI_Output \
    --input-directory /mnt/windows/Users/HerwinKomp/Documents/ComfyUI/input \
    --disable-cuda-malloc --disable-mmap \
    </dev/null >/tmp/comfyui.log 2>&1 &
  sleep 8
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8188/
'
```

Expected: `200`

- [ ] **Step 3: Verify node registered**

```bash
ssh krawczyk@192.168.50.199 \
  'curl -s http://127.0.0.1:8188/object_info/AnimeMannequinNode | python3 -c "
import sys, json; d=json.load(sys.stdin)
k=list(d.keys()); print(\"OK:\", k)
print(\"inputs:\", list(d[k[0]][\"input\"][\"required\"].keys()))
"'
```

Expected: `OK: ['AnimeMannequinNode']`, inputs include `width`, `height`, `gender`

- [ ] **Step 4: Verify editor static route**

```bash
ssh krawczyk@192.168.50.199 \
  'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8188/mannequin_editor/index.html'
```

Expected: `200`

- [ ] **Step 5: Manual integration test in browser**

Open `http://192.168.50.199:8188` (hard-refresh Ctrl+Shift+R).

Checklist:
- [ ] Add **Anime Mannequin** node — button + thumbnail placeholder visible
- [ ] Connect INT node (value=1024) to width and height
- [ ] Click **✏️ Open Mannequin Editor** — modal opens
- [ ] Status bar shows `✓ Ready — 1024×1024`
- [ ] Mannequin visible (capsule segments, gray)
- [ ] Click a joint sphere → turns blue, gizmo appears
- [ ] Rotate a limb, Ctrl+Z undoes, Reset returns to T-pose
- [ ] Gender toggle F↔M switches proportions
- [ ] Click **Close & Save** — status shows `✓ Saved to node`, thumbnail updates
- [ ] Reopen editor — pose is restored
- [ ] Run queue — pose + depth images flow to downstream nodes

- [ ] **Step 6: Standalone mode test**

Open `http://192.168.50.199:8188/mannequin_editor/index.html`

- [ ] Editor opens without ComfyUI modal
- [ ] "Save pose.png" and "Save depth.png" buttons visible
- [ ] Downloading depth.png shows a grayscale image with white near / black far

- [ ] **Step 7: Final commit + tag**

```bash
git add deploy.sh
git commit -m "feat: deploy script and integration verified"
git tag v0.1.0-phase1
```

---

## Geometry Swap Guide (for future GLTF adapter)

When the Blender mannequin is ready:

1. Create `static/src/geometry-adapter-gltf.js` with the same exports as `geometry-adapter-capsule.js`:
   - `buildSegments(gender)` — loads `female.glb` / `male.glb` via GLTFLoader, returns `Map<boneName, THREE.Group>`
   - `computeBoneOffsets(gender)` — reads positions from GLTF node transforms instead of computing from proportions
   - `WORLD_HEIGHT`, `SELECT_COLOR`, `JOINT_COLOR`

2. In `static/index.html`, change one import line:
   ```js
   // FROM:
   import { buildSegments, computeBoneOffsets, WORLD_HEIGHT } from './src/geometry-adapter-capsule.js';
   // TO:
   import { buildSegments, computeBoneOffsets, WORLD_HEIGHT } from './src/geometry-adapter-gltf.js';
   ```

3. Place `female.glb` and `male.glb` in `static/assets/`. Name all mesh objects to match BONE_NAMES exactly.

**No other files change.**
