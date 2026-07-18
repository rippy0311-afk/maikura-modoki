'use strict';

// ワールドサイズ
const WORLD_SX = 480;
const WORLD_SY = 384;
const WORLD_SZ = 480;
const CHUNK = 16;
const WORLD_DEPTH = 300;
const SURFACE_OFFSET = WORLD_DEPTH - 22;

class World {
  constructor(sx = WORLD_SX, sy = WORLD_SY, sz = WORLD_SZ) {
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.data = new Uint8Array(sx * sy * sz);
    this.lootChests = new Map();
    this.itemNodes = new Map();
    this.colors = new Map(); // COLOR ブロックの色 (index -> 0xRRGGBB)
  }

  index(x, y, z) { return (y * this.sz + z) * this.sx + x; }

  inBounds(x, y, z) {
    return x >= 0 && x < this.sx && y >= 0 && y < this.sy && z >= 0 && z < this.sz;
  }

  get(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;        // 底面は描画しない
    if (!this.inBounds(x, y, z)) return BLOCK.AIR;
    return this.data[this.index(x, y, z)];
  }

  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    if (y === 0 && id !== BLOCK.BEDROCK) return;
    if (this.data[this.index(x, y, z)] === BLOCK.BEDROCK && id !== BLOCK.BEDROCK) return;
    const i = this.index(x, y, z);
    this.data[i] = id;
    if (id !== BLOCK.COLOR) this.colors.delete(i);
    if (id !== BLOCK.CHEST) this.lootChests.delete(i);
    if (id !== BLOCK.ITEM_NODE) this.itemNodes.delete(i);
  }

  setLootChest(x, y, z, items) {
    if (!this.inBounds(x, y, z)) return;
    if (y === 0 || this.get(x, y, z) === BLOCK.BEDROCK) return;
    const i = this.index(x, y, z);
    this.data[i] = BLOCK.CHEST;
    this.colors.delete(i);
    this.lootChests.set(i, items);
  }

  takeLootChest(x, y, z) {
    const i = this.index(x, y, z);
    const items = this.lootChests.get(i) || [];
    this.lootChests.delete(i);
    return items;
  }

  setItemNode(x, y, z, itemId, count, color) {
    if (!this.inBounds(x, y, z)) return;
    if (y === 0 || this.get(x, y, z) === BLOCK.BEDROCK) return;
    const i = this.index(x, y, z);
    this.data[i] = BLOCK.ITEM_NODE;
    this.lootChests.delete(i);
    this.itemNodes.set(i, { id: itemId, count });
    this.colors.set(i, color);
  }

  takeItemNode(x, y, z) {
    const i = this.index(x, y, z);
    const item = this.itemNodes.get(i) || null;
    this.itemNodes.delete(i);
    return item;
  }

  setColor(x, y, z, rgb) {
    if (!this.inBounds(x, y, z)) return;
    if (y === 0 || this.get(x, y, z) === BLOCK.BEDROCK) return;
    const i = this.index(x, y, z);
    this.data[i] = BLOCK.COLOR;
    this.colors.set(i, rgb);
  }

  getColor(x, y, z) {
    return this.colors.get(this.index(x, y, z)) ?? 0xffffff;
  }

  // その列の一番上にある非空気ブロックの y
  heightAt(x, z) {
    for (let y = this.sy - 1; y >= 0; y--) {
      if (this.get(x, y, z) !== BLOCK.AIR) return y;
    }
    return 0;
  }

  solidHeightAt(x, z) {
    for (let y = this.sy - 1; y >= 0; y--) {
      const block = this.get(x, y, z);
      if (block !== BLOCK.AIR && block !== BLOCK.WATER) return y;
    }
    return 0;
  }

  isSolid(x, y, z) {
    const b = this.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return b !== BLOCK.AIR && b !== BLOCK.WATER;
  }
}

// 場所プリセット
const PRESETS = {
  plains:    { label: '草原',   base: 22, amp: 6,  freq: 0.020, oct: 4, water: 17, trees: 0.007, surface: 'grass' },
  mountains: { label: '山岳',   base: 22, amp: 30, freq: 0.013, oct: 5, water: 13, trees: 0.004, surface: 'grass', stoneLine: 38, snowLine: 48 },
  desert:    { label: '砂漠',   base: 20, amp: 9,  freq: 0.017, oct: 4, water: -1, trees: 0,     surface: 'sand' },
  island:    { label: '島',     base: 26, amp: 12, freq: 0.020, oct: 4, water: 18, trees: 0.014, surface: 'grass', island: true, seaFloor: 8 },
  snow:      { label: '雪原',   base: 22, amp: 8,  freq: 0.020, oct: 4, water: 16, trees: 0.006, surface: 'snow' },
  flat:      { label: 'フラット', flat: true, base: 12, water: -1, trees: 0, surface: 'grass' },
};

