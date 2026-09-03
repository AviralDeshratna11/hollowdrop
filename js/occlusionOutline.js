import * as THREE from 'three';

/**
 * Foliage-Gated Occlusion Highlight Shader System
 *
 * Renders a crisp, glowing bioluminescent boundary ring & X-ray silhouette of entities
 * EXCLUSIVELY when masked/occluded underneath tree canopy foliage (leaves).
 *
 * Mechanism:
 * 1. Tree canopy leaves render in the opaque pass and write 1 to the hardware Stencil Buffer (ReplaceStencilOp).
 * 2. Ground, rocks, trunks, and all other environment objects have stencilWrite: false (stencil remains 0).
 * 3. The Occlusion Highlight Shader uses:
 *    - stencilFunc: THREE.EqualStencilFunc (ref: 1) -> STRICTLY discards any pixel not on tree leaves.
 *    - depthFunc: THREE.GreaterDepth -> Renders ONLY where the slime/entity is occluded behind the leaves.
 *    - depthWrite: false, transparent: true, renderOrder: 9999 -> Draws the glowing boundary ring cleanly over foliage.
 *
 * Result:
 * - 0% activation on ground, terrain slopes, rocks, or open air (stencil is 0 everywhere except tree leaves).
 * - 100% pixel-perfect boundary ring and silhouette highlight under tree leaves with zero CPU overhead.
 */

// Public-domain 3D simplex noise (Ashima Arts / Stefan Gustavson)
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

const GLSL_DISPLACE = /* glsl */ `
vec3 amoebaDisplace(vec3 dir, float baseRadius) {
  float lobes = snoise(dir * uLobeFrequency + vec3(0.0, 0.0, uTime * uLobeSpeed));
  float fine  = snoise(dir * uDetailFrequency + vec3(uTime * uDetailSpeed, 0.0, 0.0));

  float gained = clamp(lobes * uLobeGain, -1.0, 1.0);
  float outward = pow(max(gained, 0.0), uLobeSharpness);
  float inward = max(-gained, 0.0) * uInwardFactor;
  float shaped = outward - inward;

  float calm = 1.0 - uSpeedRatio * uStreamlining;
  float radial = shaped * uLobeAmplitude * calm + fine * uDetailAmplitude * calm;

  radial += uLoad * uLoadSwell;

  vec3 displaced = dir * (baseRadius * (1.0 + radial));

  float backness = max(0.0, dir.z);
  float tail = backness * backness * uTailLength * uSpeedRatio * baseRadius;
  displaced.z += tail;

  displaced.xy *= 1.0 - backness * uSpeedRatio * uTailPinch;

  return displaced;
}
`;

const OCCLUSION_VERTEX_SHADER_DISPLACED = /* glsl */ `
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
uniform float uExpandOffset;

varying vec3 vNormal;
varying vec3 vViewPosition;

${GLSL_SIMPLEX}
${GLSL_DISPLACE}

void main() {
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

  // Slight outward expansion along normal so the boundary ring is crisp along the outer edge
  vec3 finalPos = amoebaPos + objectNormal * uExpandOffset;

  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  vViewPosition = -mvPosition.xyz;
  vNormal = normalMatrix * objectNormal;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const OCCLUSION_VERTEX_SHADER_STATIC = /* glsl */ `
uniform float uExpandOffset;
varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 finalPos = position + normal * uExpandOffset;
  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  vViewPosition = -mvPosition.xyz;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Same silhouette as the static shader, but the vertex is pushed through the skeleton
// first. Needed because attachOcclusionOutline builds a SECOND mesh sharing the target's
// geometry: on a rigged character that copy has no skinning of its own, so with the
// static shader it would hang in bind pose while the real body walked out from under it.
// three prepends `#define USE_SKINNING` (and the skinIndex/skinWeight attributes) for any
// object whose .isSkinnedMesh is true, so these chunks light up automatically - the
// outline just has to be a real SkinnedMesh bound to the same Skeleton, which
// attachOcclusionOutline now does.
const OCCLUSION_VERTEX_SHADER_SKINNED = /* glsl */ `
uniform float uExpandOffset;
varying vec3 vNormal;
varying vec3 vViewPosition;

#include <common>
#include <skinning_pars_vertex>

void main() {
  vec3 objectNormal = normal;
  vec3 transformed = position;

  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>

  vec3 skinnedNormal = normalize(objectNormal);
  vec3 finalPos = transformed + skinnedNormal * uExpandOffset;
  vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
  vViewPosition = -mvPosition.xyz;
  vNormal = normalMatrix * skinnedNormal;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const OCCLUSION_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uOpacity;
uniform float uEmissiveIntensity;
uniform float uRimStrength;
uniform float uRimPower;
uniform float uInnerAlpha;
uniform float uTime;

varying vec3 vNormal;
varying vec3 vViewPosition;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vViewPosition);

  // Fresnel boundary term: 1.0 at glancing edges (perimeter), 0.0 facing camera
  float NdotV = clamp(dot(normal, viewDir), 0.0, 1.0);
  float rim = 1.0 - NdotV;

  // Crisp perimeter ring curve
  float boundaryRing = pow(rim, uRimPower) * uRimStrength;

  // Soft volumetric inner body fill
  float innerFill = uInnerAlpha * (1.0 - pow(rim, 1.4));

  float totalAlpha = clamp((boundaryRing + innerFill) * uOpacity, 0.0, 1.0);
  if (totalAlpha < 0.003) discard;

  // Living bioluminescent pulse
  float pulse = 0.94 + 0.06 * sin(uTime * 3.0);

  // Rim gradient: ring edge is tinted with uRimColor, core with uColor
  vec3 finalColor = mix(uColor, uRimColor, clamp(boundaryRing * 0.7, 0.0, 1.0));
  finalColor *= uEmissiveIntensity * pulse;

  gl_FragColor = vec4(finalColor, totalAlpha);
}
`;

