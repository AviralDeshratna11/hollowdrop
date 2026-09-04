from pathlib import Path
import random

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
TEXTURE_DIR = ROOT / "assets" / "textures"
SOURCE_PATH = TEXTURE_DIR / "cave_ground_new.png"
ATLAS_PATH = TEXTURE_DIR / "cave_ground_generated_atlas.png"
TILE_DIR = TEXTURE_DIR / "ground_tiles"

TILE_SIZE = 1024
GRID_SIZE = 3
ATLAS_SIZE = TILE_SIZE * GRID_SIZE
PATCH_SIZE = 256
OVERLAP = 64
STRIDE = PATCH_SIZE - OVERLAP
BORDER_LOCK = 128
BORDER_FEATHER = 128

RNG_SEED = 9404


THEMES = [
    {"name": "cyan sinkholes", "brightness": 0.92, "contrast": 1.08, "color": 1.08, "cyan": 0.23, "green": 0.06, "purple": 0.00},
    {"name": "wet cobble pass", "brightness": 0.98, "contrast": 1.04, "color": 0.96, "cyan": 0.08, "green": 0.02, "purple": 0.00},
    {"name": "violet fungal shelf", "brightness": 0.94, "contrast": 1.07, "color": 1.12, "cyan": 0.02, "green": 0.00, "purple": 0.26},
    {"name": "emerald moss basin", "brightness": 0.95, "contrast": 1.05, "color": 1.12, "cyan": 0.08, "green": 0.20, "purple": 0.00},
    {"name": "original spawn floor", "brightness": 1.00, "contrast": 1.00, "color": 1.00, "cyan": 0.00, "green": 0.00, "purple": 0.00},
    {"name": "blue crystal pockets", "brightness": 0.96, "contrast": 1.08, "color": 1.10, "cyan": 0.26, "green": 0.00, "purple": 0.04},
    {"name": "shadow crevice field", "brightness": 0.88, "contrast": 1.12, "color": 0.98, "cyan": 0.10, "green": 0.04, "purple": 0.06},
    {"name": "mossy pebble flats", "brightness": 0.98, "contrast": 1.03, "color": 1.05, "cyan": 0.04, "green": 0.18, "purple": 0.00},
    {"name": "deep glow grotto", "brightness": 0.91, "contrast": 1.10, "color": 1.14, "cyan": 0.20, "green": 0.04, "purple": 0.14},
]


def load_source() -> Image.Image:
    return Image.open(SOURCE_PATH).convert("RGB").resize(
        (TILE_SIZE, TILE_SIZE),
        Image.Resampling.LANCZOS,
    )


def edge_compatible_base(source: Image.Image, col: int, row: int) -> Image.Image:
    img = source.copy()
    if col != 1:
        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if row != 1:
        img = img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return img


def make_border_mask() -> Image.Image:
    mask = Image.new("L", (TILE_SIZE, TILE_SIZE), 0)
    pix = mask.load()
    for y in range(TILE_SIZE):
        for x in range(TILE_SIZE):
            dist = min(
                x - BORDER_LOCK,
                y - BORDER_LOCK,
                TILE_SIZE - BORDER_LOCK - 1 - x,
                TILE_SIZE - BORDER_LOCK - 1 - y,
            )
            if dist <= 0:
                value = 0
            else:
                t = min(1.0, dist / BORDER_FEATHER)
                value = int((t * t * (3.0 - 2.0 * t)) * 255)
            pix[x, y] = value
    return mask.filter(ImageFilter.GaussianBlur(1.4))


def choose_patch(source: np.ndarray, out: np.ndarray, filled: np.ndarray, x: int, y: int, rng: random.Random) -> np.ndarray:
    max_start = TILE_SIZE - PATCH_SIZE
    candidate_count = 90 if x or y else 1
    best_patch = None
    best_score = float("inf")

    for _ in range(candidate_count):
        sx = rng.randrange(0, max_start + 1)
        sy = rng.randrange(0, max_start + 1)
        patch = source[sy:sy + PATCH_SIZE, sx:sx + PATCH_SIZE]

        if not (x or y):
            return patch.copy()

        score = 0.0
        samples = 0
        filled_slice = filled[y:y + PATCH_SIZE, x:x + PATCH_SIZE]
        if filled_slice.any():
            diff = patch.astype(np.float32) - out[y:y + PATCH_SIZE, x:x + PATCH_SIZE].astype(np.float32)
            overlap = filled_slice[..., None]
            score = float(np.mean((diff * overlap) ** 2))
            samples = int(filled_slice.sum())

        if samples == 0:
            score = rng.random()

        # A small random term avoids picking the same best source area too often.
        score *= 0.94 + rng.random() * 0.12
        if score < best_score:
            best_score = score
            best_patch = patch.copy()

    return best_patch


