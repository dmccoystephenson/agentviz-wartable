"""Frames (PNG, in name order) -> GIF with an adaptive palette per frame.

The kit's make_gif.py shares one 128-colour palette across frames, which
can shift the war table's small saturated pennant and banner colours.
Until the kit offers a per-frame palette, the war table encodes its own.
   python3 tests/make_gif.py <frames dir> <out.gif> <fps> [width]"""
import os
import sys

from PIL import Image


def main(src, out, fps, width=800):
    names = sorted(n for n in os.listdir(src) if n.endswith(".png"))
    if not names:
        raise SystemExit("make_gif: no .png frames in %s" % src)
    frames = []
    for name in names:
        im = Image.open(os.path.join(src, name)).convert("RGB")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        frames.append(im.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG))
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0, optimize=True)
    print("%s: %d frames, %.1f MB" % (out, len(frames), os.path.getsize(out) / 1e6))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 800)
