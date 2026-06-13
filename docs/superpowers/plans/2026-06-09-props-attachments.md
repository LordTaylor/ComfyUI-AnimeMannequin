# Props / Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach 3-D props (library or uploaded GLB) to mannequin bones so they follow the pose and appear in the depth/canny control images; persist them in the scene; recover uploaded props after reload via an IndexedDB cache.

**Architecture:** A prop is a GLB `THREE.Object3D` added as a child of a target bone's group in the renderer (same pattern as bone segments) → it inherits the bone transform and follows the pose, and renders into depth/canny automatically. Prop instances live as plain data in the AppStore (`props: []`) and scene JSON; geometry is loaded from the library manifest or from uploaded files (cached in IndexedDB for reload autoload). UI is a docked side-panel + the existing `TransformControls` gizmo.

**Tech Stack:** vanilla JS ES modules, vendored Three.js (`static/lib/three.module.js`, works in Vitest+jsdom), Vitest, IndexedDB (browser). No build step.

**Spec:** `docs/superpowers/specs/2026-06-09-props-attachments-design.md`

**Worktree:** `.claude/worktrees/finger-control-1a` (branch == main). **Run tests:** `npm test` or `npx vitest run tests/js/<file>`.

**Prop data shape (used throughout):**
```js
{ id: 'p-1', source: 'lib'|'upload', ref: 'hat_01'|'mysword.glb',
  bone: 'head', position: [x,y,z], rotation: [x,y,z,w], scale: 1 }
```

---

### Task 1: Props in store state + scene serialization (data layer)

**Files:**
- Modify: `static/src/app-store.js` (defaultState, getState deep-clone)
- Modify: `static/src/mannequin-model.js` (`defaultScene`, `jsonToScene`)
- Test: `tests/js/app-store.test.js`, `tests/js/mannequin-model.test.js`

- [ ] **Step 1: Failing tests**

In `tests/js/app-store.test.js` add:
```javascript
import { AppStore, defaultState } from '../../static/src/app-store.js';
describe('props state', () => {
    it('defaultState has an empty props array', () => {
        expect(defaultState().props).toEqual([]);
    });
    it('getState returns a deep copy of props (outer mutation does not leak)', () => {
        const s = new AppStore(defaultState());
        s.setState({ props: [{ id:'p1', source:'lib', ref:'hat_01', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 }] });
        const got = s.getState();
        got.props[0].bone = 'hand_R';
        got.props.push({ id:'x' });
        expect(s.getState().props).toHaveLength(1);
        expect(s.getState().props[0].bone).toBe('head');
    });
});
```
In `tests/js/mannequin-model.test.js` add:
```javascript
describe('scene props serialization', () => {
    it('defaultScene includes props: []', () => {
        expect(defaultScene('F').props).toEqual([]);
    });
    it('jsonToScene fills missing props with []', () => {
        const scene = defaultScene('F');
        const json = JSON.stringify({ version: scene.version, gender:'F', bones: scene.bones, camera: scene.camera });
        expect(jsonToScene(json).props).toEqual([]);
    });
    it('jsonToScene preserves provided props', () => {
        const scene = defaultScene('F');
        scene.props = [{ id:'p1', source:'upload', ref:'s.glb', bone:'hand_R', position:[0,0,0], rotation:[0,0,0,1], scale:1 }];
        expect(jsonToScene(JSON.stringify(scene)).props).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run tests/js/app-store.test.js tests/js/mannequin-model.test.js` (props undefined).

- [ ] **Step 3: Implement**

`app-store.js` — add `props: []` to `defaultState()` return (after `cropFrame`). In `getState()` add a deep clone:
```javascript
        return {
            ...this._state,
            pose,
            proportions: { ...this._state.proportions },
            bustCfg:     { ...this._state.bustCfg },
            bgImage:     { ...this._state.bgImage },
            cropFrame:   { ...this._state.cropFrame },
            props:       (this._state.props ?? []).map(p => ({ ...p, position: [...p.position], rotation: [...p.rotation] })),
        };
```
`mannequin-model.js` — `defaultScene` return: add `props: []`. In `jsonToScene`, before `return parsed;` add: `if (!Array.isArray(parsed.props)) parsed.props = [];`

