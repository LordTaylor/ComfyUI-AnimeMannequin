# ComfyUI AnimeMannequin

A custom node for ComfyUI that lets you pose a stylized 3D humanoid mannequin and export **pose**, **depth**, and **canny** control images — ready to feed into ControlNet pipelines.

![AnimeMannequin editor](docs/images/preview.png)

> **Full documentation, bone naming reference, and bust parameter guide → [Wiki](https://github.com/LordTaylor/ComfyUI-AnimeMannequin/wiki)**

---

## Features

- Interactive 3D pose editor — click any joint and drag to rotate
- Female / Male stylized GLB models
- Exports: OpenPose skeleton · depth map · Canny edges
- Proportions panel — head, bust, waist, hips, legs, arms sliders
- Bust config panel — fine-grained breast positioning and rotation
- Pose library — save and recall custom poses
- Mirror pose (L→R / R→L)
- Random pose generator (safe / wild mode)
- Overlays panel — load a reference PNG as semi-transparent background
- Custom GLB model support — drop in your own compatible humanoid
- Full undo / redo

---

## Installation

### Via ComfyUI Manager (recommended)

Search for **AnimeMannequin** in the Custom Nodes section.

### Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/LordTaylor/ComfyUI-AnimeMannequin.git
```

No Python dependencies beyond what ComfyUI already provides.

---

## Quick start

1. Add the **AnimeMannequin** node to your workflow
2. Connect `width` and `height` inputs (or set them directly on the node)
3. Click **Open Mannequin Editor**
4. Pose the model, then click **Close & Save**
5. The node outputs `pose_image`, `depth_image`, `canny_image`, `openpose_image` — connect to ControlNet

---

## Custom models

Click **Model ⬆** in the editor toolbar to load your own `.glb` file.  
The model must use a compatible humanoid bone naming convention.

> Bone naming reference and compatibility guide → [Wiki: Custom Models](https://github.com/LordTaylor/ComfyUI-AnimeMannequin/wiki/Custom-Models)

---

## Development

```bash
npm install
npx vitest run      # JS unit tests (207 tests)
pytest              # Python tests
bash deploy.sh      # deploy to local ComfyUI instance
```

---

## License

MIT
