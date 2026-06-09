import * as THREE from '../lib/three.module.js';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { BONE_NAMES, PROPORTIONS } from './mannequin-model.js';

export const WORLD_HEIGHT = 2.0;

const JOINT_COLOR   = 0xaaaaaa;
const SEGMENT_COLOR = 0xcccccc;
const SELECT_COLOR  = 0x4fc3f7;

const JOINT_RADIUS = 0.044; // visible sphere (−20% tuning pass)
const HIT_RADIUS   = 0.12;  // invisible larger sphere for easier click detection

// Bones whose joints must be scaled down to the bone thickness (thin parts:
// fingers + hands). Everything else keeps the default body joint size.
const SMALL_JOINT_BONES = new Set([
    'index_L_1','index_L_2','index_L_3','middle_L_1','middle_L_2','middle_L_3',
    'ring_L_1','ring_L_2','ring_L_3','pinky_L_1','pinky_L_2','pinky_L_3',
    'thumb_L_1','thumb_L_2',
    'index_R_1','index_R_2','index_R_3','middle_R_1','middle_R_2','middle_R_3',
    'ring_R_1','ring_R_2','ring_R_3','pinky_R_1','pinky_R_2','pinky_R_3',
    'thumb_R_1','thumb_R_2',
    'hand_L','hand_R',
]);

/**
 * Visible + hit sphere radii for a bone's joint.
 * Body bones use the fixed defaults; fingers/hands scale to PROPORTIONS.radius
 * so the joint balls don't swallow the thin geometry and adjacent finger hit
 * spheres don't overlap.
 */
export function jointRadiiFor(gender, boneName) {
    if (!SMALL_JOINT_BONES.has(boneName)) {
        return { jointR: JOINT_RADIUS, hitR: HIT_RADIUS };
    }
    const set = (gender === 'M') ? PROPORTIONS.M : PROPORTIONS.F;
    const r = set?.[boneName]?.radius ?? 0.011;
    return {
        jointR: Math.max(0.0077, r * 1.024),  // −20 % ×2 passes (visual tuning)
        hitR:   Math.max(0.025, r * 3.2),     // hit target kept for clickability
    };
}

// OpenPose COCO-18 joint colors — Openpose-18-keypoints_coco_color_codes_v13 (100 % brightness).
// Bones without a direct COCO keypoint use neutral greys.
export const OPENPOSE_COLORS = {
    head:        0xff0000,  // COCO 0  nose
    neck:        0xff5500,  // COCO 1  neck
    shoulder_R:  0xffaa00,  // COCO 2  right shoulder
    upper_arm_R: 0xffcc00,  // between COCO 2-3
    forearm_R:   0xffff00,  // COCO 3  right elbow
    hand_R:      0xaaff00,  // COCO 4  right wrist
    shoulder_L:  0x55ff00,  // COCO 5  left shoulder
    upper_arm_L: 0x00cc00,  // between COCO 5-6
    forearm_L:   0x00ff00,  // COCO 6  left elbow
    hand_L:      0x00ff55,  // COCO 7  left wrist
    thigh_R:     0x00ffaa,  // COCO 8  right hip
    shin_R:      0x00ffff,  // COCO 9  right knee
    foot_R:      0x00aaff,  // COCO 10 right ankle
    thigh_L:     0x0055ff,  // COCO 11 left hip
    shin_L:      0x0000ff,  // COCO 12 left knee
    foot_L:      0x5500ff,  // COCO 13 left ankle
    // Non-COCO bones — neutral
    pelvis:      0x00ffcc,
    chest:       0xffffff,
    spine:       0xdddddd,
    torso:       0xaaaaaa,
};

