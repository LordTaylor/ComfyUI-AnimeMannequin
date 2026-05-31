import * as THREE from '../lib/three.module.js';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { BONE_NAMES } from './mannequin-model.js';

export const WORLD_HEIGHT = 2.0;

const JOINT_COLOR   = 0xaaaaaa;
const SEGMENT_COLOR = 0xcccccc;
const SELECT_COLOR  = 0x4fc3f7;

// Cached loaded GLBs — avoids re-fetching on gender toggle
const _glbCache = new Map(); // 'male'|'female' → Map<nodeName, THREE.Object3D>

// Map our bone names to GLB node names.
// Verified against actual GLB node list — all names confirmed present in both files.
// torso is a virtual root (no geometry), so it maps to null.
// pelvis maps to GEO-pelvis_*_primitive_stylized (dedicated node, not belly).
const MESH_MAP = {
    male: {
        torso:       null,
        spine:       'GEO-belly_male_primitive_stylized',
        chest:       'GEO-chest_male_primitive_stylized',
        neck:        'GEO-neck_male_primitive_stylized',
        head:        'GEO-head_male_primitive_stylized',
        shoulder_L:  'GEO-shoulder_male_primitive_stylized.L',
        upper_arm_L: 'GEO-arm_upper_male_primitive_stylized.L',
        forearm_L:   'GEO-arm_lower_male_primitive_stylized.L',
        hand_L:      'GEO-hand_male_primitive_stylized.L',
        shoulder_R:  'GEO-shoulder_male_primitive_stylized.R',
        upper_arm_R: 'GEO-arm_upper_male_primitive_stylized.R',
        forearm_R:   'GEO-arm_lower_male_primitive_stylized.R',
        hand_R:      'GEO-hand_male_primitive_stylized.R',
        pelvis:      'GEO-pelvis_male_primitive_stylized',
        thigh_L:     'GEO-leg_upper_male_primitive_stylized.L',
        shin_L:      'GEO-leg_lower_male_primitive_stylized.L',
        foot_L:      'GEO-foot_male_primitive_stylized.L',
        thigh_R:     'GEO-leg_upper_male_primitive_stylized.R',
        shin_R:      'GEO-leg_lower_male_primitive_stylized.R',
        foot_R:      'GEO-foot_male_primitive_stylized.R',
    },
    female: {
        torso:       null,
        spine:       'GEO-belly_female_primitive_stylized',
        chest:       'GEO-chest_female_primitive_stylized',
        neck:        'GEO-neck_female_primitive_stylized',
        head:        'GEO-head_female_primitive_stylized',
        shoulder_L:  'GEO-shoulder_female_primitive_stylized.L',
        upper_arm_L: 'GEO-arm_upper_female_primitive_stylized.L',
        forearm_L:   'GEO-arm_lower_female_primitive_stylized.L',
        hand_L:      'GEO-hand_female_primitive_stylized.L',
        shoulder_R:  'GEO-shoulder_female_primitive_stylized.R',
        upper_arm_R: 'GEO-arm_upper_female_primitive_stylized.R',
        forearm_R:   'GEO-arm_lower_female_primitive_stylized.R',
        hand_R:      'GEO-hand_female_primitive_stylized.R',
        pelvis:      'GEO-pelvis_female_primitive_stylized',
        thigh_L:     'GEO-leg_upper_female_primitive_stylized.L',
        shin_L:      'GEO-leg_lower_female_primitive_stylized.L',
        foot_L:      'GEO-foot_female_primitive_stylized.L',
        thigh_R:     'GEO-leg_upper_female_primitive_stylized.R',
        shin_R:      'GEO-leg_lower_female_primitive_stylized.R',
        foot_R:      'GEO-foot_female_primitive_stylized.R',
    },
};

