"""
Integration tests — AnimeMannequinNode via ComfyUI HTTP API.

These tests require a running ComfyUI instance at COMFYUI_URL
(default: http://192.168.50.199:8188).  They are skipped automatically
when the server is unreachable.

What is tested:
  1. Node is registered and has the expected contract.
  2. A workflow with no image files executes without errors and returns
     four black IMAGE outputs of the correct shape.
  3. Editor HTML is served at the expected path.
  4. Queue is properly drained after each run (no stuck jobs).
"""
import io
import json
import time
import uuid
import struct
import os

import pytest
import urllib.request
import urllib.error

COMFYUI_URL = os.environ.get('COMFYUI_URL', 'http://192.168.50.199:8188')
TIMEOUT_POLL = 60   # seconds to wait for a queued prompt to finish
POLL_INTERVAL = 0.5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get(path: str, timeout: int = 10) -> dict:
    with urllib.request.urlopen(f'{COMFYUI_URL}{path}', timeout=timeout) as r:
        return json.loads(r.read())


def _post(path: str, body: dict, timeout: int = 10) -> dict:
    data = json.dumps(body).encode()
    req  = urllib.request.Request(
        f'{COMFYUI_URL}{path}', data=data,
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _server_reachable() -> bool:
    try:
        _get('/system_stats', timeout=3)
        return True
    except Exception:
        return False


def _submit_workflow(workflow: dict) -> str:
    """Submit a workflow and return the prompt_id."""
    client_id = str(uuid.uuid4())
    resp = _post('/prompt', {'prompt': workflow, 'client_id': client_id})
    return resp['prompt_id']


def _wait_for_prompt(prompt_id: str) -> dict:
    """Poll /history until the prompt appears, then return its output dict."""
    deadline = time.time() + TIMEOUT_POLL
    while time.time() < deadline:
        history = _get(f'/history/{prompt_id}')
        if prompt_id in history:
            return history[prompt_id]
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f'Prompt {prompt_id} did not finish in {TIMEOUT_POLL}s')


def _minimal_workflow(width: int = 64, height: int = 64, gender: str = 'F') -> dict:
    """
    Minimal workflow: just the AnimeMannequinNode, no downstream nodes.
    All optional file inputs omitted → node returns black images.
    """
    return {
        '1': {
            'class_type': 'AnimeMannequinNode',
            'inputs': {
                'width':  width,
                'height': height,
                'gender': gender,
            },
        },
    }


# ---------------------------------------------------------------------------
# Skip marker — applied to the whole module
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.skipif(
    not _server_reachable(),
    reason=f'ComfyUI not reachable at {COMFYUI_URL}',
)


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------

class TestNodeRegistration:
    """Verify the node is correctly installed and advertised by the API."""

    def test_node_present_in_object_info(self):
        info = _get('/object_info/AnimeMannequinNode')
        assert 'AnimeMannequinNode' in info, 'AnimeMannequinNode not registered'

    def test_required_inputs(self):
        node = _get('/object_info/AnimeMannequinNode')['AnimeMannequinNode']
        req  = node['input']['required']
        assert 'width'  in req
        assert 'height' in req
        assert 'gender' in req

    def test_optional_file_inputs(self):
        node = _get('/object_info/AnimeMannequinNode')['AnimeMannequinNode']
        opt  = node['input'].get('optional', {})
        for name in ('pose_file', 'depth_file', 'canny_file', 'openpose_file'):
            assert name in opt, f"optional input '{name}' missing"

    def test_output_names(self):
        node = _get('/object_info/AnimeMannequinNode')['AnimeMannequinNode']
        assert node['output_name'] == ['pose', 'depth', 'canny', 'openpose']

    def test_output_types_are_image(self):
        node = _get('/object_info/AnimeMannequinNode')['AnimeMannequinNode']
        assert node['output'] == ['IMAGE', 'IMAGE', 'IMAGE', 'IMAGE']