// GLB sub-meshes that attach to a bone without their own FK pivot.
// These are children of the bone's GLB node (e.g. breasts hang on chest).
// Sub-meshes rigidly attached to a bone (breasts, face parts, toes): they move
// with the parent bone and are not individually posable.
// NOTE: fingers used to live here too, but are now first-class posable bones
// (see MESH_MAP). The Python renderer (glb_renderer.py) still treats fingers as
// rigid EXTRA_NODES — that path is reconciled separately in Plan 1b.
const EXTRA_NODES = {
    female: {
        chest: [
            { name: 'GEO-breast_female_primitive_stylized.L', proportionGroup: 'bust' },
            { name: 'GEO-breast_female_primitive_stylized.R', proportionGroup: 'bust' },
        ],
        head: [
            { name: 'GEO-ear_female_primitive_stylized.L',           proportionGroup: 'head' },
            { name: 'GEO-ear_female_primitive_stylized.R',           proportionGroup: 'head' },
            { name: 'GEO-eye_female_primitive_stylized.L',           proportionGroup: 'head' },
            { name: 'GEO-eye_female_primitive_stylized.R',           proportionGroup: 'head' },
            { name: 'GEO-eyelid_upper_female_primitive_stylized.L',  proportionGroup: 'head' },
            { name: 'GEO-eyelid_upper_female_primitive_stylized.R',  proportionGroup: 'head' },
            { name: 'GEO-eyelid_lower_female_primitive_stylized.L',  proportionGroup: 'head' },
            { name: 'GEO-eyelid_lower_female_primitive_stylized.R',  proportionGroup: 'head' },
            { name: 'GEO-nose_female_primitive_stylized',            proportionGroup: 'head' },
            { name: 'GEO-nose_bridge_female_primitive_stylized',     proportionGroup: 'head' },
        ],
        foot_L: [
            { name: 'GEO-toe_big_female_primitive_stylized.L',       proportionGroup: 'legs' },
            { name: 'GEO-toe_index_female_primitive_stylized.L',     proportionGroup: 'legs' },
            { name: 'GEO-toe_middle_female_primitive_stylized.L',    proportionGroup: 'legs' },
            { name: 'GEO-toe_ring_female_primitive_stylized.L',      proportionGroup: 'legs' },
            { name: 'GEO-toe_pinky_female_primitive_stylized.L',     proportionGroup: 'legs' },
        ],
        foot_R: [
            { name: 'GEO-toe_big_female_primitive_stylized.R',       proportionGroup: 'legs' },
            { name: 'GEO-toe_index_female_primitive_stylized.R',     proportionGroup: 'legs' },
            { name: 'GEO-toe_middle_female_primitive_stylized.R',    proportionGroup: 'legs' },
            { name: 'GEO-toe_ring_female_primitive_stylized.R',      proportionGroup: 'legs' },
            { name: 'GEO-toe_pinky_female_primitive_stylized.R',     proportionGroup: 'legs' },
        ],
    },
    male: {
        head: [
            { name: 'GEO-ear_male_primitive_stylized.L',             proportionGroup: 'head' },
            { name: 'GEO-ear_male_primitive_stylized.R',             proportionGroup: 'head' },
            { name: 'GEO-eye_male_primitive_stylized.L',             proportionGroup: 'head' },
            { name: 'GEO-eye_male_primitive_stylized.R',             proportionGroup: 'head' },
            { name: 'GEO-nose_male_primitive_stylized',              proportionGroup: 'head' },
            { name: 'GEO-nose_bridge_male_primitive_stylized',       proportionGroup: 'head' },
        ],
        foot_L: [
            { name: 'GEO-toe_big_male_primitive_stylized.L',         proportionGroup: 'legs' },
            { name: 'GEO-toe_index_male_primitive_stylized.L',       proportionGroup: 'legs' },
            { name: 'GEO-toe_middle_male_primitive_stylized.L',      proportionGroup: 'legs' },
            { name: 'GEO-toe_ring_male_primitive_stylized.L',        proportionGroup: 'legs' },
            { name: 'GEO-toe_pinky_male_primitive_stylized.L',       proportionGroup: 'legs' },
        ],
        foot_R: [
            { name: 'GEO-toe_big_male_primitive_stylized.R',         proportionGroup: 'legs' },
            { name: 'GEO-toe_index_male_primitive_stylized.R',       proportionGroup: 'legs' },
            { name: 'GEO-toe_middle_male_primitive_stylized.R',      proportionGroup: 'legs' },
            { name: 'GEO-toe_ring_male_primitive_stylized.R',        proportionGroup: 'legs' },
            { name: 'GEO-toe_pinky_male_primitive_stylized.R',       proportionGroup: 'legs' },
        ],
    },
};

