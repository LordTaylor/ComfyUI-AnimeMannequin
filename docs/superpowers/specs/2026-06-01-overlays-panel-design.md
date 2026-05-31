# Overlays Panel — Design Spec

**Date:** 2026-06-01
**Status:** Approved

---

## Summary

A single floating "Overlays" panel that consolidates two editor-only visual aids:
1. **Background image** — semi-transparent reference photo behind the mannequin
2. **Crop frame** — color and opacity of the output aspect-ratio guide frame

Both are editor-only overlays; they do not appear in exported images (pose/depth/canny).

---

## Architecture

### Approach

CSS overlay (not Three.js). The background image is an `<img>` element absolutely
positioned behind the WebGL canvas. The crop frame is an existing `<div>`. Both are
driven by AppStore state — the Three.js renderer never sees them, so exports are
automatically clean.

### New AppStore state

```js
// Appended to defaultState()
bgImage:    { dataUrl: null, opacity: 0.5, zoom: 1.0 },
cropFrame:  { color: '#ffffff', opacity: 0.55 },
```

New setters on AppStore:
- `setBgImage(patch)`  — patch `bgImage` (dataUrl, opacity, zoom)
- `setCropFrame(patch)` — patch `cropFrame` (color, opacity)

### New Commands (commands.js)

| Command | execute | undo |
|---------|---------|------|
| `SetBgImageCommand(prev, next)` | `store.setBgImage(next)` | `store.setBgImage(prev)` |
| `SetCropFrameCfgCommand(prev, next)` | `store.setCropFrame(next)` | `store.setCropFrame(prev)` |

`SetBgImageCommand` stores full `bgImage` objects (including `dataUrl`).
Undo of "load image" → restores previous image (or null).

---

## Components

### DOM additions (index.html)

```html
<!-- Behind canvas, inside #canvas-wrap -->
<img id="bg-image" style="display:none; position:absolute; inset:0;
     width:100%; height:100%; object-fit:cover;
     pointer-events:none; transform-origin:center;" />
```

Toolbar button:
```html
<button id="btn-overlays" title="Overlays — background image & crop frame">Overlays</button>
```

Hidden file input (outside DOM flow):
```html
<input type="file" id="bg-file-input" accept="image/*" style="display:none" />
```

### OverlaysPanel (static/src/overlays-panel.js)

Constructor: `(store, history)`

Mounts a draggable floating panel (same pattern as BustDebugPanel).

**Sections:**

```
┌─────────────────────────────────┐
│ Overlays                     ✕  │
├─────────────────────────────────┤
│ Background image                │
│ [Wybierz obraz]   [✕ Usuń]     │
│ Opacity  ──●────────  50%      │
│ Zoom     ────●──────  100%     │
├─────────────────────────────────┤
│ Crop frame                      │
│ Color    [████████]             │
│ Opacity  ──●────────  55%      │
└─────────────────────────────────┘
```

**Behaviour:**
- "Wybierz obraz" → triggers `#bg-file-input` → `FileReader.readAsDataURL` →
  `SetBgImageCommand({ ...prev, dataUrl })` committed to history
- "✕ Usuń" → `SetBgImageCommand({ ...prev, dataUrl: null })`
- Opacity/Zoom sliders:
  - `input` event → `store.setBgImage({ opacity })` / `store.setBgImage({ zoom })` live
  - `change` event → `SetBgImageCommand(prev, next)` committed to history
- Crop frame color `<input type="color">`:
  - `input` → `store.setCropFrame({ color })` live
  - `change` → `SetCropFrameCfgCommand(prev, next)` committed
- Crop frame opacity slider: same live/commit pattern
- Panel subscribes to store → `_syncFromStore()` keeps sliders in sync after undo/redo
- `dispose()` → removes store subscription, removes DOM elements

### Renderer/index.html reactive wiring

In `index.html` store subscription (or in OverlaysPanel itself):

```js
store.subscribe(state => {
    const img = document.getElementById('bg-image');
    const { dataUrl, opacity, zoom } = state.bgImage;
    img.style.display = dataUrl ? 'block' : 'none';
    if (dataUrl) img.src = dataUrl;
    img.style.opacity = opacity;
    img.style.transform = `scale(${zoom})`;

    // Crop frame
    const frame = document.getElementById('crop-frame');
    const hex = state.cropFrame.color;           // '#rrggbb'
    const alpha = state.cropFrame.opacity;
    // parse hex → rgba
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    frame.style.borderColor = `rgba(${r},${g},${b},${alpha})`;
});
```

---

## File Changes

| File | Change |
|------|--------|
| `static/src/app-store.js` | Add `bgImage`, `cropFrame` to `defaultState()`; add `setBgImage()`, `setCropFrame()` setters |
| `static/src/commands.js` | Add `SetBgImageCommand`, `SetCropFrameCfgCommand` |
| `static/src/overlays-panel.js` | New file — panel component |
| `static/index.html` | Add `#bg-image`, `#bg-file-input`, toolbar button, instantiate `OverlaysPanel` |

---

## Testing

New test file: `tests/js/overlays-panel.test.js` (jsdom environment)

Tests:
- `setBgImage` patches only provided fields, notifies subscribers
- `setCropFrame` patches correctly
- `SetBgImageCommand` execute/undo round-trip (dataUrl + opacity + zoom)
- `SetCropFrameCfgCommand` execute/undo round-trip
- Panel `_syncFromStore` updates slider values after undo
- Remove button sets `dataUrl: null`

---

## Non-goals

- Background does NOT appear in exported pose/depth/canny PNGs
- No server-side storage of uploaded images
- No URL-based image loading (file picker only)
- No crop frame visibility toggle (already controlled by output size)
