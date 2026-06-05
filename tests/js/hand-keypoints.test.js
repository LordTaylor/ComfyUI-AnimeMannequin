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
