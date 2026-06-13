// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from '../../static/lib/three.module.js';
import { MannequinRenderer } from '../../static/src/mannequin-renderer.js';

function rendererWithBones() {
    const r = Object.create(MannequinRenderer.prototype);
    r._bones = new Map();
    r._props = new Map();
    r.markDirty = () => {};
    r._bones.set('head', new THREE.Object3D());
    r._bones.set('hand_R', new THREE.Object3D());
    return r;
}

describe('renderer props', () => {
    it('attachProp adds the object under the target bone with isProp + transform', () => {
        const r = rendererWithBones();
        const obj = new THREE.Object3D();
        r.attachProp({ id:'p1', bone:'head', position:[0,0.1,0], rotation:[0,0,0,1], scale:2 }, obj);
        expect(r._bones.get('head').children).toContain(obj);
        expect(obj.userData.isProp).toBe(true);
        expect(obj.userData.propId).toBe('p1');
        expect(obj.position.y).toBeCloseTo(0.1, 6);
        expect(obj.scale.x).toBeCloseTo(2, 6);
        expect(r._props.get('p1')).toBe(obj);
    });
    it('attachProp on unknown bone does nothing', () => {
        const r = rendererWithBones();
        const obj = new THREE.Object3D();
        r.attachProp({ id:'p1', bone:'no_such_bone', position:[0,0,0], rotation:[0,0,0,1], scale:1 }, obj);
        expect(r._props.has('p1')).toBe(false);
    });
    it('updatePropTransform re-parents on bone change and updates transform', () => {
        const r = rendererWithBones();
        const obj = new THREE.Object3D();
        r.attachProp({ id:'p1', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 }, obj);
        r.updatePropTransform({ id:'p1', bone:'hand_R', position:[0.2,0,0], rotation:[0,0,0,1], scale:3 });
        expect(r._bones.get('hand_R').children).toContain(obj);
        expect(r._bones.get('head').children).not.toContain(obj);
        expect(obj.position.x).toBeCloseTo(0.2, 6);
        expect(obj.scale.x).toBeCloseTo(3, 6);
    });
    it('removeProp detaches and forgets it', () => {
        const r = rendererWithBones();
        const obj = new THREE.Object3D();
        r.attachProp({ id:'p1', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 }, obj);
        r.removeProp('p1');
        expect(r._props.has('p1')).toBe(false);
        expect(r._bones.get('head').children).not.toContain(obj);
    });
});
