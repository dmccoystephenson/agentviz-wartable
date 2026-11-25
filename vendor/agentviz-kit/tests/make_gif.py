"""Frames (PNG, in name order) -> an optimised GIF, with Pillow (ffmpeg is not
needed). pip install -r requirements-dev.txt brings Pillow.
   python3 make_gif.py <frames dir> <out.gif> <fps> [width]"""
import os
import sys

from PIL import Image


def main(src, out, fps, width=720):
    names = sorted(n for n in os.listdir(src) if n.endswith(".png"))
    if not names:
        raise SystemExit("make_gif: no .png frames in %s" % src)
    frames = []
    for n in names:
        im = Image.open(os.path.join(src, n)).convert("RGB")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        frames.append(im)
    # One shared palette from a few frames keeps the GIF small and steady.
    sample = Image.new("RGB", (frames[0].width, frames[0].height * 3))
    for i, k in enumerate((0, len(frames) // 2, len(frames) - 1)):
        sample.paste(frames[k], (0, frames[0].height * i))
    pal = sample.quantize(colors=128, method=Image.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.NONE) for f in frames]
    q[0].save(out, save_all=True, append_images=q[1:], duration=int(1000 / fps), loop=0, optimize=True)
    print("%s: %d frames, %.1f MB" % (out, len(q), os.path.getsize(out) / 1e6))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 720)
