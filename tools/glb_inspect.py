#!/usr/bin/env python3
"""Offline report on a rigged .glb, for the Hollowdrop asset pipeline.

Answers, without opening Blender or a browser, the questions that decide whether a
freshly exported clip will work in the game:

  * Is there a clip, what is it called, and how long is it?
  * Does it have ROOT MOTION? (It must not - PlayerController owns translation.)
  * What will three.js rename the bones to? (Reserved characters are stripped on load.)
  * How far do the paws actually travel per cycle, and what ground speed does that
    imply once the model is normalised to targetRadius? (Sets the mixer timeScale.)
  * Where is the file size going?

Pure standard library - no numpy, no Pillow, nothing to install.

    python tools/glb_inspect.py models/rat_walk.glb
    python tools/glb_inspect.py models/new.glb --target-radius 0.75 --max-speed 7.5

See ASSET_PIPELINE.md sections 5 and 6 for how to read the output.
"""

import argparse
import json
import math
import re
import struct
import sys

# --- glTF plumbing -------------------------------------------------------------------

# componentType -> (struct code, byte size)
CTYPE = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2),
         5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
CTYPE_LABEL = {5120: 'i8', 5121: 'u8', 5122: 'i16', 5123: 'u16', 5125: 'u32', 5126: 'f32'}
NORM_LIMIT = {'b': 127.0, 'B': 255.0, 'h': 32767.0, 'H': 65535.0}


def load_glb(path):
    raw = open(path, 'rb').read()
    magic, _version, length = struct.unpack('<III', raw[:12])
    if magic != 0x46546C67:
        sys.exit(path + ': not a GLB (bad magic). A .gltf + .bin pair is not supported.')
    if length != len(raw):
        print('  ! header length %d != actual %d bytes' % (length, len(raw)),
              file=sys.stderr)
    off, chunks = 12, []
    while off < min(length, len(raw)):
        clen, ctype = struct.unpack('<II', raw[off:off + 8])
        chunks.append((ctype, raw[off + 8:off + 8 + clen]))
        off += 8 + clen
    gltf = json.loads(chunks[0][1].decode('utf-8'))
    blob = chunks[1][1] if len(chunks) > 1 else b''
    return gltf, blob, len(raw), len(chunks[0][1])


def read_accessor(gltf, blob, index):
    """Returns a list of tuples (scalars for SCALAR). Normalised ints are decoded."""
    acc = gltf['accessors'][index]
    n = NCOMP[acc['type']]
    code, size = CTYPE[acc['componentType']]
    count = acc['count']
    if 'bufferView' not in acc:                      # sparse-only / zero-filled
        return [((0.0,) * n if n > 1 else 0.0)] * count
    bv = gltf['bufferViews'][acc['bufferView']]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or (size * n)
    limit = NORM_LIMIT.get(code) if acc.get('normalized') else None
    out = []
    for i in range(count):
        vals = struct.unpack_from('<' + code * n, blob, base + i * stride)
        if limit:
            vals = tuple(max(v / limit, -1.0) for v in vals)
        out.append(vals if n > 1 else vals[0])
    if acc.get('sparse'):
        print('  ! accessor %d is sparse; values may be incomplete' % index,
              file=sys.stderr)
    return out


def view_len(gltf, index):
    return gltf['bufferViews'][index]['byteLength']


# --- three.js name mangling ----------------------------------------------------------

# three's PropertyBinding.sanitizeNodeName: whitespace becomes '_', then the characters
# reserved by animation property paths ( [ ] . : / ) are REMOVED outright.
_RESERVED = re.compile(r'[\[\]\.:/]')
_WHITESPACE = re.compile(r'\s')


def sanitize(name):
    return _RESERVED.sub('', _WHITESPACE.sub('_', name or ''))


# --- tiny 4x4 / quaternion maths (pure python) ---------------------------------------

IDENTITY = ((1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0), (0.0, 0.0, 0.0, 1.0))


def quat_to_mat3(q):
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
            (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
            (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))