// Which proportion slider affects each bone's main segment.
const SEGMENT_PROPORTION_GROUP = {
    head:        'head',
    chest:       'waist',
    spine:       'waist',
    pelvis:      'hips',
    thigh_L:     'legs',
    thigh_R:     'legs',
    shin_L:      'legs',
    shin_R:      'legs',
    foot_L:      'legs',
    foot_R:      'legs',
    shoulder_L:  'arms',
    shoulder_R:  'arms',
    upper_arm_L: 'arms',
    upper_arm_R: 'arms',
    forearm_L:   'arms',
    forearm_R:   'arms',
    hand_L:      'arms',
    hand_R:      'arms',
    thumb_L:     'arms',
    index_L:     'arms',
    middle_L:    'arms',
    ring_L:      'arms',
    pinky_L:     'arms',
    thumb_R:     'arms',
    index_R:     'arms',
    middle_R:    'arms',
    ring_R:      'arms',
    pinky_R:     'arms',
};

// Cached loaded GLBs — avoids re-fetching on gender toggle
const _glbCache   = new Map(); // 'male'|'female' → Map<nodeName, THREE.Object3D>
const _scaleCache = new Map(); // 'male'|'female' → { charScale, groundOffsetGLB, centerX, centerZ }

// ── Custom GLB support ────────────────────────────────────────────────────────
// When set, 'custom' is a valid gender value that bypasses the built-in assets.

let _customGLB = null; // { nodeMap, meshMap, scaleInfo } | null

/**
 * Parse a GLB file (ArrayBuffer) and return a nodeMap.
 * Call setCustomGLB(nodeMap) to activate it.
 */
export async function parseCustomGLB(arrayBuffer) {
    const loader = new GLTFLoader();
    const gltf   = await new Promise((resolve, reject) => {
        loader.parse(arrayBuffer, '', resolve, reject);
    });
    gltf.scene.updateMatrixWorld(true);
    const nodeMap = new Map();
    gltf.scene.traverse(obj => {
        const name = obj.userData.name || obj.name;
        if (name) nodeMap.set(name, obj);
    });
    return nodeMap;
}

/**
 * Activate a custom model. Automatically detects mesh-to-bone mapping by
 * keyword matching on node names. Unmatched bones fall back to joints-only.
 */
export function setCustomGLB(nodeMap) {
    const meshMap   = _autoDetectMeshMap(nodeMap);
    const scaleInfo = _computeCustomScaleInfo(nodeMap);
    _customGLB = { nodeMap, meshMap, scaleInfo };
    const matched = Object.entries(meshMap).filter(([,v]) => v !== null).map(([k]) => k);
    console.log(`[AnimeMannequin] Custom model — matched ${matched.length} bones:`, matched.join(', '));
    const missed  = Object.entries(meshMap).filter(([,v]) => v === null).map(([k]) => k);
    if (missed.length) console.log('[AnimeMannequin] Unmatched (joints only):', missed.join(', '));
}

/** Remove custom model — next buildMannequin call will use the built-in asset. */
export function clearCustomGLB() {
    _customGLB = null;
}

/** Returns true when a custom model is currently active. */
export function hasCustomGLB() {
    return _customGLB !== null;
}

// Keyword lists for auto mesh detection — order matters (first match wins).
const _BONE_KEYWORDS = {
    torso:       null,
    head:        ['head'],
    neck:        ['neck'],
    spine:       ['spine', 'belly', 'abdomen'],
    chest:       ['chest', 'trunk', 'upperbody', 'upper_body'],
    pelvis:      ['pelvis', 'hip'],
    shoulder_L:  ['shoulder_l', 'shoulder.l', 'l_shoulder', 'shoulderl'],
    upper_arm_L: ['upper_arm_l', 'upperarm_l', 'arm_upper_l', 'l_upper_arm', 'l_arm'],
    forearm_L:   ['forearm_l', 'arm_lower_l', 'lowerarm_l', 'l_forearm'],
    hand_L:      ['hand_l', 'hand.l', 'l_hand'],
    shoulder_R:  ['shoulder_r', 'shoulder.r', 'r_shoulder', 'shoulderr'],
    upper_arm_R: ['upper_arm_r', 'upperarm_r', 'arm_upper_r', 'r_upper_arm', 'r_arm'],
    forearm_R:   ['forearm_r', 'arm_lower_r', 'lowerarm_r', 'r_forearm'],
    hand_R:      ['hand_r', 'hand.r', 'r_hand'],
    thigh_L:     ['thigh_l', 'leg_upper_l', 'upperleg_l', 'thigh.l', 'l_thigh'],
    shin_L:      ['shin_l', 'leg_lower_l', 'lowerleg_l', 'calf_l', 'l_shin'],
    foot_L:      ['foot_l', 'foot.l', 'l_foot'],
    thigh_R:     ['thigh_r', 'leg_upper_r', 'upperleg_r', 'thigh.r', 'r_thigh'],
    shin_R:      ['shin_r', 'leg_lower_r', 'lowerleg_r', 'calf_r', 'r_shin'],
    foot_R:      ['foot_r', 'foot.r', 'r_foot'],
};

