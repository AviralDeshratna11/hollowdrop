import * as THREE from 'three';
import { attachOcclusionOutline } from './occlusionOutline.js?v=5.3';

/**
 * Shared slime-creature factory: a procedurally deforming translucent body.
 *
 * One implementation drives the player AND every NPC. Identity comes from parameters -
 * hue, radius, non-uniform bodyScale, how restless the lobes are, and how many eyes -
 * not from separate geometry per creature. See playerSlimeModel.js and the *Model.js
 * files for the presets.
 *
 * Broad, blunt pseudopods push out of the membrane and retract continuously while at
 * rest, giving the irregular star-like silhouette a real amoeba has. As the player
 * moves, those lobes retract and the REAR of the body stretches into a tapering tail
 * along the direction travelled, so the cell reads as flowing rather than sliding.
 *
 * All of it is GPU vertex displacement injected into a normal MeshStandardMaterial via
 * onBeforeCompile. Two reasons it is done that way rather than with an animated model:
 *
 *  - It has to respond to ACTUAL velocity. A baked animation clip cannot know how fast
 *    the player is going or which way they turned; a canned wobble loop would fight the
 *    velocity-driven squash/stretch PlayerController already applies to the root.
 *  - Keeping MeshStandardMaterial (rather than a bare ShaderMaterial) preserves full
 *    PBR lighting AND leaves .emissive/.emissiveIntensity/.opacity writable, which is
 *    the contract PlayerController writes every frame for hit-flash, low-health tint,
 *    absorb pulse and the death-collapse fade.
 *
 * This replaces a 45,440-triangle imported character model. The icosphere below is
 * ~8,820 triangles, needs no network fetch, and - unlike that model, which shipped
 * with KHR_materials_unlit - actually responds to scene lighting.
 *
 */

export const SLIME_DEFAULTS = {
  radius: 0.6,
  // Non-uniform body scale, applied to the mesh - this is what makes a Stalker long
  // and low rather than another egg, without touching the shared geometry.
  bodyScale: [1, 1, 1],
  // Speed at which streamlining and the tail reach full strength. Creatures measure
  // their own speed (see update()), so each needs its own reference maximum.
  maxSpeed: 6.0,

  // IcosahedronGeometry subdivides as 20 * (detail+1)^2 triangles - NOT 20 * 4^detail,
  // which is the easy assumption and is wrong by a wide margin. Detail 4 was tried
  // first believing it gave ~5k triangles; it is actually 500, which is why the
  // displaced surface came out visibly faceted. 20 gives 20 * 441 = 8,820 triangles
  // (~4.4k welded vertices) - smooth under displacement and still under a fifth of the
  // 45,440-triangle model this replaces. Vertex count matters more than usual here:
  // the shader runs three simplex evaluations per vertex.
  detail: 20,

  // LOW frequency is the entire point: it yields a handful of broad, blunt lobes, the
  // shape a real amoeba makes. Raising this produces many small bumps instead - which
  // reads as a lumpy golf ball, not a cell.
  lobeFrequency: 0.9,
  lobeSpeed: 0.30,      // how fast lobes form and retract
  // Softened from 0.38. The design doc calls the player a "clean, translucent slime"
  // with "toy-like" appeal; 0.38 was tuned against a scientific amoeba photo and gave a
  // busy, starfish-ish outline that fought that description. This reads as squishable.
  lobeAmplitude: 0.24,

  // Peak shaping. Raw simplex noise bumps the ENTIRE surface fairly evenly, which
  // produced a cauliflower on the first attempt; raising the positive half to a power
  // pushes mid-range values back toward zero and leaves only real peaks standing, so
  // the membrane stays calm between a few distinct pseudopods.
  //
  // The gain is not optional. 3D simplex noise only reaches about +/-0.7 in practice,
  // never +/-1, so applying pow() directly attenuates everything (0.7^2.1 = 0.46) and
  // the second attempt flattened into a rounded cube. Gain lifts peaks to ~1 FIRST so
  // the exponent shapes the curve instead of just shrinking it.
  // Sharpness is deliberately 1.0 (i.e. OFF). Raising it does produce distinct lobes,
  // but it produces them by narrowing the peaks - at 1.4 the body came out spiky, more
  // sea urchin than amoeba. Broad blunt lobes come from LOW FREQUENCY instead, and the
  // star silhouette comes from pulling the troughs deeply inward (below) rather than
  // pushing the peaks sharply outward. Left as a tunable because it is the single knob
  // that decides "blunt pseudopod" vs "spike".
  lobeGain: 1.4,
  lobeSharpness: 1.0,
  // Was 0.7, which is what carved the deep starfish valleys. Those valleys are exactly
  // the "scientific specimen" cue the cute direction is moving away from - dropping
  // this leaves gentle bulges on a mostly round body instead of points on a star.
  inwardFactor: 0.25,

  // A second, faster, much weaker octave so the surface never looks like it is cycling
  // through one repeating shape. Deliberately tiny - this is life, not texture.
  detailFrequency: 2.2,
  detailSpeed: 0.5,
  // Near zero: any surface fizz reads as "textured organism" rather than "clean toy".
  detailAmplitude: 0.008,

  tailLength: 0.7,      // how far the rear stretches at full speed, fraction of radius
  tailPinch: 0.55,      // how much the tail's cross-section narrows (0 = blunt)
  // Not 1.0: the cell should still read as a living thing at full sprint, so some lobe
  // character survives rather than smoothing into a featureless teardrop.
  streamlining: 0.6,

  loadSwell: 0.18,      // extra radius at a completely full Living Inventory

  // Brighter and higher-key than the previous 0x6affa8 - cute reads light and fresh,
  // and this stays inside the game's accent identity (--accent: #7cffb2).
  color: 0x8dffc4,
  emissive: 0x2aa86c,
  emissiveIntensity: 0.5,
  // 0.62, not 0.78. At 0.78 the membrane is nearly four-fifths opaque, so the eyes and
  // the Living Inventory suspended behind it were only ~22% visible and washed out to
  // faint smudges. Genuine translucency is the point of the design - things inside have
  // to actually read.
  opacity: 0.62,
  // Glossy, not matte. 0.28 was too dry for something meant to look wet; this lets the
  // key light leave a tight bright highlight, which is a primary cuteness signal.
  roughness: 0.12,
  rimStrength: 0.9,     // fresnel edge brightness - what reads as a cell membrane
  rimPower: 2.2,

  // Fake subsurface. Real jelly is pale and bright where it is thin (the edges) and
  // deeper and more saturated where you look through more of it (the middle). Plain
  // uniform alpha cannot express that, which is why the body currently reads as a
  // coloured balloon rather than as jelly. This tints the CORE - the inverse of the
  // fresnel rim - and costs one dot product, no extra render pass (unlike real
  // transmission, which would blow the mobile budget).
  coreTint: 0x0f8f5e,
  coreStrength: 0.55,
};