async function loadGLB(gender) {
    const key = gender === 'F' ? 'female' : 'male';
    if (_glbCache.has(key)) return _glbCache.get(key);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(`/mannequin_editor/assets/${key}.glb`);
    // Ensure world matrices are computed before getWorldPosition calls
    gltf.scene.updateMatrixWorld(true);
    // Build name → Object3D map
    const nodeMap = new Map();
    gltf.scene.traverse(obj => { if (obj.name) nodeMap.set(obj.name, obj); });
    _glbCache.set(key, nodeMap);
    return nodeMap;
}

function makeToonMat(color) {
    return new THREE.MeshToonMaterial({ color });
}

/**
 * Build segment groups for all bones from GLB meshes.
 * Each group: joint sphere (isJoint=true) + optional GLB mesh segment.
 * @param {string} gender — 'M' or 'F'
 * @returns {Promise<Map<string, THREE.Group>>}
 */
export async function buildSegments(gender) {
    const key = gender === 'F' ? 'female' : 'male';
    const boneMap = MESH_MAP[key];
    const nodeMap = await loadGLB(gender);
    const groups = new Map();

    for (const boneName of BONE_NAMES) {
        const group = new THREE.Group();
        group.name = boneName;

        // Joint sphere — always present, clickable selection handle
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 12, 8),
            makeToonMat(JOINT_COLOR)
        );
        sphere.userData.boneName = boneName;
        sphere.userData.isJoint = true;
        group.add(sphere);

        // GLB mesh segment
        const glbNodeName = boneMap[boneName];
        if (glbNodeName) {
            const glbNode = nodeMap.get(glbNodeName);
            if (glbNode && glbNode.isMesh) {
                // Use new Mesh directly to avoid the intermediate geometry leak from clone()
                const seg = new THREE.Mesh(glbNode.geometry.clone(), makeToonMat(SEGMENT_COLOR));
                seg.userData.boneName = boneName;
                // Reset local transform — position/scale come from our bone hierarchy.
                // Do NOT apply WORLD_HEIGHT scale here: bone offsets are already
                // WORLD_HEIGHT-scaled, so the geometry must remain at GLB unit scale.
                seg.position.set(0, 0, 0);
                seg.rotation.set(0, 0, 0);
                seg.scale.set(1, 1, 1);
                group.add(seg);
            }
        }

        groups.set(boneName, group);
    }
    return groups;
}

/**
 * Compute local offsets for each bone.
 * Uses GLB world positions scaled to WORLD_HEIGHT, with torso as scene root.
 * Falls back to zero vector for unmapped or missing bones.
 * @param {string} gender — 'M' or 'F'
 * @returns {Promise<Map<string, THREE.Vector3>>}
 */
export async function computeBoneOffsets(gender) {
    const key = gender === 'F' ? 'female' : 'male';
    const boneMap = MESH_MAP[key];
    const nodeMap = await loadGLB(gender);
    const offsets = new Map();

    // Helper: get world position of a named GLB node, scaled to WORLD_HEIGHT
    function scaledWorldPos(glbNodeName) {
        if (!glbNodeName) return null;
        const node = nodeMap.get(glbNodeName);
        if (!node) return null;
        const v = new THREE.Vector3();
        node.getWorldPosition(v);
        return v.multiplyScalar(WORLD_HEIGHT);
    }

    // Position torso so foot rests at Y=0 in our scene
    const footPos = scaledWorldPos(boneMap.foot_L);
    const torsoGLBPos = scaledWorldPos(boneMap.spine) ?? new THREE.Vector3(0, WORLD_HEIGHT * 0.45, 0);
    const groundOffset = footPos ? -footPos.y : 0;
    const torsoY = torsoGLBPos.y + groundOffset;

    offsets.set('torso', new THREE.Vector3(0, torsoY, 0));

    for (const boneName of BONE_NAMES) {
        if (boneName === 'torso') continue;
        const pos = scaledWorldPos(boneMap[boneName]);
        if (pos) {
            offsets.set(boneName, pos.clone().setY(pos.y + groundOffset));
        } else {
            offsets.set(boneName, new THREE.Vector3(0, 0, 0));
        }
    }

    return offsets;
}

export { SELECT_COLOR, JOINT_COLOR };