- [ ] **Step 4: Run → PASS.** Then `npm test` (whole suite green).

- [ ] **Step 5: Commit**
```bash
git add static/src/app-store.js static/src/mannequin-model.js tests/js/app-store.test.js tests/js/mannequin-model.test.js
git commit -m "feat(props): props array in store state + scene serialization"
```

---

### Task 2: Store setters + Commands (add/remove/transform, undoable)

**Files:**
- Modify: `static/src/app-store.js` (setters)
- Modify: `static/src/commands.js` (3 commands)
- Test: `tests/js/app-store-setters.test.js`, `tests/js/commands.test.js`

- [ ] **Step 1: Failing tests**

`app-store-setters.test.js`:
```javascript
describe('prop setters', () => {
    it('addProp / removeProp / updateProp mutate immutably', () => {
        const s = new AppStore(defaultState());
        s.addProp({ id:'p1', source:'lib', ref:'hat_01', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 });
        expect(s.getState().props).toHaveLength(1);
        s.updateProp('p1', { bone:'hand_R', scale:2 });
        expect(s.getState().props[0].bone).toBe('hand_R');
        expect(s.getState().props[0].scale).toBe(2);
        s.removeProp('p1');
        expect(s.getState().props).toHaveLength(0);
    });
});
```
`commands.test.js`:
```javascript
import { AddPropCommand, RemovePropCommand, TransformPropCommand } from '../../static/src/commands.js';
describe('prop commands', () => {
    const mkProp = () => ({ id:'p1', source:'lib', ref:'hat_01', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 });
    it('AddPropCommand adds and undo removes', () => {
        const s = new AppStore(defaultState());
        const c = new AddPropCommand(mkProp());
        c.execute(s); expect(s.getState().props).toHaveLength(1);
        c.undo(s);    expect(s.getState().props).toHaveLength(0);
    });
    it('TransformPropCommand applies next and undo restores prev', () => {
        const s = new AppStore(defaultState()); s.addProp(mkProp());
        const c = new TransformPropCommand('p1', { scale:1, bone:'head' }, { scale:3, bone:'hand_R' });
        c.execute(s); expect(s.getState().props[0].scale).toBe(3); expect(s.getState().props[0].bone).toBe('hand_R');
        c.undo(s);    expect(s.getState().props[0].scale).toBe(1); expect(s.getState().props[0].bone).toBe('head');
    });
    it('RemovePropCommand removes and undo re-adds at same data', () => {
        const s = new AppStore(defaultState()); s.addProp(mkProp());
        const c = new RemovePropCommand(mkProp());
        c.execute(s); expect(s.getState().props).toHaveLength(0);
        c.undo(s);    expect(s.getState().props[0].id).toBe('p1');
    });
});
```
(Import `AppStore, defaultState` at top of commands.test.js if not present.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`app-store.js` (with the other specific setters):
```javascript
    /** Dodaj prop. */
    addProp(prop) {
        this._state = { ...this._state, props: [...(this._state.props ?? []), { ...prop }] };
        this._notify();
    }
    /** Usuń prop po id. */
    removeProp(id) {
        this._state = { ...this._state, props: (this._state.props ?? []).filter(p => p.id !== id) };
        this._notify();
    }
    /** Patch jednego propa po id. */
    updateProp(id, partial) {
        this._state = { ...this._state, props: (this._state.props ?? []).map(p => p.id === id ? { ...p, ...partial } : p) };
        this._notify();
    }
```
`commands.js` (append):
```javascript
export class AddPropCommand extends Command {
    constructor(prop) { super(); this._prop = { ...prop }; }
    execute(store) { store.addProp(this._prop); }
    undo(store)    { store.removeProp(this._prop.id); }
    get description() { return `Add prop ${this._prop.ref}`; }
}
export class RemovePropCommand extends Command {
    constructor(prop) { super(); this._prop = { ...prop }; }
    execute(store) { store.removeProp(this._prop.id); }
    undo(store)    { store.addProp(this._prop); }
    get description() { return `Remove prop ${this._prop.ref}`; }
}
export class TransformPropCommand extends Command {
    constructor(id, prev, next) { super(); this._id = id; this._prev = { ...prev }; this._next = { ...next }; }
    execute(store) { store.updateProp(this._id, this._next); }
    undo(store)    { store.updateProp(this._id, this._prev); }
    get description() { return `Transform prop ${this._id}`; }
}
```

- [ ] **Step 4: Run → PASS.** Then `npm test`.

- [ ] **Step 5: Commit**
```bash
git add static/src/app-store.js static/src/commands.js tests/js/app-store-setters.test.js tests/js/commands.test.js
git commit -m "feat(props): store setters + Add/Remove/Transform prop commands"
```

---

### Task 3: Prop library manifest + loaders (`props.js`)

**Files:**
- Create: `static/src/props.js`
- Create dir: `static/assets/props/` (with `.gitkeep`)
- Test: `tests/js/props.test.js`

- [ ] **Step 1: Failing test** `tests/js/props.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { PROP_LIBRARY, libraryEntry } from '../../static/src/props.js';

describe('PROP_LIBRARY manifest', () => {
    it('every entry has id, name, file, defaultBone, category', () => {
        for (const e of PROP_LIBRARY) {
            for (const k of ['id','name','file','defaultBone','category']) expect(e[k]).toBeTruthy();
        }
    });
    it('libraryEntry(id) finds by id, undefined if missing', () => {
        if (PROP_LIBRARY.length) expect(libraryEntry(PROP_LIBRARY[0].id)).toBe(PROP_LIBRARY[0]);
        expect(libraryEntry('nope-xyz')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `static/src/props.js`:
```javascript
import * as THREE from '../lib/three.module.js';
import { GLTFLoader } from '../lib/GLTFLoader.js';

// Library manifest. Add a prop by dropping its GLB into static/assets/props/
// and appending an entry here. Empty-friendly: upload works without any entries.
export const PROP_LIBRARY = [
    // { id: 'hat_01', name: 'Cap', file: 'hat_01.glb', defaultBone: 'head', category: 'head' },
];

export function libraryEntry(id) {
    return PROP_LIBRARY.find(e => e.id === id);
}

const _libCache = new Map(); // id → THREE.Object3D (template)

/** Load a built-in library prop by id → a fresh clone ready to attach. */
export async function loadLibraryProp(id) {
    const entry = libraryEntry(id);
    if (!entry) throw new Error(`Unknown library prop: ${id}`);
    if (!_libCache.has(id)) {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(`./assets/props/${entry.file}`);
        _libCache.set(id, gltf.scene);
    }
    return _libCache.get(id).clone(true);
}

/** Parse an uploaded GLB (ArrayBuffer) → THREE.Object3D. */
export async function parsePropGLB(arrayBuffer) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) => loader.parse(arrayBuffer, '', res, rej));
    return gltf.scene;
}
```

- [ ] **Step 4: Run → PASS.** Create `static/assets/props/.gitkeep` (empty).

- [ ] **Step 5: Commit**
```bash
mkdir -p static/assets/props && touch static/assets/props/.gitkeep
git add static/src/props.js static/assets/props/.gitkeep tests/js/props.test.js
git commit -m "feat(props): library manifest + GLB loaders (library + upload)"
```

---

### Task 4: IndexedDB cache for uploaded GLBs (`prop-cache.js`)

**Files:**
- Create: `static/src/prop-cache.js`
- Test: `tests/js/prop-cache.test.js`

**Context:** thin async key→Blob store in IndexedDB so uploaded props autoload after reload. jsdom has no IndexedDB; install `fake-indexeddb` as a devDependency and load it in the test.

- [ ] **Step 1: Add dev dependency**
```bash
npm install -D fake-indexeddb
```

- [ ] **Step 2: Failing test** `tests/js/prop-cache.test.js`:
```javascript
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { putPropBlob, getPropBlob } from '../../static/src/prop-cache.js';

