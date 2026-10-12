"""HCFaceSwap: put the companion's portrait face onto a finished render.

FaceID borrows a likeness; it cannot copy a face. This node swaps the
render's face for the portrait's with insightface's inswapper (the model
every face-swap tool uses), then hands the picture on to the graph's
FaceDetailer pass, which re-renders skin detail over the swapped face at a
low denoise so it sits in the photo's own light.

Written here rather than installing ReActor because ReActor blanks any image
its NSFW detector flags, and every picture this app renders is explicit.

Inputs:  image   the render (IMAGE, batch)
         source  her portrait (IMAGE)
Output:  the render with her face. Unchanged if either image has no face,
         or if the swap model is missing, so a photo is never lost to it.
"""

import os
import threading

import numpy as np
import torch

import folder_paths

_LOCK = threading.Lock()
_APP = None
_SWAPPER = None


def _insightface_dirs():
    dirs = [os.path.join(folder_paths.models_dir, "insightface")]
    for vol in ("/runpod-volume", "/workspace"):
        dirs.append(os.path.join(vol, "models", "insightface"))
    return [d for d in dirs if os.path.isdir(d)]


def _load():
    global _APP, _SWAPPER
    with _LOCK:
        if _APP is not None and _SWAPPER is not None:
            return _APP, _SWAPPER
        import insightface
        from insightface.app import FaceAnalysis

        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        root = None
        swapper_path = None
        for d in _insightface_dirs():
            if root is None and os.path.isdir(os.path.join(d, "models", "buffalo_l")):
                root = d
            p = os.path.join(d, "inswapper_128.onnx")
            if swapper_path is None and os.path.isfile(p):
                swapper_path = p
        if root is None or swapper_path is None:
            raise FileNotFoundError(
                f"HCFaceSwap needs models/insightface/models/buffalo_l and inswapper_128.onnx (root={root}, swapper={swapper_path})"
            )
        app = FaceAnalysis(name="buffalo_l", root=root, providers=providers)
        app.prepare(ctx_id=0, det_size=(640, 640))
        _APP = app
        _SWAPPER = insightface.model_zoo.get_model(swapper_path, providers=providers)
        return _APP, _SWAPPER


def _to_bgr(t):
    arr = (t.detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
    return arr[:, :, ::-1].copy()


def _to_tensor(bgr):
    rgb = bgr[:, :, ::-1].astype(np.float32) / 255.0
    return torch.from_numpy(rgb.copy())


def _largest(faces):
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


class HCFaceSwap:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "source": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "swap"
    CATEGORY = "humancrush"

    def swap(self, image, source):
        try:
            app, swapper = _load()
        except Exception as e:  # missing model: never lose the photo to it
            print(f"[HCFaceSwap] skipped: {e}")
            return (image,)
        src_faces = app.get(_to_bgr(source[0]))
        if not src_faces:
            print("[HCFaceSwap] no face in the portrait; skipped")
            return (image,)
        src = _largest(src_faces)
        out = []
        for frame in image:
            bgr = _to_bgr(frame)
            faces = app.get(bgr)
            if faces:
                bgr = swapper.get(bgr, _largest(faces), src, paste_back=True)
            else:
                print("[HCFaceSwap] no face in the render; left as is")
            out.append(_to_tensor(bgr))
        return (torch.stack(out, dim=0),)


NODE_CLASS_MAPPINGS = {"HCFaceSwap": HCFaceSwap}
NODE_DISPLAY_NAME_MAPPINGS = {"HCFaceSwap": "HumanCrush face swap"}