def trs_to_mat(t, r, s):
    m = quat_to_mat3(r)
    return ((m[0][0] * s[0], m[0][1] * s[1], m[0][2] * s[2], t[0]),
            (m[1][0] * s[0], m[1][1] * s[1], m[1][2] * s[2], t[1]),
            (m[2][0] * s[0], m[2][1] * s[1], m[2][2] * s[2], t[2]),
            (0.0, 0.0, 0.0, 1.0))


def mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4))
                 for i in range(4))


# --- animation sampling --------------------------------------------------------------

def build_tracks(gltf, blob, anim):
    """{node_index: {path: (times, values)}}"""
    tracks = {}
    for ch in anim['channels']:
        target = ch.get('target', {})
        node = target.get('node')
        if node is None:
            continue
        smp = anim['samplers'][ch['sampler']]
        times = read_accessor(gltf, blob, smp['input'])
        values = read_accessor(gltf, blob, smp['output'])
        tracks.setdefault(node, {})[target['path']] = (times, values)
    return tracks


def sample(track, t, default):
    """Linear sample. Good enough for measurement; three does proper slerp on rotation."""
    if track is None:
        return default
    times, values = track
    if not times:
        return default
    if t <= times[0]:
        return values[0]
    if t >= times[-1]:
        return values[-1]
    lo = 0
    for i in range(len(times) - 1):
        if times[i] <= t <= times[i + 1]:
            lo = i
            break
    span = times[lo + 1] - times[lo]
    a = 0.0 if span <= 0 else (t - times[lo]) / span
    return tuple(v0 + (v1 - v0) * a for v0, v1 in zip(values[lo], values[lo + 1]))


def world_pos(nodes, parent, tracks, node, t):
    chain, cur = [], node
    while cur is not None:
        chain.append(cur)
        cur = parent.get(cur)
    m = IDENTITY
    for idx in reversed(chain):
        nd = nodes[idx]
        tr = tracks.get(idx, {})
        tt = sample(tr.get('translation'), t, tuple(nd.get('translation', (0, 0, 0))))
        rr = sample(tr.get('rotation'), t, tuple(nd.get('rotation', (0, 0, 0, 1))))
        ss = sample(tr.get('scale'), t, tuple(nd.get('scale', (1, 1, 1))))
        m = mat_mul(m, trs_to_mat(tt, rr, ss))
    return (m[0][3], m[1][3], m[2][3])


# --- report sections -----------------------------------------------------------------

PAW_RE = re.compile(r'toe|paw|foot|hand', re.I)


def report_header(gltf, path, total, json_len):
    print('\n=== %s - %.2f MB ===' % (path, total / 1e6))
    asset = gltf.get('asset', {})
    print('  generator      %s  (glTF %s)'
          % (asset.get('generator', '?'), asset.get('version', '?')))
    print('  extensions     %s' % (gltf.get('extensionsUsed') or 'none'))
    if gltf.get('extensionsRequired'):
        print('  REQUIRED       %s  <- needs a browser-side decoder'
              % gltf['extensionsRequired'])
    print('  nodes %d   meshes %d   skins %d   animations %d'
          % (len(gltf.get('nodes', [])), len(gltf.get('meshes', [])),
             len(gltf.get('skins', [])), len(gltf.get('animations', []))))
    print('\n--- size ---')
    print('  JSON chunk               %7.2f MB' % (json_len / 1e6))


def report_images(gltf):
    total = 0
    for i, img in enumerate(gltf.get('images', [])):
        if 'bufferView' not in img:
            print('  image %d %-24s EXTERNAL uri=%s' % (i, img.get('name', ''),
                                                        img.get('uri')))
            continue
        n = view_len(gltf, img['bufferView'])
        total += n
        print('  image %d %-24s %7.2f MB  %s'
              % (i, img.get('name', ''), n / 1e6, img.get('mimeType')))
    print('  images total             %7.2f MB' % (total / 1e6))