function smoothstep(a, b, t) {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// プリセットとシードからワールド生成
function generateWorld(presetKey, seed, worldSx = WORLD_SX, worldSy = WORLD_SY, worldSz = WORLD_SZ) {
  const p = PRESETS[presetKey] || PRESETS.plains;
  const heightOffset = SURFACE_OFFSET;
  const waterLevel = p.water >= 0 ? p.water + heightOffset : p.water;
  const stoneLine = p.stoneLine ? p.stoneLine + heightOffset : 0;
  const snowLine = p.snowLine ? p.snowLine + heightOffset : 0;
  const world = new World(worldSx, worldSy, worldSz);
  const noise = new Noise2D(seed);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const { sx, sy, sz } = world;
  const cx = sx / 2, cz = sz / 2;

  const heights = new Int16Array(sx * sz);

  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      let h;
      if (p.flat) {
        h = p.base + heightOffset;
      } else {
        h = p.base + heightOffset + noise.fbm(x * p.freq, z * p.freq, p.oct) * p.amp;
        if (p.island) {
          const d = Math.hypot(x - cx, z - cz) / (Math.min(cx, cz));
          const mask = 1 - smoothstep(0.5, 0.95, d);
          const seaFloor = p.seaFloor + heightOffset;
          h = seaFloor + (h - seaFloor) * mask;
        }
      }
      h = Math.max(1, Math.min(sy - 24, Math.round(h)));
      heights[z * sx + x] = h;

      const underwater = h < waterLevel;
      for (let y = 0; y <= h; y++) {
        let id;
        if (y < h - 3) {
          id = BLOCK.STONE;
          const oreRoll = rand();
          const depth = h - y;
          if (depth >= 70 && oreRoll < 0.006) id = BLOCK.GOLD_ORE;
          else if (depth >= 35 && oreRoll < 0.018) id = BLOCK.IRON_ORE;
          else if (depth >= 12 && oreRoll < 0.040) id = BLOCK.COAL_ORE;
        } else if (y < h) {
          id = (p.surface === 'sand') ? BLOCK.SAND : BLOCK.DIRT;
        } else {
          // 表面ブロック
          if (p.surface === 'sand') id = BLOCK.SAND;
          else if (underwater || h <= waterLevel + 1) id = BLOCK.SAND; // 水中・水際は砂浜
          else if (snowLine && h >= snowLine) id = BLOCK.SNOW;
          else if (stoneLine && h >= stoneLine) id = BLOCK.STONE;
          else if (p.surface === 'snow') id = BLOCK.SNOW;
          else id = BLOCK.GRASS;
        }
        world.data[world.index(x, y, z)] = id;
      }
      // 水を張る
      for (let y = h + 1; y <= waterLevel; y++) {
        world.data[world.index(x, y, z)] = BLOCK.WATER;
      }
    }
  }

  if (!p.flat) carveCaves(world, heights, seed, p);

  // 木を植える
  if (p.trees > 0) {
    for (let z = 3; z < sz - 3; z++) {
      for (let x = 3; x < sx - 3; x++) {
        if (rand() >= p.trees) continue;
        const h = heights[z * sx + x];
        const top = world.get(x, h, z);
        if (top !== BLOCK.GRASS && top !== BLOCK.SNOW) continue;
        if (h <= waterLevel + 1 || h + 8 >= sy) continue;
        plantTree(world, x, h, z, rand);
      }
    }
  }
  if (p.spawn) world.spawnPoint = p.spawn;
  lockBedrockLayer(world);

  return world;
}

function lockBedrockLayer(world) {
  for (let z = 0; z < world.sz; z++) {
    for (let x = 0; x < world.sx; x++) {
      world.data[world.index(x, 0, z)] = BLOCK.BEDROCK;
    }
  }
}

function caveRadiusAt(step, length, baseRadius) {
  const t = step / Math.max(1, length - 1);
  const taper = Math.sin(t * Math.PI);
  return baseRadius * (0.45 + taper * 0.75);
}

function carveSphere(world, heights, cx, cy, cz, radius, openToSurface = false) {
  const minX = Math.floor(cx - radius), maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius), maxY = Math.ceil(cy + radius);
  const minZ = Math.floor(cz - radius), maxZ = Math.ceil(cz + radius);

  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!world.inBounds(x, y, z) || y < 3) continue;
        const h = heights[z * world.sx + x];
        if (!openToSurface && y > h - 4) continue;
        const dx = (x + 0.5 - cx) / radius;
        const dy = (y + 0.5 - cy) / (radius * 0.75);
        const dz = (z + 0.5 - cz) / radius;
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        const block = world.get(x, y, z);
        if (block !== BLOCK.AIR && block !== BLOCK.WATER) world.set(x, y, z, BLOCK.AIR);
      }
    }
  }
}

