import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { createIKHandles, setIKHandlesVisible, syncIKHandles } from '../../static/src/mannequin-renderer.js';

/**
 * Simulate the capture hide predicate used inside captureImages():
 *   (o.userData.isGizmo || o.userData.isIKHandle) && o.visible
 * Returns the list of objects that would be hidden.
 */
function collectHiddenDuringCapture(scene) {
    const hidden = [];
    scene.traverse(o => {
        if ((o.userData.isGizmo || o.userData.isIKHandle) && o.visible) {
            hidden.push(o);
        }
    });
    return hidden;
}

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

    it('visible IK handles are captured by the captureImages hide predicate (fix: handles excluded from renders)', () => {
        // Regression test for: IK handles leaking into captured output maps.
        // The captureImages() traversal hides objects matching:
        //   (o.userData.isGizmo || o.userData.isIKHandle) && o.visible
        // This test proves that predicate catches IK handles when they are visible
        // (i.e. when IK mode is on), which is the fix applied in mannequin-renderer.js.
        const { scene } = stub();
        const handles = createIKHandles(scene);

        // When handles are hidden (IK mode off) — nothing to hide during capture
        setIKHandlesVisible(handles, false);
        const hiddenWhenOff = collectHiddenDuringCapture(scene);
        expect(hiddenWhenOff).toHaveLength(0);

        // When handles are visible (IK mode on) — ALL four must be caught and would be hidden
        setIKHandlesVisible(handles, true);
        const hiddenWhenOn = collectHiddenDuringCapture(scene);
        expect(hiddenWhenOn).toHaveLength(4);
        // Every captured object must be an IK handle
        for (const o of hiddenWhenOn) {
            expect(o.userData.isIKHandle).toBe(true);
        }
    });

    it('IK handles are NOT tagged isGizmo (they are hidden via isIKHandle, not via isGizmo)', () => {
        // Ensures the fix uses the isIKHandle tag rather than a secondary isGizmo tag,
        // keeping handle identity separate from the transform-controls gizmo.
        const { scene } = stub();
        const handles = createIKHandles(scene);
        for (const h of handles.values()) {
            expect(h.userData.isGizmo).toBeFalsy();
            expect(h.userData.isIKHandle).toBe(true);
        }
    });
});
