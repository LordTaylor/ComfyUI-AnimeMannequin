import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { computeFaceKeypoints } from '../../static/src/mannequin-renderer.js';

const head = new THREE.Vector3(0, 1.60, 0);
const neck = new THREE.Vector3(0, 1.45, 0);
const noRot = new THREE.Quaternion();   // head facing -Z (nose/forward), +X = left

describe('computeFaceKeypoints', () => {
    it('returns the four face keypoints', () => {
        const f = computeFaceKeypoints(head, neck, noRot);
        expect(Object.keys(f).sort()).toEqual(['ear_L', 'ear_R', 'eye_L', 'eye_R']);
    });

    it('eyes sit forward (toward the nose, -Z) and above the head origin (no head rotation)', () => {
        const f = computeFaceKeypoints(head, neck, noRot);
        for (const e of [f.eye_L, f.eye_R]) {
            expect(e.z).toBeLessThan(head.z);   // forward = -Z (nose)
            expect(e.y).toBeGreaterThan(head.y);
        }
    });

    it('left keypoints on +X, right on -X (no head rotation)', () => {
        const f = computeFaceKeypoints(head, neck, noRot);
        expect(f.eye_L.x).toBeGreaterThan(0);
        expect(f.eye_R.x).toBeLessThan(0);
        expect(f.ear_L.x).toBeGreaterThan(0);
        expect(f.ear_R.x).toBeLessThan(0);
    });

    it('ears are wider than eyes', () => {
        const f = computeFaceKeypoints(head, neck, noRot);
        expect(Math.abs(f.ear_L.x)).toBeGreaterThan(Math.abs(f.eye_L.x));
        expect(Math.abs(f.ear_R.x)).toBeGreaterThan(Math.abs(f.eye_R.x));
    });

    it('is symmetric left/right (no head rotation)', () => {
        const f = computeFaceKeypoints(head, neck, noRot);
        expect(f.eye_L.x).toBeCloseTo(-f.eye_R.x, 6);
        expect(f.eye_L.z).toBeCloseTo(f.eye_R.z, 6);
    });

    it('tracks head YAW: turning the head +90° about up swings the face sideways', () => {
        // yaw +90° about world up (+Y): head-forward (+Z) rotates toward +X
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        const f = computeFaceKeypoints(head, neck, yaw);
        const noRotF = computeFaceKeypoints(head, neck, noRot);
        // with no rotation the eyes lead in +Z; after yaw they should lead in X instead
        expect(Math.abs(f.eye_L.x - head.x)).toBeGreaterThan(Math.abs(noRotF.eye_L.x - head.x));
        expect(Math.abs(f.eye_L.z - head.z)).toBeLessThan(Math.abs(noRotF.eye_L.z - head.z));
    });
});
