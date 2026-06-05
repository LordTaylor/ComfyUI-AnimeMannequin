import { describe, it, expect } from 'vitest';
import { FINGER_PRESETS, buildPresetPose, FINGER_BONES } from '../../static/src/finger-presets.js';

describe('finger presets', () => {
    it('exposes the 6 named presets', () => {
        for (const n of ['Pięść','Otwarta dłoń','Wskazywanie','Peace','OK','Półzgięte'])
            expect(FINGER_PRESETS).toHaveProperty(n);
    });

    it('buildPresetPose returns a quaternion for all 10 finger bones', () => {
        const pose = buildPresetPose('Pięść');
        expect(Object.keys(pose).sort()).toEqual([...FINGER_BONES].sort());
        for (const q of Object.values(pose)) {
            expect(q).toHaveLength(4);
            const len = Math.hypot(...q);
            expect(len).toBeCloseTo(1, 5); // normalized quaternion
        }
    });

    it('Otwarta dłoń is (near) identity for all fingers', () => {
        const pose = buildPresetPose('Otwarta dłoń');
        for (const q of Object.values(pose)) {
            expect(q[3]).toBeCloseTo(1, 3); // w≈1 → no rotation
        }
    });

    it('Wskazywanie leaves index straight but curls pinky', () => {
        const pose = buildPresetPose('Wskazywanie');
        expect(pose.index_L[3]).toBeCloseTo(1, 3);          // index straight
        expect(Math.abs(pose.pinky_L[3])).toBeLessThan(0.99); // pinky curled
    });

    it('throws on unknown preset', () => {
        expect(() => buildPresetPose('Nope')).toThrow();
    });
});
