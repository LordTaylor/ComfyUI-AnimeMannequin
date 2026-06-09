import { describe, it, expect } from 'vitest';
import {
    BONE_NAMES, BONE_CHILDREN, PROPORTIONS,
    defaultScene, sceneToJSON, jsonToScene
} from '../../static/src/mannequin-model.js';

describe('BONE_NAMES', () => {
    it('contains exactly 48 bones (20 body + 28 finger phalanges)', () => {
        expect(BONE_NAMES).toHaveLength(48);
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

    it('contains 28 phalange bones (14 per hand)', () => {
        const phalanges = [
            // left hand
            'index_L_1','index_L_2','index_L_3',
            'middle_L_1','middle_L_2','middle_L_3',
            'ring_L_1','ring_L_2','ring_L_3',
            'pinky_L_1','pinky_L_2','pinky_L_3',
            'thumb_L_1','thumb_L_2',
            // right hand
            'index_R_1','index_R_2','index_R_3',
            'middle_R_1','middle_R_2','middle_R_3',
            'ring_R_1','ring_R_2','ring_R_3',
            'pinky_R_1','pinky_R_2','pinky_R_3',
            'thumb_R_1','thumb_R_2',
        ];
        for (const f of phalanges) expect(BONE_NAMES).toContain(f);
    });

    it('spot-checks representative phalange names are present', () => {
        expect(BONE_NAMES).toContain('index_L_1');
        expect(BONE_NAMES).toContain('index_L_2');
        expect(BONE_NAMES).toContain('index_L_3');
        expect(BONE_NAMES).toContain('thumb_L_1');
        expect(BONE_NAMES).toContain('thumb_L_2');
        expect(BONE_NAMES).toContain('pinky_R_3');
    });

    it('does NOT contain old single finger bones', () => {
        for (const old of ['thumb_L','index_L','middle_L','ring_L','pinky_L',
                           'thumb_R','index_R','middle_R','ring_R','pinky_R']) {
            expect(BONE_NAMES).not.toContain(old);
        }
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
    it('hand_L children are exactly the 5 left proximal bones', () => {
        expect(BONE_CHILDREN.hand_L).toContain('index_L_1');
        expect(BONE_CHILDREN.hand_L).toContain('middle_L_1');
        expect(BONE_CHILDREN.hand_L).toContain('ring_L_1');
        expect(BONE_CHILDREN.hand_L).toContain('pinky_L_1');
        expect(BONE_CHILDREN.hand_L).toContain('thumb_L_1');
        expect(BONE_CHILDREN.hand_L).toHaveLength(5);
    });

    it('hand_R children are exactly the 5 right proximal bones', () => {
        expect(BONE_CHILDREN.hand_R).toContain('index_R_1');
        expect(BONE_CHILDREN.hand_R).toContain('middle_R_1');
        expect(BONE_CHILDREN.hand_R).toContain('ring_R_1');
        expect(BONE_CHILDREN.hand_R).toContain('pinky_R_1');
        expect(BONE_CHILDREN.hand_R).toContain('thumb_R_1');
        expect(BONE_CHILDREN.hand_R).toHaveLength(5);
    });

    it('index_L chain: _1→_2→_3→[]', () => {
        expect(BONE_CHILDREN.index_L_1).toEqual(['index_L_2']);
        expect(BONE_CHILDREN.index_L_2).toEqual(['index_L_3']);
        expect(BONE_CHILDREN.index_L_3).toEqual([]);
    });

    it('thumb_L chain: _1→_2→[]', () => {
        expect(BONE_CHILDREN.thumb_L_1).toEqual(['thumb_L_2']);
        expect(BONE_CHILDREN.thumb_L_2).toEqual([]);
    });

    it('pinky_R chain: _1→_2→_3→[]', () => {
        expect(BONE_CHILDREN.pinky_R_1).toEqual(['pinky_R_2']);
        expect(BONE_CHILDREN.pinky_R_2).toEqual(['pinky_R_3']);
        expect(BONE_CHILDREN.pinky_R_3).toEqual([]);
    });

    it('does NOT contain old single finger bones', () => {
        for (const old of ['thumb_L','index_L','middle_L','ring_L','pinky_L',
                           'thumb_R','index_R','middle_R','ring_R','pinky_R']) {
            expect(BONE_CHILDREN).not.toHaveProperty(old);
        }
    });
});

describe('PROPORTIONS finger entries', () => {
    it('F and M have all 28 phalange bones with radius', () => {
        const phalanges = [
            'index_L_1','index_L_2','index_L_3',
            'middle_L_1','middle_L_2','middle_L_3',
            'ring_L_1','ring_L_2','ring_L_3',
            'pinky_L_1','pinky_L_2','pinky_L_3',
            'thumb_L_1','thumb_L_2',
            'index_R_1','index_R_2','index_R_3',
            'middle_R_1','middle_R_2','middle_R_3',
            'ring_R_1','ring_R_2','ring_R_3',
            'pinky_R_1','pinky_R_2','pinky_R_3',
            'thumb_R_1','thumb_R_2',
        ];
        for (const g of ['F','M'])
            for (const f of phalanges)
                expect(PROPORTIONS[g][f], `${g}.${f} missing radius`).toHaveProperty('radius');
    });

    it('phalange radii taper distally: _1 >= _2 >= _3 for index_L', () => {
        for (const g of ['F', 'M']) {
            expect(PROPORTIONS[g].index_L_1.radius).toBeGreaterThanOrEqual(PROPORTIONS[g].index_L_2.radius);
            expect(PROPORTIONS[g].index_L_2.radius).toBeGreaterThanOrEqual(PROPORTIONS[g].index_L_3.radius);
        }
    });

    it('does NOT contain old single finger bones', () => {
        for (const old of ['thumb_L','index_L','middle_L','ring_L','pinky_L',
                           'thumb_R','index_R','middle_R','ring_R','pinky_R']) {
            expect(PROPORTIONS.F).not.toHaveProperty(old);
            expect(PROPORTIONS.M).not.toHaveProperty(old);
        }
    });
});

describe('PROPORTIONS', () => {
    it('has F and M presets', () => {
        expect(PROPORTIONS).toHaveProperty('F');
        expect(PROPORTIONS).toHaveProperty('M');
    });

    it('all 48 bones defined in each preset', () => {
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
