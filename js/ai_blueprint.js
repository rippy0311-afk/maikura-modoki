'use strict';

const AI_BUILD_ENDPOINT = window.AI_BUILD_ENDPOINT || '';
const AI_BLUEPRINT_LIMITS = {
  maxPrimitives: 80,
  maxBlocks: 6000,
  maxRadius: 28,
  maxSize: 44,
};

function aiClamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function aiColorFromMaterial(material, fallback = 0xd8d8d8) {
  if (!material) return fallback;
  if (typeof material === 'number') return material;
  const raw = String(material).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return Number.parseInt(raw.slice(1), 16);
  if (/^0x[0-9a-f]{6}$/i.test(raw)) return Number.parseInt(raw.slice(2), 16);
  const catalog = typeof MINECRAFT_BLOCK_CATALOG !== 'undefined' ? MINECRAFT_BLOCK_CATALOG : [];
  const found = catalog.find((item) => {
    const names = [item.id, item.label].concat(item.aliases || []);
    return names.some((name) => String(name).toLowerCase() === raw);
  });
  return found ? Number.parseInt(found.color.replace('#', ''), 16) : fallback;
}

function normalizeAiBlueprint(raw) {
  const blueprint = raw && typeof raw === 'object' ? raw : {};
  const primitives = Array.isArray(blueprint.primitives) ? blueprint.primitives : [];
  const blocks = Array.isArray(blueprint.blocks) ? blueprint.blocks : [];
  return {
    label: String(blueprint.label || 'AI生成物').slice(0, 40),
    primitives: primitives.slice(0, AI_BLUEPRINT_LIMITS.maxPrimitives).map((shape) => ({
      type: String(shape.type || 'box').toLowerCase(),
      x: Math.round(aiClamp(shape.x, -AI_BLUEPRINT_LIMITS.maxRadius, AI_BLUEPRINT_LIMITS.maxRadius)),
      y: Math.round(aiClamp(shape.y, 0, AI_BLUEPRINT_LIMITS.maxSize)),
      z: Math.round(aiClamp(shape.z, -AI_BLUEPRINT_LIMITS.maxRadius, AI_BLUEPRINT_LIMITS.maxRadius)),
      sx: Math.round(aiClamp(shape.sx ?? shape.w ?? 1, 0, AI_BLUEPRINT_LIMITS.maxSize)),
      sy: Math.round(aiClamp(shape.sy ?? shape.h ?? 1, 0, AI_BLUEPRINT_LIMITS.maxSize)),
      sz: Math.round(aiClamp(shape.sz ?? shape.d ?? 1, 0, AI_BLUEPRINT_LIMITS.maxSize)),
      radius: Math.round(aiClamp(shape.radius ?? shape.r ?? 2, 1, AI_BLUEPRINT_LIMITS.maxRadius)),
      material: shape.material || shape.color || '#d8d8d8',
    })),
    blocks: blocks.slice(0, AI_BLUEPRINT_LIMITS.maxBlocks).map((block) => ({
      x: Math.round(aiClamp(block.x, -AI_BLUEPRINT_LIMITS.maxRadius, AI_BLUEPRINT_LIMITS.maxRadius)),
      y: Math.round(aiClamp(block.y, 0, AI_BLUEPRINT_LIMITS.maxSize)),
      z: Math.round(aiClamp(block.z, -AI_BLUEPRINT_LIMITS.maxRadius, AI_BLUEPRINT_LIMITS.maxRadius)),
      material: block.material || block.color || '#d8d8d8',
    })),
  };
}

function renderAiBlueprintPrimitive(world, origin, shape, bounds, counter) {
  const color = aiColorFromMaterial(shape.material);
  const ox = origin.x + shape.x;
  const oy = origin.y + shape.y;
  const oz = origin.z + shape.z;
  const type = shape.type;
  const sx = shape.sx;
  const sy = shape.sy;
  const sz = shape.sz;

  const place = (x, y, z) => {
    if (counter.count >= AI_BLUEPRINT_LIMITS.maxBlocks) return;
    if (!world.inBounds(x, y, z)) return;
    world.setColor(x, y, z, color);
    counter.count++;
    bounds.x0 = Math.min(bounds.x0, x); bounds.x1 = Math.max(bounds.x1, x);
    bounds.z0 = Math.min(bounds.z0, z); bounds.z1 = Math.max(bounds.z1, z);
  };

  if (type === 'sphere' || type === 'ellipsoid') {
    const rx = Math.max(1, sx || shape.radius);
    const ry = Math.max(1, sy || shape.radius);
    const rz = Math.max(1, sz || shape.radius);
    for (let y = -ry; y <= ry; y++) {
      for (let z = -rz; z <= rz; z++) {
        for (let x = -rx; x <= rx; x++) {
          if ((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2 <= 1) place(ox + x, oy + y, oz + z);
        }
      }
    }
    return;
  }

  if (type === 'cylinder') {
    const r = Math.max(1, shape.radius || sx || sz);
    for (let y = 0; y <= sy; y++) {
      for (let z = -r; z <= r; z++) {
        for (let x = -r; x <= r; x++) {
          if (x * x + z * z <= r * r) place(ox + x, oy + y, oz + z);
        }
      }
    }
    return;
  }

  for (let y = 0; y <= sy; y++) {
    for (let z = -sz; z <= sz; z++) {
      for (let x = -sx; x <= sx; x++) place(ox + x, oy + y, oz + z);
    }
  }
}

function renderAiBlueprint(world, origin, rawBlueprint) {
  const blueprint = normalizeAiBlueprint(rawBlueprint);
  const bounds = { x0: origin.x, z0: origin.z, x1: origin.x, z1: origin.z };
  const counter = { count: 0 };

  for (const shape of blueprint.primitives) renderAiBlueprintPrimitive(world, origin, shape, bounds, counter);
  for (const block of blueprint.blocks) {
    if (counter.count >= AI_BLUEPRINT_LIMITS.maxBlocks) break;
    const x = origin.x + block.x;
    const y = origin.y + block.y;
    const z = origin.z + block.z;
    if (!world.inBounds(x, y, z)) continue;
    world.setColor(x, y, z, aiColorFromMaterial(block.material));
    counter.count++;
    bounds.x0 = Math.min(bounds.x0, x); bounds.x1 = Math.max(bounds.x1, x);
    bounds.z0 = Math.min(bounds.z0, z); bounds.z1 = Math.max(bounds.z1, z);
  }

  return { ...bounds, label: blueprint.label, count: counter.count };
}

async function requestAiBlueprint(prompt, context = {}) {
  if (!AI_BUILD_ENDPOINT) return null;
  const response = await fetch(AI_BUILD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, context }),
  });
  if (!response.ok) throw new Error(`AI endpoint failed: ${response.status}`);
  return response.json();
}
