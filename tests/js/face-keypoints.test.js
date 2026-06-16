import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { computeFaceKeypoints } from '../../static/src/mannequin-renderer.js';

// A-pose-ish head: head above neck, shoulders on ±X, model facing +Z.
function setup() {
    const head = new THREE.Vector3(0, 1.60, 0);
    const neck = new THREE.Vector3(0, 1.45, 0);
    const shL  = new THREE.Vector3(0.20, 1.42, 0);   // model's left = +X
    const shR  = new THREE.Vector3(-0.20, 1.42, 0);
    return { head, neck, shL, shR, face: computeFaceKeypoints(head, neck, shL, shR) };
}

describe('computeFaceKeypoints', () => {
    it('returns the four face keypoints', () => {
        const { face } = setup();
        expect(Object.keys(face).sort()).toEqual(['ear_L', 'ear_R', 'eye_L', 'eye_R']);
    });

    it('eyes sit forward (+Z) and above the head origin', () => {
        const { head, face } = setup();
        for (const e of [face.eye_L, face.eye_R]) {
            expect(e.z).toBeGreaterThan(head.z);   // forward toward camera
            expect(e.y).toBeGreaterThan(head.y);   // up
        }
    });

    it('left keypoints are on +X, right on -X (model-correct sides)', () => {
        const { face } = setup();
        expect(face.eye_L.x).toBeGreaterThan(0);
        expect(face.eye_R.x).toBeLessThan(0);
        expect(face.ear_L.x).toBeGreaterThan(0);
        expect(face.ear_R.x).toBeLessThan(0);
    });

    it('ears are wider than eyes (further out to the sides)', () => {
        const { face } = setup();
        expect(Math.abs(face.ear_L.x)).toBeGreaterThan(Math.abs(face.eye_L.x));
        expect(Math.abs(face.ear_R.x)).toBeGreaterThan(Math.abs(face.eye_R.x));
    });

    it('is symmetric left/right about X', () => {
        const { face } = setup();
        expect(face.eye_L.x).toBeCloseTo(-face.eye_R.x, 6);
        expect(face.eye_L.y).toBeCloseTo(face.eye_R.y, 6);
        expect(face.eye_L.z).toBeCloseTo(face.eye_R.z, 6);
    });
});
