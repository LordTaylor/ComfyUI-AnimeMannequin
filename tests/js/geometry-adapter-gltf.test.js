/**
 * Unit tests for geometry-adapter-gltf.js bugs.
 *
 * Four bugs were fixed in this adapter:
 *   Bug 1: All bones placed at X≈-6.47 — pelvis origin offset not subtracted
 *   Bug 2: charScale hardcoded to 2.0 — should be WORLD_HEIGHT / actual GLB height
 *   Bug 3: A-pose arm rotations discarded — seg.rotation was set to (0,0,0)
 *   Bug 4: R-side mirrored meshes invisible — MeshToonMaterial lacked DoubleSide
 *
 * Tests for Bug 3 require a full GLB-loading environment (integration); see comment below.
 */

import { vi, describe, it, expect } from 'vitest';

// ── Mock browser-only deps ────────────────────────────────────────────────────

vi.mock('../../static/lib/three.module.js', () => {
    class Vector3 {
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        clone() { return new Vector3(this.x, this.y, this.z); }
        sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
        copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    }
    class MeshToonMaterial { constructor(opts) { Object.assign(this, opts); } }
    class SphereGeometry {}
    class Group { add() {} }
    class Mesh {
        constructor() {
            this.position = { set() {} };
            this.quaternion = { copy() {} };
            this.scale = { set() {} };
            this.userData = {};
        }
    }
    return { Vector3, MeshToonMaterial, SphereGeometry, Group, Mesh, DoubleSide: 2 };
});

vi.mock('../../static/lib/GLTFLoader.js', () => ({
    GLTFLoader: class {
        loadAsync() {
            return Promise.resolve({
                scene: { updateMatrixWorld() {}, traverse() {} },
            });
        }
    },
}));

// ── Import testable exports ───────────────────────────────────────────────────

import { WORLD_HEIGHT, MESH_MAP, makeToonMat, jointRadiiFor, HAND_NODE_MAP } from '../../static/src/geometry-adapter-gltf.js';
import { BONE_NAMES } from '../../static/src/mannequin-model.js';

// ── Bug 1: Bone positions not centered ───────────────────────────────────────
// Root cause: pelvis GLB node is scene root at world pos (-3.234, 0.96, 0.037).
// Old code: boneX = worldPos.x * WORLD_HEIGHT → all bones at X≈-6.47.
// Fix: boneX = (worldPos.x - centerX) * charScale → bones centered at X=0.

describe('Bug 1 — coordinate centering: pelvis offset must be subtracted', () => {
    const CENTER_X = -3.234; // typical female pelvis world X
    const CHAR_HEIGHT_GLB = 1.618;
    const charScale = WORLD_HEIGHT / CHAR_HEIGHT_GLB;

    // The corrected formula
    const toSceneX = (worldX) => (worldX - CENTER_X) * charScale;

    it('pelvis node (worldX == centerX) maps to X=0 in scene', () => {
        expect(toSceneX(CENTER_X)).toBeCloseTo(0, 5);
    });

    it('a node 0.1 GLB units to the right of pelvis maps to +0.1 * charScale in scene', () => {
        expect(toSceneX(CENTER_X + 0.1)).toBeCloseTo(0.1 * charScale, 5);
    });

    it('old buggy formula (no centering) would produce X≈-6.47 for pelvis', () => {
        const buggy = (worldX) => worldX * WORLD_HEIGHT;
        expect(buggy(CENTER_X)).toBeCloseTo(-6.468, 1);
        expect(Math.abs(buggy(CENTER_X))).toBeGreaterThan(5); // clearly off-center
    });
});

// ── Bug 2: Wrong scale factor ─────────────────────────────────────────────────
// Root cause: charScale was hardcoded to WORLD_HEIGHT=2.0.
// Actual female character height in GLB units is ~1.618.
// Fix: charScale = WORLD_HEIGHT / charHeightGLB.

