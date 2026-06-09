# Finger Phalanges — Iteration 2 Plan (3-bone fingers from hand.glb)

> Executes via subagent-driven TDD. Steps use checkbox syntax.

**Goal:** Replace the 10 single-bone fingers with a real 3-phalange rig sourced from `hand.glb` (a segmented left hand whose origins sit at the proximal joints). Right hand mirrored, male reuses the (scaled) female hand. Fingers become individually curl-able across MCP/PIP/DIP joints; OpenPose hand output derives from real joints.

**Source model facts (`~/Downloads/hand.glb`, verified):**
- 15 nodes: `GEO-hand_female_primitive_stylized.L` (node 14, parent) + 14 finger-segment meshes (children).
- Per finger segments: index/middle/ring/pinky = 3; thumb = 2.
- Segment naming: base = `…stylized.L`, then `.L.001`, `.L.002`. **Anatomical order by distance from hand = base → .002 → .001** (.001 is the TIP, .002 the middle). Order by X-distance, NOT by name suffix.
- **Origins are at the proximal joint** of each segment (centerOffset.x ≈ size.x/2), so a bone placed at the node origin pivots at the correct joint — geometry attaches at offset 0 like body segments.
- hand.glb node coordinates are in the SAME space as `female.glb`'s hand region (hand node translation matches the full-body hand position).

**Bone scheme (replaces 1a's single finger bones):**
```
index_L_1,index_L_2,index_L_3  middle_L_1..3  ring_L_1..3  pinky_L_1..3  thumb_L_1,thumb_L_2
(+ _R)  → 14 per hand × 2 = 28 finger bones; total skeleton 20 body + 28 = 48
```
Chain: `hand_L → {index_L_1,middle_L_1,ring_L_1,pinky_L_1,thumb_L_1}`; each `_1→_2→_3` (thumb `_1→_2`).

**GLB node map (left; right mirrored):**
| bone | hand.glb node |
|---|---|
| index_L_1 | GEO-finger_index_female_primitive_stylized.L |
| index_L_2 | GEO-finger_index_female_primitive_stylized.L.002 |
| index_L_3 | GEO-finger_index_female_primitive_stylized.L.001 |
| middle_L_1/2/3 | …middle….L / .L.002 / .L.001 |
| ring_L_1/2/3 | …ring….L / .L.002 / .L.001 |
| pinky_L_1/2/3 | …pinky….L / .L.002 / .L.001 |
| thumb_L_1/2 | …thumb….L / .L.001 |
| hand_L | GEO-hand_female_primitive_stylized.L |

**Out of scope here:** Python `glb_renderer.py` (Plan 1b), final visual placement tuning (needs browser — Jarek verifies).

**Worktree:** `.claude/worktrees/finger-control-1a`. Tests: `npm test`.

---

### Task P1: bone structure (data only)
`mannequin-model.js`: replace the 10 single finger bones in `BONE_NAMES` with the 28 phalange bones; `BONE_CHILDREN` chains; `PROPORTIONS` radius per phalange (taper distal). Update `mannequin-model.test.js` (count, hierarchy, leaves). Pure data — fully testable.

### Task P2: load hand.glb + node map
`geometry-adapter-gltf.js`: add `loadHandGLB()` (cache), and a `HAND_MESH_MAP` (above table) used when building finger phalange segments. Resolve nodes by `userData.name`. Order-by-distance is baked into the map (already resolved above). Pure-ish; test the map shape + ordering decisions.

### Task P3: build phalange segments + pivots + right-hand mirror
`buildSegments`/`computeBoneOffsets`: for phalange bones, pull geometry + world transform from hand.glb (origins already at joints → offset 0). Bone pivot = node world position (mapped into scene space consistent with female.glb). Right hand = mirror left across the sagittal plane (negate X about hand center, flip winding via DoubleSide already in place). Skip female.glb's original whole-finger + hand meshes (replaced). Geometry-heavy — logic unit-tested where possible; placement verified in browser.

### Task P4: presets per-phalange
`finger-presets.js`: curl angles per joint (e.g. fist = MCP/PIP/DIP each bent). Keep the 6 preset names; each now sets 3 quats per finger (2 for thumb). Update tests.

### Task P5: keypoints from real joints
`mannequin-renderer.js` `_computeHandKeypoints`: MCP=_1 origin, PIP=_2 origin, DIP=_3 origin, tip=extrapolate from _3 (using fingerTipLocal of _3). Remove the interpolation approximation. Update tests.

### Task P6: wiring — mirror pairs, jointRadii, applyFingerPreset list
Extend `MIRROR_PAIRS` (phalange pairs), `SMALL_JOINT_BONES` (phalanges), `FINGER_BONES`/preset application list. Update tests.

### Final: browser verification (Jarek)
Confirm hand geometry sits correctly, fingers curl at the right joints toward the palm, both hands, hands.png reflects pose.
