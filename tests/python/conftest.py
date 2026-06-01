import sys, os, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

# ---------------------------------------------------------------------------
# Lightweight stubs for heavy deps that are not installed in the test env
# (torch, folder_paths).  Real ComfyUI provides these at runtime.
# ---------------------------------------------------------------------------

if 'torch' not in sys.modules:
    import numpy as _np

    class _FakeTensor:
        def __init__(self, arr):
            self._arr = arr

        @property
        def shape(self):
            return self._arr.shape

        @property
        def dtype(self):
            return self._arr.dtype

        def max(self):
            return float(self._arr.max())

        def unsqueeze(self, dim):
            return _FakeTensor(_np.expand_dims(self._arr, axis=dim))

        def __getitem__(self, key):
            return self._arr[key]

    class _FakeTorch(types.ModuleType):
        float32 = _np.float32
        Tensor  = _FakeTensor

        @staticmethod
        def from_numpy(arr):
            return _FakeTensor(arr)

    sys.modules['torch'] = _FakeTorch('torch')

if 'folder_paths' not in sys.modules:
    _fp = types.ModuleType('folder_paths')
    _fp.get_input_directory = lambda: '/tmp/comfyui_input'
    sys.modules['folder_paths'] = _fp