describe('prop-cache (IndexedDB)', () => {
    it('stores and retrieves a blob by key', async () => {
        const data = new Uint8Array([1,2,3,4]).buffer;
        await putPropBlob('mysword.glb', data);
        const got = await getPropBlob('mysword.glb');
        expect(got).toBeTruthy();
        const arr = new Uint8Array(got);
        expect(Array.from(arr)).toEqual([1,2,3,4]);
    });
    it('returns null for a missing key', async () => {
        expect(await getPropBlob('absent-xyz')).toBeNull();
    });
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement** `static/src/prop-cache.js`:
```javascript
const DB = 'mannequin-props';
const STORE = 'glb';

function open() {
    return new Promise((res, rej) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
}

/** Store an ArrayBuffer under key. */
export async function putPropBlob(key, arrayBuffer) {
    const db = await open();
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(arrayBuffer, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

/** Retrieve an ArrayBuffer for key, or null if absent. */
export async function getPropBlob(key) {
    const db = await open();
    return new Promise((res, rej) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => res(req.result ?? null);
        req.onerror = () => rej(req.error);
    });
}
```

- [ ] **Step 5: Run → PASS.** Then `npm test`.

- [ ] **Step 6: Commit**
```bash
git add static/src/prop-cache.js tests/js/prop-cache.test.js package.json package-lock.json
git commit -m "feat(props): IndexedDB cache for uploaded GLBs"
```

---

### Task 5: Renderer — attach / remove / transform props on bones

**Files:**
- Modify: `static/src/mannequin-renderer.js`
- Test: `tests/js/props-renderer.test.js`

**Context:** props are added as children of the target bone's group (`this._bones.get(bone)`), so they follow the pose. `userData.isProp=true`. A `this._props: Map<id,Object3D>` tracks them. The actual GLB object is supplied by the caller (so this is unit-testable with a fake Object3D — no GLB needed here).

- [ ] **Step 1: Failing test** `tests/js/props-renderer.test.js`:
```javascript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { MannequinRenderer } from '../../static/src/mannequin-renderer.js';

function rendererWithBones() {
    const r = Object.create(MannequinRenderer.prototype);
    r._bones = new Map();
    r._props = new Map();
    r.markDirty = () => {};
    const head = new THREE.Object3D(); head.name = 'head';
    r._bones.set('head', head);
    const hand = new THREE.Object3D(); hand.name = 'hand_R';
    r._bones.set('hand_R', hand);
    return r;
}

describe('renderer props', () => {
    it('attachProp adds the object under the target bone with isProp + transform', () => {
        const r = rendererWithBones();
        const obj = new THREE.Object3D();
        r.attachProp({ id:'p1', bone:'head', position:[0,0.1,0], rotation:[0,0,0,1], scale:2 }, obj);
        expect(r._bones.get('head').children).toContain(obj);
        expect(obj.userData.isProp).toBe(true);
        expect(obj.userData.propId).toBe('p1');
        expect(obj.position.y).toBeCloseTo(0.1, 6);
        expect(obj.scale.x).toBeCloseTo(2, 6);
    });
    it('updatePropTransform re-parents on bone change and updates transform', () => {
        const r = rendererWithBones();
        const obj = new THREE.Object3D();
        r.attachProp({ id:'p1', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 }, obj);
        r.updatePropTransform({ id:'p1', bone:'hand_R', position:[0.2,0,0], rotation:[0,0,0,1], scale:3 });
        expect(r._bones.get('hand_R').children).toContain(obj);
        expect(r._bones.get('head').children).not.toContain(obj);
        expect(obj.position.x).toBeCloseTo(0.2, 6);
        expect(obj.scale.x).toBeCloseTo(3, 6);
    });
    it('removeProp detaches and forgets it', () => {
        const r = rendererWithBones();
        const obj = new THREE.Object3D();
        r.attachProp({ id:'p1', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 }, obj);
        r.removeProp('p1');
        expect(r._props.has('p1')).toBe(false);
        expect(r._bones.get('head').children).not.toContain(obj);
    });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** in `mannequin-renderer.js`. Add `this._props = new Map();` in the constructor (near `this._segments`). Add methods:
```javascript
    /** Attach a loaded prop object under its target bone group. */
    attachProp(propState, object3d) {
        const bone = this._bones.get(propState.bone);
        if (!bone) return;
        object3d.userData.isProp = true;
        object3d.userData.propId = propState.id;
        const [px,py,pz] = propState.position;
        const [rx,ry,rz,rw] = propState.rotation;
        object3d.position.set(px,py,pz);
        object3d.quaternion.set(rx,ry,rz,rw);
        const s = propState.scale ?? 1;
        object3d.scale.set(s,s,s);
        bone.add(object3d);
        this._props.set(propState.id, object3d);
        this.markDirty();
    }

    /** Apply a new transform/bone to an already-attached prop. */
    updatePropTransform(propState) {
        const obj = this._props.get(propState.id);
        if (!obj) return;
        const targetBone = this._bones.get(propState.bone);
        if (targetBone && obj.parent !== targetBone) targetBone.add(obj); // re-parent (THREE removes from old parent)
        const [px,py,pz] = propState.position;
        const [rx,ry,rz,rw] = propState.rotation;
        obj.position.set(px,py,pz);
        obj.quaternion.set(rx,ry,rz,rw);
        const s = propState.scale ?? 1;
        obj.scale.set(s,s,s);
        this.markDirty();
    }

    /** Remove a prop from the scene. */
    removeProp(id) {
        const obj = this._props.get(id);
        if (obj && obj.parent) obj.parent.remove(obj);
        this._props.delete(id);
        this.markDirty();
    }

    get props() { return this._props; }
```
(Also ensure `this._props` is cleared in `buildMannequin` when bones are rebuilt — add `this._props.clear();` alongside `this._bones.clear()`.)

- [ ] **Step 4: Run → PASS.** Then `npm test`.

- [ ] **Step 5: Commit**
```bash
git add static/src/mannequin-renderer.js tests/js/props-renderer.test.js
git commit -m "feat(props): renderer attach/update/remove props on bone groups"
```

---

### Task 6: Props controller — load + sync store↔renderer + cache + recovery

**Files:**
- Create: `static/src/props-controller.js`
- Test: `tests/js/props-controller.test.js`

**Context:** orchestrates: given a prop state, load its geometry (library via `loadLibraryProp`, upload via cache `getPropBlob`+`parsePropGLB`), attach via `renderer.attachProp`. On upload, store the blob via `putPropBlob`. On scene load, reconcile `store.props` with the renderer; props whose geometry can't be loaded (upload, not in cache) become **missing** (tracked, not attached). Exposes `missingProps()` for the panel.

- [ ] **Step 1: Failing test** `tests/js/props-controller.test.js` — inject fakes for loader + cache + renderer so it's pure:
```javascript
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { PropsController } from '../../static/src/props-controller.js';

function fakeRenderer() {
    const attached = new Map();
    return {
        attachProp: vi.fn((p,o)=>attached.set(p.id,o)),
        removeProp: vi.fn(id=>attached.delete(id)),
        updatePropTransform: vi.fn(),
        _attached: attached,
    };
}
const fakeObj = () => ({ isObject3D:true });

describe('PropsController', () => {
    it('attaches a library prop via loadLibraryProp', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(async()=>fakeObj()), parsePropGLB: vi.fn(), getPropBlob: vi.fn(), putPropBlob: vi.fn() };
        const c = new PropsController(r, deps);
        await c.realize({ id:'p1', source:'lib', ref:'hat_01', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 });
        expect(deps.loadLibraryProp).toHaveBeenCalledWith('hat_01');
        expect(r.attachProp).toHaveBeenCalled();
        expect(c.missingProps()).toHaveLength(0);
    });
    it('marks an upload prop missing when cache has no blob', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(), parsePropGLB: vi.fn(), getPropBlob: vi.fn(async()=>null), putPropBlob: vi.fn() };
        const c = new PropsController(r, deps);
        await c.realize({ id:'p2', source:'upload', ref:'sword.glb', bone:'hand_R', position:[0,0,0], rotation:[0,0,0,1], scale:1 });
        expect(r.attachProp).not.toHaveBeenCalled();
        expect(c.missingProps().map(p=>p.ref)).toEqual(['sword.glb']);
    });
    it('autoloads an upload prop from cache when blob present', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(), parsePropGLB: vi.fn(async()=>fakeObj()), getPropBlob: vi.fn(async()=>new ArrayBuffer(4)), putPropBlob: vi.fn() };
        const c = new PropsController(r, deps);
        await c.realize({ id:'p3', source:'upload', ref:'sword.glb', bone:'hand_R', position:[0,0,0], rotation:[0,0,0,1], scale:1 });
        expect(deps.parsePropGLB).toHaveBeenCalled();
        expect(r.attachProp).toHaveBeenCalled();
        expect(c.missingProps()).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `static/src/props-controller.js`:
