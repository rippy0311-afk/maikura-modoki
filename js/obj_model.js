'use strict';

function parseObjText(text) {
  const vertices = [];
  const faces = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      vertices.push({
        x: Number(parts[1]),
        y: Number(parts[2]),
        z: Number(parts[3]),
      });
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const indices = parts.slice(1).map((part) => {
        const raw = Number(part.split('/')[0]);
        return raw < 0 ? vertices.length + raw : raw - 1;
      }).filter((index) => index >= 0 && index < vertices.length);
      for (let i = 1; i < indices.length - 1; i++) faces.push([indices[0], indices[i], indices[i + 1]]);
    }
  }

  if (vertices.length === 0 || faces.length === 0) throw new Error('OBJに頂点または面がありません');
  return { vertices, faces };
}

function normalizeObjVertices(vertices, maxDim) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of vertices) {
    min.x = Math.min(min.x, v.x); min.y = Math.min(min.y, v.y); min.z = Math.min(min.z, v.z);
    max.x = Math.max(max.x, v.x); max.y = Math.max(max.y, v.y); max.z = Math.max(max.z, v.z);
  }
  const size = {
    x: Math.max(0.0001, max.x - min.x),
    y: Math.max(0.0001, max.y - min.y),
    z: Math.max(0.0001, max.z - min.z),
  };
  const scale = maxDim / Math.max(size.x, size.y, size.z);
  const center = {
    x: (min.x + max.x) / 2,
    y: min.y,
    z: (min.z + max.z) / 2,
  };
  return vertices.map((v) => ({
    x: (v.x - center.x) * scale,
    y: (v.y - center.y) * scale,
    z: (v.z - center.z) * scale,
  }));
}

function addObjPoint(points, x, y, z) {
  points.add(`${Math.round(x)},${Math.round(y)},${Math.round(z)}`);
}

function sampleObjTriangle(points, a, b, c) {
  const ab = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const bc = Math.hypot(b.x - c.x, b.y - c.y, b.z - c.z);
  const ca = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
  const steps = Math.max(2, Math.ceil(Math.max(ab, bc, ca) * 1.8));
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps - i; j++) {
      const u = i / steps;
      const v = j / steps;
      const w = 1 - u - v;
      addObjPoint(
        points,
        a.x * w + b.x * u + c.x * v,
        a.y * w + b.y * u + c.y * v,
        a.z * w + b.z * u + c.z * v
      );
    }
  }
}

function objColorNumber(hex) {
  return Number.parseInt(String(hex || '#c8c8c8').replace('#', ''), 16) || 0xc8c8c8;
}

function placeObjModelInWorld(world, objText, options) {
  const maxDim = Math.max(8, Math.min(220, Number(options.size) || 96));
  const color = objColorNumber(options.color);
  const parsed = parseObjText(objText);
  const vertices = normalizeObjVertices(parsed.vertices, maxDim);
  const points = new Set();

  for (const [ia, ib, ic] of parsed.faces) {
    sampleObjTriangle(points, vertices[ia], vertices[ib], vertices[ic]);
  }

  const cx = Math.floor(world.sx / 2);
  const cz = Math.floor(world.sz / 2);
  const groundY = PRESETS.flat.base + SURFACE_OFFSET + 1;
  let placed = 0;
  for (const key of points) {
    const [px, py, pz] = key.split(',').map(Number);
    const x = cx + px;
    const y = groundY + py;
    const z = cz + pz;
    if (!world.inBounds(x, y, z)) continue;
    world.setColor(x, y, z, color);
    placed++;
  }

  const dist = maxDim * 1.1 + 18;
  const alt = maxDim * 0.55 + 18;
  return {
    placed,
    pos: { x: cx + 0.5, y: groundY + alt, z: cz + 0.5 + dist },
    yaw: 0,
    pitch: -Math.atan2(alt, dist) * 0.78,
    fly: true,
  };
}
