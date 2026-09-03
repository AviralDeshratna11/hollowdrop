# Animating a new asset for Hollowdrop (Blender -> .glb -> game)

Everything here was learned the expensive way while building `models/rat_walk.glb`.
Read it before animating the next creature and you skip roughly a session's worth of
rediscovery.

**Scope split:** `CLAUDE.md` documents the *engine* side (the two loaders, the outline
system, the userData contract). This file documents the *authoring* side — Blender,
export, optimisation, and how to verify the result. Read both.

**Worked example:** `models/rat_walk.glb` (2.4 MB, 181 deform bones, one `Walk` clip).
Source blend: `C:\Users\Parth Sharma\Downloads\ratwalk .blend` (note the space before
`.blend`).

---

## 1. Environment

- **Blender 5.2.0 LTS.**
- **BlenderMCP addon**, port 9876. A Claude session can read the scene and run Python in
  Blender directly — vastly faster than a human relaying bone names.
  To connect: viewport -> press **N** -> **BlenderMCP** tab -> **Connect to Claude**.
  Ticking the addon in Preferences is *not* enough; that button starts the socket.

### Repo tooling (use these before writing any game code)

| Script | What it does | Needs |
|---|---|---|
| `tools/glb_inspect.py` | Offline report on a .glb: clips, root-motion check, three.js bone renaming, measured stride and the mixer timeScale it implies, full size breakdown. | nothing |
| `tools/glb_optimize.py` | The section-5 slimming recipe, with a validation pass. | `pip install Pillow` |

```bash
python tools/glb_inspect.py models/rat_walk.glb
python tools/glb_optimize.py models/raw.glb models/out.glb
```

Both are idempotent and read-only with respect to your source. `glb_inspect.py`
reproduces every number quoted in this document, so it doubles as a way to check the
document still matches reality.

---

## 2. Blender 5.x API traps

**`action.fcurves` no longer exists.** Slotted actions moved the curves into
layers/strips/channelbags. Accessing `.fcurves` raises `AttributeError`. Use:

```python
def all_fcurves(action):
    if hasattr(action, "fcurves"):          # pre-4.4
        return list(action.fcurves)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out
```

**Assigning an action is not enough — bind its slot**, or it silently won't evaluate:

```python
arm.animation_data.action = act
if getattr(arm.animation_data, "action_slot", None) is None and act.slots:
    arm.animation_data.action_slot = act.slots[0]
```

**`bpy.ops.object.select_all` fails in Pose Mode** with "context is incorrect". Switch to
OBJECT mode first, or set `obj.select_set()` directly and skip the operator.

**Rigify scenes are mostly widgets.** The rat scene had **373 objects**, ~200 of them
`WGT-*` control shapes. Export with `use_selection=True` and select *only* the mesh and
armature, or you ship all of them.

**Rigify bone families:** `DEF-` deform the mesh; `ORG-`/`MCH-` are control and mechanism
bones. The rat rig is 760 bones total, **181 deform**. Only DEF- matters to three.js.

---

## 3. Authoring a walk-in-place cycle

**Rigify quadruped (cat metarig) IK control names** — note front limbs are "hand":

| Limb | Bone |
|---|---|
| Front left / right | `hand_ik.L` / `hand_ik.R` |
| Rear left / right | `foot_ik.L` / `foot_ik.R` |
| Body | `torso` |

**Verify the local axis mapping empirically — never guess.** Nudge each local axis and
read back the armature-space delta:

```python
pb = arm.pose.bones["foot_ik.L"]
pb.location = (0,0,0); bpy.context.view_layer.update()
base = pb.matrix.translation.copy()
for i, ax in enumerate("XYZ"):
    pb.location = (0,0,0); pb.location[i] = 0.1
    bpy.context.view_layer.update()
    print(ax, tuple(round(v,3) for v in (pb.matrix.translation - base)))
pb.location = (0,0,0)
```
On the rat rig these mapped 1:1 to armature space (local Y = fwd/back, local Z = up), but
that is a property of *that* rig, not a guarantee.

**Gait shape that worked:**
- 16 frames @ 24fps (0.67s) — a brisk rodent scurry.
- Lateral-sequence four-beat walk, phases `0.00 / 0.25 / 0.50 / 0.75` in footfall order
  left-hind -> left-fore -> right-hind -> right-fore.