// Scratch object for the eye billboard - no per-frame allocation in the update path.
const tempWorldQuat = new THREE.Quaternion();
const tempMeasurePos = new THREE.Vector3();

export const EYE_DEFAULTS = {
  // 2 for the player, 1 for every NPC. That contrast is the cast's identity rule.
  count: 2,
  // <1 squashes the eye vertically into a narrow, hostile shape; 1 is round and cute.
  aspect: 1,
  // Angry eyelid. 0 disables it entirely (the default - the player has none).
  //
  // A lid covering the upper half turns a round eye into an angled semicircle, which is
  // the classic angry read - and it does it WITHOUT changing the eye itself, so the
  // gaze tracking, blink and highlight all keep working underneath exactly as before.
  // The lids are mirrored so the INNER edges drop, which is what makes it read as a
  // scowl rather than as drowsiness.
  lidAngle: 0,
  lidColor: 0x000000,

  // How far the eyeball can shift inside its socket, as a fraction of eye radius.
  gazeRange: 0.42,
  // Lower = laggier, heavier-feeling gaze. Deliberately not instant: eyes that snap
  // exactly to the cursor read as mechanical rather than alive.
  gazeSmoothing: 9.0,

  // Deliberately large relative to the body, set high and close together - the standard
  // baby-schema cues, and the reason this reads as a character rather than a cell.
  radius: 0.30,        // fraction of body radius
  separation: 0.32,    // horizontal gap from centre, fraction of body radius
  height: 0.16,        // vertical offset, fraction of body radius
  // How far toward the camera the eyes sit. They live INSIDE the body (that is the
  // whole point) but need to be near the camera-facing side or the membrane's own
  // thickness tint mutes them into the murk.
  depth: 0.34,

  highlightRadius: 0.34,   // fraction of eye radius - the "wet" dot doing the cuteness work
  highlightOffset: 0.38,   // fraction of eye radius, up and to one side

  // Near-black rather than a dark green: the membrane blends its own bright green over
  // whatever sits behind it, so an iris tinted anywhere near the body colour simply
  // dissolves into it. Maximum value contrast is what keeps the eyes legible through
  // the jelly.
  irisColor: 0x071410,
  // A little self-illumination so the iris punches through the membrane blended in
  // front of it instead of being averaged away.
  irisEmissive: 0x0a2018,
  // Raised well above 1 for creatures whose eyes should read as GLOWING rather than
  // merely dark - the Apex's three red slits are invisible at 1, because the
  // translucent membrane in front of them averages the colour away.
  irisEmissiveIntensity: 1,
  highlightColor: 0xffffff,

  blinkIntervalMin: 2.4,
  blinkIntervalMax: 6.0,
  blinkDuration: 0.13,

  widenDuration: 0.35,   // absorb reaction
  widenAmount: 0.4,
  squintDuration: 0.45,  // damage reaction
  squintAmount: 0.65,

  followLag: 6.0,        // how quickly the eyes settle after the body moves
};

/**
 * Welds duplicate vertices and returns an indexed copy.
 *
 * PolyhedronGeometry (which IcosahedronGeometry extends) emits non-indexed geometry -
 * every triangle owns its own three vertices, so the icosphere below carries 26,460
 * vertices for only ~4,412 distinct positions. That matters a lot here specifically:
 * this shader runs three simplex-noise evaluations per vertex (one for the position,
 * two more for the finite-difference normal), so welding cuts the per-frame vertex
 * cost roughly six-fold. It also makes computeVertexNormals() produce smooth normals
 * rather than faceted ones.
 *
 * three ships exactly this as BufferGeometryUtils.mergeVertices(), but that lives in
 * examples/jsm and would mean a second CDN request. This game already cannot start
 * without a network round-trip for three itself, and a transient jsdelivr failure while
 * developing this file took the whole page down (ERR_CONNECTION_RESET -> main.js never
 * ran). Twenty lines here removes that failure mode entirely, and with GLTFLoader now
 * gone the project depends on nothing outside the three core.
 */
export function weldVertices(geometry, precision = 1e-4) {
  const position = geometry.attributes.position;
  const seen = new Map();
  const positions = [];
  const indices = [];
  const inverse = 1 / precision;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // Quantised key: floats that differ only in the last bits still describe the same
    // corner of the icosphere and must collapse to one vertex.
    const key = `${Math.round(x * inverse)},${Math.round(y * inverse)},${Math.round(z * inverse)}`;
    let index = seen.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      seen.set(key, index);
      positions.push(x, y, z);
    }
    indices.push(index);
  }

  const welded = new THREE.BufferGeometry();
  welded.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  welded.setIndex(indices);
  // UVs are deliberately dropped - this material has no maps, and the shader derives
  // everything it needs from the vertex position alone.
  welded.computeVertexNormals();
  return welded;
}

