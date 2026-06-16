import * as THREE from '../lib/three.module.js';
import { solveTwoBone } from './ik-solver.js';

export const IK_CHAINS = [
    { id: 'arm_L', root: 'upper_arm_L', mid: 'forearm_L', end: 'hand_L', defaultPole: [0, 0, -1] },
    { id: 'arm_R', root: 'upper_arm_R', mid: 'forearm_R', end: 'hand_R', defaultPole: [0, 0, -1] },
    { id: 'leg_L', root: 'thigh_L',     mid: 'shin_L',    end: 'foot_L', defaultPole: [0, 0,  1] },
    { id: 'leg_R', root: 'thigh_R',     mid: 'shin_R',    end: 'foot_R', defaultPole: [0, 0,  1] },
];

const v2a = (v) => [v.x, v.y, v.z];

export class IKController {
    /** @param {{ bones: Map<string, THREE.Object3D> }} deps */
    constructor({ bones }) {
        this._bones = bones;
        this._chainById = new Map(IK_CHAINS.map(c => [c.id, c]));
    }

    chain(id) { return this._chainById.get(id) ?? null; }

    /**
     * Solve a chain so its effector reaches targetWorld (THREE.Vector3),
     * mutating the root and mid bone quaternions. End bone untouched.
     */
    solve(chainId, targetWorld, poleOverride = null) {
        const chain = this._chainById.get(chainId);
        if (!chain) return;
        const rootB = this._bones.get(chain.root);
        const midB  = this._bones.get(chain.mid);
        const endB  = this._bones.get(chain.end);
        if (!rootB || !midB || !endB) return;

        const rootW = rootB.getWorldPosition(new THREE.Vector3());
        const midW0 = midB.getWorldPosition(new THREE.Vector3());
        const endW0 = endB.getWorldPosition(new THREE.Vector3());

        const lenA = midW0.distanceTo(rootW);
        const lenB = endW0.distanceTo(midW0);

        // Bend side. A locked pole (joint blockade, captured at drag start) keeps the
        // elbow/knee from flipping to the wrong side; without it, derive from the current bend.
        const pole = poleOverride ?? this._poleFromCurrent(rootW, midW0, endW0, chain);

        const res = solveTwoBone({
            root: v2a(rootW), target: v2a(targetWorld), lenA, lenB, pole,
        });
        const midTarget = new THREE.Vector3(res.mid[0], res.mid[1], res.mid[2]);
        const endTarget = new THREE.Vector3(res.endClamped[0], res.endClamped[1], res.endClamped[2]);

        const midW1 = new THREE.Vector3();
        for (let i = 0; i < 2; i++) {
            // 1) Rotate root bone so its child (mid) moves toward midTarget.
            this._aimBoneChildTo(rootB, midB, rootW, midTarget);

            rootB.updateWorldMatrix(true, true);
            midB.getWorldPosition(midW1);

            // 2) Rotate mid bone so its child (end) moves toward endTarget.
            this._aimBoneChildTo(midB, endB, midW1, endTarget);
            midB.updateWorldMatrix(true, true);
        }
    }

    /**
     * World bend-pole from the chain's CURRENT configuration — the side the elbow/knee
     * currently bends toward (perpendicular component of mid-root vs the root→end axis), or
     * the chain's anatomical default when the limb is straight. Plain [x,y,z]. null if no chain.
     * Capture this at drag start and pass it back to solve() as poleOverride to lock the bend
     * side (joint blockade), so dragging through the straight pose can't flip the joint.
     */
    currentPole(chainId) {
        const chain = this._chainById.get(chainId);
        if (!chain) return null;
        const rootB = this._bones.get(chain.root);
        const midB  = this._bones.get(chain.mid);
        const endB  = this._bones.get(chain.end);
        if (!rootB || !midB || !endB) return null;
        return this._poleFromCurrent(
            rootB.getWorldPosition(new THREE.Vector3()),
            midB.getWorldPosition(new THREE.Vector3()),
            endB.getWorldPosition(new THREE.Vector3()), chain);
    }

    _poleFromCurrent(rootW, midW0, endW0, chain) {
        const axis = endW0.clone().sub(rootW);
        if (axis.lengthSq() > 1e-10) {
            const n = axis.clone().normalize();
            const rm = midW0.clone().sub(rootW);
            const perp = rm.sub(n.clone().multiplyScalar(rm.dot(n)));
            if (perp.lengthSq() > 1e-8) return v2a(perp);
        }
        return chain.defaultPole;
    }

    /**
     * Rotate `bone` (whose origin world position is boneW) so that its descendant
     * joint `childB` aims from its current world direction toward childTargetW.
     * Axis-agnostic: uses the minimal rotation between the two world directions.
     */
    _aimBoneChildTo(bone, childB, boneW, childTargetW) {
        const childW = childB.getWorldPosition(new THREE.Vector3());
        const cur = childW.clone().sub(boneW);
        const des = childTargetW.clone().sub(boneW);
        if (cur.lengthSq() < 1e-12 || des.lengthSq() < 1e-12) return;
        cur.normalize(); des.normalize();

        const qWorldDelta = new THREE.Quaternion().setFromUnitVectors(cur, des);

        const curWorldQ = bone.getWorldQuaternion(new THREE.Quaternion());
        const newWorldQ = qWorldDelta.clone().multiply(curWorldQ);

        const parentWorldQ = bone.parent
            ? bone.parent.getWorldQuaternion(new THREE.Quaternion())
            : new THREE.Quaternion();
        const localQ = parentWorldQ.invert().multiply(newWorldQ);
        bone.quaternion.copy(localQ);
        bone.updateMatrix();
    }

    /** Effector world position for a chain (for placing/reading handles). */
    effectorWorld(chainId, out = new THREE.Vector3()) {
        const chain = this._chainById.get(chainId);
        const endB = chain && this._bones.get(chain.end);
        if (!endB) return out.set(0, 0, 0);
        return endB.getWorldPosition(out);
    }
}
