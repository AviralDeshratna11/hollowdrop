#!/usr/bin/env python3
"""Slim a rigged .glb without touching its rig, mesh topology or animation.

This is the recipe from ASSET_PIPELINE.md section 5, as a runnable script. On
models/rat_walk.glb it did 7.50 MB -> 2.47 MB. Two reductions, both safe:

  1. Re-encode the embedded textures (downscale + JPEG). Textures were 4.84 MB of
     that original 7.50. Maps that carry PER-CHANNEL data rather than colour - normal
     maps, and packed occlusion/roughness/metalness - are written with 4:4:4 chroma
     subsampling, because the default 4:2:0 smears the channels into each other and
     visibly corrupts the lighting. Which map is which is detected from how the
     MATERIAL references it, not from its name.

  2. WEIGHTS_0 float32 -> ubyte-normalized. This is core glTF 2.0 (the spec allows
     float, ubyte-normalized or ushort-normalized for weights), so it needs no
     extension and three.js reads it natively. 4 bytes per weight becomes 1.

Deliberately NOT done here: geometry decimation. Simplifying a skinned mesh needs the
weights redone, which is a Blender job - decimate BEFORE weight painting.

Requires Pillow:  pip install Pillow

    python tools/glb_optimize.py models/in.glb models/out.glb
    python tools/glb_optimize.py models/in.glb models/out.glb --max-px 512 --quality 80
    python tools/glb_optimize.py models/in.glb models/out.glb --no-weights

Verify the result with:  python tools/glb_inspect.py models/out.glb
"""

import argparse
import io
import json
import struct
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is required:  pip install Pillow')

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def load_glb(path):
    raw = open(path, 'rb').read()
    magic, _version, length = struct.unpack('<III', raw[:12])
    if magic != GLB_MAGIC:
        sys.exit(path + ': not a GLB (bad magic).')
    off, chunks = 12, []
    while off < min(length, len(raw)):
        clen, ctype = struct.unpack('<II', raw[off:off + 8])
        chunks.append((ctype, raw[off + 8:off + 8 + clen]))
        off += 8 + clen
    gltf = json.loads(chunks[0][1].decode('utf-8'))
    blob = chunks[1][1] if len(chunks) > 1 else b''
    return gltf, blob, len(raw)


def classify_images(gltf):
    """image index -> 'normal' | 'packed' | 'color', from how materials use it.

    Name-based guessing breaks on any asset that names its maps differently; the
    material's own reference is authoritative.
    """
    tex_to_img = {}
    for ti, tex in enumerate(gltf.get('textures', [])):
        if 'source' in tex:
            tex_to_img[ti] = tex['source']
    roles = {}

    def mark(texinfo, role):
        if not texinfo:
            return
        img = tex_to_img.get(texinfo.get('index'))
        if img is None:
            return
        # normal/packed win over color if a map is somehow used for both
        if roles.get(img) != 'normal':
            roles[img] = role

    for mat in gltf.get('materials', []):
        pbr = mat.get('pbrMetallicRoughness', {})
        mark(pbr.get('baseColorTexture'), 'color')
        mark(mat.get('emissiveTexture'), 'color')
        mark(pbr.get('metallicRoughnessTexture'), 'packed')
        mark(mat.get('occlusionTexture'), 'packed')
        mark(mat.get('normalTexture'), 'normal')
    return roles


def materials_needing_alpha(gltf):
    """Base-colour image indices whose material actually uses the alpha channel."""
    tex_to_img = {ti: t['source'] for ti, t in enumerate(gltf.get('textures', []))
                  if 'source' in t}
    keep = set()
    for mat in gltf.get('materials', []):
        if mat.get('alphaMode', 'OPAQUE') == 'OPAQUE':
            continue
        info = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if info and tex_to_img.get(info.get('index')) is not None:
            keep.add(tex_to_img[info['index']])
    return keep


