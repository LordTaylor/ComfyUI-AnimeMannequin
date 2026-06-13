import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { putPropBlob, getPropBlob } from '../../static/src/prop-cache.js';

describe('prop-cache (IndexedDB)', () => {
    it('stores and retrieves an ArrayBuffer by key', async () => {
        const data = new Uint8Array([1,2,3,4]).buffer;
        await putPropBlob('mysword.glb', data);
        const got = await getPropBlob('mysword.glb');
        expect(got).toBeTruthy();
        expect(Array.from(new Uint8Array(got))).toEqual([1,2,3,4]);
    });
    it('returns null for a missing key', async () => {
        expect(await getPropBlob('absent-xyz')).toBeNull();
    });
    it('overwrites an existing key', async () => {
        await putPropBlob('k', new Uint8Array([1]).buffer);
        await putPropBlob('k', new Uint8Array([9,9]).buffer);
        expect(Array.from(new Uint8Array(await getPropBlob('k')))).toEqual([9,9]);
    });
});