/**
 * Two eyes suspended INSIDE the body, never attached to the membrane.
 *
 * That placement is the entire design. The membrane is displaced per-vertex by noise,
 * so anything parented to its surface would be dragged and smeared as pseudopods pass
 * underneath - which reads as unsettling rather than cute. Floating inside, the eyes
 * stay perfectly round no matter what the body does, and looking at them THROUGH the
 * jelly is what makes the material read as jelly. It is the same technique the Living
 * Inventory already uses to suspend absorbed resources in the cytoplasm.
 *
 * They are forced to DRAW ON TOP of the membrane (transparent + depthWrite off + a high
 * renderOrder) even though they sit geometrically inside it. Letting them sort normally
 * was tried and fails badly: the membrane's surface is displaced by oscillating lobes,
 * so an eye at a fixed depth is sometimes behind the surface and sometimes poking
 * through it. On screen that produced one solid black eye and one nearly invisible one,
 * flickering between the two states as the lobes moved. Drawing on top makes them
 * unconditionally legible while the geometry stays inside, so they still never distort.
 *
 * Returned group is billboarded at the camera by update() - see the note there.
 */
function createEyes(bodyRadius, eye) {
  const group = new THREE.Group();

  const eyeRadius = bodyRadius * eye.radius;
  // transparent + depthWrite:false puts these in the transparent pass so renderOrder
  // below can force them after the membrane; opacity stays 1 so they are still solid.
  const irisMaterial = new THREE.MeshStandardMaterial({
    color: eye.irisColor,
    emissive: eye.irisEmissive,
    emissiveIntensity: eye.irisEmissiveIntensity,
    roughness: 0.15,
    metalness: 0,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  // Basic, not Standard: the highlight must stay bright regardless of where the scene
  // lights happen to be. A lit highlight that goes dim in a dark corner defeats it.
  const highlightMaterial = new THREE.MeshBasicMaterial({
    color: eye.highlightColor,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });

  const irisGeometry = new THREE.SphereGeometry(eyeRadius, 20, 16);
  const lidGeometry = new THREE.PlaneGeometry(1, 2); // scaled per-eye below
  const lidMaterial = new THREE.MeshBasicMaterial({
    color: eye.lidColor,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const highlightGeometry = new THREE.SphereGeometry(eyeRadius * eye.highlightRadius, 12, 10);

  const eyes = [];
  // One eye sits dead centre; any higher count spaces evenly across the face, so 2
  // gives [-1, 1] and 3 gives [-1, 0, 1]. Zero is valid and means no eyes at all -
  // used by the centipede's body segments, which are just meat.
  const sides = eye.count <= 0
    ? []
    : eye.count === 1
      ? [0]
      : Array.from({ length: eye.count }, (_, i) => -1 + (2 * i) / (eye.count - 1));
  for (const side of sides) {
    // Each eye is wrapped in a pivot so blink/squint can scale the eye WITHOUT moving
    // it - scaling the mesh directly around its own centre keeps it in place, while the
    // pivot holds the position.
    const pivot = new THREE.Group();
    pivot.position.set(
      side * bodyRadius * eye.separation,
      bodyRadius * eye.height,
      bodyRadius * eye.depth
    );

    // Gaze wrapper. The iris and its highlight move together inside the pivot, so the
    // whole eyeball shifts to look around while the pivot keeps holding the eye's
    // position on the face and owning the blink/squint scale.
    const gaze = new THREE.Group();
    pivot.add(gaze);

    const iris = new THREE.Mesh(irisGeometry, irisMaterial);
    gaze.add(iris);

    const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
    // Up and toward the same side on both eyes (not mirrored) - a shared light source
    // would land on the same side of each eye, and mirroring it looks subtly wrong.
    highlight.position.set(
      eyeRadius * eye.highlightOffset * 0.8,
      eyeRadius * eye.highlightOffset,
      eyeRadius * 0.72
    );
    gaze.add(highlight);

    if (eye.lidAngle) {
      const lid = new THREE.Mesh(lidGeometry, lidMaterial);
      // Half-height equals the eye radius and it sits one radius up, so its lower edge
      // crosses the eye's centre - covering exactly the top half.
      // Centre sits at 0.5r, not 1.0r. At a full radius the plane's lower edge only just
      // grazed the eye's centre, so once tilted it rode clear of the eye entirely and
      // read as a pale eyebrow floating above the head rather than a lid on the eye.
      // Half-height 0.9r with the centre at 0.5r pushes the lower edge to -0.4r, biting
      // into the eye so a genuine angled semicircle is left showing beneath it.
      lid.scale.set(eyeRadius * 2.2, eyeRadius * 0.9, 1);
      lid.position.set(0, eyeRadius * 0.5, eyeRadius * 1.15);
      // side * angle drops the inner edge on both eyes: the left eye's +X edge and the
      // right eye's -X edge. Reversing the sign would produce a sad/worried face instead.
      lid.rotation.z = side * eye.lidAngle;
      lid.renderOrder = 12; // above iris (10) and highlight (11)
      // Parented to the PIVOT, not the gaze group, so the eyeball moves around beneath a
      // lid that stays put - which is how a real eye behaves and reads far better than a
      // lid sliding around with the pupil.
      pivot.add(lid);
    }

    group.add(pivot);
    pivot.userData.gaze = gaze;
    eyes.push(pivot);
  }

  // Higher than the membrane's 0, so the eyes always resolve last and are never
  // half-swallowed by a passing lobe. The highlight is higher still so it can never be
  // hidden by its own iris.
  group.renderOrder = 10;
  for (const pivot of eyes) {
    // Indexed through the gaze wrapper, not the pivot: the iris and highlight are
    // children of the gaze group so they can shift together when the eye looks around.
    const [iris, highlight] = pivot.userData.gaze.children;
    iris.renderOrder = 10;
    highlight.renderOrder = 11;
  }

  group.userData.eyes = eyes;
  group.userData.irisMaterial = eyes.length > 0 ? irisMaterial : null;
  return group;
}

// Public-domain 3D simplex noise (Ashima Arts / Stefan Gustavson). Used instead of a
// sum of sines because sines produce visibly axis-aligned, repeating bulges; simplex
// gives lobes that wander without ever settling into a pattern.
const GLSL_SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
      i.z+vec4(0.0,i1.z,i2.z,1.0))
    + i.y+vec4(0.0,i1.y,i2.y,1.0))
    + i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

/**
 * The displacement function, shared by the vertex position and by the finite-difference
 * normal recomputation below (which is why it is a function rather than inline code -
 * the two MUST use identical maths or the lighting will not match the silhouette).
 *
 * `dir` is the unit direction of the vertex from the body centre.
 *
 * The tail term needs no direction uniform: PlayerController yaws the player root to
 * face the direction of travel every frame, so in this mesh's local space "backward"
 * is always +Z. Only a speed scalar has to be passed in.
 */
const GLSL_DISPLACE = /* glsl */ `
// baseRadius MUST be passed in rather than assumed to be 1. dir is normalized, so
// multiplying it by (1.0 + radial) alone would push every vertex out to unit radius and
// silently resize the body - which is exactly what happened on the first attempt: the
// amoeba rendered at radius 1.0 instead of PLAYER_RADIUS 0.6, roughly 67% oversized.
vec3 amoebaDisplace(vec3 dir, float baseRadius) {
  float lobes = snoise(dir * uLobeFrequency + vec3(0.0, 0.0, uTime * uLobeSpeed));
  float fine  = snoise(dir * uDetailFrequency + vec3(uTime * uDetailSpeed, 0.0, 0.0));

  // Gain first, THEN shape - see uLobeGain's note. Without the gain the pow() below
  // only attenuates, because snoise never actually reaches 1.
  float gained = clamp(lobes * uLobeGain, -1.0, 1.0);
  float outward = pow(max(gained, 0.0), uLobeSharpness);
  float inward = max(-gained, 0.0) * uInwardFactor;
  float shaped = outward - inward;

  // Lobes retract as the cell speeds up - a moving amoeba streamlines.
  float calm = 1.0 - uSpeedRatio * uStreamlining;
  float radial = shaped * uLobeAmplitude * calm + fine * uDetailAmplitude * calm;

  // A full Living Inventory visibly swells the whole cell.
  radial += uLoad * uLoadSwell;

  vec3 displaced = dir * (baseRadius * (1.0 + radial));

  // Tail: only the rear half responds (backness is clamped at 0), squared so the
  // stretch concentrates at the very back instead of dragging the middle with it.
  // Scaled by baseRadius so the tail stays proportional to the body.
  float backness = max(0.0, dir.z);
  float tail = backness * backness * uTailLength * uSpeedRatio * baseRadius;
  displaced.z += tail;

  // Narrow the tail's cross-section so it tapers to a point rather than stretching
  // as a blunt cylinder.
  displaced.xy *= 1.0 - backness * uSpeedRatio * uTailPinch;

  return displaced;
}
`;

/**
 * Applies just the FRAGMENT half of the amoeba's jelly look - the thickness tint (fake
 * subsurface: pale at the silhouette, deeper/saturated through the middle) and the
 * fresnel rim glow added to emissive - to an arbitrary existing MeshStandardMaterial,
 * without the vertex displacement above.
 *
 * Exists for imported character meshes (see playerSlimeModel.js) that have their own
 * fixed, artist-authored shape: running the lobe-displacement noise over their vertices
 * would melt that shape, but the material-only glassy/translucent treatment is exactly
 * what "read as jelly" actually depends on, and applies to any geometry unchanged.
 *
 * Mutates and returns `material`. Chains onto any onBeforeCompile the material already
 * has (rather than overwriting it) so this can layer on top of, e.g., a caller's own map
 * setup without either clobbering the other.
 */
export function applyJellyRimTreatment(material, options = {}) {
  const uniforms = {
    uRimStrength: { value: options.rimStrength ?? SLIME_DEFAULTS.rimStrength },
    uRimPower: { value: options.rimPower ?? SLIME_DEFAULTS.rimPower },
    uCoreTint: { value: new THREE.Color(options.coreTint ?? SLIME_DEFAULTS.coreTint) },
    uCoreStrength: { value: options.coreStrength ?? SLIME_DEFAULTS.coreStrength },
  };

  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform vec3 uCoreTint;
        uniform float uCoreStrength;
        `
      )
      // Same thickness-tint trick as amoebaDisplace's fragment half above - see that
      // function's comment for why this is a per-pixel dot product rather than real
      // transmission.
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        float jellyFacing = saturate(dot(normalize(vNormal), normalize(vViewPosition)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uCoreTint, jellyFacing * uCoreStrength);
        `
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        float jellyFresnel = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), uRimPower);
        totalEmissiveRadiance += emissive * jellyFresnel * uRimStrength;
        `
      );
  };
  // Distinct key from the amoeba's own ('hollowdrop-amoeba') - different injected code,
  // and unlike the amoeba this compiles onto whatever base chunks the caller's own maps
  // (normalMap, roughnessMap, etc.) already pulled in, which the amoeba's material never had.
  material.customProgramCacheKey = () => 'hollowdrop-jelly-rim';
  material.needsUpdate = true;
  return material;
}

/**
 * Applies the VERTEX half of the amoeba's jelly look - the same lobe/pseudopod noise
 * displacement and speed-driven tail stretch amoebaDisplace() above uses - to an
 * arbitrary existing MeshStandardMaterial, for callers who DO want the imported mesh's
 * surface to actually wobble rather than just its material reading as glassy (see
 * applyJellyRimTreatment for the material-only version, and its own comment for why that
 * one exists separately).
 *
 * Works on non-spherical geometry because the displacement is expressed as a
 * PROPORTIONAL push along each vertex's own direction/distance from the mesh's local
 * origin, not an absolute radius - centering the mesh at its own bounding-box center
 * (see gltfCharacterLoader.js) is what makes "direction from origin" a sane per-vertex
 * basis for an arbitrary artist-authored shape. It will still read differently than on
 * the amoeba's own icosphere: a lower-density or very unevenly-shaped mesh will show the
 * noise less smoothly, and concave regions can self-intersect under enough amplitude -
 * this is why the defaults below are much gentler than SLIME_DEFAULTS.
 *
 * Chains onto any onBeforeCompile the material already has (rather than overwriting it),
 * the same way applyJellyRimTreatment does, so both can be layered on the same material
 * regardless of which is applied first.
 *
 * @returns {{ uniforms, update: (deltaTime, speedRatio, load) => void }} - caller must
 *   tick `update()` every frame (see playerSlimeModel.js) since, unlike createSlimeCreature's
 *   own creature object, this has no update loop of its own to hook into.
 */
export function applyJellyDisplacement(material, options = {}) {
  const cfg = { ...SLIME_DEFAULTS, ...options };
  const uniforms = options.uniforms || {
    uTime: { value: 0 },
    uSpeedRatio: { value: 0 },
    uLoad: { value: 0 },
    uLobeFrequency: { value: cfg.lobeFrequency },
    uLobeSpeed: { value: cfg.lobeSpeed },
    uLobeAmplitude: { value: cfg.lobeAmplitude },
    uLobeGain: { value: cfg.lobeGain },
    uLobeSharpness: { value: cfg.lobeSharpness },
    uInwardFactor: { value: cfg.inwardFactor },
    uDetailFrequency: { value: cfg.detailFrequency },
    uDetailSpeed: { value: cfg.detailSpeed },
    uDetailAmplitude: { value: cfg.detailAmplitude },
    uTailLength: { value: cfg.tailLength },
    uTailPinch: { value: cfg.tailPinch },
    uStreamlining: { value: cfg.streamlining },
    uLoadSwell: { value: cfg.loadSwell },
  };

  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uSpeedRatio;
        uniform float uLoad;
        uniform float uLobeFrequency;
        uniform float uLobeSpeed;
        uniform float uLobeAmplitude;
        uniform float uLobeGain;
        uniform float uLobeSharpness;
        uniform float uInwardFactor;
        uniform float uDetailFrequency;
        uniform float uDetailSpeed;
        uniform float uDetailAmplitude;
        uniform float uTailLength;
        uniform float uTailPinch;
        uniform float uStreamlining;
        uniform float uLoadSwell;
        ${GLSL_SIMPLEX}
        ${GLSL_DISPLACE}
        `
      )
      // Same ordering requirement as amoebaDisplace's own use above - beginnormal_vertex
      // runs before begin_vertex, so all the work happens here and begin_vertex just
      // consumes amoebaPos.
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        vec3 amoebaDir = normalize(position);
        float amoebaRadius = length(position);
        vec3 amoebaPos = amoebaDisplace(amoebaDir, amoebaRadius);

        vec3 amoebaTangent = normalize(abs(amoebaDir.y) < 0.99
          ? cross(vec3(0.0, 1.0, 0.0), amoebaDir)
          : vec3(1.0, 0.0, 0.0));
        vec3 amoebaBitangent = cross(amoebaDir, amoebaTangent);
        float amoebaEps = 0.035;
        vec3 amoebaPA = amoebaDisplace(normalize(amoebaDir + amoebaTangent * amoebaEps), amoebaRadius);
        vec3 amoebaPB = amoebaDisplace(normalize(amoebaDir + amoebaBitangent * amoebaEps), amoebaRadius);
        vec3 objectNormal = normalize(cross(amoebaPA - amoebaPos, amoebaPB - amoebaPos));
        objectNormal *= sign(dot(objectNormal, amoebaDir));
        `
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = amoebaPos;');
  };
  material.customProgramCacheKey = () => 'hollowdrop-jelly-displace';
  material.needsUpdate = true;

  return {
    uniforms,
    update(deltaTime, speedRatio = 0, load = 0) {
      uniforms.uTime.value += deltaTime;
      uniforms.uSpeedRatio.value = THREE.MathUtils.clamp(speedRatio, 0, 1);
      uniforms.uLoad.value = THREE.MathUtils.clamp(load, 0, 1);
    },
  };
}

/**
 * Builds the amoeba. Synchronous by design - there is no asset to fetch, so unlike the
 * imported model this replaces there is no placeholder-then-swap dance for main.js.
 *
 * @returns {{ group: THREE.Group, bodyMaterial: THREE.MeshStandardMaterial, update: Function }}
 *          `bodyMaterial` satisfies PlayerController's contract (.emissive /
 *          .emissiveIntensity / .opacity, transparent). `update` feeds the uniforms.
 */
export function createSlimeCreature(options = {}) {
  const cfg = { ...SLIME_DEFAULTS, ...options };
  const eye = { ...EYE_DEFAULTS, ...(options.eye || {}) };
  const radius = cfg.radius;
  // Icosphere, NOT SphereGeometry: a UV sphere's poles converge to a single point, and
  // this game's camera looks down at the top pole from almost directly above, so the
  // pinching that displacement causes there would be permanently in view. An icosphere
  // has near-uniform triangle area with no poles at all.
  // PolyhedronGeometry emits non-indexed geometry (every triangle owns its vertices),
  // which shades flat; mergeVertices welds the seams so computeVertexNormals can
  // produce smooth normals.
  // Callers with many bodies (the centipede) pass one shared geometry rather than
  // paying for an icosphere per segment - at detail 20 that would be 8,820 triangles
  // each, more than the entire model this system replaced.
  let geometry = cfg.geometry;
  if (!geometry) {
    const raw = new THREE.IcosahedronGeometry(radius, cfg.detail);
    geometry = weldVertices(raw);
    raw.dispose();
  }

  const uniforms = {
    uTime: { value: 0 },
    uSpeedRatio: { value: 0 },
    uLoad: { value: 0 },
    uLobeFrequency: { value: cfg.lobeFrequency },
    uLobeSpeed: { value: cfg.lobeSpeed },
    uLobeAmplitude: { value: cfg.lobeAmplitude },
    uLobeGain: { value: cfg.lobeGain },
    uLobeSharpness: { value: cfg.lobeSharpness },
    uInwardFactor: { value: cfg.inwardFactor },
    uDetailFrequency: { value: cfg.detailFrequency },
    uDetailSpeed: { value: cfg.detailSpeed },
    uDetailAmplitude: { value: cfg.detailAmplitude },
    uTailLength: { value: cfg.tailLength },
    uTailPinch: { value: cfg.tailPinch },
    uStreamlining: { value: cfg.streamlining },
    uLoadSwell: { value: cfg.loadSwell },
    uRimStrength: { value: cfg.rimStrength },
    uRimPower: { value: cfg.rimPower },
    uCoreTint: { value: new THREE.Color(cfg.coreTint) },
    uCoreStrength: { value: cfg.coreStrength },
  };

  const material = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.emissive,
    emissiveIntensity: cfg.emissiveIntensity,
    roughness: cfg.roughness,
    metalness: 0,
    transparent: true,
    opacity: cfg.opacity,
    // Without this, the membrane's own far side and the Living Inventory items parented
    // inside the body get depth-rejected and vanish - the interior has to stay visible.
    depthWrite: false,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uSpeedRatio;
        uniform float uLoad;
        uniform float uLobeFrequency;
        uniform float uLobeSpeed;
        uniform float uLobeAmplitude;
        uniform float uLobeGain;
        uniform float uLobeSharpness;
        uniform float uInwardFactor;
        uniform float uDetailFrequency;
        uniform float uDetailSpeed;
        uniform float uDetailAmplitude;
        uniform float uTailLength;
        uniform float uTailPinch;
        uniform float uStreamlining;
        uniform float uLoadSwell;
        ${GLSL_SIMPLEX}
        ${GLSL_DISPLACE}
        `
      )
      // ORDER MATTERS. In three's vertex shader `beginnormal_vertex` (which declares
      // objectNormal) runs BEFORE `begin_vertex` (which declares transformed). So all
      // the work happens in the normal hook - the earlier of the two - and the position
      // hook below only consumes the result. Computing the displacement in begin_vertex
      // and referring to it from the normal chunks fails to compile with
      // "'amoebaNormal' : undeclared identifier".
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        vec3 amoebaDir = normalize(position);
        // The geometry's own radius, read from the vertex rather than assumed - this is
        // what keeps the body at PLAYER_RADIUS instead of unit scale.
        float amoebaRadius = length(position);
        vec3 amoebaPos = amoebaDisplace(amoebaDir, amoebaRadius);

        // Recomputed normals. Displacing positions without this leaves the lighting
        // still describing a smooth sphere while the silhouette is lumpy - the lobes
        // would show only as an outline and the body would read flat, which is the
        // exact problem this whole change exists to fix. Two tangents are built from
        // the original direction, nudged, pushed through the SAME displacement
        // function, and crossed.
        vec3 amoebaTangent = normalize(abs(amoebaDir.y) < 0.99
          ? cross(vec3(0.0, 1.0, 0.0), amoebaDir)
          : vec3(1.0, 0.0, 0.0));
        vec3 amoebaBitangent = cross(amoebaDir, amoebaTangent);
        float amoebaEps = 0.035;
        vec3 amoebaPA = amoebaDisplace(normalize(amoebaDir + amoebaTangent * amoebaEps), amoebaRadius);
        vec3 amoebaPB = amoebaDisplace(normalize(amoebaDir + amoebaBitangent * amoebaEps), amoebaRadius);
        vec3 objectNormal = normalize(cross(amoebaPA - amoebaPos, amoebaPB - amoebaPos));
        // The cross product's winding flips depending on which hemisphere the vertex
        // sits in; align it outward so the lighting is never inverted.
        objectNormal *= sign(dot(objectNormal, amoebaDir));
        `
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = amoebaPos;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform vec3 uCoreTint;
        uniform float uCoreStrength;
        `
      )
      // Thickness tint (fake subsurface). Real jelly is pale where you look through
      // little of it and deeper where you look through a lot, so the edges read light
      // and the middle reads saturated. Uniform alpha cannot express that, which is
      // why a plain transparent sphere looks like a coloured balloon rather than jelly.
      // `facing` is the inverse of the fresnel term below: 1 in the middle of the body,
      // 0 at the silhouette. Applied to diffuseColor BEFORE lighting so it darkens and
      // saturates the material itself rather than glowing.
      //
      // Real refraction (MeshPhysicalMaterial transmission) would do this properly, but
      // it forces an extra full scene render pass every frame - unaffordable on the
      // phones this game targets. This costs one dot product.
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        float amoebaFacing = saturate(dot(normalize(vNormal), normalize(vViewPosition)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uCoreTint, amoebaFacing * uCoreStrength);
        `
      )
      // Fresnel rim, added to the emissive term so it survives the standard lighting
      // pipeline and so PlayerController's hit-flash/health-tint (which write
      // .emissive) still visibly modulate the edge along with the body.
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        float amoebaFresnel = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), uRimPower);
        totalEmissiveRadiance += emissive * amoebaFresnel * uRimStrength;
        `
      );
  };

  // Changing onBeforeCompile after a material has been used requires a new program key;
  // set here so three treats this as its own shader variant.
  material.customProgramCacheKey = () => 'hollowdrop-amoeba';

  const mesh = new THREE.Mesh(geometry, material);
  // Applied to the MESH, never the group: the group also carries the eyes, and scaling
  // that would squash them along with the body. This is what turns one shared icosphere
  // into a long low Stalker or a squat domed Beetle without new geometry.
  mesh.scale.set(cfg.bodyScale[0], cfg.bodyScale[1], cfg.bodyScale[2]);

  // Foliage-Gated Occlusion Boundary Ring: renders under tree leaves, 0% on ground
  const occlusion = attachOcclusionOutline(mesh, {
    color: cfg.color,
    rimColor: options.occlusionRimColor || 0xffffff,
    opacity: 0.92,
    emissiveIntensity: 2.8,
    rimStrength: 3.4,
    rimPower: 1.8,
    innerAlpha: 0.22,
    uniforms,
    hasDisplacement: true,
  });

  const group = new THREE.Group();
  group.add(mesh);

  const eyeGroup = createEyes(radius, eye);
  group.add(eyeGroup);

  let elapsed = 0;
  // Self-measured speed. Creature controllers already move their meshes every frame, so
  // rather than threading a speedRatio in from four different controllers this reads the
  // group's own world-position delta. Keeps the whole feature inside the model layer -
  // no controller needs to know the shader exists.
  const lastWorldPos = new THREE.Vector3();
  let hasLastPos = false;

  // Legs/antennae, attached by the caller after construction (they belong to the
  // creature's own model file, not to the shared body).
  let limbs = null;

  // Gaze state. Target is set by callers; current chases it so the eyes drift rather
  // than snap.
  const targetGaze = { x: 0, y: 0 };
  const currentGaze = { x: 0, y: 0 };
  const bodyRadiusForGaze = radius;

  let blinkCountdown = eye.blinkIntervalMin;
  let blinkTime = null;  // null = not blinking
  let widenTime = null;
  let squintTime = null;

  const nextBlinkDelay = () =>
    eye.blinkIntervalMin + Math.random() * (eye.blinkIntervalMax - eye.blinkIntervalMin);

  /**
   * Registers appendages for the shared gait. Pivot groups only - the animation rotates
   * the pivot, so each limb swings from its attachment point rather than sliding.
   *
   * This exists because the old cast built legs and then never moved them: PreyManager
   * writes only position, rotation.y and scale, so the Glow Beetle's legs were pure
   * decoration and the creature read as a sliding statue. One shared gait fixes that for
   * every creature at once.
   */
  function attachLimbs({ legs = [], antennae = [] } = {}) {
    limbs = { legs, antennae };
  }

  function updateLimbs() {
    if (!limbs) return;
    const speed = uniforms.uSpeedRatio.value;
    // Gait accelerates with actual travel speed, so a stalking creature creeps and a
    // charging one scrabbles - both driven by the same self-measured velocity the body
    // deformation already uses.
    const gaitRate = 2.5 + speed * 14;
    const swing = 0.18 + speed * 0.55;
    for (let i = 0; i < limbs.legs.length; i++) {
      // Alternating phase so opposite legs are never in step - the difference between a
      // walk cycle and a twitch.
      const phase = i * Math.PI * 0.7;
      limbs.legs[i].rotation.x = Math.sin(elapsed * gaitRate + phase) * swing;
    }
    for (let i = 0; i < limbs.antennae.length; i++) {
      limbs.antennae[i].rotation.z = Math.sin(elapsed * 1.7 + i * 1.4) * 0.2;
      limbs.antennae[i].rotation.x = Math.cos(elapsed * 1.1 + i) * 0.12;
    }
  }

  /** Brief eye-widen. Wired to the absorb pulse in main.js - the "toy-like joy of
   *  absorbing items" the design doc names as the Stage 1 hook. */
  function triggerWiden() {
    widenTime = 0;
  }

  /** Brief squint. Wired to playerHealth.onDamaged. */
  function triggerSquint() {
    squintTime = 0;
  }

  function updateEyes(deltaTime, camera) {
    // Billboard. The player root yaws to face direction of travel, so eyes fixed to the
    // body would turn away from the camera whenever the player moves up-screen - losing
    // the face for a large share of play. Countering the parent's world rotation keeps
    // them readable from every heading. quaternion (not lookAt) so the body's squash and
    // lean can't tilt them.
    if (camera) {
      eyeGroup.quaternion.copy(camera.quaternion);
      group.getWorldQuaternion(tempWorldQuat);
      tempWorldQuat.invert();
      eyeGroup.quaternion.premultiply(tempWorldQuat);
    }

    // Blink: a plain countdown, then a quick close-and-open. The single cheapest cue
    // that something is alive rather than rendered.
    if (blinkTime === null) {
      blinkCountdown -= deltaTime;
      if (blinkCountdown <= 0) {
        blinkTime = 0;
        blinkCountdown = nextBlinkDelay();
      }
    } else {
      blinkTime += deltaTime;
      if (blinkTime >= eye.blinkDuration) blinkTime = null;
    }

    // A blink is a full close and reopen, so the lid factor is a triangle over the
    // duration: 1 -> 0 -> 1.
    let lid = 1;
    if (blinkTime !== null) {
      const t = blinkTime / eye.blinkDuration;
      lid = Math.abs(t - 0.5) * 2;
    }

    let widen = 0;
    if (widenTime !== null) {
      widenTime += deltaTime;
      if (widenTime >= eye.widenDuration) widenTime = null;
      else widen = Math.sin((1 - widenTime / eye.widenDuration) * Math.PI) * eye.widenAmount;
    }

    let squint = 0;
    if (squintTime !== null) {
      squintTime += deltaTime;
      if (squintTime >= eye.squintDuration) squintTime = null;
      else squint = (1 - squintTime / eye.squintDuration) * eye.squintAmount;
    }

    // Gaze. `gazeTarget` is a normalised screen-space direction (-1..1 on each axis)
    // supplied by the caller; because the eye group is billboarded at the camera, its
    // local X/Y already line up with screen X/Y, so the direction can be applied
    // directly with no projection maths here.
    const gazeLerp = 1 - Math.exp(-eye.gazeSmoothing * deltaTime);
    currentGaze.x += (targetGaze.x - currentGaze.x) * gazeLerp;
    currentGaze.y += (targetGaze.y - currentGaze.y) * gazeLerp;
    const gazeDist = eye.radius * bodyRadiusForGaze * eye.gazeRange;

    // One combined write per eye, same "recompute fresh every frame, never accumulate"
    // rule the rest of this project follows for stacked modifiers.
    const scaleXZ = 1 + widen;
    // eye.aspect is the resting shape: 1 is round, below 1 is a narrow hostile slit.
    const scaleY = Math.max(0.02, eye.aspect * lid * (1 + widen) * (1 - squint));
    for (const eyePivot of eyeGroup.userData.eyes) {
      eyePivot.scale.set(scaleXZ, scaleY, scaleXZ);
      eyePivot.userData.gaze.position.set(currentGaze.x * gazeDist, currentGaze.y * gazeDist, 0);
    }
  }

  /**
   * @param deltaTime  seconds; pass REAL delta so the membrane keeps living during hitstop
   * @param speedRatio 0..1, current speed over PLAYER_MAX_SPEED - drives tail + streamlining
   * @param load       0..1, Living Inventory fullness - swells the cell
   * @param camera     needed to billboard the eyes; omit and they stay body-fixed
   */
  function update(deltaTime, { speedRatio = null, load = 0, camera = null, gaze = null } = {}) {
    if (gaze) {
      targetGaze.x = THREE.MathUtils.clamp(gaze.x, -1, 1);
      targetGaze.y = THREE.MathUtils.clamp(gaze.y, -1, 1);
    }
    elapsed += deltaTime;
    uniforms.uTime.value = elapsed;

    // An explicit speedRatio wins (the player passes its own, which is already computed
    // for movement feel); otherwise derive it from how far the body actually moved.
    let ratio = speedRatio;
    if (ratio === null) {
      group.getWorldPosition(tempMeasurePos);
      if (!hasLastPos) {
        hasLastPos = true;
        ratio = 0;
      } else {
        const travelled = tempMeasurePos.distanceTo(lastWorldPos);
        ratio = deltaTime > 0 ? travelled / deltaTime / cfg.maxSpeed : 0;
      }
      lastWorldPos.copy(tempMeasurePos);
    }
    uniforms.uSpeedRatio.value = THREE.MathUtils.clamp(ratio, 0, 1);
    uniforms.uLoad.value = THREE.MathUtils.clamp(load, 0, 1);
    updateEyes(deltaTime, camera);
    updateLimbs();
  }

  const creature = {
    group, bodyMaterial: material, eyeGroup,
    // The iris material, surfaced because several controllers brighten "the eye" as a
    // threat cue (PredatorController ramps it on CHASE, ApexController on phase 2).
    eyeMaterial: eyeGroup.userData.irisMaterial,
    update, attachLimbs, triggerWiden, triggerSquint, uniforms,
  };

  // NPCs tick themselves via updateSlimeCreatures(); the player opts out because main.js
  // drives it explicitly (it has the camera for the eye billboard and the burden load).
  if (cfg.autoUpdate !== false) activeCreatures.add(creature);

  return creature;
}

// Every auto-updating creature. A Set rather than an array so removal on death is O(1).
const activeCreatures = new Set();

/**
 * Registers an arbitrary per-frame updater alongside the creatures.
 *
 * Exists for rigs that are more than one body - the centipede boss needs a chain-follow
 * pass that moves its segments, and that has to run every frame in the same sweep. It
 * carries a `group` for the same reason creatures do: the parent link is what tells the
 * sweep the thing has left the scene and can be dropped.
 */
export function registerSlimeUpdater(entry) {
  activeCreatures.add(entry);
  return entry;
}

/**
 * Ticks every self-updating slime creature. Called once per frame from main.js.
 *
 * Creatures whose group has been detached from the scene (a dead beetle removed by
 * PreyManager, everything cleared by resetGame) are dropped here rather than needing
 * every controller to remember to deregister - the parent link is already the
 * authoritative "is this still in the world" signal.
 */
export function updateSlimeCreatures(deltaTime) {
  for (const creature of activeCreatures) {
    if (!creature.group.parent) {
      activeCreatures.delete(creature);
      continue;
    }
    creature.update(deltaTime);
  }
}