/**
 * Creates the Stencil & Depth-gated occlusion highlight material.
 * @param {object} [options]
 * @param {number|THREE.Color} [options.color=0x8dffc4] - Base silhouette glow color
 * @param {number|THREE.Color} [options.rimColor=0xffffff] - Fresnel edge highlight color
 * @param {number} [options.opacity=0.92] - Resting opacity
 * @param {number} [options.emissiveIntensity=2.6] - Core glow intensity
 * @param {number} [options.rimStrength=3.2] - Silhouette rim brightness
 * @param {number} [options.rimPower=1.8] - Fresnel curve exponent
 * @param {number} [options.innerAlpha=0.22] - Translucent inner volume fill alpha
 * @param {number} [options.expandOffset=0.015] - Outward normal expansion for outer boundary ring
 * @param {boolean} [options.hasDisplacement=false] - Whether geometry uses vertex displacement
 * @param {boolean} [options.skinned=false] - Whether the mesh this material draws on is a
 *   SkinnedMesh (selects the skinning vertex shader; mutually exclusive with hasDisplacement)
 * @param {object} [options.uniforms] - Existing uniforms object to share
 * @returns {THREE.ShaderMaterial}
 */
export function createOcclusionMaterial(options = {}) {
  const baseColor = new THREE.Color(options.color ?? 0x8dffc4);
  const rimColor = new THREE.Color(options.rimColor ?? 0xffffff);
  const hasDisplacement = !!options.hasDisplacement;
  const isSkinned = !hasDisplacement && !!options.skinned;

  const defaultUniforms = {
    uColor: { value: baseColor },
    uRimColor: { value: rimColor },
    uOpacity: { value: options.opacity ?? 0.92 },
    uEmissiveIntensity: { value: options.emissiveIntensity ?? 2.6 },
    uRimStrength: { value: options.rimStrength ?? 3.2 },
    uRimPower: { value: options.rimPower ?? 1.8 },
    uInnerAlpha: { value: options.innerAlpha ?? 0.22 },
    uExpandOffset: { value: options.expandOffset ?? 0.015 },
    uTime: { value: 0 },
  };

  if (hasDisplacement) {
    defaultUniforms.uSpeedRatio = { value: 0 };
    defaultUniforms.uLoad = { value: 0 };
    defaultUniforms.uLobeFrequency = { value: 0.9 };
    defaultUniforms.uLobeSpeed = { value: 0.30 };
    defaultUniforms.uLobeAmplitude = { value: 0.24 };
    defaultUniforms.uLobeGain = { value: 1.4 };
    defaultUniforms.uLobeSharpness = { value: 1.0 };
    defaultUniforms.uInwardFactor = { value: 0.25 };
    defaultUniforms.uDetailFrequency = { value: 2.2 };
    defaultUniforms.uDetailSpeed = { value: 0.5 };
    defaultUniforms.uDetailAmplitude = { value: 0.008 };
    defaultUniforms.uTailLength = { value: 0.7 };
    defaultUniforms.uTailPinch = { value: 0.55 };
    defaultUniforms.uStreamlining = { value: 0.6 };
    defaultUniforms.uLoadSwell = { value: 0.18 };
  }

  // If caller provided existing uniforms (e.g. from slimeCreature), link them
  const uniforms = options.uniforms
    ? { ...defaultUniforms, ...options.uniforms, uColor: defaultUniforms.uColor, uRimColor: defaultUniforms.uRimColor, uExpandOffset: defaultUniforms.uExpandOffset, uRimStrength: defaultUniforms.uRimStrength, uRimPower: defaultUniforms.uRimPower, uInnerAlpha: defaultUniforms.uInnerAlpha, uEmissiveIntensity: defaultUniforms.uEmissiveIntensity, uOpacity: defaultUniforms.uOpacity }
    : defaultUniforms;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: hasDisplacement
      ? OCCLUSION_VERTEX_SHADER_DISPLACED
      : (isSkinned ? OCCLUSION_VERTEX_SHADER_SKINNED : OCCLUSION_VERTEX_SHADER_STATIC),
    fragmentShader: OCCLUSION_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    // GreaterDepth ensures it renders ONLY where occluded behind/under objects
    depthFunc: THREE.GreaterDepth,
    // Stencil test strictly gates rendering to pixels where stencil == 1 (Tree Canopy Leaves ONLY)
    // In Three.js, stencilWrite MUST BE TRUE to enable gl.STENCIL_TEST.
    // stencilWriteMask: 0x00 prevents writing/modifying the stencil buffer while allowing testing!
    stencilWrite: true,
    stencilWriteMask: 0x00,
    stencilRef: 1,
    stencilFunc: THREE.EqualStencilFunc,
    stencilFuncMask: 0xFF,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
  });

  return mat;
}

