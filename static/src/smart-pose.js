// static/src/smart-pose.js
// Pure helpers for the smart Random generator. RNG is injected (a () => [0,1) function)
// so behavior is deterministic in tests. No DOM. (Imports THREE for quaternion math and
// pose-presets for the eligible pool.)
import * as THREE from '../lib/three.module.js';
import { presetById } from './pose-presets.js';

// Base pose pool. NOW: the 8 'basic' presets. To include combat poses in the eventual
// default, extend this array with: 'rifle','pistol','saber','sword_shield','rapier'.
export const ELIGIBLE_PRESET_IDS = [
    't_pose', 'arms_up', 'hands_on_hips', 'arms_crossed', 'contrapposto', 'waving', 'sitting', 'walking',
];

// Bones the jitter perturbs (limbs come from IK; fingers are left neutral).
export const TORSO_BONES = ['spine', 'chest', 'neck', 'head', 'pelvis', 'shoulder_L', 'shoulder_R'];

// Intensity for the safe/wild toggle. jitterDeg = max per-axis torso jitter (degrees);
// reachFrac = IK target offset radius as a fraction of the limb's total length.
export const INTENSITY = {
    safe: { jitterDeg: 8,  reachFrac: 0.12 },
    wild: { jitterDeg: 22, reachFrac: 0.30 },
};

const DEG = Math.PI / 180;

/** Pick a base preset uniformly from the eligible pool. rng: () => [0,1). */
export function pickBasePreset(rng) {
    const idx = Math.min(ELIGIBLE_PRESET_IDS.length - 1, Math.floor(rng() * ELIGIBLE_PRESET_IDS.length));
    return presetById(ELIGIBLE_PRESET_IDS[idx]);
}

/**
 * Return a NEW pose map with a small random rotation composed onto each listed bone.
 * Each axis is uniform in [-jitterDeg, +jitterDeg] (Euler 'XYZ'), applied in the bone's
 * local frame (q_out = q_in * q_jitter). Bones not in `bones` are copied unchanged.
 */
export function jitterPose(pose, rng, jitterDeg, bones = TORSO_BONES) {
    const out = {};
    const set = new Set(bones);
    const euler = new THREE.Euler();
    const jq = new THREE.Quaternion();
    const base = new THREE.Quaternion();
    for (const [name, q] of Object.entries(pose)) {
        if (!set.has(name)) { out[name] = { ...q }; continue; }
        const rx = (rng() * 2 - 1) * jitterDeg * DEG;
        const ry = (rng() * 2 - 1) * jitterDeg * DEG;
        const rz = (rng() * 2 - 1) * jitterDeg * DEG;
        euler.set(rx, ry, rz, 'XYZ');
        jq.setFromEuler(euler);
        base.set(q.x, q.y, q.z, q.w).multiply(jq);
        out[name] = { x: base.x, y: base.y, z: base.z, w: base.w };
    }
    return out;
}

/** Random offset vector with uniform direction and magnitude in [0, radius]. */
export function randomOffsetVec(rng, radius) {
    // uniform direction on the unit sphere
    const u = rng() * 2 - 1;            // cos(theta) in [-1,1]
    const phi = rng() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    const dir = new THREE.Vector3(s * Math.cos(phi), s * Math.sin(phi), u);
    return dir.multiplyScalar(rng() * radius);
}
