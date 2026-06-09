// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { MannequinRenderer } from '../../static/src/mannequin-renderer.js';

// Fake bone whose getWorldPosition writes a fixed vector.
function fakeBone(x, y, z) {
    return { getWorldPosition: v => { v.set(x, y, z); return v; }, quaternion: { x:0, y:0, z:0, w:1 } };
}

function makeCamera() {
    const cam = new THREE.PerspectiveCamera(45, 0.75, 0.01, 100);
    cam.position.set(0, 1, 3);
    cam.lookAt(0, 1, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
}

describe('_captureHands', () => {
    it('returns a PNG data-URL drawn from both hands', () => {
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = makeCamera();
        r._outputWidth = 64;
        r._outputHeight = 64;
        r._bones = new Map([
            ['hand_L',  fakeBone(-0.2, 1, 0)], ['index_L', fakeBone(-0.25, 1.1, 0)],
            ['thumb_L', fakeBone(-0.15, 1.05, 0)], ['middle_L', fakeBone(-0.25, 1.12, 0)],
            ['ring_L',  fakeBone(-0.25, 1.1, 0)], ['pinky_L', fakeBone(-0.25, 1.08, 0)],
            ['hand_R',  fakeBone(0.2, 1, 0)],  ['index_R', fakeBone(0.25, 1.1, 0)],
            ['thumb_R', fakeBone(0.15, 1.05, 0)], ['middle_R', fakeBone(0.25, 1.12, 0)],
            ['ring_R',  fakeBone(0.25, 1.1, 0)], ['pinky_R', fakeBone(0.25, 1.08, 0)],
        ]);
        const url = r._captureHands(64, 64);
        expect(typeof url).toBe('string');
        expect(url.startsWith('data:image/png')).toBe(true);
    });
});

describe('_computeHandKeypoints', () => {
    it('returns 21 points with wrist first, each having x and y', () => {
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = makeCamera();
        r._outputWidth = 100;
        r._outputHeight = 100;
        r._bones = new Map([
            ['hand_L',   fakeBone(0,    1,    0)],
            ['thumb_L',  fakeBone(0.10, 1,    0)],
            ['index_L',  fakeBone(0.20, 1,    0)],
            ['middle_L', fakeBone(0.20, 1.05, 0)],
            ['ring_L',   fakeBone(0.20, 1.10, 0)],
            ['pinky_L',  fakeBone(0.20, 1.15, 0)],
        ]);
        const kps = r._computeHandKeypoints('L');
        expect(kps).toHaveLength(21);
        expect(kps[0]).toBeTruthy();              // wrist present
        for (const p of kps) {
            if (!p) continue;
            expect(typeof p.x).toBe('number');
            expect(typeof p.y).toBe('number');
        }
    });

    it('places finger base/tip at the documented indices and interpolates middles', () => {
        // No fingerTipLocal set → exercises fallback path (legacy base-wrist heuristic)
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = makeCamera();
        r._outputWidth = 100;
        r._outputHeight = 100;
        r._bones = new Map([
            ['hand_L',  fakeBone(0,    1, 0)],
            ['index_L', fakeBone(0.20, 1, 0)],
        ]);
        const kps = r._computeHandKeypoints('L');
        const base = kps[5], j1 = kps[6], j2 = kps[7], tip = kps[8];
        expect(base).toBeTruthy(); expect(tip).toBeTruthy();
        // j1 ~ 1/3 between base and tip; j2 ~ 2/3
        expect(j1.x).toBeCloseTo(base.x + (tip.x - base.x) / 3, 3);
        expect(j2.x).toBeCloseTo(base.x + (tip.x - base.x) * 2 / 3, 3);
    });
});

// Helper to create a minimal renderer with real THREE scene graph support
function realRenderer(camera, W, H) {
    const r = Object.create(MannequinRenderer.prototype);
    r._camera = camera;
    r._outputWidth = W;
    r._outputHeight = H;
    r._bones = new Map();
    return r;
}

describe('keypoints follow finger rotation', () => {
    it('tip moves when the finger bone rotates; base (knuckle) stays', () => {
        const cam = makeCamera();
        const scene = new THREE.Scene();
        const hand = new THREE.Object3D(); hand.position.set(0.2, 1, 0); scene.add(hand);
        const index = new THREE.Object3D(); index.position.set(0, 0, 0); hand.add(index); // knuckle at hand
        index.userData.fingerTipLocal = new THREE.Vector3(0, -0.1, 0); // points down 10cm at rest
        scene.updateMatrixWorld(true);

        const r = realRenderer(cam, 100, 100);
        r._bones.set('hand_L', hand);
        r._bones.set('index_L', index);

        const before = r._computeHandKeypoints('L');
        const baseBefore = before[5], tipBefore = before[8];

        // rotate the finger 90° about Z and recompute
        index.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
        scene.updateMatrixWorld(true);
        const after = r._computeHandKeypoints('L');
        const baseAfter = after[5], tipAfter = after[8];

        // base (knuckle) is the pivot — unchanged
        expect(baseAfter.x).toBeCloseTo(baseBefore.x, 3);
        expect(baseAfter.y).toBeCloseTo(baseBefore.y, 3);
        // tip swings — must differ meaningfully
        const moved = Math.hypot(tipAfter.x - tipBefore.x, tipAfter.y - tipBefore.y);
        expect(moved).toBeGreaterThan(1); // more than 1px on a 100px canvas
    });

    it('falls back to base-wrist heuristic and still returns 21 points when fingerTipLocal is absent', () => {
        const cam = makeCamera();
        const r = realRenderer(cam, 100, 100);
        const hand = new THREE.Object3D(); hand.position.set(0, 1, 0);
        const idx = new THREE.Object3D(); idx.position.set(0.2, 1, 0);
        const scene = new THREE.Scene(); scene.add(hand); scene.add(idx); scene.updateMatrixWorld(true);
        r._bones.set('hand_L', hand);
        r._bones.set('index_L', idx);
        const kps = r._computeHandKeypoints('L');
        expect(kps).toHaveLength(21);
        expect(kps[5]).toBeTruthy(); // index base present
    });
});

describe('_computeFingerTipLocals', () => {
    it('sets fingerTipLocal to the farthest geometry corner in bone-local space', () => {
        const r = Object.create(MannequinRenderer.prototype);
        const scene = new THREE.Scene();
        const hand = new THREE.Object3D(); hand.position.set(0.2, 1, 0); scene.add(hand);
        const index = new THREE.Object3D(); hand.add(index);              // finger bone at knuckle
        // segment mesh: a 0.02 x 0.1 x 0.02 box, shifted so it extends -Y from the knuckle
        const geo = new THREE.BoxGeometry(0.02, 0.1, 0.02);
        const mesh = new THREE.Mesh(geo);
        mesh.position.set(0, -0.05, 0);            // box centered 5cm below the bone origin
        mesh.userData.boneName = 'index_L';
        index.add(mesh);
        scene.updateMatrixWorld(true);

        r._bones = new Map([['index_L', index]]);
        r._mannequinRoot = scene;                  // helper updates world matrices from here
        r._computeFingerTipLocals();

        const tip = index.userData.fingerTipLocal;
        expect(tip).toBeTruthy();
        // farthest corner from bone origin is at about y = -0.1 (box bottom), small x/z
        expect(tip.y).toBeLessThan(-0.08);
        expect(Math.abs(tip.x)).toBeLessThan(0.02);
    });

    it('leaves fingerTipLocal unset when the finger bone has no mesh', () => {
        const r = Object.create(MannequinRenderer.prototype);
        const scene = new THREE.Scene();
        const idx = new THREE.Object3D(); scene.add(idx);
        scene.updateMatrixWorld(true);
        r._bones = new Map([['index_L', idx]]);
        r._mannequinRoot = scene;
        r._computeFingerTipLocals();
        expect(idx.userData.fingerTipLocal).toBeUndefined();
    });
});
