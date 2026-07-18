'use strict';

// ブロックID
const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WATER: 5,
  LOG: 6,
  LEAVES: 7,
  SNOW: 8,
  COLOR: 9,   // 画像用カラーブロック(色は World.colors に保持)
  PLANK: 10,
  BRICK: 11,
  COAL_ORE: 12,
  IRON_ORE: 13,
  GOLD_ORE: 14,
  CHEST: 15,
  BEDROCK: 16,
  ITEM_NODE: 17,
};

// テクスチャアトラスのタイル番号
const TILE_ID = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, WATER: 5,
  LOG_SIDE: 6, LOG_TOP: 7,
  LEAVES: 8, SNOW: 9, SNOW_SIDE: 10, WHITE: 11, PLANK: 12, BRICK: 13,
  COAL_ORE: 14, IRON_ORE: 15, GOLD_ORE: 16, CHEST: 17, BEDROCK: 18, ITEM_NODE: 19,
};

const ATLAS_COLS = 8;
const ATLAS_ROWS = 5;
const TILE_PX = 16;
const CUSTOM_TILE_START = 24;

// ブロックごとの面タイル { top, side, bottom }
const BLOCK_TILES = {
  [BLOCK.GRASS]:  { top: TILE_ID.GRASS_TOP, side: TILE_ID.GRASS_SIDE, bottom: TILE_ID.DIRT },
  [BLOCK.DIRT]:   { top: TILE_ID.DIRT,      side: TILE_ID.DIRT,       bottom: TILE_ID.DIRT },
  [BLOCK.STONE]:  { top: TILE_ID.STONE,     side: TILE_ID.STONE,      bottom: TILE_ID.STONE },
  [BLOCK.SAND]:   { top: TILE_ID.SAND,      side: TILE_ID.SAND,       bottom: TILE_ID.SAND },
  [BLOCK.WATER]:  { top: TILE_ID.WATER,     side: TILE_ID.WATER,      bottom: TILE_ID.WATER },
  [BLOCK.LOG]:    { top: TILE_ID.LOG_TOP,   side: TILE_ID.LOG_SIDE,   bottom: TILE_ID.LOG_TOP },
  [BLOCK.LEAVES]: { top: TILE_ID.LEAVES,    side: TILE_ID.LEAVES,     bottom: TILE_ID.LEAVES },
  [BLOCK.SNOW]:   { top: TILE_ID.SNOW,      side: TILE_ID.SNOW_SIDE,  bottom: TILE_ID.DIRT },
  [BLOCK.COLOR]:  { top: TILE_ID.WHITE,     side: TILE_ID.WHITE,      bottom: TILE_ID.WHITE },
  [BLOCK.PLANK]:  { top: TILE_ID.PLANK,     side: TILE_ID.PLANK,      bottom: TILE_ID.PLANK },
  [BLOCK.BRICK]:  { top: TILE_ID.BRICK,     side: TILE_ID.BRICK,      bottom: TILE_ID.BRICK },
  [BLOCK.COAL_ORE]: { top: TILE_ID.COAL_ORE, side: TILE_ID.COAL_ORE, bottom: TILE_ID.COAL_ORE },
  [BLOCK.IRON_ORE]: { top: TILE_ID.IRON_ORE, side: TILE_ID.IRON_ORE, bottom: TILE_ID.IRON_ORE },
  [BLOCK.GOLD_ORE]: { top: TILE_ID.GOLD_ORE, side: TILE_ID.GOLD_ORE, bottom: TILE_ID.GOLD_ORE },
  [BLOCK.CHEST]: { top: TILE_ID.CHEST, side: TILE_ID.CHEST, bottom: TILE_ID.CHEST },
  [BLOCK.BEDROCK]: { top: TILE_ID.BEDROCK, side: TILE_ID.BEDROCK, bottom: TILE_ID.BEDROCK },
  [BLOCK.ITEM_NODE]: { top: TILE_ID.ITEM_NODE, side: TILE_ID.ITEM_NODE, bottom: TILE_ID.ITEM_NODE },
};

function tileForFace(blockId, dirY) {
  const t = BLOCK_TILES[blockId] || BLOCK_TILES[BLOCK.STONE];
  if (dirY === 1) return t.top;
  if (dirY === -1) return t.bottom;
  return t.side;
}

function customTileForBlock(blockId) {
  const index = HOTBAR_BLOCKS.findIndex((item) => item.id === blockId);
  return index >= 0 ? CUSTOM_TILE_START + index : null;
}

// ホットバー用ブロック(キー1〜9)
const HOTBAR_BLOCKS = [
  { id: BLOCK.GRASS,  label: '草',     color: '#323ad4' },
  { id: BLOCK.DIRT,   label: '土',     color: '#866043' },
  { id: BLOCK.STONE,  label: '石',     color: '#7d7d7d' },
  { id: BLOCK.SAND,   label: '砂',     color: '#dacea0' },
  { id: BLOCK.LOG,    label: '原木',   color: '#675231' },
  { id: BLOCK.LEAVES, label: '葉',     color: '#3c7828' },
  { id: BLOCK.SNOW,   label: '雪',     color: '#f0f4f8' },
  { id: BLOCK.PLANK,  label: '木材',   color: '#aa8753' },
  { id: BLOCK.BRICK,  label: 'レンガ', color: '#96463c' },
  { id: BLOCK.COAL_ORE, label: '石炭鉱石', color: '#2a2a2e' },
  { id: BLOCK.IRON_ORE, label: '鉄鉱石',   color: '#cd8a59' },
  { id: BLOCK.GOLD_ORE, label: '金鉱石',   color: '#eec23e' },
];

