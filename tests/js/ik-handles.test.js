import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { createIKHandles, setIKHandlesVisible, syncIKHandles } from '../../static/src/mannequin-renderer.js';

function stub() {
    const scene = new THREE.Scene();
    const bones = new Map();
    for (const [name, pos] of [
        ['hand_L', [0.5, 1.2, 0]], ['hand_R', [-0.5, 1.2, 0]],
        ['foot_L', [0.2, 0.0, 0]], ['foot_R', [-0.2, 0.0, 0]],
    ]) {
        const b = new THREE.Object3D(); b.position.set(...pos); scene.add(b);
        bones.set(name, b);
    }
    scene.updateMatrixWorld(true);
    return { scene, bones };
}

describe('IK handles', () => {
    it('creates four hidden handles tagged with chainId', () => {
        const { scene } = stub();
        const handles = createIKHandles(scene);
        expect(handles.size).toBe(4);
        for (const h of handles.values()) {
            expect(h.userData.isIKHandle).toBe(true);
            expect(h.visible).toBe(false);
        }
        expect([...handles.keys()].sort()).toEqual(['arm_L', 'arm_R', 'leg_L', 'leg_R']);
    });

    it('syncIKHandles positions handles at effector world positions', () => {
        const { scene, bones } = stub();
        const handles = createIKHandles(scene);
        syncIKHandles(handles, bones);
        const armL = handles.get('arm_L');
        expect(armL.position.x).toBeCloseTo(0.5, 5);
        expect(armL.position.y).toBeCloseTo(1.2, 5);
    });

    it('setIKHandlesVisible toggles visibility', () => {
        const { scene } = stub();
        const handles = createIKHandles(scene);
        setIKHandlesVisible(handles, true);
        expect(handles.get('leg_R').visible).toBe(true);
        setIKHandlesVisible(handles, false);
        expect(handles.get('leg_R').visible).toBe(false);
    });
});