```javascript
import * as realLoaders from './props.js';
import * as realCache from './prop-cache.js';

export class PropsController {
    /** deps overridable for tests: {loadLibraryProp, parsePropGLB, getPropBlob, putPropBlob} */
    constructor(renderer, deps = {}) {
        this._renderer = renderer;
        this._loadLibraryProp = deps.loadLibraryProp ?? realLoaders.loadLibraryProp;
        this._parsePropGLB    = deps.parsePropGLB    ?? realLoaders.parsePropGLB;
        this._getPropBlob     = deps.getPropBlob     ?? realCache.getPropBlob;
        this._putPropBlob     = deps.putPropBlob     ?? realCache.putPropBlob;
        this._missing = new Map(); // id → propState
    }

    /** Load geometry for a prop state and attach it; track as missing if geometry unavailable. */
    async realize(propState) {
        let obj = null;
        try {
            if (propState.source === 'lib') {
                obj = await this._loadLibraryProp(propState.ref);
            } else {
                const buf = await this._getPropBlob(propState.ref);
                if (buf) obj = await this._parsePropGLB(buf);
            }
        } catch { obj = null; }
        if (obj) {
            this._missing.delete(propState.id);
            this._renderer.attachProp(propState, obj);
        } else {
            this._missing.set(propState.id, { ...propState });
        }
    }

    /** Register an uploaded GLB (cache it) then realize. */
    async addUpload(propState, arrayBuffer) {
        await this._putPropBlob(propState.ref, arrayBuffer);
        await this.realize(propState);
    }

    remove(id) { this._missing.delete(id); this._renderer.removeProp(id); }
    missingProps() { return [...this._missing.values()]; }
}
```

