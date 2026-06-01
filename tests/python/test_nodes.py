"""
Tests for nodes.py — AnimeMannequinNode.

API flow: ComfyUI calls get_outputs(width, height, gender, pose_file, ...)
with filenames pointing to pre-uploaded PNGs. When files are missing (e.g.
when submitting a workflow via the API without opening the editor first),
the node returns black images. server-side rendering from scene JSON is not
yet implemented — see future work in nodes.py.
"""
import math
import os
import sys
import types
from unittest.mock import patch, MagicMock

import numpy as np
import pytest
from PIL import Image

_ROOT = os.path.join(os.path.dirname(__file__), '../..')
sys.path.insert(0, _ROOT)
# torch and folder_paths stubs are registered in conftest.py

# nodes.py uses `from .image_processing import ...` — we need a parent package.
import importlib, importlib.util

_pkg_name = 'ComfyUI_AnimeMannequin'
_pkg = types.ModuleType(_pkg_name)
_pkg.__path__ = [_ROOT]
_pkg.__package__ = _pkg_name
sys.modules[_pkg_name] = _pkg

# Load image_processing as a sub-module of the fake package
_ip_spec = importlib.util.spec_from_file_location(
    f'{_pkg_name}.image_processing',
    os.path.join(_ROOT, 'image_processing.py'),
    submodule_search_locations=[],
)
_ip_mod = importlib.util.module_from_spec(_ip_spec)
_ip_mod.__package__ = _pkg_name
sys.modules[f'{_pkg_name}.image_processing'] = _ip_mod
_ip_spec.loader.exec_module(_ip_mod)

# Load nodes as a sub-module of the fake package
_n_spec = importlib.util.spec_from_file_location(
    f'{_pkg_name}.nodes',
    os.path.join(_ROOT, 'nodes.py'),
    submodule_search_locations=[],
)
_n_mod = importlib.util.module_from_spec(_n_spec)
_n_mod.__package__ = _pkg_name
sys.modules[f'{_pkg_name}.nodes'] = _n_mod
_n_spec.loader.exec_module(_n_mod)

AnimeMannequinNode = _n_mod.AnimeMannequinNode


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_png(tmp_path, filename, color=(128, 64, 32), size=(8, 8)):
    """Create a tiny solid-colour PNG for testing."""
    img = Image.new('RGB', size, color=color)
    p = tmp_path / filename
    img.save(p)
    return p


def _node(tmp_dir: str) -> AnimeMannequinNode:
    """Return a node instance whose input_dir is patched to tmp_dir."""
    with patch('folder_paths.get_input_directory', return_value=tmp_dir):
        return AnimeMannequinNode()


# ---------------------------------------------------------------------------
# Contract tests — INPUT_TYPES / RETURN_TYPES / metadata
# ---------------------------------------------------------------------------

class TestNodeContract:
    def test_required_inputs_present(self):
        it = AnimeMannequinNode.INPUT_TYPES()
        req = it['required']
        assert 'width' in req
        assert 'height' in req
        assert 'gender' in req

    def test_optional_file_inputs_present(self):
        it = AnimeMannequinNode.INPUT_TYPES()
        opt = it.get('optional', {})
        for name in ('pose_file', 'depth_file', 'canny_file', 'openpose_file'):
            assert name in opt, f"optional input '{name}' missing"

    def test_return_types_are_four_images(self):
        assert AnimeMannequinNode.RETURN_TYPES == ('IMAGE', 'IMAGE', 'IMAGE', 'IMAGE')

    def test_return_names(self):
        assert set(AnimeMannequinNode.RETURN_NAMES) == {'pose', 'depth', 'canny', 'openpose'}

    def test_function_name(self):
        assert AnimeMannequinNode.FUNCTION == 'get_outputs'

    def test_is_changed_returns_nan(self):
        val = AnimeMannequinNode.IS_CHANGED()
        assert math.isnan(val), "IS_CHANGED must return NaN so ComfyUI never caches"


# ---------------------------------------------------------------------------
# Black-image fallback — the "API without editor" scenario
# ---------------------------------------------------------------------------