function carveCaves(world, heights, seed, preset) {
  const rand = mulberry32(seed ^ 0x6c617665);
  const areaScale = (world.sx * world.sz) / (160 * 160);
  const waterLevel = preset.water >= 0 ? preset.water + SURFACE_OFFSET : preset.water;
  const caveCount = Math.round((preset.island ? 18 : 28) * areaScale);

  for (let i = 0; i < caveCount; i++) {
    let x = 8 + rand() * (world.sx - 16);
    let z = 8 + rand() * (world.sz - 16);
    let h = heights[Math.floor(z) * world.sx + Math.floor(x)];
    const maxDepth = Math.max(18, Math.min(WORLD_DEPTH - 8, h - 8));
    const caveDepth = 10 + Math.pow(rand(), 0.72) * maxDepth;
    let y = Math.max(5, h - caveDepth);
    let yaw = rand() * Math.PI * 2;
    let pitch = (rand() - 0.5) * 0.48;
    const length = 55 + Math.floor(rand() * 88);
    const radius = 1.35 + rand() * 1.8;

    for (let step = 0; step < length; step++) {
      const ix = Math.floor(x), iz = Math.floor(z);
      if (ix < 3 || ix >= world.sx - 3 || iz < 3 || iz >= world.sz - 3) break;
      h = heights[iz * world.sx + ix];
      if (y < h - 3) carveSphere(world, heights, x, y, z, caveRadiusAt(step, length, radius));
      if (step % 22 === 8 && rand() < 0.28) {
        carveSphere(world, heights, x, y, z, radius * (2.2 + rand() * 1.2));
      }

      yaw += (rand() - 0.5) * 0.50;
      pitch = Math.max(-0.46, Math.min(0.46, pitch + (rand() - 0.5) * 0.18));
      x += Math.cos(yaw) * 1.15;
      z += Math.sin(yaw) * 1.15;
      y += Math.sin(pitch) * 1.05;
      y = Math.max(4, Math.min(h - 5, y));
    }
  }

  const entranceCount = Math.round(14 * areaScale);
  for (let i = 0; i < entranceCount; i++) {
    const x = 10 + Math.floor(rand() * (world.sx - 20));
    const z = 10 + Math.floor(rand() * (world.sz - 20));
    const h = heights[z * world.sx + x];
    if (h <= waterLevel + 4 || h < 14) continue;
    const depth = 35 + Math.floor(rand() * 110);
    const driftX = (rand() - 0.5) * 0.45;
    const driftZ = 0.45 + rand() * 0.45;
    for (let step = 0; step < depth; step++) {
      carveSphere(world, heights, x + step * driftX, h - 1 - step, z + step * driftZ, 1.35 + Math.min(1.3, step * 0.018), true);
    }
  }

  const ravineCount = Math.round(3 * areaScale);
  for (let i = 0; i < ravineCount; i++) {
    let x = 16 + rand() * (world.sx - 32);
    let z = 16 + rand() * (world.sz - 32);
    let yaw = rand() * Math.PI * 2;
    const length = 50 + Math.floor(rand() * 90);
    const h = heights[Math.floor(z) * world.sx + Math.floor(x)];
    let y = Math.max(8, h - (55 + rand() * 140));
    for (let step = 0; step < length; step++) {
      const ix = Math.floor(x), iz = Math.floor(z);
      if (ix < 4 || ix >= world.sx - 4 || iz < 4 || iz >= world.sz - 4) break;
      carveSphere(world, heights, x, y, z, 3.0 + rand() * 1.2);
      carveSphere(world, heights, x, y + 3, z, 2.4 + rand() * 0.9);
      yaw += (rand() - 0.5) * 0.22;
      x += Math.cos(yaw) * 1.35;
      z += Math.sin(yaw) * 1.35;
      y += (rand() - 0.5) * 0.38;
    }
  }
}

function plantTree(world, x, groundY, z, rand) {
  const trunkH = 4 + Math.floor(rand() * 3);
  const topY = groundY + trunkH;
  // 葉
  for (let dy = trunkH - 2; dy <= trunkH + 1; dy++) {
    const r = dy > trunkH ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy <= trunkH) continue;
        if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.6) continue;
        const y = groundY + dy;
        if (world.get(x + dx, y, z + dz) === BLOCK.AIR) {
          world.set(x + dx, y, z + dz, BLOCK.LEAVES);
        }
      }
    }
  }
  // 幹
  for (let y = groundY + 1; y <= topY; y++) world.set(x, y, z, BLOCK.LOG);
}

