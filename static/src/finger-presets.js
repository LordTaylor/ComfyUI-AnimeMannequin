import * as THREE from '../lib/three.module.js';

export const FINGER_BONES = [
    'thumb_L','index_L','middle_L','ring_L','pinky_L',
    'thumb_R','index_R','middle_R','ring_R','pinky_R',
];

const FINGERS = ['thumb','index','middle','ring','pinky'];

// Local-space curl axis for the four fingers. Confirmed/flipped during visual
// verification (Plan 1a Task 5). Fingers curl toward the palm around this axis.
const CURL_AXIS  = new THREE.Vector3(1, 0, 0);
// Thumb opposes across the palm — blend of curl + inward yaw.
const THUMB_AXIS = new THREE.Vector3(0, 0, 1);

// Curl magnitude in degrees per finger, per preset. 0 = straight.
// Order: [thumb, index, middle, ring, pinky]
const PRESET_CURLS = {
    'Pięść':        [70,  95,  95,  95,  95],
    'Otwarta dłoń': [ 0,   0,   0,   0,   0],
    'Wskazywanie':  [60,   0,  95,  95,  95],
    'Peace':        [60,   0,   0,  95,  95],
    'OK':           [45,  45,   0,   0,   0],
    'Półzgięte':    [15,  25,  25,  25,  25],
};

export const FINGER_PRESETS = PRESET_CURLS;

const DEG = Math.PI / 180;

/** Quaternion for one finger at a given curl (deg), for side 'L' or 'R'. */
function fingerQuat(finger, deg, side) {
    if (!deg) return [0, 0, 0, 1];
    const axis = (finger === 'thumb' ? THUMB_AXIS : CURL_AXIS).clone();
    // Mirror the curl direction for the right hand so both hands close inward.
    const sign = side === 'R' ? -1 : 1;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, sign * deg * DEG);
    return [q.x, q.y, q.z, q.w];
}

/** Build a { boneName: [x,y,z,w] } pose for all 10 finger bones from a preset name. */
export function buildPresetPose(name) {
    const curls = PRESET_CURLS[name];
    if (!curls) throw new Error(`Unknown finger preset: ${name}`);
    const pose = {};
    FINGERS.forEach((finger, i) => {
        pose[`${finger}_L`] = fingerQuat(finger, curls[i], 'L');
        pose[`${finger}_R`] = fingerQuat(finger, curls[i], 'R');
    });
    return pose;
}
