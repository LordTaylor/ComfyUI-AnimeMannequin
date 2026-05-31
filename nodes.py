import os
import folder_paths
from .image_processing import load_image, image_to_tensor


class AnimeMannequinNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width":  ("INT", {"default": 768, "min": 64, "max": 2048, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 2048, "step": 64}),
                "gender": (["F", "M"],),
            },
            "optional": {
                "pose_file":     ("STRING", {"default": ""}),
                "depth_file":    ("STRING", {"default": ""}),
                "canny_file":    ("STRING", {"default": ""}),
                "openpose_file": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES  = ("IMAGE", "IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES  = ("pose", "depth", "canny", "openpose")
    FUNCTION      = "get_outputs"
    CATEGORY      = "AnimeMannequin"
    OUTPUT_NODE   = False

    @staticmethod
    def _safe_join(base: str, filename: str) -> str:
        if not filename:
            return ""
        real = os.path.realpath(os.path.join(base, filename))
        if not real.startswith(base + os.sep):
            return ""  # silently reject path traversal attempts
        return real

    def get_outputs(self, width, height, gender="F", pose_file="", depth_file="", canny_file="", openpose_file=""):
        input_dir    = os.path.realpath(folder_paths.get_input_directory())
        pose_path     = self._safe_join(input_dir, pose_file)
        depth_path    = self._safe_join(input_dir, depth_file)
        canny_path    = self._safe_join(input_dir, canny_file)
        openpose_path = self._safe_join(input_dir, openpose_file)
        pose     = image_to_tensor(load_image(pose_path,     width, height))
        depth    = image_to_tensor(load_image(depth_path,    width, height))
        canny    = image_to_tensor(load_image(canny_path,    width, height))
        openpose = image_to_tensor(load_image(openpose_path, width, height))
        return (pose, depth, canny, openpose)


NODE_CLASS_MAPPINGS = {
    "AnimeMannequinNode": AnimeMannequinNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimeMannequinNode": "Anime Mannequin",
}