def blend_patch(out: np.ndarray, filled: np.ndarray, patch: np.ndarray, x: int, y: int) -> None:
    h = min(PATCH_SIZE, TILE_SIZE - y)
    w = min(PATCH_SIZE, TILE_SIZE - x)
    patch = patch[:h, :w].astype(np.float32)
    target = out[y:y + h, x:x + w].astype(np.float32)
    existing = filled[y:y + h, x:x + w]

    alpha = np.ones((h, w), dtype=np.float32)
    if x > 0:
        ramp = np.linspace(0.0, 1.0, min(OVERLAP, w), dtype=np.float32)
        alpha[:, :len(ramp)] = np.minimum(alpha[:, :len(ramp)], ramp[None, :])
    if y > 0:
        ramp = np.linspace(0.0, 1.0, min(OVERLAP, h), dtype=np.float32)
        alpha[:len(ramp), :] = np.minimum(alpha[:len(ramp), :], ramp[:, None])

    alpha = np.where(existing, alpha, 1.0)[..., None]
    mixed = target * (1.0 - alpha) + patch * alpha
    out[y:y + h, x:x + w] = np.clip(mixed, 0, 255).astype(np.uint8)
    filled[y:y + h, x:x + w] = True


def quilt_tile(source: Image.Image, seed: int) -> Image.Image:
    rng = random.Random(seed)
    src = np.array(source, dtype=np.uint8)
    out = np.zeros_like(src)
    filled = np.zeros((TILE_SIZE, TILE_SIZE), dtype=bool)

    positions = list(range(0, TILE_SIZE - PATCH_SIZE + 1, STRIDE))
    if positions[-1] != TILE_SIZE - PATCH_SIZE:
        positions.append(TILE_SIZE - PATCH_SIZE)

    for y in positions:
        for x in positions:
            patch = choose_patch(src, out, filled, x, y, rng)
            blend_patch(out, filled, patch, x, y)

    return Image.fromarray(out, "RGB")


def apply_theme(img: Image.Image, theme: dict) -> Image.Image:
    arr = np.array(img).astype(np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

    cyan_mask = np.clip(((g + b) * 0.5 - r * 1.08) / 95.0, 0.0, 1.0) * np.clip(lum * 2.1, 0.0, 1.0)
    green_mask = np.clip((g - (r + b) * 0.45) / 80.0, 0.0, 1.0) * np.clip(lum * 2.0, 0.0, 1.0)
    purple_mask = np.clip(((r + b) * 0.5 - g * 1.08) / 95.0, 0.0, 1.0) * np.clip(lum * 2.1, 0.0, 1.0)
    dark_mask = np.clip((0.22 - lum) / 0.22, 0.0, 1.0)

    arr[..., 1] += cyan_mask * theme["cyan"] * 52.0
    arr[..., 2] += cyan_mask * theme["cyan"] * 72.0
    arr[..., 0] -= cyan_mask * theme["cyan"] * 18.0

    arr[..., 1] += green_mask * theme["green"] * 70.0
    arr[..., 0] -= green_mask * theme["green"] * 10.0

    arr[..., 0] += purple_mask * theme["purple"] * 66.0
    arr[..., 2] += purple_mask * theme["purple"] * 82.0
    arr[..., 1] -= purple_mask * theme["purple"] * 22.0

    arr *= 1.0 - dark_mask[..., None] * 0.04
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    img = ImageEnhance.Brightness(img).enhance(theme["brightness"])
    img = ImageEnhance.Contrast(img).enhance(theme["contrast"])
    img = ImageEnhance.Color(img).enhance(theme["color"])
    return img.filter(ImageFilter.UnsharpMask(radius=0.55, percent=55, threshold=3))


def main() -> None:
    source = load_source()
    border_mask = make_border_mask()
    atlas = Image.new("RGB", (ATLAS_SIZE, ATLAS_SIZE))

    for row in range(GRID_SIZE):
        for col in range(GRID_SIZE):
            idx = row * GRID_SIZE + col
            base = edge_compatible_base(source, col, row)
            if idx == 4:
                tile = source.copy()
            else:
                quilted = quilt_tile(source, RNG_SEED + idx * 137)
                themed = apply_theme(quilted, THEMES[idx])
                tile = Image.composite(themed, base, border_mask)

            tile_path = TILE_DIR / f"cave_ground_generated_tile_r{row + 1}c{col + 1}.png"
            tile.save(tile_path, optimize=True)
            atlas.paste(tile, (col * TILE_SIZE, row * TILE_SIZE))
            print(f"{tile_path.name}: {THEMES[idx]['name']}")

    atlas.save(ATLAS_PATH, optimize=True)
    print(f"atlas: {ATLAS_PATH.relative_to(ROOT)} {ATLAS_SIZE}x{ATLAS_SIZE}")


if __name__ == "__main__":
    main()
