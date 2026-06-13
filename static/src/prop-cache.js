const DB_NAME = 'mannequin-props';
const STORE = 'glb';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Store an ArrayBuffer under `key` (overwrites). */
export async function putPropBlob(key, arrayBuffer) {
    const db = await openDB();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(arrayBuffer, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

/** Retrieve the ArrayBuffer for `key`, or null if absent. */
export async function getPropBlob(key) {
    const db = await openDB();
    try {
        return await new Promise((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    } finally {
        db.close();
    }
}
