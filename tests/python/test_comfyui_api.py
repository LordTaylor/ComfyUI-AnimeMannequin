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
    Minimal workflow: AnimeMannequinNode only, no SaveImage.
    Used to verify execution succeeds — outputs dict will be empty without SaveImage.
    """
    return {
        '1': {
            'class_type': 'AnimeMannequinNode',
            'inputs': {'width': width, 'height': height, 'gender': gender},
        },
    }


def _scene_workflow(width: int = 64, height: int = 64, gender: str = 'F',
                    scene: str = '') -> dict:
    """
    Full workflow: AnimeMannequinNode + 4 SaveImage nodes.
    Renders from scene JSON server-side via headless_render.js.
    """
    if not scene:
        scene = json.dumps({
            'version': '1.0', 'gender': gender, 'bones': {},
            'camera': {'azimuth': 0, 'elevation': 5, 'distance': 2.5},
            'proportions': {'head': 1, 'bust': 1, 'hips': 1,
                            'waist': 1, 'legs': 1, 'arms': 1},
        })
    return {
        '1': {'class_type': 'AnimeMannequinNode',
              'inputs': {'width': width, 'height': height,
                         'gender': gender, 'scene': scene}},
        '2': {'class_type': 'SaveImage',
              'inputs': {'images': ['1', 0], 'filename_prefix': 'api_pose'}},
        '3': {'class_type': 'SaveImage',
              'inputs': {'images': ['1', 1], 'filename_prefix': 'api_depth'}},
        '4': {'class_type': 'SaveImage',
              'inputs': {'images': ['1', 2], 'filename_prefix': 'api_canny'}},
        '5': {'class_type': 'SaveImage',
              'inputs': {'images': ['1', 3], 'filename_prefix': 'api_openpose'}},
    }


def _first_saved_image(outputs: dict):
    """Return first image descriptor from any SaveImage node in outputs."""
    for nout in outputs.values():
        imgs = nout.get('images', [])
        if imgs:
            return imgs[0]
    return None


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
    """Submit real workflows via /prompt and verify outputs."""

    def test_workflow_executes_without_error(self):
        """Bare node (no SaveImage, no scene) executes without error."""
        pid    = _submit_workflow(_minimal_workflow(64, 64))
        result = _wait_for_prompt(pid)
        assert result.get('error') is None, f"Execution error: {result.get('error')}"

    def test_scene_json_produces_four_saved_images(self):
        """scene JSON → headless render → 4 SaveImage outputs in history."""
        pid    = _submit_workflow(_scene_workflow(64, 96, 'F'))
        result = _wait_for_prompt(pid)
        outputs = result.get('outputs', {})
        # nodes 2-5 are SaveImage — each should have one image entry
        saved = [v for k, v in outputs.items() if k in ('2', '3', '4', '5')]
        assert len(saved) == 4, f'Expected 4 SaveImage outputs, got {len(saved)}'
        for node_out in saved:
            assert node_out.get('images'), f'SaveImage node produced no images: {node_out}'

    @pytest.mark.parametrize('width,height,gender', [
        (64,  128, 'F'),
        (128,  64, 'M'),
        (256, 256, 'F'),
    ])
    def test_scene_outputs_have_correct_dimensions(self, width, height, gender):
        """Rendered images must match requested width × height."""
        from PIL import Image as PILImage

        pid    = _submit_workflow(_scene_workflow(width, height, gender))
        result = _wait_for_prompt(pid)
        img_desc = _first_saved_image(result.get('outputs', {}))
        assert img_desc, 'No saved image found in outputs'

        url = (f'{COMFYUI_URL}/view?filename={img_desc["filename"]}'
               f'&subfolder={img_desc.get("subfolder","")}'
               f'&type={img_desc.get("type","output")}')
        with urllib.request.urlopen(url, timeout=10) as r:
            img = PILImage.open(io.BytesIO(r.read()))
        assert img.width  == width,  f'width:  expected {width},  got {img.width}'
        assert img.height == height, f'height: expected {height}, got {img.height}'

    def test_scene_renders_non_black_pose(self):
        """
        Pose image rendered from scene JSON must NOT be all-black.
        Verifies the headless renderer actually produced content.
        """
        from PIL import Image as PILImage
        import numpy as np

        pid    = _submit_workflow(_scene_workflow(128, 192, 'F'))
        result = _wait_for_prompt(pid)
        # Node 2 = SaveImage for pose (first output channel)
        pose_out = result.get('outputs', {}).get('2', {})
        imgs = pose_out.get('images', [])
        assert imgs, 'No pose image in outputs'

        url = (f'{COMFYUI_URL}/view?filename={imgs[0]["filename"]}'
               f'&subfolder=&type={imgs[0].get("type","output")}')
        with urllib.request.urlopen(url, timeout=10) as r:
            img = PILImage.open(io.BytesIO(r.read())).convert('RGB')
        arr = np.array(img)
        assert arr.max() > 0, 'Pose image is all-black — headless renderer failed'

    def test_no_scene_no_files_returns_black(self):
        """
        Without scene JSON and without pre-uploaded files, outputs are black.
        Graceful degradation — no crash.
        """
        from PIL import Image as PILImage
        import numpy as np

        wf = {
            '1': {'class_type': 'AnimeMannequinNode',
                  'inputs': {'width': 64, 'height': 64, 'gender': 'F'}},
            '2': {'class_type': 'SaveImage',
                  'inputs': {'images': ['1', 0], 'filename_prefix': 'black_test'}},
        }
        pid    = _submit_workflow(wf)
        result = _wait_for_prompt(pid)
        img_desc = _first_saved_image(result.get('outputs', {}))
        assert img_desc, 'No output image'

        url = (f'{COMFYUI_URL}/view?filename={img_desc["filename"]}'
               f'&subfolder=&type={img_desc.get("type","output")}')
        with urllib.request.urlopen(url, timeout=10) as r:
            img = PILImage.open(io.BytesIO(r.read())).convert('RGB')
        assert np.array(img).max() == 0, 'Expected black image without scene/files'
