// tests/js/pose-presets.test.js
import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { POSE_PRESETS, presetToPose, presetById } from '../../static/src/pose-presets.js';
import { BONE_NAMES } from '../../static/src/mannequin-model.js';

describe('POSE_PRESETS data', () => {
    it('has 13 presets with unique ids', () => {
        expect(POSE_PRESETS).toHaveLength(13);
        const ids = POSE_PRESETS.map(p => p.id);
        expect(new Set(ids).size).toBe(13);
    });

    it('every preset has a name and a basic|combat group', () => {
        for (const p of POSE_PRESETS) {
            expect(typeof p.name).toBe('string');
            expect(p.name.length).toBeGreaterThan(0);
            expect(['basic', 'combat']).toContain(p.group);
        }
    });

    it('every angle entry targets a real bone and is a 3-number array', () => {
        const valid = new Set(BONE_NAMES);
        for (const p of POSE_PRESETS) {
            for (const [bone, angle] of Object.entries(p.angles)) {
                expect(valid.has(bone)).toBe(true);
                expect(Array.isArray(angle)).toBe(true);
                expect(angle).toHaveLength(3);
                for (const a of angle) expect(typeof a).toBe('number');
            }
        }
    });

    it('includes the 5 combat poses by id', () => {
        const ids = POSE_PRESETS.map(p => p.id);
        for (const id of ['rifle', 'pistol', 'saber', 'sword_shield', 'rapier']) {
            expect(ids).toContain(id);
        }
    });
});

describe('presetToPose', () => {
    it('returns a quaternion for every bone in BONE_NAMES', () => {
        const pose = presetToPose(POSE_PRESETS[0]);
        for (const name of BONE_NAMES) {
            expect(pose[name]).toBeDefined();
            const q = pose[name];
            expect(typeof q.x).toBe('number');
            expect(typeof q.w).toBe('number');
        }
    });

    it('unlisted bones are identity', () => {
        const tpose = presetById('t_pose');
        const pose = presetToPose(tpose);
        expect(pose.head).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    });

    it('listed bone matches the quaternion from its Euler degrees (XYZ)', () => {
        const preset = { id: 'x', name: 'x', group: 'basic', angles: { upper_arm_L: [0, 0, 90] } };
        const pose = presetToPose(preset);
        const expected = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, 0, 90 * Math.PI / 180, 'XYZ'));
        expect(pose.upper_arm_L.x).toBeCloseTo(expected.x, 6);
        expect(pose.upper_arm_L.y).toBeCloseTo(expected.y, 6);
        expect(pose.upper_arm_L.z).toBeCloseTo(expected.z, 6);
        expect(pose.upper_arm_L.w).toBeCloseTo(expected.w, 6);
    });
});

describe('presetById', () => {
    it('returns the preset or null', () => {
        expect(presetById('t_pose').id).toBe('t_pose');
        expect(presetById('nope')).toBeNull();
    });
});