/**
 * Attaches a foliage-gated occlusion highlight mesh (or hierarchy) to the target object.
 * @param {THREE.Object3D} target
 * @param {object} [options]
 * @returns {{ mesh: THREE.Object3D, material: THREE.ShaderMaterial|THREE.ShaderMaterial[], update: Function, dispose: Function }}
 */
export function attachOcclusionOutline(target, options = {}) {
  if (!target) return null;

  // Single mesh target
  if (target.isMesh) {
    const mat = createOcclusionMaterial(options);
    const outlineMesh = new THREE.Mesh(target.geometry, mat);
    outlineMesh.renderOrder = 9999;
    outlineMesh.frustumCulled = false;
    target.add(outlineMesh);

    return {
      mesh: outlineMesh,
      material: mat,
      update(deltaTime, speedRatio = 0, load = 0) {
        if (mat.uniforms.uTime) mat.uniforms.uTime.value += deltaTime;
        if (mat.uniforms.uSpeedRatio) mat.uniforms.uSpeedRatio.value = speedRatio;
        if (mat.uniforms.uLoad) mat.uniforms.uLoad.value = load;
      },
      dispose() {
        target.remove(outlineMesh);
        mat.dispose();
      },
    };
  }

  // Complex group / hierarchy target (e.g. FBX model or multi-mesh character)
  const meshes = [];
  const materials = [];
  const createdOutlines = [];

  target.traverse((child) => {
    if (child.isMesh && child.geometry) {
      meshes.push(child);
    }
  });

  for (const childMesh of meshes) {
    // A rigged character needs a SkinnedMesh copy bound to the SAME Skeleton, not a
    // plain Mesh over the same geometry - the latter renders the bind pose forever
    // while the body it is supposed to outline animates away from it. Added as a child
    // with an identity local transform, so its matrixWorld (and therefore the
    // bindMatrixInverse that AttachedBindMode recomputes from it each frame) stays
    // identical to the mesh it shadows.
    const skinned = childMesh.isSkinnedMesh === true && !!childMesh.skeleton;
    const mat = createOcclusionMaterial({ ...options, skinned });
    materials.push(mat);
    let outlineMesh;
    if (skinned) {
      outlineMesh = new THREE.SkinnedMesh(childMesh.geometry, mat);
      outlineMesh.bindMode = childMesh.bindMode;
      childMesh.add(outlineMesh);
      outlineMesh.bind(childMesh.skeleton, childMesh.bindMatrix);
    } else {
      outlineMesh = new THREE.Mesh(childMesh.geometry, mat);
      childMesh.add(outlineMesh);
    }
    outlineMesh.renderOrder = 9999;
    outlineMesh.frustumCulled = false;
    createdOutlines.push({ parent: childMesh, outline: outlineMesh, mat });
  }

  return {
    mesh: target,
    materials,
    update(deltaTime, speedRatio = 0, load = 0) {
      for (const mat of materials) {
        if (mat.uniforms.uTime) mat.uniforms.uTime.value += deltaTime;
        if (mat.uniforms.uSpeedRatio) mat.uniforms.uSpeedRatio.value = speedRatio;
        if (mat.uniforms.uLoad) mat.uniforms.uLoad.value = load;
      }
    },
    dispose() {
      for (const item of createdOutlines) {
        item.parent.remove(item.outline);
        item.mat.dispose();
      }
    },
  };
}

/**
 * Backward-compatible stub for any lingering references to circumference rings.
 */
export function createCircumferenceRing() {
  const dummy = new THREE.Group();
  dummy.visible = false;
  return {
    mesh: dummy,
    material: null,
    update() {},
  };
}

