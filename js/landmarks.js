'use strict';

// 名所ワールド: 富士山・浅草寺(雷門/本堂/五重塔)・東京タワー・ピラミッド・桜

const LM_COLOR = {
  vermilion:   0xBE3428, // 朱色(社寺)
  redLantern:  0xC82820, // 大提灯
  darkRoof:    0x38424E, // 瓦屋根
  white:       0xEEE8DC, // 白壁
  stoneGray:   0xA8A296, // 基壇
  darkWood:    0x2A2620, // 提灯の帯
  gold:        0xE6BE3C, // 相輪・祭壇
  towerOrange: 0xE85A2A, // 東京タワー
  towerWhite:  0xF2F2F2,
  fujiRock:    0x59617E, // 富士の山肌(青系)
  sakura1:     0xE89CB4, // 桜
  sakura2:     0xF2BCCC,
  pathGray:    0x9C968A, // 石畳
};

function lmFillColor(w, x0, y0, z0, x1, y1, z1, rgb) {
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) w.setColor(x, y, z, rgb);
}

function lmFillBlock(w, x0, y0, z0, x1, y1, z1, id) {
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) w.set(x, y, z, id);
}

// 地面を groundY に均す(上は空気、表面は草)
function lmFlatten(w, x0, z0, x1, z1, groundY) {
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < w.sy; y++) {
        let id;
        if (y < groundY - 3) id = BLOCK.STONE;
        else if (y < groundY) id = BLOCK.DIRT;
        else if (y === groundY) id = BLOCK.GRASS;
        else id = BLOCK.AIR;
        w.set(x, y, z, id);
      }
    }
  }
}

// 寄棟屋根: 1段ずつ小さくなるスラブを積む
function lmHipRoof(w, cx, cz, y0, hx, hz, layers, rgb) {
  for (let i = 0; i < layers; i++) {
    const ax = hx - i, az = hz - i;
    if (ax < 0 || az < 0) break;
    lmFillColor(w, cx - ax, y0 + i, cz - az, cx + ax, y0 + i, cz + az, rgb);
  }
}

/* ---------- 富士山 ---------- */
function buildFuji(w, seed) {
  const n = new Noise2D((seed ^ 0xF031) >>> 0);
  const fx = 80, fz = 30, R = 46, peak = 56, baseY = 12;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = fx + dx, z = fz + dz;
      if (x < 0 || x >= w.sx || z < 0 || z >= w.sz) continue;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const t = 1 - d / R;
      let h = baseY + peak * Math.pow(t, 1.7)
        + n.fbm(x * 0.09, z * 0.09, 3) * 3 * Math.min(1, t * 3);
      if (d < 5) h -= (5 - d) * 1.5; // 火口
      h = Math.min(w.sy - 4, Math.round(h));
      const cur = w.heightAt(x, z);
      if (h <= cur) continue;
      const snowY = baseY + peak * 0.6 + n.noise(x * 0.15, z * 0.15) * 2.5;
      for (let y = cur + 1; y <= h; y++) {
        if (y >= h - 1) {
          if (h <= baseY + 7) w.set(x, y, z, BLOCK.GRASS);           // 裾野は緑
          else if (y >= snowY) w.setColor(x, y, z, 0xF2F6FA);        // 冠雪(純白)
          else w.setColor(x, y, z, LM_COLOR.fujiRock);               // 青い山肌
        } else {
          w.set(x, y, z, BLOCK.STONE);
        }
      }
    }
  }
}

/* ---------- 浅草寺 本堂 ---------- */
function buildMainHall(w, cx, cz) {
  const V = LM_COLOR;
  // 基壇と階段(南向き)
  lmFillColor(w, cx - 10, 13, cz - 7, cx + 10, 14, cz + 7, V.stoneGray);
  lmFillColor(w, cx - 4, 13, cz + 8, cx + 4, 13, cz + 9, V.stoneGray);
  // 壁(白壁 + 朱柱)、内部は空洞
  lmFillColor(w, cx - 7, 15, cz - 4, cx + 7, 20, cz + 4, V.white);
  lmFillBlock(w, cx - 6, 15, cz - 3, cx + 6, 20, cz + 3, BLOCK.AIR);
  for (let x = cx - 7; x <= cx + 7; x += 3) {
    lmFillColor(w, x, 15, cz - 4, x, 20, cz - 4, V.vermilion);
    lmFillColor(w, x, 15, cz + 4, x, 20, cz + 4, V.vermilion);
  }
  for (let z = cz - 4; z <= cz + 4; z += 4) {
    lmFillColor(w, cx - 7, 15, z, cx - 7, 20, z, V.vermilion);
    lmFillColor(w, cx + 7, 15, z, cx + 7, 20, z, V.vermilion);
  }
  // 扉(南)と祭壇
  lmFillBlock(w, cx - 1, 15, cz + 4, cx + 1, 18, cz + 4, BLOCK.AIR);
  lmFillColor(w, cx - 1, 15, cz - 2, cx + 1, 16, cz - 2, V.gold);
  // 二層の大屋根
  lmHipRoof(w, cx, cz, 21, 10, 7, 4, V.darkRoof);
  lmHipRoof(w, cx, cz, 25, 6, 3, 3, V.darkRoof);
  lmFillColor(w, cx - 3, 28, cz, cx + 3, 28, cz, V.darkRoof); // 大棟
}