function _autoDetectMeshMap(nodeMap) {
    const result = {};
    for (const [bone, keywords] of Object.entries(_BONE_KEYWORDS)) {
        if (keywords === null) { result[bone] = null; continue; }
        let found = null;
        for (const [name] of nodeMap) {
            const lower = name.toLowerCase();
            if (keywords.some(kw => lower.includes(kw))) { found = name; break; }
        }
        result[bone] = found;
    }
    return result;
}

function _computeCustomScaleInfo(nodeMap) {
    const bbox = new THREE.Box3();
    for (const [, obj] of nodeMap) {
        if (obj.isMesh) bbox.expandByObject(obj);
    }
    if (bbox.isEmpty()) {
        bbox.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 2, 0.5));
    }
    const size   = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);
    return {
        charScale:      size.y > 0.1 ? WORLD_HEIGHT / size.y : 1.0,
        groundOffsetGLB: -bbox.min.y,
        centerX:        center.x,
        centerZ:        center.z,
    };
}

// Map our bone names to GLB node names.
// torso is a virtual root (no geometry), maps to null.
export const MESH_MAP = {
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
        // Finger bones: FK pivots — own GLB node per finger
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
        // Finger bones: FK pivots — own GLB node per finger
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
};

// Left-hand phalange bone → node name in hand.glb (segmented left hand).
// Ordering proximal→distal: base, then .002 (middle), then .001 (tip).
export const HAND_NODE_MAP = {
    index_L_1:  'GEO-finger_index_female_primitive_stylized.L',
    index_L_2:  'GEO-finger_index_female_primitive_stylized.L.002',
    index_L_3:  'GEO-finger_index_female_primitive_stylized.L.001',
    middle_L_1: 'GEO-finger_middle_female_primitive_stylized.L',
    middle_L_2: 'GEO-finger_middle_female_primitive_stylized.L.002',
    middle_L_3: 'GEO-finger_middle_female_primitive_stylized.L.001',
    ring_L_1:   'GEO-finger_ring_female_primitive_stylized.L',
    ring_L_2:   'GEO-finger_ring_female_primitive_stylized.L.002',
    ring_L_3:   'GEO-finger_ring_female_primitive_stylized.L.001',
    pinky_L_1:  'GEO-finger_pinky_female_primitive_stylized.L',
    pinky_L_2:  'GEO-finger_pinky_female_primitive_stylized.L.002',
    pinky_L_3:  'GEO-finger_pinky_female_primitive_stylized.L.001',
    thumb_L_1:  'GEO-thumb_female_primitive_stylized.L',
    thumb_L_2:  'GEO-thumb_female_primitive_stylized.L.001',
};

export const HAND_PALM_NODE = 'GEO-hand_female_primitive_stylized.L';

let _handGLBCache = null;
export async function loadHandGLB() {
    if (_handGLBCache) return _handGLBCache;
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('./assets/hand.glb');
    gltf.scene.updateMatrixWorld(true);
    const nodeMap = new Map();
    gltf.scene.traverse(obj => {
        const name = obj.userData.name || obj.name;
        if (name) nodeMap.set(name, obj);
    });
    _handGLBCache = nodeMap;
    return nodeMap;
}