- [ ] **Step 4: Run → PASS.** Then `npm test`.

- [ ] **Step 5: Commit**
```bash
git add static/src/props-controller.js tests/js/props-controller.test.js
git commit -m "feat(props): controller — load/attach/cache + missing-prop tracking"
```

---

### Task 7: Props panel UI + toolbar button + main.js wiring

**Files:**
- Create: `static/src/panels/props-panel.js`
- Modify: `static/index.html` (toolbar button `#btn-objects` + CSS), `static/src/main.js`
- Test: `tests/js/props-panel.test.js`

**Context:** docked panel (like `hands-panel.js`): library buttons (from `PROP_LIBRARY`), an Upload GLB input, list of current props (select/remove + "missing" marker), and transform controls (bone dropdown + offset/rot/scale) for the selected prop. Toolbar id is `#btn-objects` (text "Props") — `#btn-props` is taken by "Model". Panel joins the `SIDE_PANELS` coordinator.

- [ ] **Step 1: Failing test** `tests/js/props-panel.test.js`:
```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PropsPanel } from '../../static/src/panels/props-panel.js';

describe('PropsPanel', () => {
    let api, panel;
    beforeEach(() => {
        document.body.innerHTML = '';
        api = { addLibraryProp: vi.fn(), addUpload: vi.fn(), removeProp: vi.fn(),
                listProps: () => [{ id:'p1', ref:'hat_01', bone:'head', missing:false }],
                onSelect: vi.fn() };
        panel = new PropsPanel(api);
        panel.mount(document.body);
    });
    it('mounts hidden and toggles', () => {
        expect(panel.isVisible()).toBe(false);
        panel.show(); expect(panel.isVisible()).toBe(true);
    });
    it('renders current props list with a remove control', () => {
        panel.refresh();
        expect(document.querySelector('[data-prop-id="p1"]')).toBeTruthy();
    });
    it('clicking a library button asks the api to add it', () => {
        const btn = document.querySelector('[data-lib-prop]');
        if (btn) { btn.click(); expect(api.addLibraryProp).toHaveBeenCalled(); }
        else expect(true).toBe(true); // empty library is allowed
    });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `static/src/panels/props-panel.js` following the `hands-panel.js` structure: a fixed right-side panel (`mount/show/hide/isVisible/toggle`), a "Library" section iterating `PROP_LIBRARY` (each button `data-lib-prop=<id>` → `api.addLibraryProp(id)`), an Upload `<input type=file accept=".glb">` → reads `arrayBuffer()` → `api.addUpload(file.name, buf)`, and a list container rendered by `refresh()` from `api.listProps()` — each row `data-prop-id`, a select handler `api.onSelect(id)`, a remove button `api.removeProp(id)`, and a "⚠ missing — re-upload" badge when `missing`. Match the inline-style + close-button pattern of `hands-panel.js`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Toolbar + CSS** — in `static/index.html` add after `#btn-overlays` (or near `#btn-hands`):
