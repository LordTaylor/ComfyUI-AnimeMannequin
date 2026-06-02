// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// jsdom in this setup ships no localStorage — provide a minimal in-memory stub.
const _ls = (() => {
    let m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
        clear: () => { m = new Map(); },
    };
})();
globalThis.localStorage = _ls;

const { PoseLibrary } = await import('../../static/src/panels/pose-library.js');

// PoseLibrary needs an editor (getSceneData/applySceneWithUndo) and renderer (canvas).
// For import/export logic we only exercise localStorage + the data shaping, so stubs suffice.
function mkLib() {
    const editor   = { getSceneData: () => ({ bones: {} }), applySceneWithUndo: vi.fn() };
    const renderer = { _renderer: { domElement: { toDataURL: () => 'data:image/jpeg;base64,AAAA' } } };
    const lib = new PoseLibrary(editor, renderer);
    // Avoid DOM work — importData calls _renderList()
    lib._renderList = () => {};
    return lib;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe('PoseLibrary import/export', () => {
    it('imports a collection { poses: [...] } and merges into the library', () => {
        const lib = mkLib();
        lib.saveCurrent('Existing');
        lib.importData({
            type: 'mannequin-pose-collection', version: 1,
            poses: [
                { id: 'x', name: 'A', scene: { bones: { neck: { rotation: [0,0,0,1] } } } },
                { id: 'y', name: 'B', scene: { bones: {} } },
            ],
        });
        const stored = JSON.parse(localStorage.getItem('mannequin_poses'));
        expect(stored).toHaveLength(3);                 // 2 imported + 1 existing
        expect(stored.map(p => p.name)).toContain('A');
        expect(stored.map(p => p.name)).toContain('Existing');
    });

    it('imports a single { pose: {...} }', () => {
        const lib = mkLib();
        lib.importData({ type: 'mannequin-pose', version: 1,
            pose: { name: 'Solo', scene: { bones: {} } } });
        const stored = JSON.parse(localStorage.getItem('mannequin_poses'));
        expect(stored).toHaveLength(1);
        expect(stored[0].name).toBe('Solo');
    });

    it('imports a raw array of poses', () => {
        const lib = mkLib();
        lib.importData([
            { name: 'R1', scene: { bones: {} } },
            { name: 'R2', scene: { bones: {} } },
        ]);
        const stored = JSON.parse(localStorage.getItem('mannequin_poses'));
        expect(stored).toHaveLength(2);
    });

    it('assigns fresh unique ids so imports never collide with existing', () => {
        const lib = mkLib();
        lib.importData([
            { id: 'dup', name: 'A', scene: { bones: {} } },
            { id: 'dup', name: 'B', scene: { bones: {} } },
        ]);
        const stored = JSON.parse(localStorage.getItem('mannequin_poses'));
        const ids = stored.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);     // all ids unique
        expect(ids).not.toContain('dup');
    });

    it('rejects entries without a scene', () => {
        const lib = mkLib();
        const spy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        lib.importData({ poses: [{ name: 'NoScene' }] });
        expect(JSON.parse(localStorage.getItem('mannequin_poses') ?? '[]')).toHaveLength(0);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('caps the library at 50 poses after import', () => {
        const lib = mkLib();
        const many = Array.from({ length: 60 }, (_, i) => ({ name: `P${i}`, scene: { bones: {} } }));
        lib.importData(many);
        expect(JSON.parse(localStorage.getItem('mannequin_poses'))).toHaveLength(50);
    });

    it('exportAll wraps poses in a typed collection envelope', () => {
        const lib = mkLib();
        lib.saveCurrent('One');
        let captured = null;
        lib._download = (name, obj) => { captured = { name, obj }; };
        lib.exportAll();
        expect(captured.name).toBe('mannequin-poses.json');
        expect(captured.obj.type).toBe('mannequin-pose-collection');
        expect(captured.obj.poses).toHaveLength(1);
    });

    it('exportOne writes a single-pose envelope with a safe filename', () => {
        const lib = mkLib();
        lib.saveCurrent('My Pose!');
        const id = JSON.parse(localStorage.getItem('mannequin_poses'))[0].id;
        let captured = null;
        lib._download = (name, obj) => { captured = { name, obj }; };
        lib.exportOne(id);
        expect(captured.obj.type).toBe('mannequin-pose');
        expect(captured.name).toMatch(/^pose-My_Pose_\.json$/);
    });
});
