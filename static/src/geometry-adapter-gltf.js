import * as THREE from '../lib/three.module.js';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import { BONE_NAMES } from './mannequin-model.js';

export const WORLD_HEIGHT = 2.0;

const JOINT_COLOR   = 0xaaaaaa;
const SEGMENT_COLOR = 0xcccccc;
const SELECT_COLOR  = 0x4fc3f7;

const JOINT_RADIUS = 0.055; // visible sphere
const HIT_RADIUS   = 0.12;  // invisible larger sphere for easier click detection

// OpenPose ControlNet color scheme — matches standard keypoint visualization.
// Colors follow the rainbow gradient: head=red, neck=orange, R-arm=yellow-green,
// L-arm=green, R-leg=teal-cyan, L-leg=blue-purple.
export const OPENPOSE_COLORS = {
    head:        0xff0000,
    neck:        0xff5500,
    chest:       0xffffff,
    spine:       0xdddddd,
    torso:       0xaaaaaa,
    shoulder_R:  0xffaa00,
    upper_arm_R: 0xffff00,
    forearm_R:   0xaaff00,
    hand_R:      0x55ff00,
    shoulder_L:  0x00ff00,
    upper_arm_L: 0x00ff55,
    forearm_L:   0x00ffaa,
    hand_L:      0x00ffdd,
    pelvis:      0x00cccc,
    thigh_R:     0x00ffcc,
    shin_R:      0x00ffff,
    foot_R:      0x00aaff,
    thigh_L:     0x0055ff,
    shin_L:      0x0000ff,
    foot_L:      0x5500ff,
};

// GLB sub-meshes that attach to a bone without their own FK pivot.
// These are children of the bone's GLB node (e.g. breasts hang on chest).
const EXTRA_NODES = {
    female: {
        chest: [
            { name: 'GEO-breast_female_primitive_stylized.L', proportionGroup: 'bust' },
            { name: 'GEO-breast_female_primitive_stylized.R', proportionGroup: 'bust' },
        ],
        head: [
            { name: 'GEO-ear_female_primitive_stylized.L',  proportionGroup: null },
            { name: 'GEO-ear_female_primitive_stylized.R',  proportionGroup: null },
            { name: 'GEO-eye_female_primitive_stylized.L',  proportionGroup: null },
            { name: 'GEO-eye_female_primitive_stylized.R',  proportionGroup: null },
        ],
    },
    male: {
        head: [
            { name: 'GEO-ear_male_primitive_stylized.L',             proportionGroup: null },
            { name: 'GEO-ear_male_primitive_stylized.R',             proportionGroup: null },
            { name: 'GEO-eye_male_primitive_stylized.L',             proportionGroup: null },
            { name: 'GEO-eye_male_primitive_stylized.R',             proportionGroup: null },
            { name: 'GEO-nose_male_primitive_stylized',              proportionGroup: null },
            { name: 'GEO-nose_bridge_male_primitive_stylized',       proportionGroup: null },
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
};

// Cached loaded GLBs — avoids re-fetching on gender toggle
const _glbCache   = new Map(); // 'male'|'female' → Map<nodeName, THREE.Object3D>
const _scaleCache = new Map(); // 'male'|'female' → { charScale, groundOffsetGLB, centerX, centerZ }

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
    const key = gender === 'F' ? 'female' : 'male';
    const boneMap = MESH_MAP[key];
    const nodeMap = await loadGLB(gender);
    const { charScale } = await getCharacterScaleInfo(gender);
    const groups = new Map();

    for (const boneName of BONE_NAMES) {
        const group = new THREE.Group();
        group.name = boneName;

        // Visible joint dot — MeshBasicMaterial + depthTest:false so it renders
        // on top of body geometry and is always clickable.
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(JOINT_RADIUS, 12, 8),
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
            new THREE.SphereGeometry(HIT_RADIUS, 6, 4),
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
                    seg.userData._baseScale = { x: seg.scale.x, y: seg.scale.y, z: seg.scale.z };
                    group.add(seg);
                }
            }
        }

        // Add extra sub-meshes (breasts, ears, eyes, nose)
        const extras = (EXTRA_NODES[key]?.[boneName]) ?? [];
        for (const { name: extraName, proportionGroup: extraPG } of extras) {
            const extraNode = nodeMap.get(extraName);
            if (!extraNode) continue;

            // Find all mesh descendants of the extra node (handles eye→eyelid hierarchy)
            const meshes = [];
            extraNode.traverse(c => { if (c.isMesh) meshes.push(c); });
            if (!meshes.length) {
                if (extraNode.isMesh) meshes.push(extraNode);
            }

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
                const extraSeg = new THREE.Mesh(meshNode.geometry.clone(), makeToonMat(SEGMENT_COLOR));
                extraSeg.userData.boneName        = boneName;
                extraSeg.userData.proportionGroup = extraPG;
                extraSeg.position.copy(relPos);
                extraSeg.quaternion.copy(extraWorldQ);
                extraSeg.scale.set(extraWorldS.x * charScale, extraWorldS.y * charScale, extraWorldS.z * charScale);
                extraSeg.userData._baseScale = { x: extraSeg.scale.x, y: extraSeg.scale.y, z: extraSeg.scale.z };
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
    const key = gender === 'F' ? 'female' : 'male';
    const boneMap = MESH_MAP[key];
    const nodeMap = await loadGLB(gender);
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
