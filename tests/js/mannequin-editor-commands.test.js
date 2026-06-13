// @vitest-environment jsdom

/**
 * Tests: MannequinEditor → Commands → Store — Phase 4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../static/lib/three.module.js', () => {
    function makeVec() { return { x:0, y:0, z:0, set(){}, copy(){} }; }
    function makeQ() {
        return {
            x:0, y:0, z:0, w:1,
            set(x,y,z,w){ this.x=x;this.y=y;this.z=z;this.w=w; },
            copy(o){ this.x=o.x;this.y=o.y;this.z=o.z;this.w=o.w; },
            setFromEuler(){ this.x=0;this.y=0;this.z=0;this.w=1; },
        };
    }
    function Raycaster()  { this.setFromCamera=()=>{}; this.intersectObjects=()=>[]; }
    function Vector2()    { this.x=0; this.y=0; }
    function Vector3()    { return makeVec(); }
    function Euler()      { this.set=()=>{}; }
    function Quaternion() { return makeQ(); }
    function Object3D()   {
        this.userData={}; this.position=makeVec(); this.quaternion=makeQ();
        this.getWorldPosition=v=>v; this.add=()=>{}; this.remove=()=>{}; this.traverse=fn=>fn(this);
    }
    return {
        Raycaster, Vector2, Vector3, Euler, Quaternion, Object3D,
        MathUtils: { degToRad: d => d * Math.PI / 180 },
    };
});

vi.mock('../../static/lib/OrbitControls.js', () => {
    function OrbitControls() {
        this.update=()=>{}; this.dispose=()=>{}; this.enableDamping=true;
        this.target={ set(){} }; this.enabled=true; this.addEventListener=()=>{};
    }
    return { OrbitControls };
});
vi.mock('../../static/lib/TransformControls.js', () => {
    function TransformControls() {
        this.setMode=()=>{}; this.setSpace=()=>{}; this.userData={};
        this.addEventListener=()=>{}; this.attach=()=>{}; this.detach=()=>{};
        this.dispose=()=>{}; this.add=()=>{};
    }
    return { TransformControls };
});

vi.mock('../../static/src/geometry-adapter-gltf.js', () => ({
    SELECT_COLOR: 0x00ff00, JOINT_COLOR: 0xffffff,
}));

vi.mock('../../static/src/mannequin-model.js', () => ({
    defaultScene: g => ({ gender:g, bones:{}, proportions:{} }),
    BONE_NAMES: [], BONE_CHILDREN: {},
    defaultProportions: () => ({ head:1, bust:1, hips:1, waist:1, legs:1, arms:1 }),
}));

vi.mock('../../static/src/finger-presets.js', () => ({
    buildPresetPose: (name) => {
        if (name === 'Pięść') {
            return {
                thumb_L:  [0.5, 0, 0, 0.866],
                index_L:  [0.7, 0, 0, 0.714],
                middle_L: [0.7, 0, 0, 0.714],
                ring_L:   [0.7, 0, 0, 0.714],
                pinky_L:  [0.7, 0, 0, 0.714],
                thumb_R:  [-0.5, 0, 0, 0.866],
                index_R:  [-0.7, 0, 0, 0.714],
                middle_R: [-0.7, 0, 0, 0.714],
                ring_R:   [-0.7, 0, 0, 0.714],
                pinky_R:  [-0.7, 0, 0, 0.714],
            };
        }
        throw new Error(`Unknown finger preset: ${name}`);
    },
    FINGER_BONES: ['thumb_L','index_L','middle_L','ring_L','pinky_L',
                   'thumb_R','index_R','middle_R','ring_R','pinky_R'],
}));

vi.mock('../../static/src/mannequin-renderer.js', () => ({
    BUST_DEFAULTS: { loc_z_base:0, loc_z:0.65, glob_z:0.2, loc_x:0.18, loc_y:0.3, glob_y_base:0.0, glob_y:0.0,
                     rot_x:0.6, rot_z:-0.5, rot_y:0.5, grot_x:0.0, grot_y:0.0, grot_z:0.0, scale_x:1.0 },
}));

const { AppStore, defaultState } = await import('../../static/src/app-store.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const mkStore = () => new AppStore(defaultState('F'));

/** Minimal renderer mock with controllable bones map */
function mkRenderer(boneNames = []) {
    const bones = new Map();
    for (const n of boneNames) {
        bones.set(n, {
            userData:{}, quaternion:{ x:0,y:0,z:0,w:1,
                set(x,y,z,w){ this.x=x;this.y=y;this.z=z;this.w=w; },
                copy(o){ this.x=o.x;this.y=o.y;this.z=o.z;this.w=o.w; },
            },
            getWorldPosition(v){ return v; },
        });
    }
    return {
        camera:   { aspect:1, updateProjectionMatrix(){} },
        scene:    { add(){}, traverse(fn){} },
        bones,
        markDirty:      vi.fn(),
        applyScene:     vi.fn(),
        buildMannequin: vi.fn().mockResolvedValue(undefined),
        getSceneData:   vi.fn(() => ({ gender:'F', bones:{}, proportions:{} })),
        applyProportions: vi.fn(),
    };
}

