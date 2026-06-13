# Props / Attachments — Brainstorm WIP (paused)

**Status:** brainstorm in progress, PAUSED 2026-06-09 to fix the GitHub one-page site.
Resume from "Open questions" below.

## Feature
Attach 3-D props/accessories to mannequin bones so they follow the pose:
head → hats/glasses, neck/shoulders → necklaces/capes, hands → swords/guitars/guns.

## Decisions so far
- **Q1 — Source of props: C (both).** Built-in library of GLB props in the repo
  (`static/assets/props/*.glb`, pick from a list) **AND** user upload of own GLB
  (reuse the existing custom-model loader pattern: `parseCustomGLB`/`setCustomGLB`).
- **Q2 — Attachment + adjustment: C (hybrid).** Each prop has a sensible **default bone**
  (library props: hat→head, sword→hand_R, …; uploads: user picks the bone on add).
  After attaching, the prop's **offset / rotation / scale** is adjustable (gizmo and/or sliders),
  because models will have varied pivots and scales.

## Open questions (resume here)
- **Q3 — Output integration:** props appear in depth/canny (for ControlNet) — yes? and are
  excluded from the OpenPose/pose skeleton output — yes? (proposed: yes/yes)
- **Q4 — UI:** a docked side-panel like Poses/Hands to browse the library, add/remove props,
  and edit the selected prop's transform? (and how the joined side-panel coordinator handles it)
- **Q5 — Persistence:** props saved in the scene JSON (type/source + bone + transform), so
  save/load and the ComfyUI scene round-trip keep them?
- **v1 scope:** how many built-in props / which categories first.

## Architecture hooks (from existing code)
- `static/src/geometry-adapter-gltf.js` — GLB loading + bone-attached segments; `parseCustomGLB`.
- Bone Object3D map in renderer (`_bones`) — attach prop as a child of a bone group (follows pose).
- Panel pattern: `static/src/panels/{pose-library,proportions-panel,hands-panel}.js`.
- Scene serialization: `mannequin-model.js` (`getSceneData`/`applyScene`/`jsonToScene`), `app-store.js`.
- Output: props into depth/canny render in `mannequin-renderer.js`; keep out of `_captureOpenPose`/`_drawHand`.