class TestBlackFallback:
    """
    When filenames are empty or point to non-existent files the node must
    return black tensors of the correct shape instead of crashing.
    This is the current behaviour when the workflow is submitted via the
    ComfyUI API without the editor having been opened.
    """

    def test_all_empty_filenames_returns_four_tensors(self, tmp_path):
        node = _node(str(tmp_path))
        with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
            result = node.get_outputs(64, 128, gender='F')
        assert len(result) == 4

    def test_empty_filenames_return_black_images(self, tmp_path):
        import torch
        node = _node(str(tmp_path))
        with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
            pose, depth, canny, openpose = node.get_outputs(64, 128, gender='F')
        for name, t in [('pose', pose), ('depth', depth), ('canny', canny), ('openpose', openpose)]:
            assert t.shape == (1, 128, 64, 3), f"{name} wrong shape"
            assert float(t.max()) == 0.0, f"{name} should be all-black"

    def test_missing_file_returns_black_correct_size(self, tmp_path):
        import torch
        node = _node(str(tmp_path))
        with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
            result = node.get_outputs(
                width=32, height=48, gender='M',
                pose_file='nonexistent.png',
            )
        pose = result[0]
        assert pose.shape == (1, 48, 32, 3)
        assert float(pose.max()) == 0.0

    def test_width_height_reflected_in_output_shape(self, tmp_path):
        node = _node(str(tmp_path))
        for w, h in [(64, 128), (256, 256), (512, 768)]:
            with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
                pose, *_ = node.get_outputs(w, h, gender='F')
            assert pose.shape == (1, h, w, 3), f"expected (1,{h},{w},3) got {pose.shape}"


# ---------------------------------------------------------------------------
# Happy path — valid PNG files are loaded correctly
# ---------------------------------------------------------------------------

class TestValidFiles:
    def test_pose_file_loaded_and_normalised(self, tmp_path):
        import torch
        _make_png(tmp_path, 'p.png', color=(255, 0, 0), size=(8, 8))
        node = _node(str(tmp_path))
        with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
            pose, *_ = node.get_outputs(8, 8, gender='F', pose_file='p.png')
        assert pose.shape == (1, 8, 8, 3)
        # Red channel of a pure-red image should be ≈1.0 after normalisation
        assert float(pose[0, 0, 0, 0]) > 0.95

    def test_all_four_files_loaded(self, tmp_path):
        import torch
        colours = {'pose': (200, 100, 50), 'depth': (50, 50, 50),
                   'canny': (255, 255, 255), 'openpose': (0, 200, 0)}
        for name, col in colours.items():
            _make_png(tmp_path, f'{name}.png', color=col, size=(16, 16))

        node = _node(str(tmp_path))
        with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
            pose, depth, canny, openpose = node.get_outputs(
                16, 16, gender='F',
                pose_file='pose.png', depth_file='depth.png',
                canny_file='canny.png', openpose_file='openpose.png',
            )
        # All tensors non-black (files were loaded)
        assert float(pose.max()) > 0.0
        assert float(depth.max()) > 0.0
        assert float(canny.max()) > 0.0
        assert float(openpose.max()) > 0.0

    def test_output_resized_to_requested_dimensions(self, tmp_path):
        _make_png(tmp_path, 'img.png', size=(32, 32))  # source: 32×32
        node = _node(str(tmp_path))
        with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
            pose, *_ = node.get_outputs(64, 128, pose_file='img.png')  # target: 64×128
        assert pose.shape == (1, 128, 64, 3)


# ---------------------------------------------------------------------------
# Security — path traversal must be rejected
# ---------------------------------------------------------------------------

class TestPathTraversal:
    @pytest.mark.parametrize('evil_path', [
        '../../../etc/passwd',
        '../../secrets.txt',
        '/etc/passwd',
    ])
    def test_path_traversal_rejected_returns_black(self, tmp_path, evil_path):
        import torch
        node = _node(str(tmp_path))
        with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
            pose, *_ = node.get_outputs(32, 32, pose_file=evil_path)
        assert float(pose.max()) == 0.0, "traversal path must produce black image, not crash or leak data"


# ---------------------------------------------------------------------------
# API-without-editor documentation test
# ---------------------------------------------------------------------------

class TestAPIScenarioDocumentation:
    """
    These tests document the current limitation:
    submitting a ComfyUI workflow via the HTTP API without opening the editor
    produces black outputs because no PNG files have been uploaded.

    Future work: add a `scene` STRING input and implement server-side rendering
    so that workflows submitted with a scene JSON produce correct images.
    """

    def test_node_has_no_scene_input_yet(self):
        """
        Confirms that `scene` is NOT yet a recognised input.
        When server-side rendering is implemented, this test should be removed
        and replaced with TestServerSideRendering (not yet written).
        """
        it = AnimeMannequinNode.INPUT_TYPES()
        all_inputs = {**it.get('required', {}), **it.get('optional', {})}
        assert 'scene' not in all_inputs, (
            "Server-side scene rendering is implemented — "
            "remove this placeholder test and add real rendering tests."
        )

    def test_api_flow_without_files_returns_black(self, tmp_path):
        """
        Simulates a raw API queue submission: no files, just dimensions + gender.
        Expected: all-black tensors (not an error), correct shape.
        """
        node = _node(str(tmp_path))
        with patch('folder_paths.get_input_directory', return_value=str(tmp_path)):
            outputs = node.get_outputs(width=512, height=768, gender='F')
        assert len(outputs) == 4
        for t in outputs:
            assert t.shape == (1, 768, 512, 3)
            assert float(t.max()) == 0.0
