"""Writes the app icons (public/icons/*.png): a teal rounded square with a white cross.

Pure Python (zlib + struct), so no image library is needed. Re-run after changing the colours:
    python tools/make-icons.py
"""
import os
import struct
import zlib

ACCENT = (0x1D, 0x5C, 0x68)
WHITE = (0xFF, 0xFF, 0xFF)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')


def png(path, size, pixel):
    rows = b''.join(b'\x00' + b''.join(bytes(pixel(x, y, size)) for x in range(size)) for y in range(size))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)


def coverage(x, y, size, inside, samples=4):
    """Anti-aliased coverage of a shape by supersampling the pixel."""
    hits = 0
    for i in range(samples):
        for j in range(samples):
            if inside((x + (i + 0.5) / samples) / size, (y + (j + 0.5) / samples) / size):
                hits += 1
    return hits / (samples * samples)


def rounded_square(u, v, inset, r):
    lo, hi = inset, 1 - inset
    if not (lo <= u <= hi and lo <= v <= hi):
        return False
    cx = min(max(u, lo + r), hi - r)
    cy = min(max(v, lo + r), hi - r)
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r


def cross(u, v, arm=0.13, length=0.30):
    return (abs(u - 0.5) <= arm / 2 and abs(v - 0.5) <= length) or (abs(v - 0.5) <= arm / 2 and abs(u - 0.5) <= length)


def make(name, size, maskable):
    # Maskable icons fill the whole square (the OS crops them); "any" icons get rounded corners.
    inset, radius = (0.0, 0.0) if maskable else (0.04, 0.2)
    scale = 0.8 if maskable else 1.0  # keep the cross inside the maskable safe zone

    def pixel(x, y, s):
        bg = coverage(x, y, s, lambda u, v: rounded_square(u, v, inset, radius)) if not maskable else 1.0
        fg = coverage(x, y, s, lambda u, v: cross(0.5 + (u - 0.5) / scale, 0.5 + (v - 0.5) / scale))
        col = [round(ACCENT[k] * (1 - fg) + WHITE[k] * fg) for k in range(3)]
        return (*col, round(255 * max(bg, fg)))

    png(os.path.join(OUT, name), size, pixel)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    make('icon-192.png', 192, False)
    make('icon-512.png', 512, False)
    make('maskable-512.png', 512, True)
    make('apple-touch-icon.png', 180, True)
    print('icons written to', os.path.normpath(OUT))
