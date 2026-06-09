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

// ---------------------------------------------------------------------------
// _captureHands — updated bone map to phalange names
// ---------------------------------------------------------------------------
describe('_captureHands', () => {
    it('returns a PNG data-URL drawn from both hands', () => {
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = makeCamera();
        r._outputWidth = 64;
        r._outputHeight = 64;
        r._bones = new Map([
            ['hand_L',        fakeBone(-0.2,  1,    0)],
            ['thumb_L_1',     fakeBone(-0.15, 1.05, 0)],
            ['thumb_L_2',     fakeBone(-0.13, 1.08, 0)],
            ['index_L_1',     fakeBone(-0.25, 1.10, 0)],
            ['index_L_2',     fakeBone(-0.27, 1.13, 0)],
            ['index_L_3',     fakeBone(-0.28, 1.15, 0)],
            ['middle_L_1',    fakeBone(-0.25, 1.12, 0)],
            ['ring_L_1',      fakeBone(-0.25, 1.10, 0)],
            ['pinky_L_1',     fakeBone(-0.25, 1.08, 0)],
            ['hand_R',        fakeBone( 0.2,  1,    0)],
            ['thumb_R_1',     fakeBone( 0.15, 1.05, 0)],
            ['thumb_R_2',     fakeBone( 0.13, 1.08, 0)],
            ['index_R_1',     fakeBone( 0.25, 1.10, 0)],
            ['index_R_2',     fakeBone( 0.27, 1.13, 0)],
            ['index_R_3',     fakeBone( 0.28, 1.15, 0)],
        ]);
        const url = r._captureHands(64, 64);
        expect(typeof url).toBe('string');
        expect(url.startsWith('data:image/png')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// _computeHandKeypoints — phalange chain tests
// ---------------------------------------------------------------------------
describe('_computeHandKeypoints', () => {

    it('returns 21 points with wrist first; each non-null point has x and y', () => {
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = makeCamera();
        r._outputWidth = 100;
        r._outputHeight = 100;
        r._bones = new Map([
            ['hand_L',     fakeBone(0,    1,    0)],
            ['thumb_L_1',  fakeBone(0.05, 1,    0)],
            ['thumb_L_2',  fakeBone(0.07, 1,    0)],
            ['index_L_1',  fakeBone(0.10, 1,    0)],
            ['index_L_2',  fakeBone(0.13, 1,    0)],
            ['index_L_3',  fakeBone(0.15, 1,    0)],
            ['middle_L_1', fakeBone(0.10, 1.05, 0)],
            ['middle_L_2', fakeBone(0.13, 1.05, 0)],
            ['middle_L_3', fakeBone(0.15, 1.05, 0)],
            ['ring_L_1',   fakeBone(0.10, 1.10, 0)],
            ['pinky_L_1',  fakeBone(0.10, 1.15, 0)],
        ]);
        const kps = r._computeHandKeypoints('L');
        expect(kps).toHaveLength(21);
        expect(kps[0]).toBeTruthy(); // wrist present
        for (const p of kps) {
            if (!p) continue;
            expect(typeof p.x).toBe('number');
            expect(typeof p.y).toBe('number');
        }
    });

    it('maps phalange joints to OpenPose indices: MCP/PIP/DIP at start/+1/+2', () => {
        // index finger: hand_L at (0,1,0); _1 MCP, _2 PIP, _3 DIP spread along +x
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = makeCamera();
        r._outputWidth = 100;
        r._outputHeight = 100;
        r._bones = new Map([
            ['hand_L',    fakeBone(0,    1, 0)],
            ['index_L_1', fakeBone(0.05, 1, 0)],   // MCP  → kp[5]
            ['index_L_2', fakeBone(0.08, 1, 0)],   // PIP  → kp[6]
            ['index_L_3', fakeBone(0.10, 1, 0)],   // DIP  → kp[7]
        ]);
        const kps = r._computeHandKeypoints('L');
        expect(kps[5]).toBeTruthy(); // MCP
        expect(kps[6]).toBeTruthy(); // PIP
        expect(kps[7]).toBeTruthy(); // DIP
        expect(kps[8]).toBeTruthy(); // tip (fallback extrapolation)

        // All four points should be distinct (x ordering follows 3-D +x spread)
        expect(kps[5].x).not.toBeCloseTo(kps[6].x, 1);
        expect(kps[6].x).not.toBeCloseTo(kps[7].x, 1);
        expect(kps[7].x).not.toBeCloseTo(kps[8].x, 1);

        // In screen space the further-right world-x projects to a higher screen-x
        // (camera looks along -Z toward origin, so +world-x → +screen-x)
        expect(kps[6].x).toBeGreaterThan(kps[5].x);
        expect(kps[7].x).toBeGreaterThan(kps[6].x);
        expect(kps[8].x).toBeGreaterThan(kps[7].x); // tip continues past DIP
    });

    it('fallback: with no fingerTipLocal, kps has 21 entries and index tip (kp[8]) is non-null when full chain exists', () => {
        const cam = makeCamera();
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = cam;
        r._outputWidth = 100;
        r._outputHeight = 100;
        const scene = new THREE.Scene();
        const hand = new THREE.Object3D(); hand.position.set(0, 1, 0); scene.add(hand);
        const idx1 = new THREE.Object3D(); idx1.position.set(0.05, 0, 0); hand.add(idx1);
        const idx2 = new THREE.Object3D(); idx2.position.set(0.03, 0, 0); idx1.add(idx2);
        const idx3 = new THREE.Object3D(); idx3.position.set(0.02, 0, 0); idx2.add(idx3);
        scene.updateMatrixWorld(true);
        r._bones = new Map([
            ['hand_L',    hand],
            ['index_L_1', idx1],
            ['index_L_2', idx2],
            ['index_L_3', idx3],
        ]);
        const kps = r._computeHandKeypoints('L');
        expect(kps).toHaveLength(21);
        expect(kps[8]).toBeTruthy(); // tip non-null via extrapolation
    });

    it('missing finger bones leave those kps as null', () => {
        const r = Object.create(MannequinRenderer.prototype);
        r._camera = makeCamera();
        r._outputWidth = 100;
        r._outputHeight = 100;
        r._bones = new Map([
            ['hand_L',    fakeBone(0, 1, 0)],
            ['index_L_1', fakeBone(0.05, 1, 0)],
            // no _2 or _3 → PIP, DIP will be null; tip extrapolated from single-bone chain
        ]);
        const kps = r._computeHandKeypoints('L');
        expect(kps).toHaveLength(21);
        expect(kps[5]).toBeTruthy();  // MCP present
        expect(kps[6]).toBeNull();    // PIP absent (no _2 bone)
        expect(kps[7]).toBeNull();    // DIP absent (no _3 bone)
        expect(kps[8]).toBeTruthy();  // tip extrapolated from the only available bone
        // middle/ring/pinky are entirely absent → all null
        expect(kps[9]).toBeNull();
        expect(kps[13]).toBeNull();
        expect(kps[17]).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// keypoints follow real THREE hierarchy rotation
// ---------------------------------------------------------------------------

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
    it('tip moves when the distal bone rotates; MCP (kp[5]) stays', () => {
        const cam = makeCamera();
        const scene = new THREE.Scene();

        // Build hierarchy: hand → index_1 (MCP) → index_2 (PIP) → index_3 (DIP/distal)
        const hand   = new THREE.Object3D(); hand.position.set(0.2, 1, 0); scene.add(hand);
        const idx1   = new THREE.Object3D(); idx1.position.set(0, 0, 0); hand.add(idx1);   // MCP at hand
        const idx2   = new THREE.Object3D(); idx2.position.set(0, -0.04, 0); idx1.add(idx2);
        const idx3   = new THREE.Object3D(); idx3.position.set(0, -0.03, 0); idx2.add(idx3);
        idx3.userData.fingerTipLocal = new THREE.Vector3(0, -0.03, 0); // distal tip down
        scene.updateMatrixWorld(true);

        const r = realRenderer(cam, 100, 100);
        r._bones.set('hand_L',    hand);
        r._bones.set('index_L_1', idx1);
        r._bones.set('index_L_2', idx2);
        r._bones.set('index_L_3', idx3);

        const before      = r._computeHandKeypoints('L');
        const mcpBefore   = before[5];
        const tipBefore   = before[8];

        // Rotate distal bone 90° about Z, recompute
        idx3.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
        scene.updateMatrixWorld(true);
        const after     = r._computeHandKeypoints('L');
        const mcpAfter  = after[5];
        const tipAfter  = after[8];

        // MCP (pivot) stays unchanged
        expect(mcpAfter.x).toBeCloseTo(mcpBefore.x, 3);
        expect(mcpAfter.y).toBeCloseTo(mcpBefore.y, 3);

        // Tip swings — must differ meaningfully
        const moved = Math.hypot(tipAfter.x - tipBefore.x, tipAfter.y - tipBefore.y);
        expect(moved).toBeGreaterThan(1); // > 1px on 100px canvas
    });
});

// ---------------------------------------------------------------------------
// _computeFingerTipLocals — distal bones only
// ---------------------------------------------------------------------------
describe('_computeFingerTipLocals', () => {
    it('sets fingerTipLocal on the distal bone when a mesh is attached (index_L_3)', () => {
        const r = Object.create(MannequinRenderer.prototype);
        const scene = new THREE.Scene();
        const hand  = new THREE.Object3D(); hand.position.set(0.2, 1, 0); scene.add(hand);
        const distal = new THREE.Object3D(); hand.add(distal); // index_L_3 (distal phalange)

        // Segment mesh: 0.02 x 0.1 x 0.02 box, shifted so it extends -Y from the bone origin
        const geo  = new THREE.BoxGeometry(0.02, 0.1, 0.02);
        const mesh = new THREE.Mesh(geo);
        mesh.position.set(0, -0.05, 0);         // box centered 5 cm below bone origin
        mesh.userData.boneName = 'index_L_3';
        distal.add(mesh);
        scene.updateMatrixWorld(true);

        r._bones = new Map([['index_L_3', distal]]);
        r._mannequinRoot = scene;
        r._computeFingerTipLocals();

        const tip = distal.userData.fingerTipLocal;
        expect(tip).toBeTruthy();
        // Farthest corner from bone origin should be near y = -0.1 (box bottom)
        expect(tip.y).toBeLessThan(-0.08);
        expect(Math.abs(tip.x)).toBeLessThan(0.02);
    });

    it('leaves fingerTipLocal unset when the distal bone has no mesh', () => {
        const r = Object.create(MannequinRenderer.prototype);
        const scene = new THREE.Scene();
        const distal = new THREE.Object3D(); scene.add(distal);
        scene.updateMatrixWorld(true);
        r._bones = new Map([['index_L_3', distal]]);
        r._mannequinRoot = scene;
        r._computeFingerTipLocals();
        expect(distal.userData.fingerTipLocal).toBeUndefined();
    });

    it('does NOT set fingerTipLocal on non-distal bones (index_L_1 ignored)', () => {
        const r = Object.create(MannequinRenderer.prototype);
        const scene = new THREE.Scene();
        const mcp = new THREE.Object3D(); scene.add(mcp);
        const geo  = new THREE.BoxGeometry(0.02, 0.04, 0.02);
        const mesh = new THREE.Mesh(geo);
        mesh.userData.boneName = 'index_L_1'; // proximal — should be skipped
        mcp.add(mesh);
        scene.updateMatrixWorld(true);
        r._bones = new Map([['index_L_1', mcp]]);
        r._mannequinRoot = scene;
        r._computeFingerTipLocals();
        // _DISTAL_BONES does not include index_L_1, so it's never iterated
        expect(mcp.userData.fingerTipLocal).toBeUndefined();
    });
});
