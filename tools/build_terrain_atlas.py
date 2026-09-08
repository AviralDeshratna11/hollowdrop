"""Builds the two final ground assets from the nine hand-painted biome regions:

  assets/textures/biomes/terrain-atlas.png   - seam-healed 3x3 color atlas
  assets/textures/biomes/terrain-height.png  - authored grayscale relief map

pack_biome_atlas.ps1 only does a mechanical grid paste (see terrain-layout.png) -
straight tile edges with no blending. This script instead OVERLAPS each pair of
neighboring tiles by a band and cross-fades them using a noise-jittered threshold,
so the seam reads as an irregular rock crack instead of a straight cut, plus a
soft shadowed "fissure" darkening right on the crack line to sell it. The height
map is blended the same way but smoothly (no jaggedness) since a noisy seam in
the physical terrain would read as bumpy ground rather than a visual crack.

Both outputs share the same 3x3 region layout and ordering as pack_biome_atlas.ps1
so js/terrain.js's UV mapping (one 0..1 span across all nine regions) lines up
identically for color and height.
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REGIONS_DIR = ROOT / "assets" / "textures" / "biomes" / "regions"
OUT_DIR = ROOT / "assets" / "textures" / "biomes"

# Matches pack_biome_atlas.ps1's $regionNames exactly - row-major, top-left first.
REGION_ORDER = [
    "r1c1-snow", "r1c2-frost", "r1c3-amethyst",
    "r2c1-swamp", "r2c2-original", "r2c3-crystal",
    "r3c1-root-marsh", "r3c2-lake", "r3c3-limestone",
]

# Authored relief per region as (base_meters, noise_amplitude_meters, noise_cells).
# js/terrain.js maps 0..255 to -1.2m..+1.2m (128 = level), then box-blurs at
# runtime, so this only needs to set gentle, climbable base elevations - matching
# the file's own "Subtle macro undulation" / "smooth, climbable, organic slopes"
# design intent. r2c2 (world origin) is pinned near-flat because the predator's
# home (10, 8) and the Apex arena (-10, -9) both stand on it. r3c2 (lake) only
# shapes the shoreline outside LAKE_CONFIG's own basin carve, which overrides
# elevation inside its ellipse regardless of this map.
REGION_HEIGHT = {
    "r1c1-snow":       (0.55, 0.16, 10),
    "r1c2-frost":      (0.45, 0.13, 9),
    "r1c3-amethyst":   (0.40, 0.18, 7),
    "r2c1-swamp":      (-0.35, 0.08, 12),
    "r2c2-original":   (0.0, 0.03, 6),
    "r2c3-crystal":    (0.25, 0.13, 8),
    "r3c1-root-marsh": (-0.25, 0.10, 11),
    "r3c2-lake":       (-0.5, 0.06, 8),
    "r3c3-limestone":  (0.30, 0.13, 9),
}

TILE = 1024                 # per-region working resolution (matches pack_biome_atlas.ps1)
BAND = 110                  # seam overlap width in px at TILE scale, for color
FINAL_ATLAS_SIZE = 2048     # downsampled for AA + a lighter file than a naive 3072 pack

HEIGHT_TILE = 512
HEIGHT_BAND = 55
FINAL_HEIGHT_SIZE = 1536    # oversampled vs. terrain.js's own 512 internal grid

JAGGED_NOISE_AMP = 0.55
JAGGED_EDGE_SOFT = 0.16
FISSURE_STRENGTH = 0.30
FISSURE_SIGMA = 0.05


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def value_noise(h, w, cells, seed):
    """Smooth pseudo-random field in [0,1] via a small random grid upsampled with bicubic filtering."""
    rng = np.random.default_rng(seed)
    small = rng.random((max(2, cells), max(2, cells))).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8), "L").resize((w, h), Image.BICUBIC)
    return np.asarray(im).astype(np.float32) / 255.0


def load_region_rgb(name, size):
    im = Image.open(REGIONS_DIR / f"{name}.png").convert("RGB").resize((size, size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32)


def _jagged_alpha_and_fissure(band, length, axis_shape, seed):
    noise = value_noise(*axis_shape, cells=14, seed=seed)
    ramp = np.linspace(0.0, 1.0, band, dtype=np.float32)
    ramp = ramp[None, :] if axis_shape[0] != band else ramp[:, None]
    base = smoothstep(ramp)
    threshold = np.clip(base + (noise - 0.5) * JAGGED_NOISE_AMP, 0.0, 1.0)
    alpha = smoothstep((threshold - (0.5 - JAGGED_EDGE_SOFT / 2)) / JAGGED_EDGE_SOFT)
    fissure = np.exp(-((threshold - 0.5) ** 2) / (2 * FISSURE_SIGMA ** 2)) * FISSURE_STRENGTH
    return alpha, fissure


def blend_row_jagged(tiles, tile_size, band, seed_base):
    total_w = 3 * tile_size - 2 * band
    out = np.zeros((tile_size, total_w, 3), dtype=np.float32)
    starts = [0, tile_size - band, 2 * (tile_size - band)]
    for i, t in enumerate(tiles):
        out[:, starts[i]:starts[i] + tile_size] = t
    for seam in range(2):
        left, right = tiles[seam], tiles[seam + 1]
        ox = starts[seam + 1]
        left_part = left[:, tile_size - band:tile_size, :]
        right_part = right[:, 0:band, :]
        alpha, fissure = _jagged_alpha_and_fissure(band, tile_size, (tile_size, band), seed_base + seam * 7 + 1)
        blended = left_part * (1 - alpha[..., None]) + right_part * alpha[..., None]
        blended *= (1.0 - fissure[..., None])
        out[:, ox:ox + band, :] = blended
    return out


def blend_col_jagged(strips, tile_h, band, seed_base):
    w = strips[0].shape[1]
    total_h = 3 * tile_h - 2 * band
    out = np.zeros((total_h, w, 3), dtype=np.float32)
    starts = [0, tile_h - band, 2 * (tile_h - band)]
    for i, s in enumerate(strips):
        out[starts[i]:starts[i] + tile_h, :] = s
    for seam in range(2):
        top, bot = strips[seam], strips[seam + 1]
        oy = starts[seam + 1]
        top_part = top[tile_h - band:tile_h, :, :]
        bot_part = bot[0:band, :, :]
        alpha, fissure = _jagged_alpha_and_fissure(band, w, (band, w), seed_base + seam * 11 + 3)
        blended = top_part * (1 - alpha[..., None]) + bot_part * alpha[..., None]
        blended *= (1.0 - fissure[..., None])
        out[oy:oy + band, :, :] = blended
    return out


def build_atlas():
    tiles2d = [[load_region_rgb(REGION_ORDER[r * 3 + c], TILE) for c in range(3)] for r in range(3)]
    rows = [blend_row_jagged(tiles2d[r], TILE, BAND, seed_base=100 + r * 31) for r in range(3)]
    full = blend_col_jagged(rows, TILE, BAND, seed_base=500)
    full = np.clip(full, 0, 255).astype(np.uint8)
    img = Image.fromarray(full, "RGB").resize((FINAL_ATLAS_SIZE, FINAL_ATLAS_SIZE), Image.LANCZOS)
    out_path = OUT_DIR / "terrain-atlas.png"
    img.save(out_path, optimize=True)
    print(f"atlas -> {out_path.relative_to(ROOT)} {img.size} ({out_path.stat().st_size / 1_048_576:.1f} MB)")


def blend_row_smooth(tiles, tile_size, band):
    total_w = 3 * tile_size - 2 * band
    out = np.zeros((tile_size, total_w), dtype=np.float32)
    starts = [0, tile_size - band, 2 * (tile_size - band)]
    for i, t in enumerate(tiles):
        out[:, starts[i]:starts[i] + tile_size] = t
    for seam in range(2):
        left, right = tiles[seam], tiles[seam + 1]
        ox = starts[seam + 1]
        lp = left[:, tile_size - band:tile_size]
        rp = right[:, 0:band]
        a = smoothstep(np.linspace(0.0, 1.0, band, dtype=np.float32))[None, :]
        out[:, ox:ox + band] = lp * (1 - a) + rp * a
    return out


def blend_col_smooth(strips, tile_h, band):
    w = strips[0].shape[1]
    total_h = 3 * tile_h - 2 * band
    out = np.zeros((total_h, w), dtype=np.float32)
    starts = [0, tile_h - band, 2 * (tile_h - band)]
    for i, s in enumerate(strips):
        out[starts[i]:starts[i] + tile_h, :] = s
    for seam in range(2):
        top, bot = strips[seam], strips[seam + 1]
        oy = starts[seam + 1]
        tp = top[tile_h - band:tile_h, :]
        bp = bot[0:band, :]
        a = smoothstep(np.linspace(0.0, 1.0, band, dtype=np.float32))[:, None]
        out[oy:oy + band, :] = tp * (1 - a) + bp * a
    return out


def make_region_height_tile(name, size, tile_index):
    base, amp, cells = REGION_HEIGHT[name]
    noise = value_noise(size, size, cells, seed=2000 + tile_index)
    meters = base + (noise - 0.5) * 2 * amp
    val = 128.0 + (meters / 1.2) * 128.0
    return np.clip(val, 0, 255).astype(np.float32)


def build_height():
    tiles2d = [
        [make_region_height_tile(REGION_ORDER[r * 3 + c], HEIGHT_TILE, r * 3 + c) for c in range(3)]
        for r in range(3)
    ]
    rows = [blend_row_smooth(tiles2d[r], HEIGHT_TILE, HEIGHT_BAND) for r in range(3)]
    full = blend_col_smooth(rows, HEIGHT_TILE, HEIGHT_BAND)
    full = np.clip(full, 0, 255).astype(np.uint8)
    img = Image.fromarray(full, "L").resize((FINAL_HEIGHT_SIZE, FINAL_HEIGHT_SIZE), Image.LANCZOS)
    out_path = OUT_DIR / "terrain-height.png"
    img.save(out_path, optimize=True)
    print(f"height -> {out_path.relative_to(ROOT)} {img.size} ({out_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    build_atlas()
    build_height()