def reencode_images(gltf, view_bytes, args):
    roles = classify_images(gltf)
    alpha_needed = materials_needing_alpha(gltf)
    replacement = {}
    for i, img in enumerate(gltf.get('images', [])):
        if 'bufferView' not in img:
            print('  image %d %-30s EXTERNAL - skipped' % (i, img.get('name', '')))
            continue
        bi = img['bufferView']
        original = view_bytes(bi)
        im = Image.open(io.BytesIO(original))
        im.load()
        before_size, before_len = im.size, len(original)

        if max(im.size) > args.max_px:
            s = args.max_px / max(im.size)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))),
                           Image.LANCZOS)

        role = roles.get(i, 'color')
        keep_alpha = i in alpha_needed and im.mode in ('RGBA', 'LA', 'P')
        buf = io.BytesIO()
        if keep_alpha:
            # JPEG has no alpha. A cutout/blended base-colour map has to stay PNG.
            im.convert('RGBA').save(buf, 'PNG', optimize=True)
            mime = 'image/png'
        else:
            packed = role in ('normal', 'packed')
            im.convert('RGB').save(buf, 'JPEG',
                                   quality=args.packed_quality if packed else args.quality,
                                   subsampling=0 if packed else 2,
                                   optimize=True)
            mime = 'image/jpeg'
        data = buf.getvalue()

        if len(data) >= before_len and im.size == before_size:
            print('  image %d %-30s %s %.2f MB - already smaller, kept as-is'
                  % (i, img.get('name', ''), before_size, before_len / 1e6))
            continue

        replacement[bi] = data
        img['mimeType'] = mime
        print('  image %d %-30s [%s] %s %.2f MB -> %s %.2f MB%s'
              % (i, img.get('name', ''), role, before_size, before_len / 1e6,
                 im.size, len(data) / 1e6, '  (alpha kept: PNG)' if keep_alpha else ''))
    return replacement


def quantize_weights(gltf, view_bytes):
    """WEIGHTS_0 float32 -> ubyte-normalized, for every skinned primitive."""
    replacement = {}
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            wi = prim['attributes'].get('WEIGHTS_0')
            if wi is None:
                continue
            acc = gltf['accessors'][wi]
            if acc['componentType'] != 5126 or acc['type'] != 'VEC4':
                print('  WEIGHTS_0 is not float32 VEC4 - already packed, skipped')
                continue
            bvi = acc['bufferView']
            bv = gltf['bufferViews'][bvi]
            if bv.get('byteStride') not in (None, 16):
                print('  WEIGHTS_0 is interleaved (byteStride=%s) - skipped'
                      % bv['byteStride'])
                continue
            sharers = [a for a in gltf['accessors'] if a.get('bufferView') == bvi]
            if len(sharers) != 1:
                print('  WEIGHTS_0 shares its bufferView with %d other accessors - '
                      'skipped' % (len(sharers) - 1))
                continue
            if bvi in replacement:
                continue
            count = acc['count']
            floats = struct.unpack('<%df' % (count * 4), view_bytes(bvi))
            out = bytearray()
            for i in range(count):
                q = floats[i * 4:i * 4 + 4]
                s = sum(q)
                b = [round(v / s * 255) if s > 0 else 0 for v in q]
                # Rounding must not change the total: ubyte-normalized weights that no
                # longer sum to 255 pull the vertex toward the origin. Push the residual
                # onto the heaviest bone, where it is least visible.
                b[b.index(max(b))] += 255 - sum(b)
                out += bytes(min(255, max(0, v)) for v in b)
            replacement[bvi] = bytes(out)
            acc['componentType'] = 5121
            acc['normalized'] = True
            if 'byteStride' in bv:
                bv['byteStride'] = 4
            print('  WEIGHTS_0 float32 -> ubyte/normalized   %.2f MB -> %.2f MB'
                  % (bv['byteLength'] / 1e6, len(out) / 1e6))
    return replacement