async function loadGLB(gender) {
    if (gender === 'custom') return _customGLB?.nodeMap ?? new Map();
    const key = gender === 'F' ? 'female' : 'male';
    if (_glbCache.has(key)) return _glbCache.get(key);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(`./assets/${key}.glb`);
    gltf.scene.updateMatrixWorld(true);
    const nodeMap = new Map();
    // GLTFLoader sanitizes obj.name (strips dots/brackets for AnimationMixer binding).
    // obj.userData.name preserves the original GLTF name including .L / .R suffixes.
    gltf.scene.traverse(obj => {
        const name = obj.userData.name || obj.name;
        if (name) nodeMap.set(name, obj);
    });
    _glbCache.set(key, nodeMap);
    return nodeMap;
}

/**
 * Compute character-specific scale info from the GLB.
 * Returns { charScale, groundOffsetGLB, centerX, centerZ } where:
 *   charScale     — multiply GLB units → scene units (targets WORLD_HEIGHT total height)
 *   groundOffsetGLB — add to GLB world Y so character foot sits at Y=0 in GLB units
 *   centerX/Z    — subtract from GLB world X/Z to center character at X=0, Z=0
 */
async function getCharacterScaleInfo(gender) {
    if (gender === 'custom') {
        return _customGLB?.scaleInfo ?? { charScale: 1, groundOffsetGLB: 0, centerX: 0, centerZ: 0 };
    }
    const key = gender === 'F' ? 'female' : 'male';
    if (_scaleCache.has(key)) return _scaleCache.get(key);

    const boneMap = MESH_MAP[key];
    const nodeMap = await loadGLB(gender);

    // The pelvis node is the GLB scene root for both models.
    // Its world position gives us the horizontal centering offset.
    const pelvisNode = nodeMap.get(boneMap.pelvis);
    const pelvisWorldPos = new THREE.Vector3();
    if (pelvisNode) pelvisNode.getWorldPosition(pelvisWorldPos);

    // Use the full character bounding box (all descendants of pelvis) for Y extent.
    let charBottomY = 0;
    let charTopY    = 1.5; // fallback
    if (pelvisNode) {
        const bbox = new THREE.Box3().setFromObject(pelvisNode);
        charBottomY = bbox.min.y;
        charTopY    = bbox.max.y;
    }

    const charHeightGLB = charTopY - charBottomY;
    const charScale     = charHeightGLB > 0.1 ? WORLD_HEIGHT / charHeightGLB : 1.0;
    const info = {
        charScale,
        groundOffsetGLB: -charBottomY, // add to GLB world Y so bottom = 0
        centerX: pelvisWorldPos.x,
        centerZ: pelvisWorldPos.z,
    };
    _scaleCache.set(key, info);
    return info;
}

export function makeToonMat(color) {
    // DoubleSide required: some GLB R-side nodes have scale=(-1,-1,-1) which
    // inverts winding order, making front-face culling hide the mesh.
    return new THREE.MeshToonMaterial({ color, side: THREE.DoubleSide });
}

/**
 * Build segment groups for all bones from GLB meshes.
 * Each group: joint sphere (isJoint=true) + optional GLB mesh segment.
 * The segment mesh carries the GLB node's local rotation and scale so that
 * the A-pose is reproduced correctly when all bone quaternions are identity.
 */