- `SWING = 0.35` — each paw airborne 35% of the cycle, planted the other 65%, sliding
  backward under the body during stance. That backward slide is what sells "walking"
  rather than "pedalling".
- Key **every frame**; interpolation mode then stops mattering.

**Seamless loop rule:** key frames `1 .. FRAMES+1` so the last duplicates the first, then
set `scene.frame_end = FRAMES`. Exporting the duplicate frame gives a one-frame hitch.

**No root motion, ever.** `PlayerController` moves the object. If the clip also translates,
you get foot-sliding or drift. Verify numerically — don't assume.

---

## 4. Export settings that worked

```python
bpy.ops.export_scene.gltf(
    filepath=path,
    export_format='GLB',
    use_selection=True,          # mesh + armature ONLY (see the widget trap above)
    export_yup=True,             # Blender is Z-up, glTF/three.js are Y-up
    export_apply=True,           # apply modifiers
    export_def_bones=True,       # DEF- only: 760 bones -> 181
    export_animations=True,
    export_force_sampling=True,  # bake Rigify's constraint/driver-driven motion
    export_frame_range=True,
)
```

`export_force_sampling` is not optional. Rigify is built on constraints and drivers, and
glTF has no concept of either — without sampling the clip exports empty or wrong.

**Project facing convention: the model faces -Z at `rotation.y = 0`.** The rat needed
`facingRotationY = Math.PI`. Yours will need its own value; find it by looking, not maths.

---

## 5. Slimming the file (7.50 MB -> 2.47 MB)

```bash
python tools/glb_optimize.py models/raw.glb models/out.glb
# --max-px 512 / --quality 80 to go smaller; --no-weights / --no-textures to isolate
```

That script does steps 1-3 below and validates the result before it exits. The reasoning,
in case you need to deviate:

1. **Textures are almost all of it** (4.84 MB of the original 7.50). Re-encode
   2048 -> 1024 **JPEG**.
2. **Use 4:4:4 chroma subsampling on the normal map and any packed ORM map.** These store
   per-channel data, not colour — default 4:2:0 subsampling smears channels into each
   other and corrupts the lighting. The script decides which map is which from how the
   **material** references it (`normalTexture`, `metallicRoughnessTexture`, ...), not
   from its filename, so it works on assets that name their maps differently. It also
   leaves a base-colour map as PNG rather than JPEG when the material's `alphaMode` is
   not `OPAQUE`, since JPEG has no alpha.
3. **`WEIGHTS_0` float32 -> normalised ubyte.** Core glTF 2.0, no extension needed.
   The one trap: after rounding, the four weights must still sum to 255, or the vertex
   creeps toward the origin. The script pushes the rounding residual onto the heaviest
   bone and asserts the invariant afterwards.
4. **Decimate the geometry.** `rat_walk.glb` is still **66,536 triangles**, which is heavy
   for a phone. For comparison `slimeCreature.js` records replacing a 45,440-tri model
   with an 8,820-tri sphere partly for performance. **Decimate before weight painting** —
   doing it after means redoing the weights.
5. Draco and MeshOptimizer are both available in this Blender install if you want more.
   Draco needs a decoder loaded browser-side; meshopt avoids that extra CDN dependency.

---

## 6. Verifying it actually works

**Inspect the file before writing any game code.**

```bash
python tools/glb_inspect.py models/new.glb
```

It answers, offline and in one command, the things that otherwise cost a debugging
session each: whether a clip survived the export at all, whether it has **root motion**
(it must not), what three.js will rename every bone to, and what stride the clip actually
has. Read the root-motion line first — it is the failure that looks like a game bug
rather than an asset bug.

**Then open it in <https://gltf-viewer.donmccurdy.com/>.** The script proves the data is
present and sane; the viewer proves it *looks* right. If the clip doesn't play there it
won't play in the game, and you'll waste hours debugging the wrong layer.

