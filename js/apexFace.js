import * as THREE from 'three';

// Slight, deterministic per-triangle variation complements the geometric facets.
// Neutral vertex colors preserve the controller's purple/red/orange phase tint.
export function shadeFacets(geometry, variation = 0.24) {
  const colors = [];
  for (let triangle = 0; triangle < geometry.attributes.position.count; triangle += 3) {
    const noise = (Math.sin(triangle * 12.9898 + 7) * 43758.5453 % 1 + 1) * 0.5;
    const shade = 0.96 - variation + noise * variation;
    for (let corner = 0; corner < 3; corner++) colors.push(shade, shade, shade);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function polygon(points) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.closePath();
  return shape;
}

function foreheadRelief(x, y) {
  return 0.52 * Math.sqrt(Math.max(0.04, 1 - (x / 0.95) ** 2 - ((y - 0.12) / 0.94) ** 2));
}

function domeGeometry(shape) {
  const source = new THREE.ExtrudeGeometry(shape, {
    depth: 0.28, steps: 1, bevelEnabled: false, curveSegments: 1,
  });
  const sourcePositions = source.attributes.position;
  const vertices = [];
  const cornerA = new THREE.Vector3();
  const cornerB = new THREE.Vector3();
  const cornerC = new THREE.Vector3();
  const point = new THREE.Vector3();
  const subdivisions = 3;
  function addPoint(across, up) {
    point.copy(cornerA).multiplyScalar(1 - (across + up) / subdivisions)
      .addScaledVector(cornerB, across / subdivisions)
      .addScaledVector(cornerC, up / subdivisions);
    vertices.push(point.x, point.y, point.z - 0.28 + foreheadRelief(point.x, point.y));
  }
  for (let triangle = 0; triangle < sourcePositions.count; triangle += 3) {
    cornerA.fromBufferAttribute(sourcePositions, triangle);
    cornerB.fromBufferAttribute(sourcePositions, triangle + 1);
    cornerC.fromBufferAttribute(sourcePositions, triangle + 2);
    for (let across = 0; across < subdivisions; across++) {
      for (let up = 0; up < subdivisions - across; up++) {
        addPoint(across, up);
        addPoint(across + 1, up);
        addPoint(across, up + 1);
        if (across + up < subdivisions - 1) {
          addPoint(across + 1, up);
          addPoint(across + 1, up + 1);
          addPoint(across, up + 1);
        }
      }
    }
  }
  source.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return shadeFacets(geometry, 0.045);
}

function createMandible(material, side) {
  const path = [
    [0.57, -0.19, 0.05, 0.19],
    [0.73, -0.39, 0.16, 0.2],
    [0.68, -0.67, 0.31, 0.18],
    [0.52, -0.87, 0.49, 0.15],
    [0.29, -0.97, 0.66, 0.015],
  ];
  const vertices = [];
  const ringSides = 6;
  const rings = path.map(([horizontal, vertical, depth, radius], index) => {
    const previous = path[Math.max(0, index - 1)];
    const next = path[Math.min(path.length - 1, index + 1)];
    const tangent = new THREE.Vector3(side * (next[0] - previous[0]), next[1] - previous[1], next[2] - previous[2]).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 0, 1)).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    return Array.from({ length: ringSides }, (_, corner) => {
      const angle = corner * Math.PI * 2 / ringSides;
      return new THREE.Vector3(side * (horizontal - 0.57), vertical + 0.23, depth)
        .addScaledVector(normal, Math.cos(angle) * radius)
        .addScaledVector(binormal, Math.sin(angle) * radius * 1.25);
    });
  });
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let corner = 0; corner < ringSides; corner++) {
      const next = (corner + 1) % ringSides;
      vertices.push(...rings[ring][corner], ...rings[ring][next], ...rings[ring + 1][corner]);
      vertices.push(...rings[ring][next], ...rings[ring + 1][next], ...rings[ring + 1][corner]);
    }
  }
  for (let corner = 1; corner < ringSides - 1; corner++) {
    vertices.push(...rings[0][0], ...rings[0][corner + 1], ...rings[0][corner]);
    const last = rings[rings.length - 1];
    vertices.push(...last[0], ...last[corner], ...last[corner + 1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const jaw = new THREE.Mesh(shadeFacets(geometry), material);
  jaw.name = 'CurvedMandible';
  return jaw;
}

export function createApexFace(armorMaterial, crystalMaterial) {
  const group = new THREE.Group();
  group.name = 'MurkmawFace';
  group.rotation.set(Math.PI * 0.2, Math.PI, 0);
  group.position.set(0, 0.28, -0.38);

  const eyes = new THREE.Group();
  eyes.name = 'MurkmawEyes';
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0x10051f, emissive: 0x16082c, emissiveIntensity: 0.8,
    roughness: 0.08, metalness: 0.22,
  });
  const socketMaterial = new THREE.MeshStandardMaterial({
    color: 0x39115b, roughness: 0.7, flatShading: true,
  });
  const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xeee4ff });
  const eyeGeometry = new THREE.SphereGeometry(1, 24, 16);
  const highlightGeometry = new THREE.IcosahedronGeometry(1, 0);
  const placements = [
    { name: 'ForeheadEye', x: 0, y: 0.36, radius: 0.19 },
    { name: 'LeftEye', x: -0.34, y: -0.02, radius: 0.17 },
    { name: 'RightEye', x: 0.34, y: -0.02, radius: 0.17 },
  ];
  const shield = polygon([
    [0, 0.77], [0.49, 0.65], [0.78, 0.34], [0.83, 0.01],
    [0.62, -0.29], [0, -0.50], [-0.62, -0.29],
    [-0.83, 0.01], [-0.78, 0.34], [-0.49, 0.65],
  ]);

  for (const { name, x, y, radius } of placements) {
    const hole = new THREE.Path();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const px = x + Math.cos(angle) * (radius + 0.024);
      const py = y + Math.sin(angle) * (radius + 0.024);
      if (i === 0) hole.moveTo(px, py); else hole.lineTo(px, py);
    }
    hole.closePath();
    shield.holes.push(hole);
    const mount = new THREE.Group();
    mount.name = name;
    const relief = foreheadRelief(x, y);
    const normal = new THREE.Vector3(
      0.52 ** 2 * x / (0.95 ** 2 * relief),
      0.52 ** 2 * (y - 0.12) / (0.94 ** 2 * relief),
      1,
    ).normalize();
    mount.position.set(x, y, relief);
    mount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const socket = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.005, 0.031, 4, 8), socketMaterial);
    socket.position.z = -0.025;
    mount.add(socket);
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = 'RecessedEye';
    eye.scale.set(radius, radius, radius * 0.9);
    eye.position.z = -radius * 0.9 - 0.014;
    mount.add(eye);
    const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
    highlight.scale.setScalar(radius * 0.14);
    highlight.position.set(-radius * 0.26, radius * 0.32, -0.019);
    mount.add(highlight);
    eyes.add(mount);
  }
  const faceplate = new THREE.Mesh(domeGeometry(shield), armorMaterial);
  faceplate.name = 'FacetedFaceplate';
  group.add(faceplate, eyes);

  const mouthRim = [
    [-0.51, -0.18], [-0.7, -0.4], [-0.63, -0.76], [-0.34, -1.02],
    [0, -0.94], [0.34, -1.02], [0.63, -0.76], [0.7, -0.4], [0.51, -0.18],
  ];
  const mouthVertices = [];
  for (let corner = 0; corner < mouthRim.length; corner++) {
    const edge = mouthRim[corner];
    const next = mouthRim[(corner + 1) % mouthRim.length];
    const innerEdge = [edge[0] * 0.48, -0.56 + (edge[1] + 0.56) * 0.48, -0.25];
    const innerNext = [next[0] * 0.48, -0.56 + (next[1] + 0.56) * 0.48, -0.25];
    mouthVertices.push(...edge, 0.24, ...next, 0.24, ...innerEdge);
    mouthVertices.push(...next, 0.24, ...innerNext, ...innerEdge);
    mouthVertices.push(...innerEdge, ...innerNext, 0, -0.56, -0.4);
  }
  const mouthGeometry = new THREE.BufferGeometry();
  mouthGeometry.setAttribute('position', new THREE.Float32BufferAttribute(mouthVertices, 3));
  mouthGeometry.computeVertexNormals();
  const mouth = new THREE.Mesh(mouthGeometry, new THREE.MeshStandardMaterial({
    color: 0x10031d, roughness: 0.95, side: THREE.DoubleSide, flatShading: true,
  }));
  mouth.name = 'MouthCavity';
  group.add(mouth);

  const fangGeometry = shadeFacets(new THREE.ConeGeometry(0.105, 0.36, 5).toNonIndexed());
  const mandibles = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'LeftMandible' : 'RightMandible';
    pivot.position.set(side * 0.57, -0.23, 0);
    const jaw = createMandible(armorMaterial, side);
    pivot.add(jaw);
    const lowerFang = new THREE.Mesh(fangGeometry, crystalMaterial);
    lowerFang.position.set(side * -0.13, -0.53, 0.52);
    lowerFang.rotation.z = side * -0.12;
    pivot.add(lowerFang);
    group.add(pivot);
    mandibles.push(pivot);

    const upperFang = new THREE.Mesh(fangGeometry, crystalMaterial);
    upperFang.position.set(side * 0.37, -0.43, 0.39);
    upperFang.rotation.z = Math.PI + side * 0.16;
    group.add(upperFang);
  }
  return { group, eyes, eyeMaterial, mandibles, faceplate };
}