// マイクラ風テクスチャアトラスを Canvas に描画して返す
function makeAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(20260710);

  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const jitterColor = (r, g, b, j) => {
    const d = (rand() * 2 - 1) * j;
    return `rgb(${clamp255(r + d)},${clamp255(g + d)},${clamp255(b + d)})`;
  };

  function drawTile(tileIndex, pixelFn) {
    const x0 = (tileIndex % ATLAS_COLS) * TILE_PX;
    const y0 = Math.floor(tileIndex / ATLAS_COLS) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        ctx.fillStyle = pixelFn(x, y);
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  }

  drawTile(TILE_ID.GRASS_TOP, () => jitterColor(50, 58, 212, 16));
  drawTile(TILE_ID.DIRT, () => jitterColor(134, 96, 67, 14));
  drawTile(TILE_ID.GRASS_SIDE, (x, y) => {
    if (y < 3 || (y === 3 && rand() < 0.5)) return jitterColor(50, 58, 212, 16);
    return jitterColor(134, 96, 67, 14);
  });
  drawTile(TILE_ID.STONE, () => jitterColor(125, 125, 125, 16));
  drawTile(TILE_ID.SAND, () => jitterColor(218, 206, 160, 10));
  drawTile(TILE_ID.WATER, () => jitterColor(50, 108, 200, 14));
  drawTile(TILE_ID.LOG_SIDE, (x) => {
    if (x % 4 === 0) return jitterColor(82, 64, 38, 8);
    return jitterColor(103, 82, 49, 10);
  });
  drawTile(TILE_ID.LOG_TOP, (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d % 3 < 1.2) return jitterColor(118, 94, 55, 8);
    return jitterColor(160, 130, 80, 10);
  });
  drawTile(TILE_ID.LEAVES, () => {
    if (rand() < 0.12) return jitterColor(34, 78, 24, 10);
    return jitterColor(60, 120, 40, 22);
  });
  drawTile(TILE_ID.SNOW, () => jitterColor(241, 245, 249, 6));
  drawTile(TILE_ID.SNOW_SIDE, (x, y) => {
    if (y < 4 || (y === 4 && rand() < 0.4)) return jitterColor(241, 245, 249, 6);
    return jitterColor(134, 96, 67, 14);
  });
  drawTile(TILE_ID.WHITE, () => jitterColor(228, 228, 228, 9));
  drawTile(TILE_ID.PLANK, (x, y) => {
    if (y % 4 === 3) return jitterColor(122, 92, 52, 8);
    if (x === (Math.floor(y / 4) * 5) % TILE_PX) return jitterColor(140, 108, 62, 8);
    return jitterColor(170, 135, 83, 10);
  });
  drawTile(TILE_ID.BRICK, (x, y) => {
    const row = Math.floor(y / 4);
    const mortar = (y % 4 === 0) || ((x + row * 4) % 8 === 0);
    if (mortar) return jitterColor(188, 180, 170, 8);
    return jitterColor(150, 68, 58, 14);
  });
  function drawOreTile(tileIndex, oreColor) {
    drawTile(tileIndex, (x, y) => {
      const vein = ((x * 11 + y * 7) % 17 < 3) || ((x - y + 16) % 13 < 2);
      if (vein && rand() < 0.55) return oreColor();
      return jitterColor(118, 118, 118, 15);
    });
  }
  drawOreTile(TILE_ID.COAL_ORE, () => jitterColor(42, 42, 46, 10));
  drawOreTile(TILE_ID.IRON_ORE, () => jitterColor(205, 138, 89, 12));
  drawOreTile(TILE_ID.GOLD_ORE, () => jitterColor(238, 194, 62, 12));
  drawTile(TILE_ID.CHEST, (x, y) => {
    if (y === 7 || y === 8) return jitterColor(54, 42, 24, 7);
    if (x === 7 || x === 8) return jitterColor(92, 68, 34, 8);
    if (x >= 6 && x <= 9 && y >= 6 && y <= 10) return jitterColor(226, 186, 78, 7);
    return jitterColor(154, 103, 45, 14);
  });
  drawTile(TILE_ID.BEDROCK, (x, y) => {
    const crack = ((x * 5 + y * 9) % 19 < 3) || ((x - y + 16) % 11 === 0);
    if (crack) return jitterColor(35, 35, 38, 8);
    return jitterColor(75, 75, 78, 18);
  });
  drawTile(TILE_ID.ITEM_NODE, (x, y) => {
    const gem = Math.abs(x - 7.5) + Math.abs(y - 7.5) < 6;
    const sparkle = (x + y) % 9 === 0 || (x * 3 + y * 5) % 17 === 0;
    if (sparkle) return jitterColor(245, 245, 255, 5);
    if (gem) return jitterColor(210, 210, 225, 14);
    return jitterColor(82, 82, 90, 16);
  });

  return canvas;
}

function drawCustomBlockTextures(canvas, textures) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !textures) return;
  for (const block of HOTBAR_BLOCKS) {
    const pixels = textures[block.id];
    if (!Array.isArray(pixels) || pixels.length !== TILE_PX * TILE_PX) continue;
    const tileIndex = customTileForBlock(block.id);
    const x0 = (tileIndex % ATLAS_COLS) * TILE_PX;
    const y0 = Math.floor(tileIndex / ATLAS_COLS) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const color = pixels[y * TILE_PX + x];
        if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
          ctx.fillStyle = color;
          ctx.fillRect(x0 + x, y0 + y, 1, 1);
        }
      }
    }
  }
}