```html
  <button id="btn-objects" title="Props — attach 3-D objects to bones">Props</button>
```
CSS near the other buttons:
```css
#btn-objects { background: #333; color: #aaa; }
#btn-objects.active { background: #5a4a1a; color: #fed; }
```

- [ ] **Step 6: Wire in `static/src/main.js`** — import `PropsPanel`, `PropsController`, the loaders; create the controller with `renderer`; build an `api` object bridging panel → controller + history (Add/Remove via commands), instantiate+mount the panel, and add `{ panel: propsPanel, btn: document.getElementById('btn-objects') }` to `SIDE_PANELS`. Subscribe to the store to `propsPanel.refresh()` on changes. (This wiring is integration glue — verified in the browser, not unit-tested.)

- [ ] **Step 7: Run** `npm test` (panel test green; main.js not unit-tested).

- [ ] **Step 8: Commit**
```bash
git add static/src/panels/props-panel.js static/index.html static/src/main.js tests/js/props-panel.test.js
git commit -m "feat(props): props panel + toolbar button + wiring"
```

---

### Task 8: Selection + gizmo transform for props (editor)

**Files:**
- Modify: `static/src/mannequin-editor.js`
- Test: extend `tests/js/mannequin-editor-commands.test.js`

**Context:** clicking a prop (raycast hit with `userData.isProp`, or its ancestor) selects it and attaches `TransformControls` (mode togglable translate/rotate/scale); on drag end, commit a `TransformPropCommand` with prev/next (position/rotation/scale). The bone dropdown in the panel also routes through `TransformPropCommand`.

