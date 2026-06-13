import { GLTFLoader } from '../lib/GLTFLoader.js';

// Library manifest. Add a prop by dropping its GLB into static/assets/props/
// and appending an entry here. Empty-friendly: upload works without any entries.
export const PROP_LIBRARY = [
    // { id: 'hat_01', name: 'Cap', file: 'hat_01.glb', defaultBone: 'head', category: 'head' },
];

/** Find a library manifest entry by id (undefined if absent). */
export function libraryEntry(id) {
    return PROP_LIBRARY.find(e => e.id === id);
}

const _libCache = new Map(); // id → THREE.Object3D template

/** Load a built-in library prop by id → a fresh clone ready to attach. */
export async function loadLibraryProp(id) {
    const entry = libraryEntry(id);
    if (!entry) throw new Error(`Unknown library prop: ${id}`);
    if (!_libCache.has(id)) {
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(`./assets/props/${entry.file}`);
        gltf.scene.updateMatrixWorld(true);
        _libCache.set(id, gltf.scene);
    }
    return _libCache.get(id).clone(true);
}

/** Parse an uploaded GLB (ArrayBuffer) → THREE.Object3D scene. */
export async function parsePropGLB(arrayBuffer) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((res, rej) => loader.parse(arrayBuffer, '', res, rej));
    gltf.scene.updateMatrixWorld(true);
    return gltf.scene;
}