// キューブの面定義(外向き、三角形は 0,1,2 / 2,1,3)
const CUBE_FACES = [
  { dir: [-1, 0, 0], shade: 0.66, corners: [ [[0,1,0],[0,1]], [[0,0,0],[0,0]], [[0,1,1],[1,1]], [[0,0,1],[1,0]] ] },
  { dir: [ 1, 0, 0], shade: 0.66, corners: [ [[1,1,1],[0,1]], [[1,0,1],[0,0]], [[1,1,0],[1,1]], [[1,0,0],[1,0]] ] },
  { dir: [ 0,-1, 0], shade: 0.55, corners: [ [[1,0,1],[1,0]], [[0,0,1],[0,0]], [[1,0,0],[1,1]], [[0,0,0],[0,1]] ] },
  { dir: [ 0, 1, 0], shade: 1.00, corners: [ [[0,1,1],[1,1]], [[1,1,1],[0,1]], [[0,1,0],[1,0]], [[1,1,0],[0,0]] ] },
  { dir: [ 0, 0,-1], shade: 0.84, corners: [ [[1,0,0],[0,0]], [[0,0,0],[1,0]], [[1,1,0],[0,1]], [[0,1,0],[1,1]] ] },
  { dir: [ 0, 0, 1], shade: 0.84, corners: [ [[0,0,1],[0,0]], [[1,0,1],[1,0]], [[0,1,1],[0,1]], [[1,1,1],[1,1]] ] },
];

// チャンク (cx, cz) のメッシュデータを作る。opaque と water に分ける。
function buildChunkMeshData(world, cx, cz) {
  const opaque = { positions: [], uvs: [], colors: [], indices: [] };
  const water = { positions: [], uvs: [], colors: [], indices: [] };

  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const x1 = Math.min(x0 + CHUNK, world.sx);
  const z1 = Math.min(z0 + CHUNK, world.sz);

  for (let y = 0; y < world.sy; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const id = world.data[world.index(x, y, z)];
        if (id === BLOCK.AIR) continue;
        const isWater = id === BLOCK.WATER;
        const buf = isWater ? water : opaque;

        let tint = null;
        if (id === BLOCK.COLOR || id === BLOCK.ITEM_NODE) {
          const rgb = world.getColor(x, y, z);
          tint = [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255];
        }

        for (const face of CUBE_FACES) {
          const nb = world.get(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          let visible;
          if (isWater) {
            visible = nb === BLOCK.AIR; // 水面のみ
          } else {
            visible = nb === BLOCK.AIR || nb === BLOCK.WATER;
          }
          if (!visible) continue;

          const tileIdx = tileForFace(id, face.dir[1]);
          const tu = tileIdx % ATLAS_COLS;
          const tv = Math.floor(tileIdx / ATLAS_COLS);

          const baseIndex = buf.positions.length / 3;
          for (const [pos, uv] of face.corners) {
            buf.positions.push(x + pos[0], y + pos[1], z + pos[2]);
            buf.uvs.push(
              (tu + uv[0]) / ATLAS_COLS,
              1 - (tv + 1 - uv[1]) / ATLAS_ROWS
            );
            const s = face.shade;
            if (tint) buf.colors.push(tint[0] * s, tint[1] * s, tint[2] * s);
            else buf.colors.push(s, s, s);
          }
          buf.indices.push(baseIndex, baseIndex + 1, baseIndex + 2,
                           baseIndex + 2, baseIndex + 1, baseIndex + 3);
        }
      }
    }
  }
  return { opaque, water };
}

// ボクセルDDAレイキャスト。命中: {x,y,z, nx,ny,nz} / 外れ: null
function raycastVoxel(world, ox, oy, oz, dx, dy, dz, maxDist) {
  let ix = Math.floor(ox), iy = Math.floor(oy), iz = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / (dx || 1e-10));
  const tDeltaY = Math.abs(1 / (dy || 1e-10));
  const tDeltaZ = Math.abs(1 / (dz || 1e-10));
  let tMaxX = tDeltaX * (dx > 0 ? (ix + 1 - ox) : (ox - ix));
  let tMaxY = tDeltaY * (dy > 0 ? (iy + 1 - oy) : (oy - iy));
  let tMaxZ = tDeltaZ * (dz > 0 ? (iz + 1 - oz) : (oz - iz));
  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  while (t <= maxDist) {
    const b = world.get(ix, iy, iz);
    if (b !== BLOCK.AIR && b !== BLOCK.WATER && world.inBounds(ix, iy, iz)) {
      return { x: ix, y: iy, z: iz, nx, ny, nz };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      ix += stepX; t = tMaxX; tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      iy += stepY; t = tMaxY; tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      iz += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}