def report_geometry(gltf):
    total = 0
    for mi, mesh in enumerate(gltf.get('meshes', [])):
        for pi, prim in enumerate(mesh['primitives']):
            attrs = prim['attributes']
            skinned = 'JOINTS_0' in attrs and 'WEIGHTS_0' in attrs
            tris = gltf['accessors'][prim['indices']]['count'] // 3 \
                if 'indices' in prim else None
            print('\n  mesh %d prim %d "%s"  %s  tris=%s'
                  % (mi, pi, mesh.get('name', ''),
                     'SKINNED' if skinned else
                     'STATIC (no skin data - this will NOT animate)', tris))
            entries = sorted(attrs.items())
            if 'indices' in prim:
                entries.append(('indices', prim['indices']))
            for name, ai in entries:
                acc = gltf['accessors'][ai]
                n = view_len(gltf, acc['bufferView']) if 'bufferView' in acc else 0
                total += n
                label = CTYPE_LABEL.get(acc['componentType'], '?')
                if acc.get('normalized'):
                    label += '/norm'
                print('      %-12s %-6s %-9s count=%-7d %.2f MB'
                      % (name, acc['type'], label, acc['count'], n / 1e6))
    print('\n  geometry total           %7.2f MB' % (total / 1e6))
    for si, skin in enumerate(gltf.get('skins', [])):
        print('  skin %d "%s"  joints=%d'
              % (si, skin.get('name', ''), len(skin['joints'])))


def report_bone_names(gltf, joint_ids):
    nodes = gltf['nodes']
    renamed = []
    for j in sorted(joint_ids):
        before = nodes[j].get('name', '')
        after = sanitize(before)
        if after != before:
            renamed.append((before, after))
    print('\n--- bone names as three.js will see them ---')
    if not renamed:
        print('  no bone name contains reserved characters; names pass through unchanged')
        return
    print('  %d of %d bone names are rewritten on load.' % (len(renamed), len(joint_ids)))
    print('  three strips  [ ] . : /  and turns whitespace into _')
    print('  (PropertyBinding.sanitizeNodeName). DO NOT hardcode the left-hand names -')
    print('  loadGltfCharacter returns a bones Map; match against its keys. Examples:')
    for before, after in renamed[:8]:
        print('      %-28s -> %s' % (before, after))
    if len(renamed) > 8:
        print('      ... and %d more' % (len(renamed) - 8))


def rest_pose_scale(gltf, target_radius):
    """The uniform scale loadGltfCharacter will apply, from the rest-pose extent."""
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            acc = gltf['accessors'][prim['attributes']['POSITION']]
            lo, hi = acc.get('min'), acc.get('max')
            if not (lo and hi):
                continue
            dims = [h - l for h, l in zip(hi, lo)]
            native = max(dims) / 2
            if native > 1e-6:
                return target_radius / native, dims, native
    return None, None, None


