/**
 * Tests: Renderer ↔ Store sync — Phase 3
 *
 * Renderer NIE importuje Three.js bezpośrednio w testach — mockujemy go.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Three.js mock ─────────────────────────────────────────────────────────────

vi.mock('../../static/lib/three.module.js', () => {
    const makeVec = () => ({ x:0, y:0, z:0, set(){}, copy(){}, clone(){ return makeVec(); },
        sub(){ return this; }, length(){ return 1; }, normalize(){ return this; },
        addVectors(){ return this; }, multiplyScalar(){ return this; },
        subVectors(){ return this; }, distanceTo(){ return 2; } });
    const makeQ   = () => ({ x:0, y:0, z:0, w:1, set(){}, copy(){}, setFromUnitVectors(){} });
    const makeMesh = () => ({ visible:true, userData:{}, geometry:{ dispose(){} },
        material:{ dispose(){}, color:{ setHex(){} } }, renderOrder:0,
        position: makeVec(), scale: makeVec(), quaternion: makeQ(),
        rotation: { set(){} },
        add(){}, remove(){}, traverse(fn){ fn(this); }, getWorldPosition(v){ return v; } });
    const makeScene = () => {
        const items = [];
        return { background:null, overrideMaterial:null,
            add(o){ items.push(o); }, remove(o){},
            traverse(fn){ items.forEach(o => { fn(o); if(o.traverse) o.traverse(fn); }); } };
    };
    const makeRenderer = () => ({
        setSize(){}, setPixelRatio(){}, render(){}, setClearColor(){},
        setRenderTarget(){}, readRenderTargetPixels(t,x,y,w,h,buf){ buf.fill(0); },
        forceContextLoss(){}, dispose(){},
        domElement: { toDataURL(){ return 'data:image/png;base64,'; } },
    });
    return {
        Scene: vi.fn(() => makeScene()),
        PerspectiveCamera: vi.fn(() => ({
            aspect:1, near:0.1, far:100, fov:45,
            position: makeVec(), updateProjectionMatrix(){}, lookAt(){},
            clone(){ return this; }, copy(o){ return this; },
        })),
        WebGLRenderer: vi.fn(() => makeRenderer()),
        WebGLRenderTarget: vi.fn(() => ({ setSize(){}, dispose(){} })),
        MeshDepthMaterial: vi.fn(() => ({ dispose(){} })),
        AmbientLight: vi.fn(() => makeMesh()),
        DirectionalLight: vi.fn(() => ({ ...makeMesh(), position: makeVec() })),
        GridHelper: vi.fn(() => makeMesh()),
        PlaneGeometry: vi.fn(() => ({ dispose(){} })),
        MeshBasicMaterial: vi.fn(() => ({ dispose(){}, color:{setHex(){}}, visible:true })),
        Mesh: vi.fn(() => makeMesh()),
        Group: vi.fn(() => { const g = makeMesh(); g.children=[]; g.add = o => g.children.push(o); return g; }),
        Object3D: vi.fn(() => makeMesh()),
        Box3: vi.fn(() => ({ setFromObject(){ return this; }, getCenter(v){ return v; },
            getSize(v){ v.length=()=>1; return v; } })),
        Vector3: vi.fn(() => makeVec()),
        Quaternion: vi.fn(() => makeQ()),
        Euler: vi.fn(() => ({ set(){} })),
        CylinderGeometry: vi.fn(() => ({ dispose(){} })),
        MathUtils: { degToRad: d => d * Math.PI / 180 },
        Color: vi.fn(),
    };
});

vi.mock('../../static/lib/OrbitControls.js',    () => ({ OrbitControls: vi.fn(() => ({ update(){}, dispose(){}, enableDamping:true, target:{ set(){} }, addEventListener(){} })) }));
vi.mock('../../static/lib/TransformControls.js',() => ({ TransformControls: vi.fn(() => ({ setMode(){}, setSpace(){}, userData:{}, addEventListener(){}, attach(){}, detach(){}, dispose(){}, add(){} })) }));

vi.mock('../../static/src/mannequin-model.js', () => ({
    BONE_NAMES: ['torso', 'chest', 'head', 'neck'],
    BONE_CHILDREN: { torso:['chest'], chest:['neck'], neck:['head'], head:[] },
    defaultScene: g => ({ gender:g, bones:{}, proportions:{} }),
    jsonToScene: x => x,
    defaultProportions: () => ({ head:1, bust:1, hips:1, waist:1, legs:1, arms:1 }),
    WORLD_HEIGHT: 2.0,
}));

vi.mock('../../static/src/geometry-adapter-gltf.js', () => ({
    buildSegments: async () => new Map(),
    computeBoneOffsets: async () => new Map(),
    WORLD_HEIGHT: 2.0,
    OPENPOSE_COLORS: {},
    JOINT_COLOR: 0xffffff,
    SELECT_COLOR: 0x00ff00,
}));

const { BUST_DEFAULTS } = await import('../../static/src/mannequin-renderer.js');

vi.mock('../../static/src/mannequin-renderer.js', async (importOriginal) => {
    const original = await importOriginal();
    return original;
});

vi.mock('../../static/src/mannequin-model.js', () => ({
    BONE_NAMES: ['torso', 'chest', 'head', 'neck'],
    BONE_CHILDREN: { torso:['chest'], chest:['neck'], neck:['head'], head:[] },
    defaultScene: g => ({ gender:g, bones:{}, proportions:{} }),
    jsonToScene: x => x,
    defaultProportions: () => ({ head:1, bust:1, hips:1, waist:1, legs:1, arms:1 }),
    WORLD_HEIGHT: 2.0,
}));

vi.mock('../../static/src/mannequin-renderer.js', () => ({
    BUST_DEFAULTS: { loc_z_base:0, loc_z:0.65, glob_z:0.2, loc_x:0.18, loc_y:0.3, glob_y:0.0,
                     rot_x:0.6, rot_z:-0.5, rot_y:0.5, scale_x:1.0 },
    MannequinRenderer: vi.fn(),  // not testing Three.js internals here
}));

// ── Import store after mocks ───────────────────────────────────────────────────

const { AppStore, defaultState } = await import('../../static/src/app-store.js');

const mkStore = () => new AppStore(defaultState());

// ── Tests: store subscription contracts ──────────────────────────────────────

describe('AppStore — store subscription protocol (renderer-facing API)', () => {
    it('subscribe receives full state on each change', () => {
        const s = mkStore();
        const received = [];
        s.subscribe(state => received.push({ ...state }));

        s.setState({ jointColorMode: 'flat' });
        s.setBustCfg({ loc_y: 0.9 });
        s.setProportions({ bust: 1.5 });

        expect(received).toHaveLength(3);
        expect(received[0].jointColorMode).toBe('flat');
        expect(received[1].bustCfg.loc_y).toBe(0.9);
        expect(received[2].proportions.bust).toBe(1.5);
    });

    it('subscriber sees reference equality for unchanged nested objects', () => {
        const s = mkStore();
        const states = [];
        s.subscribe(state => states.push(state));

        // Change only jointColorMode
        s.setState({ jointColorMode: 'flat' });
        // Change bustCfg
        s.setBustCfg({ loc_y: 0.9 });

        // proportions reference should differ between 0 and 1 (new state obj each time)
        // but the nested proportions object should still be the same if untouched
        expect(states[0].proportions).toBe(states[1].proportions);
    });

    it('setBustCfg preserves all other keys in bustCfg', () => {
        const s = mkStore();
        const orig = s.getState().bustCfg;
        s.setBustCfg({ loc_y: 0.9 });
        const updated = s.getState().bustCfg;
        expect(updated.loc_z).toBe(orig.loc_z);
        expect(updated.glob_z).toBe(orig.glob_z);
        expect(updated.rot_x).toBe(orig.rot_x);
    });

    it('setProportions preserves all other proportion fields', () => {
        const s = mkStore();
        s.setProportions({ bust: 2.0 });
        const p = s.getState().proportions;
        expect(p.head).toBe(1);
        expect(p.hips).toBe(1);
        expect(p.bust).toBe(2.0);
    });

    it('setOutputSize fires single notification for both dimensions', () => {
        const s = mkStore();
        const spy = vi.fn();
        s.subscribe(spy);
        s.setOutputSize(512, 768);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0].outputWidth).toBe(512);
        expect(spy.mock.calls[0][0].outputHeight).toBe(768);
    });

    it('unsubscribe stops renderer from receiving stale notifications', () => {
        const s = mkStore();
        const spy = vi.fn();
        const unsub = s.subscribe(spy);
        unsub();
        s.setBustCfg({ loc_y: 0.9 });
        s.setProportions({ bust: 2 });
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('SetGenderCommand — single notification', () => {
    it('execute fires exactly one notification', async () => {
        const { SetGenderCommand } = await import('../../static/src/commands.js');
        const s = mkStore();
        const spy = vi.fn();
        s.subscribe(spy);
        new SetGenderCommand('F', 'M', {}, {}).execute(s);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('undo fires exactly one notification', async () => {
        const { SetGenderCommand } = await import('../../static/src/commands.js');
        const s = mkStore();
        const cmd = new SetGenderCommand('F', 'M', {}, {});
        cmd.execute(s);
        const spy = vi.fn();
        s.subscribe(spy);
        cmd.undo(s);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('after execute, gender AND pose are set atomically', async () => {
        const { SetGenderCommand } = await import('../../static/src/commands.js');
        const s = mkStore();
        const Q1 = {x:0.1,y:0.2,z:0.3,w:0.9};
        new SetGenderCommand('F', 'M', {}, { head: Q1 }).execute(s);
        const state = s.getState();
        expect(state.gender).toBe('M');
        expect(state.pose.head).toEqual(Q1);
    });
});

describe('Commands use specific setters', () => {
    it('RotateBoneCommand uses setPoseBone (no shallow merge)', async () => {
        const { RotateBoneCommand } = await import('../../static/src/commands.js');
        const s = mkStore();
        const Q0 = {x:0,y:0,z:0,w:1};
        const Q1 = {x:0.1,y:0.2,z:0.3,w:0.9};
        // Pre-populate pose with another bone
        s.setPoseBone('neck', Q0);
        new RotateBoneCommand('head', Q0, Q1).execute(s);
        // Both bones should survive
        expect(s.getState().pose.head).toEqual(Q1);
        expect(s.getState().pose.neck).toEqual(Q0);
    });

    it('SetProportionsCommand uses setProportions (no full replace)', async () => {
        const { SetProportionsCommand } = await import('../../static/src/commands.js');
        const s = mkStore();
        const prev = s.getState().proportions;
        new SetProportionsCommand(prev, { ...prev, bust: 1.5 }).execute(s);
        expect(s.getState().proportions.bust).toBe(1.5);
        expect(s.getState().proportions.head).toBe(1);
    });

    it('SetBustCfgCommand uses setBustCfg (patch, not replace)', async () => {
        const { SetBustCfgCommand } = await import('../../static/src/commands.js');
        const s = mkStore();
        const prev = s.getState().bustCfg;
        new SetBustCfgCommand(prev, { ...prev, loc_y: 0.9 }).execute(s);
        expect(s.getState().bustCfg.loc_y).toBe(0.9);
        expect(s.getState().bustCfg.loc_z).toBe(prev.loc_z);
    });

    it('RandomPoseCommand throws on missing pose', async () => {
        const { RandomPoseCommand } = await import('../../static/src/commands.js');
        expect(() => new RandomPoseCommand({}, null)).toThrow();
        expect(() => new RandomPoseCommand({}, undefined)).toThrow();
    });
});
