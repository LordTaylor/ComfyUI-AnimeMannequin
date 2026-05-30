import numpy as np
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))
from image_processing import normalize_depth, load_image, image_to_tensor


def test_normalize_depth_full_range():
    arr = np.array([[0.0, 0.5], [0.75, 1.0]], dtype=np.float32)
    result = normalize_depth(arr)
    assert result.dtype == np.uint8
    assert result.max() == 255
    assert result.min() == 0


def test_normalize_depth_flat_image():
    # All same value → should return midpoint or 128, not crash
    arr = np.ones((4, 4), dtype=np.float32) * 0.5
    result = normalize_depth(arr)
    assert result.dtype == np.uint8
    assert result.shape == (4, 4)


def test_normalize_depth_inverted():
    # Near (low depth value) should map to WHITE (255)
    arr = np.array([[0.0, 1.0]], dtype=np.float32)
    result = normalize_depth(arr)
    assert result[0, 0] == 255  # near = white
    assert result[0, 1] == 0    # far = black


def test_load_image_returns_black_on_missing_file(tmp_path):
    img = load_image(str(tmp_path / 'nonexistent.png'), 64, 64)
    assert img.shape == (64, 64, 3)
    assert img.max() == 0  # black


def test_load_image_returns_black_on_empty_path():
    img = load_image('', 128, 256)
    assert img.shape == (256, 128, 3)
    assert img.max() == 0


def test_image_to_tensor_shape():
    import torch
    arr = np.zeros((64, 64, 3), dtype=np.float32)
    t = image_to_tensor(arr)
    assert t.shape == (1, 64, 64, 3)
    assert t.dtype == torch.float32


def test_image_to_tensor_values_normalized():
    import torch
    arr = np.ones((4, 4, 3), dtype=np.uint8) * 128
    t = image_to_tensor(arr)
    assert abs(float(t[0, 0, 0, 0]) - 128/255.0) < 0.01