def report_clip(gltf, blob, anim, roots, joint_ids, bone_re, args, scale):
    nodes = gltf['nodes']
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []):
            parent[c] = i

    tracks = build_tracks(gltf, blob, anim)
    stamps = [s[0] for tr in tracks.values() for s in tr.values() if s[0]]
    if not stamps:
        print('\n--- clip "%s" --- no keyframes' % anim.get('name'))
        return
    t0 = min(min(s) for s in stamps)
    t1 = max(max(s) for s in stamps)
    keys = max(len(s) for s in stamps)
    print('\n--- clip "%s" ---' % anim.get('name'))
    print('  channels %d   animated nodes %d   keys/track (max) %d'
          % (len(anim['channels']), len(tracks), keys))
    print('  time %.4f .. %.4fs   three AnimationClip.duration = %.4fs' % (t0, t1, t1))

    times = [t0 + (t1 - t0) * i / (args.samples - 1) for i in range(args.samples)]

    # ROOT MOTION: the thing that must be zero.
    print('  root motion:')
    for r in roots:
        pts = [world_pos(nodes, parent, tracks, r, t) for t in times]
        travel = [max(p[a] for p in pts) - min(p[a] for p in pts) for a in range(3)]
        verdict = ('OK - no translation' if max(travel) < 1e-6 else
                   'ROOT MOTION PRESENT -> fights PlayerController (foot-slide / drift)')
        print('    node %d "%s" animated=%s travel=%s  %s'
              % (r, nodes[r].get('name', ''), r in tracks,
                 [round(v, 5) for v in travel], verdict))

    # stride, for picking the mixer timeScale
    measured = []
    for j in sorted(joint_ids):
        name = nodes[j].get('name', '')
        if not bone_re.search(name):
            continue
        pts = [world_pos(nodes, parent, tracks, j, t) for t in times]
        span_x = max(p[0] for p in pts) - min(p[0] for p in pts)
        span_z = max(p[2] for p in pts) - min(p[2] for p in pts)
        lift = max(p[1] for p in pts) - min(p[1] for p in pts)
        measured.append((max(span_x, span_z), lift, name))
    if not measured:
        print('  stride: no bone matched /%s/ - pass --bone-filter' % bone_re.pattern)
        return
    measured.sort(reverse=True)
    print('  stride (horizontal travel per cycle, model units):')
    for span, lift, name in measured[:6]:
        print('    %-26s stride=%.4f  lift=%.4f' % (name, span, lift))

    stride = measured[0][0]
    if not scale or t1 <= 0:
        return
    implied = stride * scale / t1
    print('\n  implied ground speed at timeScale 1: '
          '%.4f * %.4f / %.4fs = %.3f u/s' % (stride, scale, t1, implied))
    if implied <= 1e-6:
        return
    need = args.max_speed / implied
    print('  foot-locked timeScale for %.1f u/s would be %.1fx' % (args.max_speed, need))
    if need > 6:
        print('  -> %.0fx is a blur, not a walk. Foot-locking is off the table; tune'
              % need)
        print('     walkMaxTimeScale for readability instead (ASSET_PIPELINE.md sec 7).')
    else:
        print('  -> within reason; this one could actually be foot-locked.')


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('glb')
    ap.add_argument('--target-radius', type=float, default=0.75,
                    help='half the largest bounding-box dimension the loader normalises '
                         'to (RAT_CONFIG.bodyRadius; default 0.75)')
    ap.add_argument('--max-speed', type=float, default=7.5,
                    help='world units/sec at full player speed '
                         '(RAT_CONFIG.maxSpeed; default 7.5)')
    ap.add_argument('--samples', type=int, default=65,
                    help='samples per clip when measuring stride (default 65)')
    ap.add_argument('--bone-filter', default=None,
                    help='regex selecting which bones to measure, instead of the '
                         'default toe|paw|foot|hand')
    args = ap.parse_args()

    gltf, blob, total, json_len = load_glb(args.glb)
    report_header(gltf, args.glb, total, json_len)
    report_images(gltf)
    report_geometry(gltf)

    joint_ids = {j for s in gltf.get('skins', []) for j in s['joints']}
    report_bone_names(gltf, joint_ids)

    if not gltf.get('animations'):
        print('\n--- animations ---')
        print('  NONE. Nothing to play - check export_animations and')
        print('  export_force_sampling (ASSET_PIPELINE.md section 4).')
        return

    scale, dims, native = rest_pose_scale(gltf, args.target_radius)
    if scale:
        print('\n--- normalisation ---')
        print('  rest-pose extent  %s' % [round(d, 3) for d in dims])
        print('  targetRadius %s / nativeRadius %.4f  ->  scale %.4f'
              % (args.target_radius, native, scale))

    scene = gltf.get('scenes', [{}])[gltf.get('scene', 0)]
    roots = scene.get('nodes', [])
    bone_re = re.compile(args.bone_filter, re.I) if args.bone_filter else PAW_RE
    for anim in gltf['animations']:
        report_clip(gltf, blob, anim, roots, joint_ids, bone_re, args, scale)
    print()


if __name__ == '__main__':
    main()