export async function buildSegments(gender) {
    const isCustom = gender === 'custom';
    const key      = isCustom ? null : (gender === 'F' ? 'female' : 'male');
    const boneMap  = isCustom ? (_customGLB?.meshMap ?? {}) : MESH_MAP[key];
    const nodeMap  = await loadGLB(gender);
    // Segmented hand (hand.glb) supplies finger phalange geometry for BOTH genders.
    // Phalange meshes always use the FEMALE hand scale (identical hands on both bodies).
    const handNodeMap = (key === 'female' || key === 'male') ? await loadHandGLB() : null;
    const handScale   = handNodeMap ? (await getCharacterScaleInfo('F')).charScale : 1;
    const { charScale } = await getCharacterScaleInfo(gender);
    const groups = new Map();

    for (const boneName of BONE_NAMES) {
        const group = new THREE.Group();
        group.name = boneName;

        const { jointR, hitR } = jointRadiiFor(gender, boneName);

        // Visible joint dot — MeshBasicMaterial + depthTest:false so it renders
        // on top of body geometry and is always clickable.
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(jointR, 12, 8),
            new THREE.MeshBasicMaterial({ color: JOINT_COLOR, depthTest: false })
        );
        sphere.renderOrder = 2;
        sphere.userData.boneName = boneName;
        sphere.userData.isJoint  = true;
        sphere.userData.originalColor = JOINT_COLOR; // overwritten by setJointColorMode
        group.add(sphere);

        // Invisible hit sphere — larger radius for easier click detection.
        // material.visible=false prevents rendering but object remains raycasted.
        const hitSphere = new THREE.Mesh(
            new THREE.SphereGeometry(hitR, 6, 4),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitSphere.userData.boneName    = boneName;
        hitSphere.userData.isJoint     = true;
        hitSphere.userData.isHitTarget = true;
        group.add(hitSphere);

        // GLB mesh segment
        const glbNodeName = boneMap[boneName];
        if (glbNodeName) {
            const glbNode = nodeMap.get(glbNodeName);
            if (glbNode) {
                // GLTFLoader wraps GLTF nodes that have children in a THREE.Group,
                // not a Mesh — so glbNode.isMesh is false for shoulder, upper_arm, etc.
                // Fix: traverse to find the first Mesh descendant for geometry.
                let meshNode = glbNode.isMesh ? glbNode : null;
                if (!meshNode) {
                    glbNode.traverse(c => { if (!meshNode && c.isMesh) meshNode = c; });
                }
                if (meshNode) {
                    const seg = new THREE.Mesh(meshNode.geometry.clone(), makeToonMat(SEGMENT_COLOR));
                    seg.userData.boneName = boneName;
                    seg.userData.proportionGroup = SEGMENT_PROPORTION_GROUP[boneName] ?? null;
                    seg.position.set(0, 0, 0);
                    // Use WORLD quaternion — accounts for all parent rotations in A-pose.
                    // Bone starts with identity world rotation, so seg.localQ = seg.worldQ
                    // = glbNode.worldQ, which correctly orients geometry in scene space.
                    const worldQ = new THREE.Quaternion();
                    glbNode.getWorldQuaternion(worldQ);
                    seg.quaternion.copy(worldQ);
                    // Use WORLD scale — propagates parent mirroring (scale=-1,-1,-1 for R-side).
                    const worldS = new THREE.Vector3();
                    glbNode.getWorldScale(worldS);
                    seg.scale.set(worldS.x * charScale, worldS.y * charScale, worldS.z * charScale);
                    seg.userData._baseScale    = { x: seg.scale.x, y: seg.scale.y, z: seg.scale.z };
                    seg.userData._basePosition = { x: 0, y: 0, z: 0 }; // at bone pivot — no offset
                    group.add(seg);
                }
            }
        }

        // Phalange segment from hand.glb. The bone pivot sits at the joint (hand.glb origins
        // are at the proximal joint), so geometry attaches at offset 0 and rotating the bone
        // curls the segment about the joint — same convention as body. Right hand mirrors the
        // left node across the sagittal plane (decompose handles the negative-scale reflection;
        // DoubleSide material keeps the flipped winding visible).
        const isRightPhalange = handNodeMap && boneName.includes('_R_');
        const handNodeName = handNodeMap
            ? (HAND_NODE_MAP[boneName] ?? (isRightPhalange ? HAND_NODE_MAP[boneName.replace('_R_', '_L_')] : null))
            : null;
        if (handNodeName) {
            const hNode = handNodeMap.get(handNodeName);
            if (hNode) {
                let meshNode = hNode.isMesh ? hNode : null;
                if (!meshNode) hNode.traverse(c => { if (!meshNode && c.isMesh) meshNode = c; });
                if (meshNode) {
                    const seg = new THREE.Mesh(meshNode.geometry.clone(), makeToonMat(SEGMENT_COLOR));
                    seg.userData.boneName        = boneName;
                    seg.userData.proportionGroup = SEGMENT_PROPORTION_GROUP[boneName] ?? null;
                    const wQ = new THREE.Quaternion();
                    hNode.getWorldQuaternion(wQ);
                    const wS = new THREE.Vector3();
                    hNode.getWorldScale(wS);
                    seg.position.set(0, 0, 0);
                    if (isRightPhalange) {
                        // Reflect the rest transform across scene x=0: F * (R · S), then decompose.
                        const m = new THREE.Matrix4().compose(
                            new THREE.Vector3(),
                            wQ,
                            new THREE.Vector3(wS.x * handScale, wS.y * handScale, wS.z * handScale),
                        );
                        m.premultiply(new THREE.Matrix4().makeScale(-1, 1, 1));
                        const mp = new THREE.Vector3(), mq = new THREE.Quaternion(), ms = new THREE.Vector3();
                        m.decompose(mp, mq, ms);
                        seg.quaternion.copy(mq);
                        seg.scale.copy(ms);
                    } else {
                        seg.quaternion.copy(wQ);
                        seg.scale.set(wS.x * handScale, wS.y * handScale, wS.z * handScale);
                    }
                    seg.userData._baseScale    = { x: seg.scale.x, y: seg.scale.y, z: seg.scale.z };
                    seg.userData._basePosition = { x: 0, y: 0, z: 0 };
                    group.add(seg);
                }
            }
        }

        // Add extra sub-meshes (breasts, ears, eyes, nose) — built-in models only
        const extras = isCustom ? [] : ((EXTRA_NODES[key]?.[boneName]) ?? []);
        for (const { name: extraName, proportionGroup: extraPG } of extras) {
            const extraNode = nodeMap.get(extraName);
            if (!extraNode) continue;

            // Find all mesh descendants (traverse visits extraNode itself, then children)
            const meshes = [];
            extraNode.traverse(c => { if (c.isMesh) meshes.push(c); });

            // Relative position: extra world pos minus parent bone world pos (both in GLB space), scaled
            const parentGlbNode = nodeMap.get(glbNodeName);
            const parentWorldPos = new THREE.Vector3();
            if (parentGlbNode) parentGlbNode.getWorldPosition(parentWorldPos);
            const extraWorldPos = new THREE.Vector3();
            extraNode.getWorldPosition(extraWorldPos);
            const relPos = new THREE.Vector3(
                (extraWorldPos.x - parentWorldPos.x) * charScale,
                (extraWorldPos.y - parentWorldPos.y) * charScale,
                (extraWorldPos.z - parentWorldPos.z) * charScale,
            );

            const extraWorldQ = new THREE.Quaternion();
            extraNode.getWorldQuaternion(extraWorldQ);
            const extraWorldS = new THREE.Vector3();
            extraNode.getWorldScale(extraWorldS);

            for (const meshNode of meshes) {
                const geom = meshNode.geometry.clone();
                const extraSeg = new THREE.Mesh(geom, makeToonMat(SEGMENT_COLOR));
                extraSeg.userData.boneName        = boneName;
                extraSeg.userData.proportionGroup = extraPG;
                extraSeg.position.copy(relPos);
                extraSeg.quaternion.copy(extraWorldQ);
                extraSeg.scale.set(extraWorldS.x * charScale, extraWorldS.y * charScale, extraWorldS.z * charScale);
                extraSeg.userData._baseScale    = { x: extraSeg.scale.x, y: extraSeg.scale.y, z: extraSeg.scale.z };
                extraSeg.userData._basePosition = { x: relPos.x, y: relPos.y, z: relPos.z };
                if (extraPG === 'bust') {
                    // Half-height of bust mesh in parent bone-group space.
                    // Projects world-up (0,1,0) into geometry local space so the result is correct
                    // even when extraWorldQ has a non-trivial rotation (e.g. Blender export tilt).
                    geom.computeBoundingBox();
                    const ext = new THREE.Vector3();
                    geom.boundingBox.getSize(ext);
                    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(extraWorldQ.clone().invert());
                    const geoHeight = Math.abs(localUp.x) * ext.x + Math.abs(localUp.y) * ext.y + Math.abs(localUp.z) * ext.z;
                    extraSeg.userData._bustHalfH = (geoHeight / 2) * Math.abs(extraWorldS.y) * charScale;
                }
                group.add(extraSeg);
            }
        }

        groups.set(boneName, group);
    }
    return groups;
}