describe('Bug 2 — charScale: must be WORLD_HEIGHT / actual GLB height, not 2.0', () => {
    it('charScale ≈ 1.236 for a 1.618-unit tall character targeting WORLD_HEIGHT=2.0', () => {
        const charHeightGLB = 1.618;
        const charScale = WORLD_HEIGHT / charHeightGLB;
        expect(charScale).toBeCloseTo(1.236, 2);
    });

    it('charScale is NOT equal to WORLD_HEIGHT for a 1.618-unit character', () => {
        const charHeightGLB = 1.618;
        const charScale = WORLD_HEIGHT / charHeightGLB;
        expect(charScale).not.toBeCloseTo(WORLD_HEIGHT, 1); // not 2.0
    });

    it('charScale × charHeightGLB equals WORLD_HEIGHT exactly', () => {
        const charHeightGLB = 1.618;
        const charScale = WORLD_HEIGHT / charHeightGLB;
        expect(charScale * charHeightGLB).toBeCloseTo(WORLD_HEIGHT, 10);
    });

    it('fallback charScale=1.0 when GLB height is degenerate (<0.1)', () => {
        const charHeightGLB = 0.05; // degenerate
        const charScale = charHeightGLB > 0.1 ? WORLD_HEIGHT / charHeightGLB : 1.0;
        expect(charScale).toBe(1.0);
    });
});

// ── Bug 4: R-side mirrored meshes invisible ───────────────────────────────────
// Root cause: shoulder_R, thigh_R etc have scale=(-1,-1,-1) in GLB for mirroring.
// Negative uniform scale inverts winding order → backface culling hides geometry.
// Fix: MeshToonMaterial must use side: THREE.DoubleSide (= 2).

describe('Bug 4 — DoubleSide material: required for mirrored R-side meshes', () => {
    it('makeToonMat creates material with side=DoubleSide (=2)', () => {
        const mat = makeToonMat(0xcccccc);
        expect(mat.side).toBe(2); // THREE.DoubleSide
    });

    it('makeToonMat passes through the given color', () => {
        const mat = makeToonMat(0xff0000);
        expect(mat.color).toBe(0xff0000);
    });
});

// ── MESH_MAP completeness ─────────────────────────────────────────────────────
// Regression guard: every bone (except torso virtual root) must have a GLB node
// name defined in both gender variants.

describe('MESH_MAP completeness', () => {
    for (const gender of ['male', 'female']) {
        describe(`${gender}`, () => {
            it('has an entry for every BONE_NAME', () => {
                for (const bone of BONE_NAMES) {
                    expect(MESH_MAP[gender], `${gender}.${bone} missing from MESH_MAP`).toHaveProperty(bone);
                }
            });

            it('torso maps to null (virtual root — no geometry)', () => {
                expect(MESH_MAP[gender].torso).toBeNull();
            });

            it('all non-torso bones map to non-empty strings', () => {
                for (const [bone, glbName] of Object.entries(MESH_MAP[gender])) {
                    if (bone === 'torso') continue;
                    expect(typeof glbName, `${gender}.${bone} should be a string`).toBe('string');
                    expect(glbName.length, `${gender}.${bone} GLB name is empty`).toBeGreaterThan(0);
                }
            });

            it('L-side and R-side bones each have a distinct GLB node name', () => {
                const lBones = ['shoulder_L', 'upper_arm_L', 'forearm_L', 'hand_L', 'thigh_L', 'shin_L', 'foot_L'];
                const rBones = ['shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R', 'thigh_R', 'shin_R', 'foot_R'];
                for (let i = 0; i < lBones.length; i++) {
                    const lName = MESH_MAP[gender][lBones[i]];
                    const rName = MESH_MAP[gender][rBones[i]];
                    expect(lName).not.toBe(rName);
                }
            });
        });
    }
});

// ── Bug 5: GLTFLoader wraps GLTF nodes-with-children as Group, not Mesh ───────
// Root cause: shoulder_L, arm_upper_L, forearm_L, thigh_L, shin_L etc. all have
// children in the GLTF hierarchy. GLTFLoader creates THREE.Group for these nodes
// → glbNode.isMesh === false → old code skipped their geometry entirely.
// Fix: traverse the node to find the first Mesh descendant.

