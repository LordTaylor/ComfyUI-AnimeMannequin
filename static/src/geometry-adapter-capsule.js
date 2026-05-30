import * as THREE from '../lib/three.module.js';
import { PROPORTIONS, BONE_NAMES } from './mannequin-model.js';

// Total mannequin height in Three.js world units
export const WORLD_HEIGHT = 2.0;

// Toon material shared across all segments (renderer applies gradient map)
function makeMaterial(color) {
    return new THREE.MeshToonMaterial({ color });
}

const JOINT_COLOR  = 0xaaaaaa;
const SEGMENT_COLOR = 0xcccccc;
const SELECT_COLOR  = 0x4fc3f7;

/**
 * Build segment groups for all bones.
 * Returns Map<boneName, THREE.Group> — each group contains:
 *   - a sphere mesh tagged userData.isJoint = true (clickable handle)
 *   - a capsule mesh (the visual segment), if the bone has length > 0
 *
 * The group's local origin is the joint position.
 * Capsule extends in -Y (toward the child bone).
 *
 * @param {string} gender - 'F' | 'M'
 * @returns {Map<string, THREE.Group>}
 */
export function buildSegments(gender) {
    const P = PROPORTIONS[gender];
    const S = WORLD_HEIGHT; // scale factor
    const groups = new Map();

    for (const name of BONE_NAMES) {
        const props = P[name];
        const group = new THREE.Group();
        group.name = name;

        // Joint sphere — clickable handle for selection
        const r = (props.radius ?? 0.035) * S;
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(r, 16, 12),
            makeMaterial(JOINT_COLOR)
        );
        sphere.userData.boneName = name;
        sphere.userData.isJoint = true;
        group.add(sphere);

        // Segment capsule — visual body of the bone
        const len = (props.length ?? 0) * S;
        if (len > 0.001) {
            const segR = r * 0.75;
            const capsule = new THREE.Mesh(
                new THREE.CapsuleGeometry(segR, len - segR * 2, 8, 16),
                makeMaterial(SEGMENT_COLOR)
            );
            capsule.userData.boneName = name;
            capsule.position.y = -len / 2;
            group.add(capsule);
        }

        groups.set(name, group);
    }

    return groups;
}

/**
 * Compute the local offset of each bone relative to its parent.
 * Used by the renderer to place bones in the Object3D hierarchy.
 *
 * Returns Map<boneName, THREE.Vector3>
 */
export function computeBoneOffsets(gender) {
    const P = PROPORTIONS[gender];
    const S = WORLD_HEIGHT;
    const offsets = new Map();

    // Torso sits at pelvis height (= thigh + shin + foot lengths from floor)
    const floorToTorso = (P.thigh_L.length + P.shin_L.length + P.foot_L.length) * S;

    offsets.set('torso',  new THREE.Vector3(0, floorToTorso, 0));
    offsets.set('spine',  new THREE.Vector3(0, P.pelvis.length * S, 0));
    offsets.set('chest',  new THREE.Vector3(0, P.spine.length * S, 0));
    offsets.set('neck',   new THREE.Vector3(0, P.chest.length * S, 0));
    offsets.set('head',   new THREE.Vector3(0, P.neck.length * S, 0));

    const halfSpan = (P.shoulderSpan / 2) * S;
    offsets.set('shoulder_L', new THREE.Vector3(-halfSpan, P.chest.length * S * 0.85, 0));
    offsets.set('upper_arm_L', new THREE.Vector3(-P.shoulder_L.length * S, 0, 0));
    offsets.set('forearm_L',   new THREE.Vector3(0, -P.upper_arm_L.length * S, 0));
    offsets.set('hand_L',      new THREE.Vector3(0, -P.forearm_L.length * S, 0));

    offsets.set('shoulder_R', new THREE.Vector3(halfSpan, P.chest.length * S * 0.85, 0));
    offsets.set('upper_arm_R', new THREE.Vector3(P.shoulder_R.length * S, 0, 0));
    offsets.set('forearm_R',   new THREE.Vector3(0, -P.upper_arm_R.length * S, 0));
    offsets.set('hand_R',      new THREE.Vector3(0, -P.forearm_R.length * S, 0));

    offsets.set('pelvis', new THREE.Vector3(0, 0, 0));
    const halfHip = (P.pelvis.width / 2) * S * 0.55;
    offsets.set('thigh_L', new THREE.Vector3(-halfHip, 0, 0));
    offsets.set('shin_L',  new THREE.Vector3(0, -P.thigh_L.length * S, 0));
    offsets.set('foot_L',  new THREE.Vector3(0, -P.shin_L.length * S, 0));
    offsets.set('thigh_R', new THREE.Vector3(halfHip, 0, 0));
    offsets.set('shin_R',  new THREE.Vector3(0, -P.thigh_R.length * S, 0));
    offsets.set('foot_R',  new THREE.Vector3(0, -P.shin_R.length * S, 0));

    return offsets;
}

export { SELECT_COLOR, JOINT_COLOR };
