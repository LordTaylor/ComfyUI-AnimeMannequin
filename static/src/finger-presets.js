import * as THREE from '../lib/three.module.js';

// Phalange bones: _1 = proximal (MCP/knuckle), _2 = middle (PIP), _3 = distal (DIP).
// Thumb has two segments (_1, _2).
const FINGERS = [
    ['thumb', 2], ['index', 3], ['middle', 3], ['ring', 3], ['pinky', 3],
];

export const FINGER_BONES = FINGERS.flatMap(([f, segs]) =>
    ['L', 'R'].flatMap(side =>
        Array.from({ length: segs }, (_, i) => `${f}_${side}_${i + 1}`)));

// Local-space curl axis. Fingers curl toward the palm around X; the thumb opposes
// across the palm around Z. Right hand mirrors the sign so both close inward.
const CURL_AXIS  = new THREE.Vector3(1, 0, 0);
const THUMB_AXIS = new THREE.Vector3(0, 0, 1);

// Per-joint curl (degrees) per finger, per preset: fingers [MCP, PIP, DIP], thumb [MCP, IP].
const PRESET_CURLS = {
    'Pięść':        { thumb: [40, 50], index: [80, 95, 70], middle: [80, 95, 70], ring: [80, 95, 70], pinky: [80, 95, 70] },
    'Otwarta dłoń': { thumb: [0, 0],   index: [0, 0, 0],    middle: [0, 0, 0],    ring: [0, 0, 0],    pinky: [0, 0, 0] },
    'Wskazywanie':  { thumb: [40, 50], index: [0, 0, 0],    middle: [80, 95, 70], ring: [80, 95, 70], pinky: [80, 95, 70] },
    'Peace':        { thumb: [40, 50], index: [0, 0, 0],    middle: [0, 0, 0],    ring: [80, 95, 70], pinky: [80, 95, 70] },
    'OK':           { thumb: [25, 35], index: [40, 55, 30], middle: [0, 0, 0],    ring: [0, 0, 0],    pinky: [0, 0, 0] },
    'Półzgięte':    { thumb: [10, 15], index: [20, 25, 15], middle: [20, 25, 15], ring: [20, 25, 15], pinky: [20, 25, 15] },
};

export const FINGER_PRESETS = PRESET_CURLS;

const DEG = Math.PI / 180;

/** Quaternion for one phalange at a given curl (deg), side 'L'|'R'. */
function jointQuat(finger, deg, side) {
    if (!deg) return [0, 0, 0, 1];
    const axis = finger === 'thumb' ? THUMB_AXIS : CURL_AXIS;
    const sign = side === 'R' ? -1 : 1;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, sign * deg * DEG);
    return [q.x, q.y, q.z, q.w];
}

/** Build a { boneName: [x,y,z,w] } pose for all 28 phalange bones from a preset name. */
export function buildPresetPose(name) {
    const curls = PRESET_CURLS[name];
    if (!curls) throw new Error(`Unknown finger preset: ${name}`);
    const pose = {};
    for (const [finger, segs] of FINGERS) {
        for (const side of ['L', 'R']) {
            for (let i = 0; i < segs; i++) {
                pose[`${finger}_${side}_${i + 1}`] = jointQuat(finger, curls[finger][i] ?? 0, side);
            }
        }
    }
    return pose;
}