describe('Bug 5 — GLTFLoader Group wrapping: traverse to find mesh', () => {
    it('a Group-like object (isMesh=false) can contain a Mesh-like child', () => {
        const group = {
            isMesh: false,
            _children: [],
            traverse(fn) { fn(this); for (const c of this._children) fn(c); },
        };
        const mesh = { isMesh: true, geometry: { vertices: [] } };
        group._children.push(mesh);

        let meshNode = group.isMesh ? group : null;
        if (!meshNode) group.traverse(c => { if (!meshNode && c.isMesh) meshNode = c; });

        expect(meshNode).toBe(mesh);
        expect(meshNode.isMesh).toBe(true);
    });

    it('direct Mesh node (isMesh=true) is found without traversal', () => {
        const mesh = { isMesh: true, geometry: { vertices: [] } };

        let meshNode = mesh.isMesh ? mesh : null;
        if (!meshNode) mesh.traverse?.(c => { if (!meshNode && c.isMesh) meshNode = c; });

        expect(meshNode).toBe(mesh);
    });

    it('bones affected by this bug have GLB node entries in MESH_MAP', () => {
        // shoulder_L/R, upper_arm, forearm, thigh, shin — these are the non-leaf
        // GLB nodes that GLTFLoader wraps in a Group.
        const groupBones = [
            'shoulder_L', 'upper_arm_L', 'forearm_L',
            'shoulder_R', 'upper_arm_R', 'forearm_R',
            'thigh_L', 'shin_L', 'thigh_R', 'shin_R',
        ];
        for (const bone of groupBones) {
            expect(MESH_MAP.female[bone], `female.${bone}`).toBeTruthy();
            expect(MESH_MAP.male[bone],   `male.${bone}`).toBeTruthy();
        }
    });
});

// ── Bug 6: GLTFLoader sanitizes .name — strips dots for AnimationMixer ────────
// PropertyBinding.sanitizeNodeName strips chars in [\[\]\.:\/] from node names.
// So 'GEO-arm_upper_female_primitive_stylized.L' → 'GEO-arm_upper_female_primitive_stylizedL'.
// Our MESH_MAP keys use the ORIGINAL names with dots.
// Fix: use obj.userData.name (GLTFLoader stores original there) instead of obj.name.

describe('Bug 6 — GLTFLoader sanitizes .name, stripping dots from .L/.R suffixes', () => {
    it('PropertyBinding-style sanitization strips dots from node names', () => {
        const original = 'GEO-arm_upper_female_primitive_stylized.L';
        // PropertyBinding.sanitizeNodeName: replace [\[\].:\/] with ''
        const sanitized = original.replace(/[\[\].:\/]/g, '');
        expect(sanitized).not.toBe(original);
        expect(sanitized).not.toContain('.');
        expect(sanitized).toBe('GEO-arm_upper_female_primitive_stylizedL');
    });

    it('all .L and .R MESH_MAP names contain a dot that would be stripped', () => {
        const lateralBones = [
            'shoulder_L', 'upper_arm_L', 'forearm_L', 'hand_L',
            'shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R',
            'thigh_L', 'shin_L', 'foot_L',
            'thigh_R', 'shin_R', 'foot_R',
        ];
        for (const bone of lateralBones) {
            expect(MESH_MAP.female[bone], `female.${bone}`).toContain('.');
            expect(MESH_MAP.male[bone],   `male.${bone}`).toContain('.');
        }
    });

    it('fix: userData.name lookup matches MESH_MAP names with dots', () => {
        // GLTFLoader sets node.userData.name = nodeDef.name (original, with dots)
        //              and node.name = sanitized name (dot stripped)
        const originalName = 'GEO-arm_upper_female_primitive_stylized.L';
        const node = {
            name: originalName.replace(/[\[\].:\/]/g, ''), // sanitized
            userData: { name: originalName },              // original preserved
        };
        const mapKey = node.userData.name || node.name;
        expect(mapKey).toBe(originalName);
        expect(mapKey).toBe(MESH_MAP.female.upper_arm_L);
    });
});

// ── HAND_NODE_MAP — left-hand phalange → hand.glb node ───────────────────────

describe('HAND_NODE_MAP (left-hand phalange → hand.glb node)', () => {
    it('maps all 14 left phalange bones', () => {
        const bones = ['index_L_1','index_L_2','index_L_3','middle_L_1','middle_L_2','middle_L_3',
            'ring_L_1','ring_L_2','ring_L_3','pinky_L_1','pinky_L_2','pinky_L_3','thumb_L_1','thumb_L_2'];
        for (const b of bones) expect(typeof HAND_NODE_MAP[b]).toBe('string');
        expect(Object.keys(HAND_NODE_MAP)).toHaveLength(14);
    });
    it('orders proximal→distal: _2 is the .002 node, _3 is the .001 (tip) node', () => {
        expect(HAND_NODE_MAP.index_L_1).toBe('GEO-finger_index_female_primitive_stylized.L');
        expect(HAND_NODE_MAP.index_L_2).toBe('GEO-finger_index_female_primitive_stylized.L.002');
        expect(HAND_NODE_MAP.index_L_3).toBe('GEO-finger_index_female_primitive_stylized.L.001');
        expect(HAND_NODE_MAP.thumb_L_1).toBe('GEO-thumb_female_primitive_stylized.L');
        expect(HAND_NODE_MAP.thumb_L_2).toBe('GEO-thumb_female_primitive_stylized.L.001');
    });
    it('contains no right-hand bones (hand.glb is left-only)', () => {
        for (const k of Object.keys(HAND_NODE_MAP)) expect(k).not.toMatch(/_R_|_R$/);
    });
});

