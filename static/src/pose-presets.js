// static/src/pose-presets.js
// Built-in body poses. Angles are LOCAL Euler degrees (order 'XYZ') applied on top of
// the GLB A-pose rest, matching generateRandomPose's convention. Only the bones a pose
// cares about are listed; presetToPose fills every other bone with identity so a preset
// is deterministic regardless of the prior pose. Finger bones are left neutral (the user
// adds a grip via the Hands finger presets).
//
// NOTE: these angle values are a mechanically-reasonable first pass and are expected to be
// tuned visually in the browser. Combat / sitting / walking especially.
import * as THREE from '../lib/three.module.js';
import { BONE_NAMES } from './mannequin-model.js';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export const POSE_PRESETS = [
    // ── Basic ────────────────────────────────────────────────────────────────
    { id: 't_pose', name: 'T-poza', group: 'basic', angles: {
        upper_arm_L: [0, 0, 55], upper_arm_R: [0, 0, -55],
    } },
    { id: 'arms_up', name: 'Ręce w górze', group: 'basic', angles: {
        upper_arm_L: [0, 0, 160], upper_arm_R: [0, 0, -160],
    } },
    { id: 'hands_on_hips', name: 'Ręce na biodrach', group: 'basic', angles: {
        // Hand-authored (Jarek's export): elbow folds in the frontal plane (Z) so the hand
        // returns to the hip — this rig's "hand to body" is Z, not X.
        upper_arm_L: [0, 0, -8], forearm_L: [0, 0, -39], hand_L: [0, 0, 40],
        upper_arm_R: [0, 0,  8], forearm_R: [0, 0,  37], hand_R: [0, 0, -46],
    } },
    // FLEXION SIGN CONVENTION (this rig): forward flexion of the SHOULDER (upper_arm) and
    // HIP (thigh) is NEGATIVE X (positive X swings them backward). The ELBOW bends at
    // forearm +X; the KNEE bends at shin +X (drops the calf DOWN when the hip is flexed forward).
    { id: 'arms_crossed', name: 'Ręce skrzyżowane', group: 'basic', angles: {
        upper_arm_L: [-30, 0, 18], forearm_L: [100, 0, 0],
        upper_arm_R: [-30, 0, -18], forearm_R: [100, 0, 0],
    } },
    { id: 'contrapposto', name: 'Kontrapost', group: 'basic', angles: {
        pelvis: [0, 0, 8], thigh_L: [-2, 0, -6], thigh_R: [4, 0, 4],
        upper_arm_L: [0, 0, 8], upper_arm_R: [0, 0, -10],
    } },
    { id: 'waving', name: 'Machanie', group: 'basic', angles: {
        upper_arm_R: [0, 0, -150], forearm_R: [55, 0, 0],
        upper_arm_L: [0, 0, 10],
    } },
    { id: 'sitting', name: 'Siad', group: 'basic', angles: {
        // Hip flexes forward at NEGATIVE X. Z stays 0: at 90° flexion a Z component
        // gimbal-couples into yaw and splays the knees sideways. Knees parallel-forward.
        thigh_L: [-90, 0, 0], shin_L: [95, 0, 0],
        thigh_R: [-90, 0, 0], shin_R: [95, 0, 0],
    } },
    { id: 'walking', name: 'Krok / marsz', group: 'basic', angles: {
        thigh_L: [-28, 0, 0], shin_L: [15, 0, 0],
        thigh_R: [22, 0, 0], shin_R: [30, 0, 0],
        upper_arm_L: [25, 0, 0], upper_arm_R: [-25, 0, 0],
    } },
    // ── Combat (body only — weapon/shield attached as a prop) ──────────────────
    { id: 'rifle', name: 'Strzelecka — karabin', group: 'combat', angles: {
        upper_arm_L: [-70, 0, 12], forearm_L: [45, 0, 0],
        upper_arm_R: [-62, 0, -12], forearm_R: [65, 0, 0],
        thigh_R: [12, 0, 0], shin_R: [10, 0, 0],
    } },
    { id: 'pistol', name: 'Strzelecka — pistolet', group: 'combat', angles: {
        upper_arm_L: [-82, 0, 6], forearm_L: [10, 0, 0],
        upper_arm_R: [-82, 0, -6], forearm_R: [10, 0, 0],
    } },
    { id: 'saber', name: 'Szermiercza — szabla', group: 'combat', angles: {
        upper_arm_R: [-80, 0, -6], forearm_R: [10, 0, 0],
        upper_arm_L: [30, 0, 14], forearm_L: [30, 0, 0],
        thigh_R: [-22, 0, 0], shin_R: [18, 0, 0], thigh_L: [10, 0, 0],
    } },
    { id: 'sword_shield', name: 'Szermiercza — miecz + tarcza', group: 'combat', angles: {
        upper_arm_L: [-72, 0, 12], forearm_L: [50, 0, 0],
        upper_arm_R: [-70, 0, -12], forearm_R: [55, 0, 0],
        thigh_L: [-22, 0, 0], shin_L: [18, 0, 0], thigh_R: [10, 0, 0],
    } },
    { id: 'rapier', name: 'Szermiercza — rapier (en-garde)', group: 'combat', angles: {
        upper_arm_R: [-80, 0, -6], forearm_R: [8, 0, 0],
        upper_arm_L: [40, 0, 40], forearm_L: [70, 0, 0],
        thigh_R: [-22, 0, 0], shin_R: [18, 0, 0], thigh_L: [10, 0, 0],
    } },
];

const _byId = new Map(POSE_PRESETS.map(p => [p.id, p]));

export function presetById(id) {
    return _byId.get(id) ?? null;
}

/**
 * Convert a preset to a full pose map { boneName: {x,y,z,w} } covering every BONE_NAMES
 * entry. Listed bones get the quaternion from their Euler degrees ('XYZ'); all others
 * get identity.
 */
export function presetToPose(preset) {
    const pose = {};
    const euler = new THREE.Euler();
    const quat  = new THREE.Quaternion();
    const DEG   = Math.PI / 180;
    const angles = preset?.angles ?? {};
    for (const name of BONE_NAMES) {
        const a = angles[name];
        if (a) {
            euler.set(a[0] * DEG, a[1] * DEG, a[2] * DEG, 'XYZ');
            quat.setFromEuler(euler);
            pose[name] = { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
        } else {
            pose[name] = { ...IDENTITY };
        }
    }
    return pose;
}
