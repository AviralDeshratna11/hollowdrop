import * as THREE from 'three';
import { getCaveLayoutTexture } from './caveLayout.js';

/** Close-up paint stays sharp at walking distance; the original atlas supplies
 * biome color. Offset edge blending avoids seams without mirrored rock patterns. */
export function createPaintedGroundMaterial(atlas, manager, anisotropy) {
  const detail = new THREE.TextureLoader(manager).load('assets/textures/cave-floor-painted.png');
  detail.colorSpace = THREE.SRGBColorSpace;
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = anisotropy;
  detail.repeat.setScalar(24);
  const loadSurface = (url) => {
    const texture = new THREE.TextureLoader(manager).load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    return texture;
  };
  const gravel = loadSurface('assets/textures/cave-path-painted.png');
  const moss = loadSurface('assets/textures/cave-moss-painted.png');
  const layout = getCaveLayoutTexture();
  const material = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.94 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.floorPaint = { value: detail };
    shader.uniforms.pathPaint = { value: gravel };
    shader.uniforms.mossPaint = { value: moss };
    shader.uniforms.caveLayout = { value: layout };
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>', /* glsl */ `
      #include <map_pars_fragment>
      uniform sampler2D floorPaint;
      uniform sampler2D pathPaint;
      uniform sampler2D mossPaint;
      uniform sampler2D caveLayout;
      vec4 sampleFloor(vec2 uv) {
        vec2 f = fract(uv);
        vec2 w = smoothstep(vec2(0.025), vec2(0.10), min(f, 1.0 - f));
        vec4 a = mix(texture2D(floorPaint, uv + vec2(0.5, 0.0)), texture2D(floorPaint, uv), w.x);
        vec4 b = mix(texture2D(floorPaint, uv + vec2(0.5)), texture2D(floorPaint, uv + vec2(0.0, 0.5)), w.x);
        return mix(b, a, w.y);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
      vec3 biome = texture2D(map, vMapUv).rgb;
      vec4 regions = texture2D(caveLayout, vMapUv);
      vec2 detailUv = vMapUv * 24.0;
      vec3 paint = vec3(0.0);
      if (regions.r < 0.998) {
        paint = sampleFloor(detailUv + vec2(0.173, 0.347)).rgb;
        if (regions.g > 0.01) {
          vec3 moss = texture2D(mossPaint, detailUv * 0.83 + vec2(0.61, 0.23)).rgb;
          float mossWeight = smoothstep(0.08, 0.9, regions.g + (0.18 - paint.g) * 0.32);
          paint = mix(paint, moss * 0.78, mossWeight);
        }
      }
      // The mask carries only region weights: all three paints retain close-up detail.
      // Tiny albedo-dependent fringes let moss grow around the slate edges.
      if (regions.r > 0.002) {
        vec3 gravel = texture2D(pathPaint, detailUv + vec2(0.31, 0.67)).rgb;
        paint = mix(paint, gravel * vec3(0.86, 0.92, 0.94), regions.r);
      }
      float luminance = max(dot(biome, vec3(0.2126, 0.7152, 0.0722)), 0.018);
      vec3 tint = clamp(biome / luminance, vec3(0.45), vec3(1.65));
      // Broad tonal variation without enlarging the old atlas' tiny painted props.
      paint *= mix(vec3(1.0), tint, 0.20);
      paint *= 0.82 + 0.28 * smoothstep(0.01, 0.16, luminance);
      paint *= mix(vec3(1.0), vec3(0.42, 1.10, 1.18), regions.b * 0.78);
      paint *= mix(vec3(1.0), vec3(1.12, 0.43, 1.40), regions.a * 0.82);
      diffuseColor.rgb *= paint;
    `);
    // Reuse the sampled paint for fine relief. A conventional bump map would
    // sample the four-way seam blend three more times per pixel (12 extra fetches).
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', /* glsl */ `
      #include <normal_fragment_maps>
      float paintHeight = dot(paint, vec3(0.2126, 0.7152, 0.0722)) * 0.025;
      vec3 floorDx = dFdx(-vViewPosition), floorDy = dFdy(-vViewPosition);
      vec3 floorR1 = cross(floorDy, normal), floorR2 = cross(normal, floorDx);
      float floorDet = dot(floorDx, floorR1) * faceDirection;
      normal = normalize(abs(floorDet) * normal - sign(floorDet) *
        (dFdx(paintHeight) * floorR1 + dFdy(paintHeight) * floorR2));
    `);
  };
  detail.offset.set(0.173, 0.347);
  material.customProgramCacheKey = () => 'painted-cave-floor-v4-layout';
  return material;
}