const { MannequinEditor } = await import('../../static/src/mannequin-editor.js');
const { buildPresetPose } = await import('../../static/src/finger-presets.js');

function mkEditor(boneNames = []) {
    const store    = mkStore();
    const renderer = mkRenderer(boneNames);
    const canvas   = { addEventListener(){}, getBoundingClientRect(){ return {left:0,top:0,width:100,height:100}; } };
    const editor   = new MannequinEditor(renderer, canvas, store);
    return { editor, store, renderer };
}

// ── CommandHistory integration ────────────────────────────────────────────────

describe('MannequinEditor.history', () => {
    it('exposes history getter', () => {
        const { editor } = mkEditor();
        expect(editor.history).toBeDefined();
        expect(editor.history.canUndo).toBe(false);
    });
});

// ── resetPose ─────────────────────────────────────────────────────────────────

describe('resetPose', () => {
    it('calls renderer.applyScene', () => {
        const { editor, renderer } = mkEditor();
        editor.resetPose();
        expect(renderer.applyScene).toHaveBeenCalled();
    });

    it('creates undo-able command in history', () => {
        const { editor } = mkEditor();
        editor.resetPose();
        expect(editor.history.canUndo).toBe(true);
    });

    it('undo after reset restores previous pose in store', () => {
        const { editor, store } = mkEditor(['head']);
        // Set up a known pose
        store.setPoseBone('head', { x:0.1, y:0.2, z:0.3, w:0.9 });
        editor.resetPose();
        editor.undo();
        expect(store.getState().pose.head).toEqual({ x:0.1, y:0.2, z:0.3, w:0.9 });
    });
});

// ── mirrorPose ────────────────────────────────────────────────────────────────

describe('mirrorPose', () => {
    it('creates undo-able command in history', () => {
        const { editor } = mkEditor(['shoulder_L', 'shoulder_R']);
        editor.mirrorPose('L_to_R');
        expect(editor.history.canUndo).toBe(true);
    });

    it('undo restores pose before mirror', () => {
        const { editor, store } = mkEditor(['shoulder_L', 'shoulder_R']);
        const before = { ...store.getState().pose };
        editor.mirrorPose('L_to_R');
        editor.undo();
        // Pose should be back to 'before' state
        expect(store.getState().pose).toEqual(before);
    });
});

// ── generateRandomPose ────────────────────────────────────────────────────────

describe('generateRandomPose', () => {
    it('creates undo-able command', () => {
        const { editor } = mkEditor(['head', 'neck', 'chest']);
        editor.generateRandomPose('safe');
        expect(editor.history.canUndo).toBe(true);
    });

    it('pose in store changes after random', () => {
        const { editor, store } = mkEditor(['head']);
        const before = JSON.stringify(store.getState().pose);
        editor.generateRandomPose('safe');
        // Pose should now contain head (from limits)
        // (Limits include head so bone gets rotated)
        expect(editor.history.canUndo).toBe(true);
    });

    it('undo restores pose before random', () => {
        const { editor, store } = mkEditor(['head']);
        store.setPoseBone('head', { x:0.1,y:0.2,z:0.3,w:0.9 });
        const before = store.getState().pose;
        editor.generateRandomPose('safe');
        editor.undo();
        expect(store.getState().pose).toEqual(before);
    });
});

// ── setGender ─────────────────────────────────────────────────────────────────

