export const BONE_NAMES = [
    'torso', 'spine', 'chest', 'neck', 'head',
    'shoulder_L', 'upper_arm_L', 'forearm_L', 'hand_L',
    'shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R',
    'pelvis',
    'thigh_L', 'shin_L', 'foot_L',
    'thigh_R', 'shin_R', 'foot_R',
    'thumb_L', 'index_L', 'middle_L', 'ring_L', 'pinky_L',
    'thumb_R', 'index_R', 'middle_R', 'ring_R', 'pinky_R',
];

export const BONE_CHILDREN = {
    torso:     ['spine', 'pelvis'],
    spine:     ['chest'],
    chest:     ['neck', 'shoulder_L', 'shoulder_R'],
    neck:      ['head'],
    head:      [],
    shoulder_L: ['upper_arm_L'],
    upper_arm_L: ['forearm_L'],
    forearm_L:  ['hand_L'],
    hand_L:     ['thumb_L', 'index_L', 'middle_L', 'ring_L', 'pinky_L'],
    thumb_L: [], index_L: [], middle_L: [], ring_L: [], pinky_L: [],
    shoulder_R: ['upper_arm_R'],
    upper_arm_R: ['forearm_R'],
    forearm_R:  ['hand_R'],
    hand_R:     ['thumb_R', 'index_R', 'middle_R', 'ring_R', 'pinky_R'],
    thumb_R: [], index_R: [], middle_R: [], ring_R: [], pinky_R: [],
    pelvis:    ['thigh_L', 'thigh_R'],
    thigh_L:   ['shin_L'],
    shin_L:    ['foot_L'],
    foot_L:    [],
    thigh_R:   ['shin_R'],
    shin_R:    ['foot_R'],
    foot_R:    [],
};

// All lengths/radii relative to total mannequin height = 1.0
export const PROPORTIONS = {
    F: {
        torso:       { length: 0 }, // virtual root, no geometry — transform origin only
        spine:       { length: 0.060, radius: 0.038 },
        chest:       { length: 0.175, width: 0.130, depth: 0.085, radius: 0.050 },
        neck:        { length: 0.055, radius: 0.030 },
        head:        { radius: 0.115 },
        shoulder_L:  { length: 0.040, radius: 0.038 },
        upper_arm_L: { length: 0.155, radius: 0.028 },
        forearm_L:   { length: 0.130, radius: 0.022 },
        hand_L:      { length: 0.060, radius: 0.022 },
        shoulder_R:  { length: 0.040, radius: 0.038 },
        upper_arm_R: { length: 0.155, radius: 0.028 },
        forearm_R:   { length: 0.130, radius: 0.022 },
        hand_R:      { length: 0.060, radius: 0.022 },
        pelvis:      { length: 0.080, width: 0.155, depth: 0.090, radius: 0.050 },
        thigh_L:     { length: 0.230, radius: 0.042 },
        shin_L:      { length: 0.210, radius: 0.032 },
        foot_L:      { length: 0.080, radius: 0.028 },
        thigh_R:     { length: 0.230, radius: 0.042 },
        shin_R:      { length: 0.210, radius: 0.032 },
        foot_R:      { length: 0.080, radius: 0.028 },
        thumb_L: { radius: 0.012 }, index_L: { radius: 0.011 }, middle_L: { radius: 0.011 },
        ring_L:  { radius: 0.010 }, pinky_L: { radius: 0.009 },
        thumb_R: { radius: 0.012 }, index_R: { radius: 0.011 }, middle_R: { radius: 0.011 },
        ring_R:  { radius: 0.010 }, pinky_R: { radius: 0.009 },
        shoulderSpan: 0.270,
    },
    M: {
        torso:       { length: 0 }, // virtual root, no geometry — transform origin only
        spine:       { length: 0.060, radius: 0.044 },
        chest:       { length: 0.185, width: 0.155, depth: 0.100, radius: 0.060 },
        neck:        { length: 0.055, radius: 0.036 },
        head:        { radius: 0.100 },
        shoulder_L:  { length: 0.040, radius: 0.044 },
        upper_arm_L: { length: 0.165, radius: 0.034 },
        forearm_L:   { length: 0.140, radius: 0.028 },
        hand_L:      { length: 0.065, radius: 0.028 },
        shoulder_R:  { length: 0.040, radius: 0.044 },
        upper_arm_R: { length: 0.165, radius: 0.034 },
        forearm_R:   { length: 0.140, radius: 0.028 },
        hand_R:      { length: 0.065, radius: 0.028 },
        pelvis:      { length: 0.080, width: 0.130, depth: 0.090, radius: 0.048 },
        thigh_L:     { length: 0.220, radius: 0.048 },
        shin_L:      { length: 0.210, radius: 0.038 },
        foot_L:      { length: 0.085, radius: 0.032 },
        thigh_R:     { length: 0.220, radius: 0.048 },
        shin_R:      { length: 0.210, radius: 0.038 },
        foot_R:      { length: 0.085, radius: 0.032 },
        thumb_L: { radius: 0.012 }, index_L: { radius: 0.011 }, middle_L: { radius: 0.011 },
        ring_L:  { radius: 0.010 }, pinky_L: { radius: 0.009 },
        thumb_R: { radius: 0.012 }, index_R: { radius: 0.011 }, middle_R: { radius: 0.011 },
        ring_R:  { radius: 0.010 }, pinky_R: { radius: 0.009 },
        shoulderSpan: 0.340,
    },
};

const IDENTITY_QUAT = [0, 0, 0, 1];

export function defaultProportions() {
    return { head: 1.0, bust: 1.0, hips: 1.0, waist: 1.0, legs: 1.0, arms: 1.0 };
}

export function defaultScene(gender = 'F') {
    const bones = {};
    for (const name of BONE_NAMES) {
        bones[name] = { rotation: [...IDENTITY_QUAT] };
    }
    return {
        version: '1.0',
        gender,
        bones,
        camera: { azimuth: 0, elevation: 5, distance: 2.5 },
        proportions: defaultProportions(),
    };
}

export function sceneToJSON(scene) {
    return JSON.stringify(scene);
}

export function jsonToScene(json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch { throw new Error('Invalid JSON'); }
    if (!parsed.version || !parsed.gender || !parsed.bones || !parsed.camera) {
        throw new Error('Invalid scene: missing required fields');
    }
    for (const name of BONE_NAMES) {
        if (!parsed.bones[name]) parsed.bones[name] = { rotation: [...IDENTITY_QUAT] };
    }
    if (!parsed.proportions) parsed.proportions = defaultProportions();
    return parsed;
}
