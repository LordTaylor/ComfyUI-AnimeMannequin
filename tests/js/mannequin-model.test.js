import { describe, it, expect } from 'vitest';
import {
    BONE_NAMES, BONE_CHILDREN, PROPORTIONS,
    defaultScene, sceneToJSON, jsonToScene
} from '../../static/src/mannequin-model.js';

describe('BONE_NAMES', () => {
    it('contains exactly 30 bones (20 body + 10 fingers)', () => {
        expect(BONE_NAMES).toHaveLength(30);
    });

    it('contains all required body bones', () => {
        const required = [
            'torso','spine','chest','neck','head',
            'shoulder_L','upper_arm_L','forearm_L','hand_L',
            'shoulder_R','upper_arm_R','forearm_R','hand_R',
            'pelvis','thigh_L','shin_L','foot_L',
            'thigh_R','shin_R','foot_R'
        ];
        for (const b of required) expect(BONE_NAMES).toContain(b);
    });

    it('contains 10 finger bones (5 per hand)', () => {
        const fingers = [
            'thumb_L','index_L','middle_L','ring_L','pinky_L',
            'thumb_R','index_R','middle_R','ring_R','pinky_R',
        ];
        for (const f of fingers) expect(BONE_NAMES).toContain(f);
    });
});

describe('BONE_CHILDREN', () => {
    it('chest has shoulder_L, shoulder_R, neck as children', () => {
        expect(BONE_CHILDREN.chest).toContain('shoulder_L');
        expect(BONE_CHILDREN.chest).toContain('shoulder_R');
        expect(BONE_CHILDREN.chest).toContain('neck');
    });

    it('pelvis has thigh_L and thigh_R', () => {
        expect(BONE_CHILDREN.pelvis).toContain('thigh_L');
        expect(BONE_CHILDREN.pelvis).toContain('thigh_R');
    });
});

describe('BONE_CHILDREN finger hierarchy', () => {
    it('hand_L has 5 finger children, hand_R too', () => {
        for (const f of ['thumb_L','index_L','middle_L','ring_L','pinky_L'])
            expect(BONE_CHILDREN.hand_L).toContain(f);
        for (const f of ['thumb_R','index_R','middle_R','ring_R','pinky_R'])
            expect(BONE_CHILDREN.hand_R).toContain(f);
    });

    it('each finger bone is a leaf', () => {
        for (const f of ['thumb_L','index_L','middle_L','ring_L','pinky_L',
                         'thumb_R','index_R','middle_R','ring_R','pinky_R'])
            expect(BONE_CHILDREN[f]).toEqual([]);
    });
});

describe('PROPORTIONS finger entries', () => {
    it('F and M have all 10 finger bones with radius', () => {
        for (const g of ['F','M'])
            for (const f of ['thumb_L','index_L','middle_L','ring_L','pinky_L',
                             'thumb_R','index_R','middle_R','ring_R','pinky_R'])
                expect(PROPORTIONS[g][f]).toHaveProperty('radius');
    });
});

describe('PROPORTIONS', () => {
    it('has F and M presets', () => {
        expect(PROPORTIONS).toHaveProperty('F');
        expect(PROPORTIONS).toHaveProperty('M');
    });

    it('all 20 bones defined in each preset', () => {
        for (const g of ['F', 'M']) {
            for (const bone of BONE_NAMES) {
                expect(PROPORTIONS[g], `${g}.${bone} missing`).toHaveProperty(bone);
            }
        }
    });

    it('all numeric values are non-negative', () => {
        for (const g of ['F', 'M']) {
            for (const [bone, props] of Object.entries(PROPORTIONS[g])) {
                for (const [k, v] of Object.entries(props)) {
                    if (typeof v === 'number') {
                        expect(v, `${g}.${bone}.${k}`).toBeGreaterThanOrEqual(0);
                    }
                }
            }
        }
    });

    it('M has wider shoulders than F', () => {
        expect(PROPORTIONS.M.shoulderSpan).toBeGreaterThan(PROPORTIONS.F.shoulderSpan);
    });

    it('F has wider hips than M', () => {
        expect(PROPORTIONS.F.pelvis.width).toBeGreaterThan(PROPORTIONS.M.pelvis.width);
    });
});

describe('defaultScene', () => {
    it('all bones have identity quaternion', () => {
        const scene = defaultScene('F');
        for (const bone of BONE_NAMES) {
            expect(scene.bones[bone].rotation).toEqual([0, 0, 0, 1]);
        }
    });

    it('sets the requested gender', () => {
        expect(defaultScene('F').gender).toBe('F');
        expect(defaultScene('M').gender).toBe('M');
    });

    it('no NaN values in any rotation', () => {
        const scene = defaultScene('F');
        for (const { rotation } of Object.values(scene.bones)) {
            for (const v of rotation) expect(Number.isNaN(v)).toBe(false);
        }
    });
});

describe('sceneToJSON / jsonToScene roundtrip', () => {
    it('preserves all bone rotations and camera', () => {
        const original = defaultScene('M');
        original.bones.head.rotation = [0.04, 0, 0, 0.999];
        original.camera.azimuth = 45;
        const restored = jsonToScene(sceneToJSON(original));
        expect(restored.gender).toBe('M');
        expect(restored.bones.head.rotation).toEqual([0.04, 0, 0, 0.999]);
        expect(restored.camera.azimuth).toBe(45);
    });

    it('throws on invalid JSON string', () => {
        expect(() => jsonToScene('not json')).toThrow();
    });

    it('throws on missing required fields', () => {
        expect(() => jsonToScene('{"version":"1.0"}')).toThrow();
    });

    it('fills missing bones with identity quaternion', () => {
        const partial = JSON.stringify({
            version: '1.0', gender: 'F', bones: {}, camera: { azimuth: 0, elevation: 5, distance: 2.5 }
        });
        const scene = jsonToScene(partial);
        for (const bone of BONE_NAMES) {
            expect(scene.bones[bone].rotation).toEqual([0, 0, 0, 1]);
        }
    });
});
