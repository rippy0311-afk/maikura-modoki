'use strict';

// 画像 → ボクセル変換
// mode: 'mural'  = 垂直の壁画
//       'relief' = 地面に置き、明るさで高さをつけるレリーフ
//       'flat'   = 地面に1段のドット絵
const IMAGE_MODES = {
  mural:  '壁画(垂直)',
  relief: 'レリーフ(高さつき)',
  flat:   'フラット(1段)',
};

// 画像ファイルを読み込んで ImageData に(最大 maxDim にリサイズ)
function loadImageToPixels(file, maxDim, mode) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // ワールドに収まる上限
      const capW = mode === 'mural' ? WORLD_SX - 10 : WORLD_SX - 10;
      const capH = mode === 'mural' ? WORLD_SY - 20 : WORLD_SZ - 10;
      let w = img.width, h = img.height;
      const scale = Math.min(maxDim / Math.max(w, h), capW / w, capH / h, 1);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

// ImageData をワールド中央に配置する。戻り値はおすすめのカメラ位置。
function placeImageInWorld(world, imageData, mode, groundY) {
  const { width: w, height: h, data } = imageData;
  const cx = Math.floor(world.sx / 2);
  const cz = Math.floor(world.sz / 2);

  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 64) continue; // 透過部分はスキップ
      const rgb = (r << 16) | (g << 8) | b;

      if (mode === 'mural') {
        const x = cx - Math.floor(w / 2) + px;
        const y = groundY + 1 + (h - 1 - py);
        world.setColor(x, y, cz, rgb);
      } else if (mode === 'relief') {
        const x = cx - Math.floor(w / 2) + px;
        const z = cz - Math.floor(h / 2) + py;
        const hh = 1 + Math.round((lum(r, g, b) / 255) * 8);
        for (let dy = 0; dy < hh; dy++) {
          world.setColor(x, groundY + 1 + dy, z, rgb);
        }
      } else { // flat
        const x = cx - Math.floor(w / 2) + px;
        const z = cz - Math.floor(h / 2) + py;
        world.setColor(x, groundY + 1, z, rgb);
      }
    }
  }

  // 見やすいカメラ位置を返す
  if (mode === 'mural') {
    const dist = Math.max(w, h) * 0.9 + 8;
    return {
      pos: { x: cx + 0.5, y: groundY + 1, z: cz + 0.5 + dist },
      yaw: 0,
      pitch: Math.atan2(h * 0.45, dist),
      fly: false,
    };
  }
  // レリーフ / フラットは上空から見下ろす
  const dist = Math.max(w, h) * 0.6 + 8;
  const alt = Math.max(w, h) * 0.55 + 10;
  return {
    pos: { x: cx + 0.5, y: groundY + alt, z: cz + 0.5 + dist },
    yaw: 0,
    pitch: -Math.atan2(alt, dist) * 0.85,
    fly: true,
  };
}