- [ ] **Step 1: Failing test** — add a unit test for the pure helper that reads a prop object's transform into the prop-state shape (the raycast/gizmo wiring itself is browser-verified):
```javascript
import { propTransformFromObject } from '../../static/src/mannequin-editor.js';
describe('propTransformFromObject', () => {
    it('reads position/rotation(quat)/uniform-scale from an Object3D-like', () => {
        const obj = { position:{x:0.1,y:0.2,z:0.3}, quaternion:{x:0,y:0,z:0,w:1}, scale:{x:2,y:2,z:2} };
        expect(propTransformFromObject(obj)).toEqual({ position:[0.1,0.2,0.3], rotation:[0,0,0,1], scale:2 });
    });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — export the helper from `mannequin-editor.js`:
```javascript
export function propTransformFromObject(obj) {
    return {
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
        scale: obj.scale.x,
    };
}
```
Then wire selection in the editor: in `_onCanvasClick`, after the bone pickables, also collect prop objects (`obj.userData.isProp` walking up parents). On a prop hit: deselect bone, attach `this._transform` to the prop object, remember the prop id + its transform-before; add a gizmo-mode toggle (translate/rotate/scale) bound to a key or a panel control. On `dragging-changed` end for a prop, build prev/next with `propTransformFromObject` and commit `new TransformPropCommand(id, prev, next)` through history. Follow the existing bone drag-commit pattern in the constructor.

- [ ] **Step 4: Run → PASS.** Then `npm test`.

- [ ] **Step 5: Commit**
```bash
git add static/src/mannequin-editor.js tests/js/mannequin-editor-commands.test.js
git commit -m "feat(props): click-select + gizmo transform for props (undoable)"
```

---

### Task 9: Scene load reconciliation + missing-prop recovery

**Files:**
- Modify: `static/src/main.js` (and/or a small `props-sync` helper)
- Test: covered by Task 6 controller tests (reconciliation logic lives there)

**Context:** when a scene is applied (`applyScene`/load/ComfyUI `SetSceneData`), realize every `store.props` entry through the controller (autoload uploads from cache; missing → tracked). After realize, `propsPanel.refresh()` shows missing entries with re-upload prompts. Uploading a file whose name matches a missing prop's `ref` re-realizes it at the saved transform.

- [ ] **Step 1:** Add a `syncProps(storeProps)` path in `main.js` that diffs current vs desired (remove dropped, realize new) and calls `controller.realize` per prop; call it on store changes (debounced) and after scene load. Wire the panel's "re-upload" to `controller.addUpload(propState, buf)` keyed by the missing prop's `ref`.
- [ ] **Step 2:** Browser verification (no unit test — integration): load a scene with a library prop → appears; add an upload, reload page → autoloads from IndexedDB; clear cache / different browser → prop listed as missing with the saved transform, re-upload restores it in place.
- [ ] **Step 3: Commit**
```bash
git add static/src/main.js
git commit -m "feat(props): scene-load reconciliation + missing-prop recovery wiring"
```

---

### Final: full verification

- [ ] `npm test` — whole suite green.
- [ ] Browser (serve `static/`, open editor): add a library prop (if any) and an uploaded GLB → both attach to the right bone and **follow the pose** when you rotate that bone.
- [ ] Export depth + canny → the prop **appears** in both; export pose/openpose → prop **absent**.
- [ ] Move/rotate/scale a prop with the gizmo; undo/redo works; bone dropdown re-parents.
- [ ] Save a pose with props, reload → library props restore; uploaded props autoload from IndexedDB; with cache cleared they show as missing with the saved transform and re-upload restores them.
- [ ] Toggle the Props panel against Poses/Model/Hands — only one docked panel open at a time.

## Notes for later (out of scope)
- Server-side prop rendering in `glb_renderer.py` / `headless_render.js` (so the ComfyUI scene-JSON re-render path includes props) — separate plan, mirrors fingers "Plan 1b".
- Non-uniform prop scale (`[x,y,z]`) if needed.