**Bone names get sanitised on load.** The file keeps dots (`DEF-tail.001`), but three.js
runs node names through `PropertyBinding.sanitizeNodeName`, which strips characters
reserved for animation property paths — dots among them. **Do not hardcode bone names.**
`loadGltfCharacter` returns a `bones: Map<string, THREE.Bone>`; log its keys and match
against those. `glb_inspect.py` prints the before -> after table (176 of the rat's 181
bone names are rewritten, e.g. `DEF-r_toe.L` -> `DEF-r_toeL`), so you can get the real
names without loading the game.

**Measure bone LOCAL rotation, not world position.** This is the single most useful thing
in this document. A previous session measured a paw's *world* position to check whether
the legs had stopped, saw residual movement, and concluded the animation was still
running. It wasn't — that was the player root's own lean/yaw easing out after a turn,
carrying a completely static pose through space. Local rotation is parent-independent and
settles the question:

| State | Bone local quaternion delta / frame |
|---|---|
| Standing | 2.2e-7 (float noise) |
| Moving | 2.5e-3 |

Four orders of magnitude. Anything ambiguous means you're measuring the wrong thing.

---

## 7. The idle rule (design, not mechanics)

**A walk cycle has no frame where all four paws are planted** — each is airborne 35% of
the cycle at 0.25 phase offsets, so 1-2 are always up. Therefore:

- **Never stop a gait by setting `timeScale = 0`.** It freezes wherever it lands, giving a
  creature standing on three legs with one hanging in the air.
- **Blend the action's weight to 0 instead.** At weight 0 the `AnimationMixer` hands the
  bones back to their stored originals — the model's rest pose, a creature standing
  squarely on all fours.
- Keep **weight and timeScale as separate knobs**. The weight blend runs on the mixer's
  own clock, so it completes smoothly even as the clip slows underneath it. Stopping then
  reads as settling onto the paws rather than a snap.

Tuning lives in `RAT_CONFIG` (`js/ratModel.js`): `walkMoveThreshold`, `walkBlendRate`,
`walkMinTimeScale`, `walkMaxTimeScale`.

**Playback rate is not foot-locked and can't practically be.** The rat clip moves paws
0.267 model units per cycle, implying ~0.32 u/s of ground speed, while the player sprints
at 7.5 — exact matching needs `timeScale ~= 23`, which is a blur. It's tuned for
readability instead. Expect the same trade on any new creature.

---

## 8. Checklist for the next animated asset

1. Decimate the mesh, *then* rig and weight-paint.
2. Rig it (Rigify metarig closest to the body plan).
3. Author the clip: walk-in-place, no root motion, seamless loop, named clearly.
4. Verify axis mapping empirically before scripting keyframes.
5. Export with the settings in section 4.
6. `python tools/glb_inspect.py <file>` — confirm the clip exists, there is **no root
   motion**, and note the implied timeScale it prints.
7. Check it in the online glTF viewer (it should *look* right, not just parse).
8. `python tools/glb_optimize.py <raw> <out>` and confirm the size.
9. Wire it through `gltfCharacterLoader.js` — **not** `fbxCharacterLoader.js`; see
   `CLAUDE.md` for why they're incompatible.
10. If the model gets an occlusion outline, confirm `options.skinned` — a plain `Mesh`
    copy hangs in bind pose.
11. Verify in a real browser using local bone rotation (section 6).

---

## 9. Known outstanding issues

- **Camera NaN at `js/main.js:116` — still unfixed, pre-existing.**
  `camera.position.copy(CAMERA_OFFSET).multiplyScalar(viewZoom)`: if the page loads at a
  0x0 viewport, `aspect = 0/0 = NaN` -> `viewZoom = NaN` -> `camera.position` is NaN
  forever, because a later resize repairs `viewZoom` and `camera.aspect` but
  `updateCamera` only ever *lerps* position, and NaN is absorbing. The view renders black.
  Fix: `Number.isFinite` guard in `updateViewZoom`, or re-seed position in `onResize`.
  This blocks automated in-browser verification, so fix it before the next asset job.
- `models/cute_rat/` (13 MB) is now referenced by nothing — the GLB replaced it. Delete
  when you're confident.
- `rat_walk.glb` geometry is still 66,536 triangles (textures were optimised, mesh wasn't).
- The **boss** rat (`'venom'` variant, `predatorModel.js`) still uses the procedural
  bob/pitch/roll gait, because its FBX has no skeleton to drive. Only the player's
  `'cute'` variant is skeletally animated.
