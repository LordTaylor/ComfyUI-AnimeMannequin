// tests/js/smart-random-integration.test.js
//
// Integration test: exercises the REAL smart-random pipeline (no mocks of feature modules).
// Uses Strategy 2 — direct pipeline harness — because constructing a full MannequinEditor
// headlessly requires OrbitControls / TransformControls / createIKHandles which need a real
// DOM/canvas. Instead we replicate the exact 5-step body of generateRandomPose() inline on
// a real bone hierarchy + real IKController, verifying the real helpers compose correctly.
//
// This mirrors generateRandomPose()'s body (mannequin-editor.js):
//   1) pickBasePreset → 2) presetToPose → 3) jitterPose → 4) apply to bones
//   5) for each IK chain: offset effector + ikController.solve → 6) read back full pose

import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';

// ── REAL feature modules (no mocks) ──────────────────────────────────────────
import { INTENSITY, pickBasePreset, jitterPose, randomOffsetVec } from '../../static/src/smart-pose.js';
import { presetToPose } from '../../static/src/pose-presets.js';
import { IK_CHAINS, IKController } from '../../static/src/ik-controller.js';

// ── Seeded LCG RNG — same style as smart-pose.test.js ─────────────────────
function seededRng(seed = 1) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

// ── Build a minimal real bone hierarchy ───────────────────────────────────────
//
// Bones are real THREE.Object3D instances parented to form the chains that IK_CHAINS
// needs (arm_L, arm_R, leg_L, leg_R) plus the torso bones that jitterPose perturbs.
// Positions are distinct so limbLen (root→mid + mid→end) is non-zero.
//
//   torso (root)
//     ├── spine → chest → neck → head
//     ├── pelvis
//     ├── shoulder_L → upper_arm_L → forearm_L → hand_L
//     ├── shoulder_R → upper_arm_R → forearm_R → hand_R
//     ├── thigh_L → shin_L → foot_L
//     └── thigh_R → shin_R → foot_R
//
function buildBoneHierarchy() {
    const scene = new THREE.Scene();

    function bone(x, y, z) {
        const o = new THREE.Object3D();
        o.position.set(x, y, z);
        return o;
    }

    const torso      = bone(0,   1.2, 0);
    const spine      = bone(0,   0.1, 0);
    const chest      = bone(0,   0.2, 0);
    const neck       = bone(0,   0.15, 0);
    const head       = bone(0,   0.15, 0);
    const pelvis     = bone(0,  -0.1, 0);
    const shoulder_L = bone( 0.3, 0.1, 0);
    const shoulder_R = bone(-0.3, 0.1, 0);

    // Left arm chain: shoulder → upper_arm → forearm → hand
    const upper_arm_L = bone( 0.2,  0, 0);
    const forearm_L   = bone( 0,   -0.35, 0);
    const hand_L      = bone( 0,   -0.30, 0);

    // Right arm chain
    const upper_arm_R = bone(-0.2,  0, 0);
    const forearm_R   = bone( 0,   -0.35, 0);
    const hand_R      = bone( 0,   -0.30, 0);

    // Left leg chain
    const thigh_L = bone( 0.15, -0.1, 0);
    const shin_L  = bone( 0,    -0.45, 0);
    const foot_L  = bone( 0,    -0.42, 0.05);

    // Right leg chain
    const thigh_R = bone(-0.15, -0.1, 0);
    const shin_R  = bone( 0,    -0.45, 0);
    const foot_R  = bone( 0,    -0.42, 0.05);

    // Wire up hierarchy
    torso.add(spine);
    spine.add(chest);
    chest.add(neck);
    neck.add(head);
    torso.add(pelvis);
    chest.add(shoulder_L);
    chest.add(shoulder_R);
    shoulder_L.add(upper_arm_L);
    upper_arm_L.add(forearm_L);
    forearm_L.add(hand_L);
    shoulder_R.add(upper_arm_R);
    upper_arm_R.add(forearm_R);
    forearm_R.add(hand_R);
    pelvis.add(thigh_L);
    thigh_L.add(shin_L);
    shin_L.add(foot_L);
    pelvis.add(thigh_R);
    thigh_R.add(shin_R);
    shin_R.add(foot_R);

    scene.add(torso);
    scene.updateMatrixWorld(true);

    const bones = new Map([
        ['torso',      torso],
        ['spine',      spine],
        ['chest',      chest],
        ['neck',       neck],
        ['head',       head],
        ['pelvis',     pelvis],
        ['shoulder_L', shoulder_L],
        ['shoulder_R', shoulder_R],
        ['upper_arm_L', upper_arm_L],
        ['forearm_L',   forearm_L],
        ['hand_L',      hand_L],
        ['upper_arm_R', upper_arm_R],
        ['forearm_R',   forearm_R],
        ['hand_R',      hand_R],
        ['thigh_L',  thigh_L],
        ['shin_L',   shin_L],
        ['foot_L',   foot_L],
        ['thigh_R',  thigh_R],
        ['shin_R',   shin_R],
        ['foot_R',   foot_R],
    ]);

    return { scene, bones };
}

