import { describe, it, expect } from 'vitest';
import { FINGER_PRESETS, buildPresetPose, FINGER_BONES } from '../../static/src/finger-presets.js';

const ALL_PHALANGES = [
    'index_L_1','index_L_2','index_L_3','middle_L_1','middle_L_2','middle_L_3',
    'ring_L_1','ring_L_2','ring_L_3','pinky_L_1','pinky_L_2','pinky_L_3',
    'thumb_L_1','thumb_L_2',
    'index_R_1','index_R_2','index_R_3','middle_R_1','middle_R_2','middle_R_3',
    'ring_R_1','ring_R_2','ring_R_3','pinky_R_1','pinky_R_2','pinky_R_3',
    'thumb_R_1','thumb_R_2',
];

describe('finger presets (per-phalange)', () => {
    it('exposes the 6 named presets', () => {
        for (const n of ['Pięść','Otwarta dłoń','Wskazywanie','Peace','OK','Półzgięte'])
            expect(FINGER_PRESETS).toHaveProperty(n);
    });

    it('FINGER_BONES lists all 28 phalange bones', () => {
        expect([...FINGER_BONES].sort()).toEqual([...ALL_PHALANGES].sort());
    });

    it('buildPresetPose returns a normalized quaternion for all 28 bones', () => {
        const pose = buildPresetPose('Pięść');
        expect(Object.keys(pose).sort()).toEqual([...ALL_PHALANGES].sort());
        for (const q of Object.values(pose)) {
            expect(q).toHaveLength(4);
            expect(Math.hypot(...q)).toBeCloseTo(1, 5);
        }
    });

    it('Otwarta dłoń is identity everywhere', () => {
        for (const q of Object.values(buildPresetPose('Otwarta dłoń')))
            expect(q[3]).toBeCloseTo(1, 3);
    });

    it('Pięść curls every index joint, not just the knuckle', () => {
        const pose = buildPresetPose('Pięść');
        for (const b of ['index_L_1','index_L_2','index_L_3'])
            expect(Math.abs(pose[b][3])).toBeLessThan(0.999); // each joint rotated
    });

    it('Wskazywanie leaves the whole index straight but curls pinky joints', () => {
        const pose = buildPresetPose('Wskazywanie');
        for (const b of ['index_L_1','index_L_2','index_L_3'])
            expect(pose[b][3]).toBeCloseTo(1, 3);
        expect(Math.abs(pose.pinky_L_1[3])).toBeLessThan(0.999);
        expect(Math.abs(pose.pinky_L_2[3])).toBeLessThan(0.999);
    });

    it('right hand mirrors the left (opposite rotation sign)', () => {
        const pose = buildPresetPose('Pięść');
        expect(pose.index_R_1[0]).toBeCloseTo(-pose.index_L_1[0], 5);
        expect(pose.index_R_1[3]).toBeCloseTo(pose.index_L_1[3], 5);
    });

    it('throws on unknown preset', () => {
        expect(() => buildPresetPose('Nope')).toThrow();
    });
});
