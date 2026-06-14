import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { IKController, IK_CHAINS } from '../../static/src/ik-controller.js';

function makeArmChain() {
    const scene = new THREE.Scene();
    const upper = new THREE.Object3D(); upper.position.set(0, 2, 0);
    const fore  = new THREE.Object3D(); fore.position.set(0, -1, 0);
    const hand  = new THREE.Object3D(); hand.position.set(0.0, -1, 0.0);
    upper.add(fore); fore.add(hand); scene.add(upper);
    fore.rotation.set(0.3, 0, 0);
    scene.updateMatrixWorld(true);
    const bones = new Map([['upper_arm_L', upper], ['forearm_L', fore], ['hand_L', hand]]);
    return { scene, bones, upper, fore, hand };
}

describe('IK_CHAINS', () => {
    it('defines four chains: arms and legs', () => {
        const ids = IK_CHAINS.map(c => c.id).sort();
        expect(ids).toEqual(['arm_L', 'arm_R', 'leg_L', 'leg_R']);
    });
    it('arm_L chain bones are upper_arm/forearm/hand', () => {
        const arm = IK_CHAINS.find(c => c.id === 'arm_L');
        expect(arm.root).toBe('upper_arm_L');
        expect(arm.mid).toBe('forearm_L');
        expect(arm.end).toBe('hand_L');
    });
});

describe('IKController.solve', () => {
    it('moves the effector to a reachable target', () => {
        const { scene, bones, hand } = makeArmChain();
        const ctrl = new IKController({ bones });
        const target = new THREE.Vector3(0.4, 0.4, 0.3);
        ctrl.solve('arm_L', target);
        scene.updateMatrixWorld(true);
        const got = hand.getWorldPosition(new THREE.Vector3());
        expect(got.distanceTo(target)).toBeLessThan(1e-2);
    });

    it('leaves the end bone local rotation untouched', () => {
        const { bones, hand } = makeArmChain();
        hand.quaternion.set(0.1, 0.2, 0.0, 0.974);
        const before = hand.quaternion.clone();
        const ctrl = new IKController({ bones });
        ctrl.solve('arm_L', new THREE.Vector3(0.5, 0.5, 0.2));
        expect(hand.quaternion.x).toBeCloseTo(before.x, 6);
        expect(hand.quaternion.y).toBeCloseTo(before.y, 6);
        expect(hand.quaternion.z).toBeCloseTo(before.z, 6);
        expect(hand.quaternion.w).toBeCloseTo(before.w, 6);
    });

    it('out-of-reach target straightens the limb toward the target', () => {
        const { scene, bones, upper, hand } = makeArmChain();
        const ctrl = new IKController({ bones });
        const far = new THREE.Vector3(0, -10, 0);
        ctrl.solve('arm_L', far);
        scene.updateMatrixWorld(true);
        const shoulder = upper.getWorldPosition(new THREE.Vector3());
        const wrist    = hand.getWorldPosition(new THREE.Vector3());
        expect(wrist.distanceTo(shoulder)).toBeCloseTo(2, 1);
        expect(wrist.x).toBeCloseTo(0, 1);
        expect(wrist.z).toBeCloseTo(0, 1);
    });
});

describe('IKController.effectorWorld / chain', () => {
    it('chain() returns the chain def or null', () => {
        const ctrl = new IKController({ bones: new Map() });
        expect(ctrl.chain('arm_L').end).toBe('hand_L');
        expect(ctrl.chain('nope')).toBeNull();
    });

    it('effectorWorld returns the effector bone world position', () => {
        const { bones } = makeArmChain();
        const ctrl = new IKController({ bones });
        const out = ctrl.effectorWorld('arm_L');
        // wrist = shoulder(0,2,0) + elbow(0,-1,0) + hand(0,-1,0), with the 0.3 x-bend applied
        expect(out.y).toBeLessThan(2);   // below the shoulder
        expect(Number.isFinite(out.x)).toBe(true);
    });

    it('effectorWorld returns origin for unknown chain', () => {
        const ctrl = new IKController({ bones: new Map() });
        const out = ctrl.effectorWorld('nope');
        expect([out.x, out.y, out.z]).toEqual([0, 0, 0]);
    });
});
