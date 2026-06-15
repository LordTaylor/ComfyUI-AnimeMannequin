// tests/js/smart-pose.test.js
import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { ELIGIBLE_PRESET_IDS, TORSO_BONES, INTENSITY, pickBasePreset, jitterPose, randomOffsetVec } from '../../static/src/smart-pose.js';

function seededRng(seed = 1) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

describe('config', () => {
    it('ELIGIBLE_PRESET_IDS is the 8 basic ids', () => {
        expect(ELIGIBLE_PRESET_IDS).toEqual(
            ['t_pose', 'arms_up', 'hands_on_hips', 'arms_crossed', 'contrapposto', 'waving', 'sitting', 'walking']);
    });
    it('TORSO_BONES lists torso + shoulders only (no limbs/fingers)', () => {
        expect(TORSO_BONES).toEqual(['spine', 'chest', 'neck', 'head', 'pelvis', 'shoulder_L', 'shoulder_R']);
    });
    it('INTENSITY has safe and wild with numeric jitterDeg/reachFrac', () => {
        for (const k of ['safe', 'wild']) {
            expect(typeof INTENSITY[k].jitterDeg).toBe('number');
            expect(typeof INTENSITY[k].reachFrac).toBe('number');
        }
        expect(INTENSITY.wild.jitterDeg).toBeGreaterThan(INTENSITY.safe.jitterDeg);
    });
});

describe('pickBasePreset', () => {
    it('returns a preset whose id is in the eligible pool', () => {
        const rng = seededRng(42);
        for (let i = 0; i < 20; i++) {
            const p = pickBasePreset(rng);
            expect(ELIGIBLE_PRESET_IDS).toContain(p.id);
        }
    });
    it('is deterministic for a fixed rng', () => {
        expect(pickBasePreset(seededRng(7)).id).toBe(pickBasePreset(seededRng(7)).id);
    });
});

describe('jitterPose', () => {
    it('only changes TORSO_BONES; other bones copied unchanged', () => {
        const pose = { spine: { x: 0, y: 0, z: 0, w: 1 }, forearm_L: { x: 0.1, y: 0, z: 0, w: 0.995 } };
        const out = jitterPose(pose, seededRng(3), 10);
        expect(out.forearm_L).toEqual(pose.forearm_L);
        expect(out.spine).not.toEqual(pose.spine);
    });
    it('keeps each jitter axis within ±jitterDeg of identity input', () => {
        const jitterDeg = 12;
        const pose = { head: { x: 0, y: 0, z: 0, w: 1 } };
        const out = jitterPose(pose, seededRng(9), jitterDeg);
        const e = new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion(out.head.x, out.head.y, out.head.z, out.head.w), 'XYZ');
        const lim = (jitterDeg + 1e-6) * Math.PI / 180;
        expect(Math.abs(e.x)).toBeLessThanOrEqual(lim);
        expect(Math.abs(e.y)).toBeLessThanOrEqual(lim);
        expect(Math.abs(e.z)).toBeLessThanOrEqual(lim);
    });
    it('is deterministic for a fixed rng', () => {
        const pose = { spine: { x: 0, y: 0, z: 0, w: 1 } };
        expect(jitterPose(pose, seededRng(5), 10)).toEqual(jitterPose(pose, seededRng(5), 10));
    });
});

describe('randomOffsetVec', () => {
    it('magnitude never exceeds radius', () => {
        const rng = seededRng(11);
        for (let i = 0; i < 50; i++) {
            const v = randomOffsetVec(rng, 0.5);
            expect(v.length()).toBeLessThanOrEqual(0.5 + 1e-9);
        }
    });
    it('is deterministic for a fixed rng', () => {
        const a = randomOffsetVec(seededRng(2), 1);
        const b = randomOffsetVec(seededRng(2), 1);
        expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z]);
    });
});
