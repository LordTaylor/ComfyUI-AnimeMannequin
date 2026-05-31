import os
import numpy as np
from PIL import Image
import torch


def normalize_depth(depth_arr: np.ndarray) -> np.ndarray:
    """Normalize float depth array to uint8 where near=255, far=0."""
    mn, mx = depth_arr.min(), depth_arr.max()
    if mx - mn < 1e-6:
        return np.full(depth_arr.shape, 128, dtype=np.uint8)
    normalized = (depth_arr - mn) / (mx - mn)
    inverted = 1.0 - normalized  # near → 1.0 → 255
    return (inverted * 255).clip(0, 255).astype(np.uint8)


def load_image(path: str, width: int, height: int) -> np.ndarray:
    """
    Load image from path, resize to (width, height).
    Returns float32 RGB array shape (height, width, 3) in range [0, 1].
    Returns black image on missing file or empty path.
    """
    if not path or not os.path.isfile(path):
        return np.zeros((height, width, 3), dtype=np.float32)
    with Image.open(path) as img:
        img_rgb = img.convert('RGB').resize((width, height), Image.LANCZOS)
    return np.array(img_rgb, dtype=np.float32) / 255.0


def image_to_tensor(arr: np.ndarray) -> torch.Tensor:
    """Convert HxWx3 float32 or uint8 array to ComfyUI-format tensor (1, H, W, 3)."""
    if arr.dtype == np.uint8:
        arr = arr.astype(np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)