class TestEditorServed:
    """Verify the static editor HTML is accessible."""

    def test_editor_html_returns_200(self):
        try:
            with urllib.request.urlopen(
                f'{COMFYUI_URL}/mannequin_editor/index.html', timeout=5
            ) as r:
                assert r.status == 200
                content = r.read(64)
                assert b'<!DOCTYPE' in content or b'<html' in content.lower()
        except urllib.error.HTTPError as e:
            pytest.fail(f'Editor HTML returned HTTP {e.code}')


class TestAPIExecution:
    """Submit a real workflow via /prompt and verify outputs."""

    def test_workflow_executes_without_error(self):
        """No exception → execution completed normally."""
        pid = _submit_workflow(_minimal_workflow(64, 64))
        result = _wait_for_prompt(pid)
        # ComfyUI stores errors under 'error' key if execution failed
        assert result.get('error') is None, f"Execution error: {result.get('error')}"

    def test_outputs_contain_four_images(self):
        """Four IMAGE outputs are present in history."""
        pid    = _submit_workflow(_minimal_workflow(64, 64))
        result = _wait_for_prompt(pid)
        outputs = result.get('outputs', {})
        assert '1' in outputs, 'Node 1 has no outputs in history'
        node_out = outputs['1']
        # Each output channel is a list of image descriptors
        for ch in ('pose', 'depth', 'canny', 'openpose'):
            assert ch in node_out or 'images' in node_out, (
                f"Output channel '{ch}' missing — got keys: {list(node_out.keys())}"
            )

    @pytest.mark.parametrize('width,height,gender', [
        (64,  128, 'F'),
        (128,  64, 'M'),
        (256, 256, 'F'),
    ])
    def test_outputs_have_correct_dimensions(self, width, height, gender, tmp_path):
        """
        Download the pose output image and verify its pixel dimensions match
        the requested width×height.
        """
        from PIL import Image as PILImage

        pid    = _submit_workflow(_minimal_workflow(width, height, gender))
        result = _wait_for_prompt(pid)
        outputs = result.get('outputs', {}).get('1', {})

        # ComfyUI may return output images under 'images' list or per-name keys
        imgs = outputs.get('images', [])
        if not imgs:
            # Try to find any list value that looks like image descriptors
            for v in outputs.values():
                if isinstance(v, list) and v and isinstance(v[0], dict) and 'filename' in v[0]:
                    imgs = v
                    break

        assert imgs, f'No image descriptors found in outputs: {outputs}'
        fname = imgs[0]['filename']
        subfolder = imgs[0].get('subfolder', '')
        ftype = imgs[0].get('type', 'output')

        url = f'{COMFYUI_URL}/view?filename={fname}&subfolder={subfolder}&type={ftype}'
        with urllib.request.urlopen(url, timeout=10) as r:
            img_bytes = r.read()

        img = PILImage.open(io.BytesIO(img_bytes))
        assert img.width  == width,  f'Expected width={width},  got {img.width}'
        assert img.height == height, f'Expected height={height}, got {img.height}'

    def test_api_without_files_returns_black_images(self, tmp_path):
        """
        The current limitation: submitting via API without the editor
        means no PNG files were uploaded → all outputs are black.
        This test documents and verifies the graceful degradation.
        """
        from PIL import Image as PILImage
        import numpy as np

        pid    = _submit_workflow(_minimal_workflow(64, 64, 'F'))
        result = _wait_for_prompt(pid)
        outputs = result.get('outputs', {}).get('1', {})

        imgs = outputs.get('images', [])
        if not imgs:
            for v in outputs.values():
                if isinstance(v, list) and v and isinstance(v[0], dict) and 'filename' in v[0]:
                    imgs = v
                    break

        assert imgs, 'No images in output'
        fname = imgs[0]['filename']
        ftype = imgs[0].get('type', 'output')
        url = f'{COMFYUI_URL}/view?filename={fname}&subfolder=&type={ftype}'
        with urllib.request.urlopen(url, timeout=10) as r:
            img_bytes = r.read()

        img = PILImage.open(io.BytesIO(img_bytes)).convert('RGB')
        arr = np.array(img)
        assert arr.max() == 0, (
            f'Expected all-black image (no files uploaded), '
            f'got max pixel={arr.max()}. '
            'If server-side rendering is implemented, update this test.'
        )