// ── Run the real generateRandomPose pipeline ──────────────────────────────────
//
// Mirrors the body of MannequinEditor.generateRandomPose (mannequin-editor.js):
//   step 1: pickBasePreset
//   step 2: presetToPose
//   step 3: jitterPose
//   step 4: apply jittered pose to bones
//   step 5: for each IK chain → randomOffsetVec + solve
//   step 6: read back full pose
//
function runPipeline(bones, scene, rng, mode = 'safe') {
    const intensity = INTENSITY[mode] ?? INTENSITY.safe;

    // Step 1+2: pick a base preset and convert to a full pose map
    const preset = pickBasePreset(rng);
    const base   = presetToPose(preset);

    // Step 3: jitter torso bones
    const jittered = jitterPose(base, rng, intensity.jitterDeg);

    // Step 4: apply jittered pose to renderer bones
    for (const [name, q] of Object.entries(jittered)) {
        const b = bones.get(name);
        if (b) b.quaternion.set(q.x, q.y, q.z, q.w);
    }
    scene.updateMatrixWorld(true);

    // Step 5: IK-settle each limb
    const ik = new IKController({ bones });
    for (const chain of IK_CHAINS) {
        const rootB = bones.get(chain.root);
        const midB  = bones.get(chain.mid);
        const endB  = bones.get(chain.end);
        if (!rootB || !midB || !endB) continue;
        const rootW = rootB.getWorldPosition(new THREE.Vector3());
        const midW  = midB.getWorldPosition(new THREE.Vector3());
        const endW  = endB.getWorldPosition(new THREE.Vector3());
        const limbLen = rootW.distanceTo(midW) + midW.distanceTo(endW);
        const target  = randomOffsetVec(rng, intensity.reachFrac * limbLen).add(endW);
        ik.solve(chain.id, target);
    }
    scene.updateMatrixWorld(true);

    // Step 6: read back full pose from bones
    const pose = {};
    for (const [name, b] of bones) {
        const q = b.quaternion;
        pose[name] = { x: q.x, y: q.y, z: q.z, w: q.w };
    }
    return pose;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('smart-random integration — real modules, real THREE bones', () => {

    it('assertion 1: every quaternion component is finite (no NaN/Infinity)', () => {
        const { scene, bones } = buildBoneHierarchy();
        const pose = runPipeline(bones, scene, seededRng(42));

        for (const [name, q] of Object.entries(pose)) {
            expect(Number.isFinite(q.x), `${name}.x is not finite`).toBe(true);
            expect(Number.isFinite(q.y), `${name}.y is not finite`).toBe(true);
            expect(Number.isFinite(q.z), `${name}.z is not finite`).toBe(true);
            expect(Number.isFinite(q.w), `${name}.w is not finite`).toBe(true);
        }
    });

    it('assertion 2: at least one torso bone quaternion differs from identity (jitter happened)', () => {
        const { scene, bones } = buildBoneHierarchy();
        const pose = runPipeline(bones, scene, seededRng(7));

        const torsoBones = ['spine', 'chest', 'neck', 'head', 'pelvis', 'shoulder_L', 'shoulder_R'];
        const identity = { x: 0, y: 0, z: 0, w: 1 };
        const anyJittered = torsoBones.some(name => {
            const q = pose[name];
            if (!q) return false;
            return q.x !== identity.x || q.y !== identity.y ||
                   q.z !== identity.z || q.w !== identity.w;
        });

        expect(anyJittered).toBe(true);
    });

    it('assertion 3: IK offset target is bounded by reachFrac * limbLen from the effector', () => {
        // Strategy: instrument randomOffsetVec to capture the offset vector, then verify
        // its magnitude ≤ reachFrac * limbLen.  We test this directly because the effector's
        // final world position after IK can differ from the original by more than the offset
        // (jitter already rotated the arm before IK runs, moving the end bone).
        //
        // What the test actually verifies: the real randomOffsetVec (from smart-pose.js)
        // always produces a vector whose length ≤ radius, and the radius fed into it is
        // reachFrac * limbLen.  This is the meaningful bound the spec guarantees.
        const mode = 'safe';
        const intensity = INTENSITY[mode];

        const { scene, bones } = buildBoneHierarchy();

        // Compute limbLen for arm_L from the initial (pre-pipeline) bone positions
        const chain = IK_CHAINS.find(c => c.id === 'arm_L');
        const rootW = bones.get(chain.root).getWorldPosition(new THREE.Vector3());
        const midW  = bones.get(chain.mid).getWorldPosition(new THREE.Vector3());
        const endW  = bones.get(chain.end).getWorldPosition(new THREE.Vector3());
        const limbLen = rootW.distanceTo(midW) + midW.distanceTo(endW);

        expect(limbLen).toBeGreaterThan(0.1);  // hierarchy is non-degenerate

        const maxOffset = intensity.reachFrac * limbLen;

        // Verify randomOffsetVec respects the radius bound for many samples
        // (this is the real module — same assertion the unit test makes, but in integration context)
        const rng = seededRng(99);
        for (let i = 0; i < 30; i++) {
            const v = randomOffsetVec(rng, maxOffset);
            expect(v.length()).toBeLessThanOrEqual(maxOffset + 1e-9);
        }
    });

    it('assertion 4: determinism — same seed produces identical poses', () => {
        const { scene: scene1, bones: bones1 } = buildBoneHierarchy();
        const { scene: scene2, bones: bones2 } = buildBoneHierarchy();

        const pose1 = runPipeline(bones1, scene1, seededRng(123));
        const pose2 = runPipeline(bones2, scene2, seededRng(123));

        // Every bone quaternion must match exactly (same RNG seed → identical path)
        for (const name of bones1.keys()) {
            const q1 = pose1[name];
            const q2 = pose2[name];
            expect(q1, `${name} missing from run 1`).toBeDefined();
            expect(q2, `${name} missing from run 2`).toBeDefined();
            expect(q1.x).toBe(q2.x);
            expect(q1.y).toBe(q2.y);
            expect(q1.z).toBe(q2.z);
            expect(q1.w).toBe(q2.w);
        }
    });

    it('would fail if jitter were a no-op (sanity: torso bones are non-identity after jitter)', () => {
        // Directly verify jitterPose mutates torso bones — if jitter is broken this fails
        const { scene, bones } = buildBoneHierarchy();

        const preset = pickBasePreset(seededRng(1));
        const base   = presetToPose(preset);

        // Set all bones to identity first
        for (const [name, q] of Object.entries(base)) {
            base[name] = { x: 0, y: 0, z: 0, w: 1 };
        }

        const jittered = jitterPose(base, seededRng(1), INTENSITY.safe.jitterDeg);

        const torsoBones = ['spine', 'chest', 'neck', 'head', 'pelvis', 'shoulder_L', 'shoulder_R'];
        const changed = torsoBones.filter(n => {
            const q = jittered[n];
            return q && (q.x !== 0 || q.y !== 0 || q.z !== 0 || q.w !== 1);
        });
        expect(changed.length).toBeGreaterThan(0);
    });

    it('would fail if IK solve were broken (effector reaches a reachable target)', () => {
        // Directly verify IKController.solve works on the real bone hierarchy —
        // if solve is broken (e.g. no-op) the effector won't move to the target
        const { scene, bones } = buildBoneHierarchy();
        const ik = new IKController({ bones });

        const endB = bones.get('hand_L');
        const rootB = bones.get('upper_arm_L');
        const rootW = rootB.getWorldPosition(new THREE.Vector3());

        // Target: near root, definitely reachable
        const target = rootW.clone().add(new THREE.Vector3(0.1, -0.2, 0));
        ik.solve('arm_L', target);
        scene.updateMatrixWorld(true);

        const endW = endB.getWorldPosition(new THREE.Vector3());
        // Effector should be within 5cm of the target (IK converges for reachable targets)
        expect(endW.distanceTo(target)).toBeLessThan(0.05);
    });
});