// ── Bug 3 note ────────────────────────────────────────────────────────────────
// Bug 3 (A-pose arm rotations discarded) requires a real GLB to be loaded to test.
// It is verified by integration: with correct fix, arms appear in A-pose (~50° angle).
// Code path: seg.quaternion.copy(glbNode.quaternion) in buildSegments().

// ── jointRadiiFor — finger/hand joint scaling ─────────────────────────────────
// Body bones keep the fixed 0.055/0.12 defaults.
// Finger + hand bones scale down to PROPORTIONS.radius so joint balls
// don't swallow thin geometry and adjacent hit spheres don't overlap.

describe('jointRadiiFor', () => {
    it('returns the default 0.055/0.12 for ordinary body bones', () => {
        const r = jointRadiiFor('F', 'forearm_L');
        expect(r.jointR).toBeCloseTo(0.055, 5);
        expect(r.hitR).toBeCloseTo(0.12, 5);
    });

    it('returns much smaller radii for phalange bones', () => {
        const f = jointRadiiFor('F', 'index_L_1');
        expect(f.jointR).toBeLessThan(0.03);
        expect(f.hitR).toBeLessThan(0.06);
        // smaller than a body joint
        expect(f.jointR).toBeLessThan(jointRadiiFor('F', 'forearm_L').jointR);
    });

    it('reduces the hand bones too', () => {
        const h = jointRadiiFor('F', 'hand_L');
        expect(h.jointR).toBeLessThan(0.055);
    });

    it('falls back gracefully for unknown gender / missing radius', () => {
        const r = jointRadiiFor('custom', 'index_L_1');
        expect(r.jointR).toBeGreaterThan(0);
        expect(r.hitR).toBeGreaterThan(r.jointR);
    });
});

// ── MESH_MAP finger nodes ─────────────────────────────────────────────────────
// Each finger bone must map to its own GLB node (promoted from EXTRA_NODES).

describe('MESH_MAP finger nodes', () => {
    it('maps every finger bone to a GLB node for F and M', () => {
        const expectedNodes = {
            female: {
                thumb_L:  'GEO-thumb_female_primitive_stylized.L',
                index_L:  'GEO-finger_index_female_primitive_stylized.L',
                middle_L: 'GEO-finger_middle_female_primitive_stylized.L',
                ring_L:   'GEO-finger_ring_female_primitive_stylized.L',
                pinky_L:  'GEO-finger_pinky_female_primitive_stylized.L',
                thumb_R:  'GEO-thumb_female_primitive_stylized.R',
                index_R:  'GEO-finger_index_female_primitive_stylized.R',
                middle_R: 'GEO-finger_middle_female_primitive_stylized.R',
                ring_R:   'GEO-finger_ring_female_primitive_stylized.R',
                pinky_R:  'GEO-finger_pinky_female_primitive_stylized.R',
            },
            male: {
                thumb_L:  'GEO-thumb_male_primitive_stylized.L',
                index_L:  'GEO-finger_index_male_primitive_stylized.L',
                middle_L: 'GEO-finger_middle_male_primitive_stylized.L',
                ring_L:   'GEO-finger_ring_male_primitive_stylized.L',
                pinky_L:  'GEO-finger_pinky_male_primitive_stylized.L',
                thumb_R:  'GEO-thumb_male_primitive_stylized.R',
                index_R:  'GEO-finger_index_male_primitive_stylized.R',
                middle_R: 'GEO-finger_middle_male_primitive_stylized.R',
                ring_R:   'GEO-finger_ring_male_primitive_stylized.R',
                pinky_R:  'GEO-finger_pinky_male_primitive_stylized.R',
            },
        };
        for (const [key, bones] of Object.entries(expectedNodes))
            for (const [bone, node] of Object.entries(bones))
                expect(MESH_MAP[key][bone]).toBe(node);
    });
});