def rebuild(gltf, blob, replacement, dst):
    """Repack every bufferView into a fresh binary chunk, 4-byte aligned."""
    newbin = bytearray()
    for i, bv in enumerate(gltf['bufferViews']):
        if i in replacement:
            data = replacement[i]
        else:
            o = bv.get('byteOffset', 0)
            data = blob[o:o + bv['byteLength']]
        while len(newbin) % 4:
            newbin += b'\x00'
        bv['byteOffset'] = len(newbin)
        bv['byteLength'] = len(data)
        newbin += data
    while len(newbin) % 4:
        newbin += b'\x00'
    gltf['buffers'] = [{'byteLength': len(newbin)}]

    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * (-len(js) % 4)
    body = (struct.pack('<II', len(js), CHUNK_JSON) + js
            + struct.pack('<II', len(newbin), CHUNK_BIN) + bytes(newbin))
    out = struct.pack('<III', GLB_MAGIC, 2, 12 + len(body)) + body
    open(dst, 'wb').write(out)
    return len(out)


def validate(path):
    """Re-open the result and prove it is structurally sound before trusting it."""
    gltf, blob, total = load_glb(path)
    assert gltf['buffers'][0]['byteLength'] == len(blob), 'buffer length mismatch'
    for i, bv in enumerate(gltf['bufferViews']):
        end = bv.get('byteOffset', 0) + bv['byteLength']
        assert end <= len(blob), 'bufferView %d runs past the binary chunk' % i
    for img in gltf.get('images', []):
        if 'bufferView' not in img:
            continue
        bv = gltf['bufferViews'][img['bufferView']]
        o = bv.get('byteOffset', 0)
        im = Image.open(io.BytesIO(blob[o:o + bv['byteLength']]))
        im.load()
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            wi = prim['attributes'].get('WEIGHTS_0')
            if wi is None:
                continue
            acc = gltf['accessors'][wi]
            if acc['componentType'] != 5121:
                continue
            bv = gltf['bufferViews'][acc['bufferView']]
            o = bv.get('byteOffset', 0)
            d = blob[o:o + bv['byteLength']]
            bad = sum(1 for i in range(acc['count'])
                      if sum(d[i * 4:i * 4 + 4]) != 255)
            assert bad == 0, '%d vertices have weights not summing to 255' % bad
    return total


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--max-px', type=int, default=1024,
                    help='longest texture edge after downscaling (default 1024)')
    ap.add_argument('--quality', type=int, default=85,
                    help='JPEG quality for colour maps (default 85)')
    ap.add_argument('--packed-quality', type=int, default=92,
                    help='JPEG quality for normal / packed ORM maps, which are held to '
                         'a higher floor and 4:4:4 (default 92)')
    ap.add_argument('--no-textures', action='store_true')
    ap.add_argument('--no-weights', action='store_true')
    args = ap.parse_args()

    if args.src == args.dst:
        sys.exit('Refusing to write in place - give a different destination, then '
                 'move it over the original once glb_inspect.py looks right.')

    gltf, blob, before = load_glb(args.src)

    def view_bytes(i):
        bv = gltf['bufferViews'][i]
        o = bv.get('byteOffset', 0)
        return blob[o:o + bv['byteLength']]

    print('\n%s  %.2f MB' % (args.src, before / 1e6))
    replacement = {}
    if not args.no_textures:
        replacement.update(reencode_images(gltf, view_bytes, args))
    if not args.no_weights:
        replacement.update(quantize_weights(gltf, view_bytes))
    if not replacement:
        sys.exit('\nNothing to change.')

    after = rebuild(gltf, blob, replacement, args.dst)
    validate(args.dst)
    print('\n%s  %.2f MB  (%.0f%% smaller) - validated'
          % (args.dst, after / 1e6, 100 * (1 - after / before)))
    print('Now run:  python tools/glb_inspect.py %s' % args.dst)


if __name__ == '__main__':
    main()
