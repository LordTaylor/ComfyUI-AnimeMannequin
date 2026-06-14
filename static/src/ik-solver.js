// Pure two-bone analytic IK. Vectors are plain [x, y, z] arrays. No Three.js, no DOM.

const EPS = 1e-6;

export const sub   = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add   = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot   = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len   = (a)    => Math.sqrt(dot(a, a));
export function normalize(a) {
    const l = len(a);
    return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}
export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Any unit vector perpendicular to n. */
function anyPerp(n) {
    const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return normalize(cross(n, ref));
}

/**
 * Solve a two-bone chain.
 * @param {{root:number[], target:number[], lenA:number, lenB:number, pole:number[]}} p
 * @returns {{mid:number[], endClamped:number[], reachable:boolean}}
 */
export function solveTwoBone({ root, target, lenA, lenB, pole }) {
    const axis = sub(target, root);
    const d0   = len(axis);
    const n    = d0 < EPS ? [0, -1, 0] : scale(axis, 1 / d0);

    const dMin = Math.abs(lenA - lenB) + EPS;
    const dMax = lenA + lenB - EPS;
    const d    = clamp(d0, dMin, dMax);
    const reachable = d0 <= lenA + lenB && d0 >= Math.abs(lenA - lenB);

    const endClamped = add(root, scale(n, d));

    const cosA  = clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1);
    const angle = Math.acos(cosA);

    let p = sub(pole, scale(n, dot(pole, n)));
    p = len(p) < EPS ? anyPerp(n) : normalize(p);

    const mid = add(root, add(scale(n, lenA * Math.cos(angle)), scale(p, lenA * Math.sin(angle))));
    return { mid, endClamped, reachable };
}