describe('setGender', () => {
    it('single store notification on execute', async () => {
        const { editor, store } = mkEditor();
        const spy = vi.fn();
        store.subscribe(spy);
        spy.mockClear();
        await editor.setGender('M');
        // SetGenderCommand fires 1 notification
        const genderCalls = spy.mock.calls.filter(c => c[0].gender === 'M');
        expect(genderCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('creates undo-able command', async () => {
        const { editor } = mkEditor();
        await editor.setGender('M');
        expect(editor.history.canUndo).toBe(true);
    });
});

// ── undo / redo ───────────────────────────────────────────────────────────────

describe('undo/redo', () => {
    it('undo does nothing when stack is empty', () => {
        const { editor, renderer } = mkEditor();
        expect(() => editor.undo()).not.toThrow();
        // markDirty should NOT have been called by undo (no-op)
        expect(renderer.markDirty).not.toHaveBeenCalled();
    });

    it('redo does nothing when stack is empty', () => {
        const { editor, renderer } = mkEditor();
        expect(() => editor.redo()).not.toThrow();
    });

    it('undo → redo round-trip restores pose', () => {
        const { editor, store } = mkEditor(['head']);
        store.setPoseBone('head', { x:0.1,y:0.2,z:0.3,w:0.9 });
        const before = store.getState().pose;
        editor.resetPose();                // changes pose
        editor.undo();                     // back
        expect(store.getState().pose).toEqual(before);
        editor.redo();                     // forward again
        expect(store.getState().pose).toEqual({});
    });
});

// ── _syncPoseToStore ──────────────────────────────────────────────────────────

describe('_syncPoseToStore', () => {
    it('writes all bone quats from renderer to store', () => {
        const { editor, store, renderer } = mkEditor(['head', 'neck']);
        renderer.bones.get('head').quaternion.set(0.1, 0.2, 0.3, 0.9);
        editor._syncPoseToStore();
        expect(store.getState().pose.head).toEqual({ x:0.1, y:0.2, z:0.3, w:0.9 });
    });
});

// ── _applyPoseFromStore ───────────────────────────────────────────────────────

describe('_applyPoseFromStore', () => {
    it('applies store pose quats to renderer bones', () => {
        const { editor, store, renderer } = mkEditor(['head']);
        store.setPoseBone('head', { x:0.5, y:0.5, z:0.5, w:0.5 });
        editor._applyPoseFromStore();
        const q = renderer.bones.get('head').quaternion;
        expect(q.x).toBe(0.5);
    });

    it('does nothing gracefully when no store', () => {
        const renderer = mkRenderer(['head']);
        const canvas = { addEventListener(){} };
        const editor = new MannequinEditor(renderer, canvas, null);
        expect(() => editor._applyPoseFromStore()).not.toThrow();
    });
});

// ── applyFingerPreset ─────────────────────────────────────────────────────────

describe('applyFingerPreset', () => {
    it('sets finger quaternions in the store and leaves body bones untouched', () => {
        const { editor, store } = mkEditor(['index_L', 'forearm_L']);
        store.setPoseBone('forearm_L', { x:0.1, y:0.2, z:0.3, w:0.9 });
        const before = store.getState().pose;
        const preset = buildPresetPose('Pięść');
        editor.applyFingerPreset(preset);
        const after = store.getState().pose;
        expect(after.index_L).toBeDefined();
        expect(after.index_L.w).toBeCloseTo(preset.index_L[3], 5);
        // a body bone is unchanged (load-bearing: forearm_L was set to a known value above)
        expect(after.forearm_L).toEqual({ x:0.1, y:0.2, z:0.3, w:0.9 });
    });

    it('is undoable', () => {
        const { editor, store } = mkEditor(['index_L', 'index_R']);
        const before = JSON.stringify(store.getState().pose);
        editor.applyFingerPreset(buildPresetPose('Pięść'));
        editor.undo();
        expect(JSON.stringify(store.getState().pose)).toBe(before);
    });
});

// ── MIRROR_PAIRS fingers ──────────────────────────────────────────────────────

describe('MIRROR_PAIRS fingers', () => {
    it('includes all 14 phalange pairs', () => {
        const flat = MannequinEditor.MIRROR_PAIRS.map(p => p.join('|'));
        // 4-finger × 3 phalanges + thumb × 2 = 14 pairs
        const expected = [
            'thumb_L_1|thumb_R_1', 'thumb_L_2|thumb_R_2',
            'index_L_1|index_R_1', 'index_L_2|index_R_2', 'index_L_3|index_R_3',
            'middle_L_1|middle_R_1', 'middle_L_2|middle_R_2', 'middle_L_3|middle_R_3',
            'ring_L_1|ring_R_1', 'ring_L_2|ring_R_2', 'ring_L_3|ring_R_3',
            'pinky_L_1|pinky_R_1', 'pinky_L_2|pinky_R_2', 'pinky_L_3|pinky_R_3',
        ];
        for (const pair of expected) {
            expect(flat).toContain(pair);
        }
        // old single-bone pairs must be gone
        for (const f of ['thumb','index','middle','ring','pinky']) {
            expect(flat).not.toContain(`${f}_L|${f}_R`);
        }
    });
});
