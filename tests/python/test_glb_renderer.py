"""Unit tests for glb_renderer pure helpers (no pyrender/GPU needed)."""

from glb_renderer import _bone_quat


class TestBoneQuat:
    """Guard against malformed bone-transform entries from the headless subprocess."""

    def test_valid_quat_returned(self):
        assert _bone_quat({"quat": [0, 0, 0, 1]}) == [0, 0, 0, 1]

    def test_extra_keys_ignored(self):
        assert _bone_quat({"pos": [1, 2, 3], "quat": [0.1, 0.2, 0.3, 0.9]}) == [0.1, 0.2, 0.3, 0.9]

    def test_none_returns_none(self):
        assert _bone_quat(None) is None

    def test_missing_quat_returns_none(self):
        assert _bone_quat({"pos": [0, 0, 0]}) is None

    def test_truncated_quat_returns_none(self):
        assert _bone_quat({"quat": [0, 0]}) is None

    def test_non_dict_returns_none(self):
        assert _bone_quat([0, 0, 0, 1]) is None
        assert _bone_quat("quat") is None
        assert _bone_quat(42) is None

    def test_tuple_quat_accepted(self):
        assert _bone_quat({"quat": (0, 0, 0, 1)}) == (0, 0, 0, 1)
