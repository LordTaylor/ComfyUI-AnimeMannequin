// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PropsController } from '../../static/src/props-controller.js';

function fakeRenderer() {
    const attached = new Map();
    return {
        attachProp: vi.fn((p, o) => attached.set(p.id, o)),
        removeProp: vi.fn(id => attached.delete(id)),
        updatePropTransform: vi.fn(),
        _attached: attached,
    };
}
const fakeObj = () => ({ isObject3D: true });
const prop = (over = {}) => ({ id:'p1', source:'lib', ref:'hat_01', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1, ...over });

describe('PropsController', () => {
    it('realize: attaches a library prop via loadLibraryProp', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(async()=>fakeObj()), parsePropGLB: vi.fn(), getPropBlob: vi.fn(), putPropBlob: vi.fn() };
        const c = new PropsController(r, deps);
        await c.realize(prop());
        expect(deps.loadLibraryProp).toHaveBeenCalledWith('hat_01');
        expect(r.attachProp).toHaveBeenCalledTimes(1);
        expect(c.missingProps()).toHaveLength(0);
    });
    it('realize: upload with no cached blob → tracked as missing, not attached', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(), parsePropGLB: vi.fn(), getPropBlob: vi.fn(async()=>null), putPropBlob: vi.fn() };
        const c = new PropsController(r, deps);
        await c.realize(prop({ id:'p2', source:'upload', ref:'sword.glb', bone:'hand_R' }));
        expect(r.attachProp).not.toHaveBeenCalled();
        expect(c.missingProps().map(p=>p.ref)).toEqual(['sword.glb']);
    });
    it('realize: upload WITH cached blob → parsed + attached', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(), parsePropGLB: vi.fn(async()=>fakeObj()), getPropBlob: vi.fn(async()=>new ArrayBuffer(4)), putPropBlob: vi.fn() };
        const c = new PropsController(r, deps);
        await c.realize(prop({ id:'p3', source:'upload', ref:'sword.glb', bone:'hand_R' }));
        expect(deps.parsePropGLB).toHaveBeenCalled();
        expect(r.attachProp).toHaveBeenCalledTimes(1);
        expect(c.missingProps()).toHaveLength(0);
    });
    it('addUpload: caches the blob then realizes (attached, not missing)', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(), parsePropGLB: vi.fn(async()=>fakeObj()), getPropBlob: vi.fn(async()=>new ArrayBuffer(4)), putPropBlob: vi.fn(async()=>{}) };
        const c = new PropsController(r, deps);
        await c.addUpload(prop({ id:'p4', source:'upload', ref:'gun.glb', bone:'hand_R' }), new ArrayBuffer(8));
        expect(deps.putPropBlob).toHaveBeenCalledWith('gun.glb', expect.anything());
        expect(r.attachProp).toHaveBeenCalledTimes(1);
        expect(c.missingProps()).toHaveLength(0);
    });
    it('remove: clears from renderer and from missing set', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(), parsePropGLB: vi.fn(), getPropBlob: vi.fn(async()=>null), putPropBlob: vi.fn() };
        const c = new PropsController(r, deps);
        await c.realize(prop({ id:'p5', source:'upload', ref:'x.glb' }));
        expect(c.missingProps()).toHaveLength(1);
        c.remove('p5');
        expect(r.removeProp).toHaveBeenCalledWith('p5');
        expect(c.missingProps()).toHaveLength(0);
    });
    it('realize: loader throwing → tracked as missing (no crash)', async () => {
        const r = fakeRenderer();
        const deps = { loadLibraryProp: vi.fn(async()=>{ throw new Error('boom'); }), parsePropGLB: vi.fn(), getPropBlob: vi.fn(), putPropBlob: vi.fn() };
        const c = new PropsController(r, deps);
        await c.realize(prop({ id:'p6' }));
        expect(c.missingProps().map(p=>p.id)).toEqual(['p6']);
    });
});