/* ---------- 五重塔 ---------- */
function buildPagoda(w, cx, cz) {
  const V = LM_COLOR;
  lmFillColor(w, cx - 6, 13, cz - 6, cx + 6, 13, cz + 6, V.stoneGray);
  const halves = [5, 4, 4, 3, 3];
  let y = 14;
  for (let k = 0; k < 5; k++) {
    const hw = halves[k];
    lmFillColor(w, cx - hw, y, cz - hw, cx + hw, y + 2, cz + hw, V.vermilion);
    lmFillColor(w, cx - hw - 2, y + 3, cz - hw - 2, cx + hw + 2, y + 3, cz + hw + 2, V.darkRoof);
    y += 4;
  }
  lmFillColor(w, cx, y, cz, cx, y + 4, cz, V.gold); // 相輪
}

/* ---------- 雷門 ---------- */
function buildKaminarimon(w, cx, cz) {
  const V = LM_COLOR;
  // 柱(2x2 ×2本)
  lmFillColor(w, cx - 6, 13, cz - 1, cx - 5, 21, cz + 1, V.vermilion);
  lmFillColor(w, cx + 5, 13, cz - 1, cx + 6, 21, cz + 1, V.vermilion);
  // 梁と屋根
  lmFillColor(w, cx - 8, 22, cz - 2, cx + 8, 23, cz + 2, V.vermilion);
  lmHipRoof(w, cx, cz, 24, 10, 4, 3, V.darkRoof);
  lmFillColor(w, cx - 6, 27, cz, cx + 6, 27, cz, V.darkRoof);
  // 大提灯(下をくぐれる)
  lmFillColor(w, cx - 2, 16, cz - 1, cx + 2, 21, cz + 1, V.redLantern);
  lmFillColor(w, cx - 2, 16, cz - 1, cx + 2, 16, cz + 1, V.darkWood);
  lmFillColor(w, cx - 2, 21, cz - 1, cx + 2, 21, cz + 1, V.darkWood);
}

/* ---------- 東京タワー ---------- */
function buildTokyoTower(w, cx, cz) {
  const V = LM_COLOR;
  const baseY = 13, topY = 70;
  for (let y = baseY; y <= topY; y++) {
    const t = (y - baseY) / (topY - baseY);
    const hw = Math.max(1, Math.round(8 * Math.pow(1 - t, 1.6)));
    for (let dz = -hw; dz <= hw; dz++) {
      for (let dx = -hw; dx <= hw; dx++) {
        const ax = Math.abs(dx), az = Math.abs(dz);
        let put;
        if (hw >= 5) put = ax >= hw - 1 && az >= hw - 1;   // 4本脚
        else if (hw >= 3) put = ax === hw || az === hw;    // 中空の枠
        else put = true;
        if (put) w.setColor(cx + dx, y, cz + dz, V.towerOrange);
      }
    }
  }
  // メインデッキと特別展望台
  lmFillColor(w, cx - 5, 37, cz - 5, cx + 5, 40, cz + 5, V.towerWhite);
  lmFillColor(w, cx - 5, 38, cz - 5, cx + 5, 38, cz + 5, V.darkWood); // 窓帯
  lmFillColor(w, cx - 2, 56, cz - 2, cx + 2, 58, cz + 2, V.towerWhite);
  // アンテナ
  for (let y = topY + 1; y <= topY + 7; y++) {
    w.setColor(cx, y, cz, (Math.floor(y / 2) % 2) ? V.towerWhite : V.towerOrange);
  }
}

/* ---------- ピラミッド ---------- */
function buildPyramid(w, cx, cz) {
  for (let i = 0; i <= 12; i++) {
    const hw = 12 - i;
    lmFillBlock(w, cx - hw, 13 + i, cz - hw, cx + hw, 13 + i, cz + hw, BLOCK.SAND);
  }
}

/* ---------- 桜 ---------- */
function plantSakura(w, x, z, rand) {
  const y0 = w.heightAt(x, z);
  if (w.get(x, y0, z) !== BLOCK.GRASS) return;
  const h = 3 + Math.floor(rand() * 2);
  for (let dy = h - 1; dy <= h + 1; dy++) {
    const r = dy > h ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.5) continue;
        const y = y0 + dy;
        if (w.get(x + dx, y, z + dz) === BLOCK.AIR) {
          w.setColor(x + dx, y, z + dz, rand() < 0.5 ? LM_COLOR.sakura1 : LM_COLOR.sakura2);
        }
      }
    }
  }
  for (let y = y0 + 1; y <= y0 + h; y++) w.set(x, y, z, BLOCK.LOG);
}

/* ---------- 全体レイアウト ---------- */
function buildLandmarks(w, seed) {
  const rand = mulberry32((seed ^ 0x1a2b) >>> 0);

  buildFuji(w, seed);

  // 敷地を均す(境内・タワー・ピラミッド・スポーン地点)
  lmFlatten(w, 42, 84, 98, 136, 12);
  lmFlatten(w, 112, 86, 136, 114, 12);
  lmFlatten(w, 16, 94, 44, 122, 12);
  lmFlatten(w, 72, 136, 88, 152, 12);

  // 参道(石畳)
  for (let z = 90; z <= 148; z++) {
    for (let x = 77; x <= 83; x++) {
      if (z <= 136 || (z > 136 && x >= 78 && x <= 82)) w.setColor(x, 12, z, LM_COLOR.pathGray);
    }
  }

  buildMainHall(w, 80, 97);
  buildPagoda(w, 52, 98);
  buildKaminarimon(w, 80, 126);
  buildTokyoTower(w, 124, 100);
  buildPyramid(w, 30, 108);

  // 参道沿いの桜
  const spots = [[70, 110], [90, 112], [68, 122], [92, 124], [64, 100], [96, 106], [72, 133], [88, 133]];
  for (const [sx, sz] of spots) plantSakura(w, sx, sz, rand);
}