/**
 * Compute world-space bone positions in scene units.
 * Bone positions are derived from GLB node world positions:
 *   - centered so character X/Z ≈ 0 (removes pelvis origin offset)
 *   - grounded so character foot bottom = Y=0
 *   - scaled by charScale (WORLD_HEIGHT / actual GLB character height)
 */
export async function computeBoneOffsets(gender) {
    const isCustom = gender === 'custom';
    const key      = isCustom ? null : (gender === 'F' ? 'female' : 'male');
    const boneMap  = isCustom ? (_customGLB?.meshMap ?? {}) : MESH_MAP[key];
    const nodeMap  = await loadGLB(gender);
    // Segmented hand (hand.glb) supplies the phalange pivots for BOTH genders.
    // hand.glb shares female.glb's coordinate space: female maps it absolutely via
    // toScenePos; male anchors the same hand at its own wrist (wrist-relative offsets,
    // female hand scale — both genders get identical hands).
    const handNodeMap = (key === 'female' || key === 'male') ? await loadHandGLB() : null;
    const handScale   = handNodeMap ? (await getCharacterScaleInfo('F')).charScale : 1;
    const { charScale, groundOffsetGLB, centerX, centerZ } = await getCharacterScaleInfo(gender);
    const offsets = new Map();

    function getWorldPos(nodeName) {
        if (!nodeName) return null;
        const node = nodeMap.get(nodeName);
        if (!node) return null;
        const v = new THREE.Vector3();
        node.getWorldPosition(v);
        return v;
    }

    // Convert GLB world position → scene position:
    //   remove horizontal character offset, apply ground offset, scale to scene units
    function toScenePos(worldPos) {
        return new THREE.Vector3(
            (worldPos.x - centerX) * charScale,
            (worldPos.y + groundOffsetGLB) * charScale,
            (worldPos.z - centerZ) * charScale
        );
    }

    // Torso is our virtual FK root — placed at the spine (belly) GLB world position
    const spinePos = getWorldPos(boneMap.spine)
        ?? new THREE.Vector3(centerX, -groundOffsetGLB + 0.5, centerZ);
    offsets.set('torso', toScenePos(spinePos));

    for (const boneName of BONE_NAMES) {
        if (boneName === 'torso') continue;
        // Phalange bones take their pivot from hand.glb (origin at the joint).
        // Left side resolves directly; right side mirrors the left pivot across x=0.
        if (handNodeMap && /_(L|R)_\d$/.test(boneName)) {
            const leftName = boneName.includes('_R_') ? boneName.replace('_R_', '_L_') : boneName;
            const hn = handNodeMap.get(HAND_NODE_MAP[leftName]);
            if (hn) {
                const v = new THREE.Vector3();
                hn.getWorldPosition(v);
                let p;
                if (key === 'female') {
                    // hand.glb lives in female.glb's coordinate space — map absolutely.
                    p = toScenePos(v);
                } else {
                    // male: anchor at the male wrist; offsets relative to hand.glb's palm
                    // origin (at the wrist), converted with the FEMALE hand scale so both
                    // genders get identical hands.
                    const palm = handNodeMap.get(HAND_PALM_NODE);
                    const pv = new THREE.Vector3();
                    if (palm) palm.getWorldPosition(pv);
                    const wrist = offsets.get('hand_L'); // hand_L precedes phalanges in BONE_NAMES
                    p = new THREE.Vector3(
                        wrist.x + (v.x - pv.x) * handScale,
                        wrist.y + (v.y - pv.y) * handScale,
                        wrist.z + (v.z - pv.z) * handScale,
                    );
                }
                if (boneName.includes('_R_')) p.x = -p.x;
                offsets.set(boneName, p);
                continue;
            }
        }
        const pos = getWorldPos(boneMap[boneName]);
        if (pos) {
            offsets.set(boneName, toScenePos(pos));
        } else {
            // Fallback for unmapped bones: place at torso
            offsets.set(boneName, (offsets.get('torso') ?? new THREE.Vector3()).clone());
        }
    }

    return offsets;
}

export { SELECT_COLOR, JOINT_COLOR, JOINT_RADIUS, HIT_RADIUS };
