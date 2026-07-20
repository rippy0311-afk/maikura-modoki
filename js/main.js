'use strict';

/* ============ 基本セットアップ ============ */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const SKY_COLOR = 0x87ceeb;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);
// 初期値。起動時に applyRenderDistance() が描画距離に合わせて上書きする。
scene.fog = new THREE.Fog(SKY_COLOR, 70, 178);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ============ テクスチャ & マテリアル ============ */
const atlasCanvas = makeAtlasCanvas();
const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;

const opaqueMaterial = new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true });
const waterMaterial = new THREE.MeshBasicMaterial({
  map: atlasTexture, vertexColors: true,
  transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide,
});

/* ============ ワールドとチャンクメッシュ ============ */
let world = null;
let currentPreset = 'plains';
let currentSeed = 0;
const chunkMeshes = new Map(); // "cx,cz" -> { opaque: Mesh|null, water: Mesh|null }
let chunkBuildToken = 0;

function makeGeometry(d) {
  if (d.positions.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(d.colors, 3));
  g.setIndex(d.indices);
  return g;
}

function disposeEntry(entry) {
  for (const key of ['opaque', 'water']) {
    const mesh = entry[key];
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
  }
}

function rebuildChunk(cx, cz) {
  const key = cx + ',' + cz;
  const old = chunkMeshes.get(key);
  if (old) disposeEntry(old);

  const data = buildChunkMeshData(world, cx, cz, visualShadowsEnabled);
  const entry = {
    opaque: null,
    water: null,
    centerX: cx * CHUNK + CHUNK / 2,
    centerZ: cz * CHUNK + CHUNK / 2,
  };

  const og = makeGeometry(data.opaque);
  if (og) {
    entry.opaque = new THREE.Mesh(og, opaqueMaterial);
    scene.add(entry.opaque);
  }
  const wg = makeGeometry(data.water);
  if (wg) {
    entry.water = new THREE.Mesh(wg, waterMaterial);
    entry.water.renderOrder = 1;
    scene.add(entry.water);
  }
  chunkMeshes.set(key, entry);
}

function rebuildAllChunks() {
  chunkBuildToken++;
  for (const entry of chunkMeshes.values()) disposeEntry(entry);
  chunkMeshes.clear();
  const nx = Math.ceil(world.sx / CHUNK);
  const nz = Math.ceil(world.sz / CHUNK);
  for (let cz = 0; cz < nz; cz++) {
    for (let cx = 0; cx < nx; cx++) rebuildChunk(cx, cz);
  }
}

async function rebuildAllChunksWithProgress(onProgress) {
  chunkBuildToken++;
  for (const entry of chunkMeshes.values()) disposeEntry(entry);
  chunkMeshes.clear();
  const nx = Math.ceil(world.sx / CHUNK);
  const nz = Math.ceil(world.sz / CHUNK);
  const total = nx * nz;
  let done = 0;
  for (let cz = 0; cz < nz; cz++) {
    for (let cx = 0; cx < nx; cx++) {
      rebuildChunk(cx, cz);
      done++;
    }
    onProgress?.(done / total);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

function getSortedChunkCoords(centerX, centerZ) {
  const nx = Math.ceil(world.sx / CHUNK);
  const nz = Math.ceil(world.sz / CHUNK);
  const centerCx = Math.floor(centerX / CHUNK);
  const centerCz = Math.floor(centerZ / CHUNK);
  const coords = [];
  for (let cz = 0; cz < nz; cz++) {
    for (let cx = 0; cx < nx; cx++) {
      coords.push({ cx, cz, d: Math.hypot(cx - centerCx, cz - centerCz) });
    }
  }
  coords.sort((a, b) => a.d - b.d);
  return coords;
}

async function rebuildNearbyChunksWithProgress(centerX, centerZ, onProgress) {
  chunkBuildToken++;
  for (const entry of chunkMeshes.values()) disposeEntry(entry);
  chunkMeshes.clear();
  const coords = getSortedChunkCoords(centerX, centerZ);
  const initialRadius = Math.max(4, Math.ceil(renderDistance / CHUNK / 3));
  const nearby = coords.filter((coord) => coord.d <= initialRadius);
  const remaining = coords.filter((coord) => coord.d > initialRadius);
  const total = Math.max(1, nearby.length);
  for (let i = 0; i < nearby.length; i++) {
    rebuildChunk(nearby[i].cx, nearby[i].cz);
    if (i % 8 === 7 || i === nearby.length - 1) {
      onProgress?.((i + 1) / total);
      await nextFrame();
    }
  }
  scheduleRemainingChunkBuild(remaining, chunkBuildToken);
}

function scheduleRemainingChunkBuild(coords, token) {
  let index = 0;
  const requestIdle = window.requestIdleCallback || ((callback) => setTimeout(() => callback({ timeRemaining: () => 8 }), 16));
  function work(deadline) {
    if (token !== chunkBuildToken || !world) return;
    while (index < coords.length && deadline.timeRemaining() > 2) {
      const coord = coords[index++];
      rebuildChunk(coord.cx, coord.cz);
    }
    if (index < coords.length) requestIdle(work, { timeout: 100 });
  }
  requestIdle(work, { timeout: 100 });
}

// ブロック編集後、隣接チャンクの境界も含めて再構築
function rebuildAround(x, y, z) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const set = new Set([cx + ',' + cz]);
  if (x % CHUNK === 0 && cx > 0) set.add((cx - 1) + ',' + cz);
  if (x % CHUNK === CHUNK - 1 && (cx + 1) * CHUNK < world.sx) set.add((cx + 1) + ',' + cz);
  if (z % CHUNK === 0 && cz > 0) set.add(cx + ',' + (cz - 1));
  if (z % CHUNK === CHUNK - 1 && (cz + 1) * CHUNK < world.sz) set.add(cx + ',' + (cz + 1));
  for (const key of set) {
    const [a, b] = key.split(',').map(Number);
    rebuildChunk(a, b);
  }
}

/* ============ 描画距離 ============ */
// これより遠いチャンクは描画対象から外す。霧の終端を描画距離より内側に置くことで、
// チャンクが消える瞬間を霧で隠す(差の 14 はチャンク中心から角までの 8√2≒11.3 ぶんの余裕)。
const RENDER_DISTANCE_OPTIONS = [96, 128, 160, 192, 224, 272];
const DEFAULT_RENDER_DISTANCE = 192;
const RENDER_DISTANCE_STORAGE = 'block_world_render_distance';
let renderDistance = DEFAULT_RENDER_DISTANCE;

function loadRenderDistance() {
  const saved = Number(localStorage.getItem(RENDER_DISTANCE_STORAGE));
  return RENDER_DISTANCE_OPTIONS.includes(saved) ? saved : DEFAULT_RENDER_DISTANCE;
}

function applyRenderDistance(value) {
  renderDistance = RENDER_DISTANCE_OPTIONS.includes(value) ? value : DEFAULT_RENDER_DISTANCE;
  const far = renderDistance - 14;
  scene.fog.far = far;
  scene.fog.near = Math.round(far * 0.4);
  localStorage.setItem(RENDER_DISTANCE_STORAGE, String(renderDistance));
}

function setupRenderDistanceUI() {
  const select = document.getElementById('render-distance-select');
  applyRenderDistance(loadRenderDistance());
  select.value = String(renderDistance);
  select.addEventListener('change', () => applyRenderDistance(Number(select.value)));
}

function updateChunkVisibility() {
  const px = player.pos.x, pz = player.pos.z;
  const limit = renderDistance * renderDistance;
  for (const entry of chunkMeshes.values()) {
    const dx = entry.centerX - px;
    const dz = entry.centerZ - pz;
    const visible = dx * dx + dz * dz <= limit;
    if (entry.opaque) entry.opaque.visible = visible;
    if (entry.water) entry.water.visible = visible;
  }
}

function rebuildRegion(x0, z0, x1, z1) {
  const minCx = Math.max(0, Math.floor(Math.min(x0, x1) / CHUNK));
  const maxCx = Math.min(Math.ceil(world.sx / CHUNK) - 1, Math.floor(Math.max(x0, x1) / CHUNK));
  const minCz = Math.max(0, Math.floor(Math.min(z0, z1) / CHUNK));
  const maxCz = Math.min(Math.ceil(world.sz / CHUNK) - 1, Math.floor(Math.max(z0, z1) / CHUNK));
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) rebuildChunk(cx, cz);
  }
}

/* ============ 雲 ============ */
const cloudGroup = new THREE.Group();
{
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82 });
  const rand = mulberry32(777);
  for (let i = 0; i < 22; i++) {
    const w = 10 + rand() * 18, d = 8 + rand() * 14;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), cloudMat);
    mesh.position.set(rand() * WORLD_SX * 1.6 - WORLD_SX * 0.3, 84 + rand() * 8, rand() * WORLD_SZ * 1.6 - WORLD_SZ * 0.3);
    cloudGroup.add(mesh);
  }
  scene.add(cloudGroup);
}

/* ============ プレイヤー & 入力 ============ */
const player = new Player();
const keys = new Set();
const touchKeys = new Set();
let pointerLocked = false;
let touchPlayActive = false;
const touchMove = { x: 0, z: 0 };
let miningHeld = false;
let miningCooldown = 0;
const MINING_REPEAT_INTERVAL = 0.11;
let miningTarget = null;
let miningProgress = 0;
let placingHeld = false;
let placeCooldown = 0;
let lastPlaceTime = 0;
const PLACE_COOLDOWN = 0.18;
const LANGUAGE_STORAGE = 'block_world_language';
const UI_TEXT = {
  ja: {
    title: 'ブロックワールド',
    pageTitle: 'ブロックワールド — マイクラ風3D',
    play: 'プレイ',
    settings: '設定',
    exit: '終了',
    resume: '再開',
  },
  en: {
    title: 'BLOCK WORLD',
    pageTitle: 'BLOCK WORLD — Voxel 3D',
    play: 'Play',
    settings: 'Settings',
    exit: 'Exit',
    resume: 'Resume',
  },
};
let currentLanguage = localStorage.getItem(LANGUAGE_STORAGE) === 'en' ? 'en' : 'ja';
let gameMode = 'creative';
const KEY_BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  ascend: 'Space',
  sprint: 'ShiftLeft',
  descend: 'ShiftLeft',
  inventory: 'KeyE',
  chat: 'Slash',
  screenshot: 'KeyP',
};
const KEY_CONFIG_ITEMS = [
  { id: 'forward', label: '前へ進む' },
  { id: 'back', label: '後ろへ下がる' },
  { id: 'left', label: '左へ移動' },
  { id: 'right', label: '右へ移動' },
  { id: 'jump', label: 'ジャンプ' },
  { id: 'ascend', label: '上昇' },
  { id: 'sprint', label: 'ダッシュ' },
  { id: 'descend', label: '下降' },
  { id: 'inventory', label: 'インベントリー' },
  { id: 'chat', label: 'チャットを開く' },
  { id: 'screenshot', label: 'スクリーンショット' },
];
let rebindingAction = null;
let lastKeyTapCode = '';
let lastKeyTapTime = 0;
let inventoryOpen = false;
let openingInventory = false;
let suppressPauseAfterInventoryClose = false;
let selectedInventorySlot = 'hotbar-0';
let selectedInventoryItem = null;
const chatState = {
  roomId: Math.random().toString(36).slice(2, 8).toUpperCase(),
  messages: [],
  allowed: [],
  collapsed: false,
  socket: null,
  socketRoomId: '',
};
const MAX_HP = 20;
let playerHp = MAX_HP;
let damageCooldown = 0;
let breathTimer = 0;
let regenTimer = 0;
const SAVE_COOKIE_NAME = 'block_world_save';
const WORLD_LIST_STORAGE = 'block_world_worlds';
const VISUAL_SHADOWS_STORAGE = 'block_world_visual_shadows';
let lastSaveTime = 0;
let lastCookieSaveTime = 0;
let lastSavedPayload = '';
let activeWorldId = null;
let visualShadowsEnabled = localStorage.getItem(VISUAL_SHADOWS_STORAGE) !== 'off';
let blockColorOverrides = {};
let blockTextureOverrides = {};
let textureEditorBlockId = BLOCK.GRASS;
let textureEditorPaintColor = '#3c7828';
let textureEditorMouseDown = false;
let textureEditorRefreshPending = false;
let textureEditorDraft = null;

function normalizeBlockColors(raw) {
  const colors = {};
  if (!raw || typeof raw !== 'object') return colors;
  for (const item of HOTBAR_BLOCKS) {
    const color = raw[item.id];
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) colors[item.id] = color.toLowerCase();
  }
  return colors;
}

function normalizeBlockTextures(raw) {
  const textures = {};
  if (!raw || typeof raw !== 'object') return textures;
  for (const item of HOTBAR_BLOCKS) {
    const pixels = raw[item.id];
    if (Array.isArray(pixels) && pixels.length === TILE_PX * TILE_PX &&
        pixels.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
      textures[item.id] = pixels.map((color) => color.toLowerCase());
    }
  }
  return textures;
}

function makeSolidTexture(color) {
  const safeColor = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#8b8f98';
  return Array(TILE_PX * TILE_PX).fill(safeColor);
}

function getBlockDisplayColor(blockId) {
  const texture = blockTextureOverrides[blockId];
  if (texture?.[0]) return texture[0];
  const override = blockColorOverrides[blockId];
  if (override) return override;
  return HOTBAR_BLOCKS.find((item) => item.id === blockId)?.color || '#8b8f98';
}

/* ============ ブロックのアイコン ============ */
// UI のスウォッチは単色だと石・石炭鉱石・鉄鉱石が見分けられない。
// 実際に描画に使っているアトラスから該当タイルを切り出してアイコンにする。
const blockIconCache = new Map();

function blockIconUrl(blockId) {
  if (blockIconCache.has(blockId)) return blockIconCache.get(blockId);
  // 描画側(buildChunkMeshData)と同じ規則でタイルを選ぶ。
  // 側面を使うのは、草の縁や木の樹皮が出て見分けやすいため。
  const tileIdx = Array.isArray(blockTextureOverrides[blockId])
    ? customTileForBlock(blockId)
    : tileForFace(blockId, 0);
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  canvas.getContext('2d').drawImage(
    atlasCanvas,
    (tileIdx % ATLAS_COLS) * TILE_PX, Math.floor(tileIdx / ATLAS_COLS) * TILE_PX, TILE_PX, TILE_PX,
    0, 0, TILE_PX, TILE_PX
  );
  const url = canvas.toDataURL();
  blockIconCache.set(blockId, url);
  return url;
}

// 所持数表のキー(ブロックIDなら画像、アイテムIDなら単色)からスウォッチの style を作る
function swatchStyle(key, fallbackColor) {
  const blockId = Number(key);
  if (Number.isInteger(blockId) && BLOCK_TILES[blockId]) {
    return `background-image:url(${blockIconUrl(blockId)});background-size:cover;image-rendering:pixelated`;
  }
  return `background:${fallbackColor || '#8b8f98'}`;
}

function applyBlockColorOverrides() {
  blockIconCache.clear();   // テクスチャを編集したらアイコンも作り直す
  blockColorOverrides = normalizeBlockColors(blockColorOverrides);
  blockTextureOverrides = normalizeBlockTextures(blockTextureOverrides);
  const baseAtlas = makeAtlasCanvas();
  const ctx = atlasCanvas.getContext('2d');
  ctx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  ctx.drawImage(baseAtlas, 0, 0);
  drawCustomBlockTextures(atlasCanvas, blockTextureOverrides);
  atlasTexture.needsUpdate = true;
  if (world) {
    world.blockColors = { ...blockColorOverrides };
    world.blockTextures = { ...blockTextureOverrides };
  }
}

function scheduleTextureEditorRefresh() {
  if (textureEditorRefreshPending) return;
  textureEditorRefreshPending = true;
  requestAnimationFrame(() => {
    textureEditorRefreshPending = false;
    applyBlockColorOverrides();
    rebuildAllChunks();
    buildHotbar();
    if (inventoryOpen) renderInventoryScreen();
    saveGameState(true);
  });
}

async function applyTextureEditorDraft() {
  if (!textureEditorDraft) return;
  const block = HOTBAR_BLOCKS.find((item) => item.id === textureEditorBlockId);
  const blockName = block?.label || 'ブロック';

  try {
    setLoadingProgress(0.08, `「${blockName}」の見た目を保存中...`);
    await nextFrame();

    blockTextureOverrides[textureEditorBlockId] = textureEditorDraft.slice();
    setLoadingProgress(0.25, 'テクスチャを作り直し中...');
    await nextFrame();
    applyBlockColorOverrides();

    if (world) {
      setLoadingProgress(0.45, 'ワールドのブロック表示を更新中...');
      await rebuildAllChunksWithProgress((progress) => {
        setLoadingProgress(0.45 + progress * 0.4, 'ワールドのブロック表示を更新中...');
      });
    }

    setLoadingProgress(0.9, 'ホットバーとインベントリーを更新中...');
    await nextFrame();
    buildHotbar();
    if (inventoryOpen) renderInventoryScreen();
    saveGameState(true);

    setLoadingProgress(1, '完了');
    await nextFrame();
  } finally {
    hideLoadingProgress();
  }
}

function setSaveCookie(value) {
  const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${SAVE_COOKIE_NAME}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

function getSaveCookie() {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${SAVE_COOKIE_NAME}=`))
    ?.slice(SAVE_COOKIE_NAME.length + 1);
}

function loadSavedGame() {
  const raw = getSaveCookie() || localStorage.getItem(SAVE_COOKIE_NAME);
  if (!raw) return null;
  try {
    const data = JSON.parse(decodeURIComponent(raw));
    if (!data || data.version !== 1 || !PRESETS[data.preset]) return null;
    return data;
  } catch (err) {
    console.warn('Invalid saved game state', err);
    return null;
  }
}

function saveGameState(force = false) {
  if (!world || !player || !activeWorldId) return;
  const now = performance.now();
  if (!force && now - lastSaveTime < 10000) return;
  lastSaveTime = now;
  const state = makeCurrentState();
  const encoded = encodeURIComponent(JSON.stringify(state));
  if (!force && encoded === lastSavedPayload) return;
  lastSavedPayload = encoded;
  localStorage.setItem(SAVE_COOKIE_NAME, encoded);
  if (encoded.length < 3800 && (force || now - lastCookieSaveTime > 30000)) {
    setSaveCookie(encoded);
    lastCookieSaveTime = now;
  }
  updateActiveWorldState(state);
}

function restorePlayerState(saved) {
  if (!saved || !world.inBounds(Math.floor(saved.x), Math.floor(saved.y), Math.floor(saved.z))) return false;
  player.pos = { x: saved.x, y: saved.y, z: saved.z };
  player.vel = { x: 0, y: 0, z: 0 };
  player.yaw = saved.yaw;
  player.pitch = saved.pitch;
  player.fly = Boolean(saved.fly && saved.mode === 'creative');
  restoreArmorState(saved.armor);
  playerHp = Math.max(1, Math.min(MAX_HP, Number(saved.hp) || MAX_HP));
  updateHpUI();
  return true;
}

function loadWorldList() {
  try {
    const list = JSON.parse(localStorage.getItem(WORLD_LIST_STORAGE) || '[]');
    return Array.isArray(list) ? list.filter((item) => item && item.id && PRESETS[item.preset]) : [];
  } catch (err) {
    console.warn('Invalid world list', err);
    return [];
  }
}

function saveWorldList(list) {
  localStorage.setItem(WORLD_LIST_STORAGE, JSON.stringify(list));
}

function updateActiveWorldState(state) {
  if (!activeWorldId) return;
  const list = loadWorldList();
  const index = list.findIndex((item) => item.id === activeWorldId);
  if (index < 0) return;
  list[index] = { ...list[index], ...state, updatedAt: Date.now() };
  saveWorldList(list);
}

function makeCurrentState() {
  return {
    version: 1,
    worldId: activeWorldId,
    preset: currentPreset,
    seed: currentSeed,
    mode: gameMode,
    hp: playerHp,
    armor: getArmorState(),
    fly: player.fly,
    blockColors: { ...blockColorOverrides },
    blockTextures: { ...blockTextureOverrides },
    worldEdits: world.exportEdits(),
    x: Number(player.pos.x.toFixed(3)),
    y: Number(player.pos.y.toFixed(3)),
    z: Number(player.pos.z.toFixed(3)),
    yaw: Number(player.yaw.toFixed(5)),
    pitch: Number(player.pitch.toFixed(5)),
    savedAt: Date.now(),
  };
}

function randomPresetKey() {
  const keys = Object.keys(PRESETS).filter((key) => key !== 'flat');
  return keys[Math.floor(Math.random() * keys.length)] || 'plains';
}

function renderWorldList() {
  const box = document.getElementById('world-list');
  if (!box) return;
  box.innerHTML = '';

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'world-card add-world';
  add.textContent = '+';
  add.addEventListener('click', createRandomWorld);
  box.appendChild(add);

  loadWorldList().forEach((worldInfo) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'world-card';
    const presetLabel = PRESETS[worldInfo.preset]?.label || worldInfo.preset;
    const name = document.createElement('b');
    name.textContent = worldInfo.name;
    const preset = document.createElement('small');
    preset.textContent = presetLabel;
    card.appendChild(name);
    card.appendChild(preset);
    card.addEventListener('click', () => enterWorld(worldInfo));
    box.appendChild(card);
  });
}

function showTitleMenu() {
  activeWorldId = null;
  closeChatSocket();
  touchPlayActive = false;
  clearMovementState();
  if (pointerLocked && document.exitPointerLock) document.exitPointerLock();
  panel.classList.remove('hidden', 'settings-open', 'world-select-open', 'pause-open');
  applyLanguage();
  overlay.style.display = 'none';
}

function showWorldSelect() {
  panel.classList.remove('hidden', 'settings-open', 'pause-open');
  panel.classList.add('world-select-open');
  renderWorldList();
  overlay.style.display = 'none';
}

function createRandomWorld() {
  const list = loadWorldList();
  const record = {
    id: `world_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: `World ${list.length + 1}`,
    preset: randomPresetKey(),
    seed: (Math.random() * 0xffffffff) >>> 0,
    mode: gameMode,
    blockColors: {},
    blockTextures: {},
    worldEdits: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  list.push(record);
  saveWorldList(list);
  enterWorld(record);
}

async function enterWorld(worldInfo) {
  activeWorldId = worldInfo.id;
  gameMode = worldInfo.mode === 'survival' ? 'survival' : 'creative';
  blockColorOverrides = normalizeBlockColors(worldInfo.blockColors);
  blockTextureOverrides = normalizeBlockTextures(worldInfo.blockTextures);
  textureEditorDraft = null;
  const modeSelect = document.getElementById('game-mode-select');
  if (modeSelect) modeSelect.value = gameMode;
  await regenerate(worldInfo.preset, worldInfo.seed, worldInfo);
  ensureChatSocket();
  resumeGame();
}

const overlay = document.getElementById('overlay');
const panel = document.getElementById('panel');
const hudPos = document.getElementById('hud-pos');
const hudMode = document.getElementById('hud-mode');
const waterOverlay = document.getElementById('water-overlay');
const loadingScreen = document.getElementById('loading-screen');
const loadingFill = document.getElementById('loading-fill');
const loadingText = document.getElementById('loading-text');

function setLoadingProgress(progress, text = 'ロード中...') {
  if (!loadingScreen || !loadingFill || !loadingText) return;
  loadingScreen.style.display = 'flex';
  loadingText.textContent = text;
  loadingFill.style.width = `${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`;
}

function hideLoadingProgress() {
  if (loadingScreen) loadingScreen.style.display = 'none';
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function applyLanguage() {
  const text = UI_TEXT[currentLanguage];
  document.documentElement.lang = currentLanguage;
  document.title = text.pageTitle;

  const titleLogo = document.getElementById('title-logo');
  if (titleLogo) {
    titleLogo.textContent = text.title;
    titleLogo.classList.toggle('lang-ja', currentLanguage === 'ja');
    titleLogo.classList.toggle('lang-en', currentLanguage === 'en');
  }

  const resumeButton = document.getElementById('btn-resume');
  const settingsButton = document.getElementById('btn-settings');
  const exitButton = document.getElementById('btn-exit');
  if (resumeButton) resumeButton.textContent = panel?.classList.contains('pause-open') ? text.resume : text.play;
  if (settingsButton) settingsButton.textContent = text.settings;
  if (exitButton) exitButton.textContent = text.exit;

  document.getElementById('btn-lang-ja')?.classList.toggle('active', currentLanguage === 'ja');
  document.getElementById('btn-lang-en')?.classList.toggle('active', currentLanguage === 'en');
}

function setLanguage(language) {
  currentLanguage = language === 'en' ? 'en' : 'ja';
  localStorage.setItem(LANGUAGE_STORAGE, currentLanguage);
  applyLanguage();
}

function hasTouchControls() {
  return window.matchMedia('(pointer: coarse), (max-width: 900px)').matches || navigator.maxTouchPoints > 0;
}

function startTouchPlay() {
  if (!activeWorldId) {
    showWorldSelect();
    return;
  }
  touchPlayActive = true;
  panel.classList.remove('settings-open', 'world-select-open', 'pause-open');
  panel.classList.add('hidden');
  overlay.style.display = 'none';
}

function resumeGame() {
  if (!activeWorldId) {
    showWorldSelect();
    return;
  }
  panel.classList.remove('settings-open', 'world-select-open', 'pause-open');
  if (hasTouchControls()) {
    startTouchPlay();
    return;
  }
  panel.classList.add('hidden');
  overlay.style.display = 'none';
  if (!pointerLocked && canvas.requestPointerLock) canvas.requestPointerLock();
}

function isUiInputTarget(target) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName);
}

function isActionKey(e, actionId) {
  const binding = KEY_BINDINGS[actionId];
  if (e.code === binding) return true;
  if (actionId === 'chat' && binding === 'Slash' && e.key === '/') return true;
  return false;
}

function clearMovementState() {
  keys.clear();
  touchKeys.clear();
  touchMove.x = 0;
  touchMove.z = 0;
  miningHeld = false;
  placingHeld = false;
  clearMiningProgress();
}

function openPauseMenu() {
  if (!activeWorldId) {
    showTitleMenu();
    return;
  }
  touchPlayActive = false;
  clearMovementState();
  if (pointerLocked && document.exitPointerLock) document.exitPointerLock();
  panel.classList.remove('hidden', 'world-select-open', 'settings-open');
  panel.classList.add('pause-open');
  applyLanguage();
  overlay.style.display = 'none';
}

function handleEscapeKey(e) {
  e.preventDefault();

  if (rebindingAction) {
    rebindingAction = null;
    clearMovementState();
    updateKeyConfigUI();
    return;
  }

  if (inventoryOpen) {
    setInventoryOpen(false);
    return;
  }

  if (isUiInputTarget(document.activeElement)) {
    document.activeElement.blur();
    if (panel.classList.contains('hidden')) resumeGame();
    return;
  }

  if (!panel.classList.contains('hidden')) {
    if (panel.classList.contains('world-select-open')) showTitleMenu();
    else if (panel.classList.contains('pause-open')) resumeGame();
    else resumeGame();
    return;
  }

  openPauseMenu();
}

canvas.addEventListener('click', () => {
  if (!pointerLocked && !touchPlayActive) resumeGame();
});

function openChatInput(prefill = '') {
  const chatLog = document.getElementById('chat-log');
  const chatForm = document.getElementById('chat-form');
  const collapseButton = document.getElementById('btn-chat-collapse');
  const input = document.getElementById('chat-input');
  if (!input) return;
  chatState.collapsed = false;
  if (chatLog) chatLog.style.display = 'block';
  if (chatForm) chatForm.style.display = 'grid';
  if (collapseButton) collapseButton.textContent = '最小化';
  miningHeld = false;
  if (pointerLocked && document.exitPointerLock) document.exitPointerLock();
  input.value = prefill;
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
}
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked) {
    miningHeld = false;
    placingHeld = false;
    clearMiningProgress();
  }
  if (openingInventory || inventoryOpen || suppressPauseAfterInventoryClose) {
    panel.classList.add('hidden');
    overlay.style.display = 'none';
    openingInventory = false;
    suppressPauseAfterInventoryClose = false;
    return;
  }
  if (!pointerLocked && activeWorldId && panel.classList.contains('hidden')) {
    overlay.style.display = 'none';
    return;
  }
  if (!pointerLocked && panel.classList.contains('pause-open')) {
    overlay.style.display = 'none';
    return;
  }
  panel.classList.toggle('hidden', pointerLocked);
  overlay.style.display = (pointerLocked || touchPlayActive) ? 'none' : 'flex';
});

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  player.yaw -= e.movementX * 0.0024;
  player.pitch -= e.movementY * 0.0024;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    handleEscapeKey(e);
    return;
  }
  if (isUiInputTarget(e.target)) return;
  if (rebindingAction) {
    e.preventDefault();
    KEY_BINDINGS[rebindingAction] = e.code;
    rebindingAction = null;
    clearMovementState();
    updateKeyConfigUI();
    return;
  }
  if (isActionKey(e, 'inventory')) {
    e.preventDefault();
    setInventoryOpen(!inventoryOpen);
    return;
  }
  if (isActionKey(e, 'chat')) {
    e.preventDefault();
    setInventoryOpen(false);
    openChatInput(e.key === '/' ? '/' : '');
    return;
  }
  keys.add(e.code);
  const now = performance.now();
  if (!e.repeat && e.code === lastKeyTapCode && now - lastKeyTapTime < 280) {
    toggleFlyMode();
    lastKeyTapCode = '';
    lastKeyTapTime = 0;
  } else if (!e.repeat && e.code !== 'Escape') {
    lastKeyTapCode = e.code;
    lastKeyTapTime = now;
  }
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= HOTBAR_SIZE) selectHotbar(n - 1);
  }
  if (isActionKey(e, 'screenshot')) saveScreenshot();
  if (isActionKey(e, 'jump') || isActionKey(e, 'ascend')) e.preventDefault();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  touchKeys.clear();
  touchMove.x = 0;
  touchMove.z = 0;
  miningHeld = false;
  placingHeld = false;
  clearMiningProgress();
});

/* ============ ブロックの破壊・設置 ============ */
function gameModeLabel() {
  return gameMode === 'survival' ? 'サバイバル' : 'クリエイティブ';
}

function resetPlayerHp() {
  playerHp = MAX_HP;
  damageCooldown = 0;
  breathTimer = 0;
  regenTimer = 0;
  updateHpUI();
}

function damagePlayer(amount) {
  if (gameMode !== 'survival' || damageCooldown > 0) return;
  const actualDamage = reduceDamageByArmor(amount);
  playerHp = Math.max(0, playerHp - actualDamage);
  damageCooldown = 0.6;
  updateHpUI();
  if (playerHp <= 0) {
    player.spawn(world);
    resetPlayerHp();
  }
}

function healPlayer(amount) {
  if (gameMode !== 'survival' || playerHp >= MAX_HP) return;
  playerHp = Math.min(MAX_HP, playerHp + amount);
  updateHpUI();
}

function updateHpUI() {
  const fullHearts = Math.ceil(playerHp / 2);
  const heartsText = '♥'.repeat(fullHearts) + '♡'.repeat(10 - fullHearts);
  const fillWidth = `${(playerHp / MAX_HP) * 100}%`;
  const labelText = `${playerHp} / ${MAX_HP}`;

  [
    ['hp-hearts', 'hp-fill', 'hp-label'],
    ['hud-hp-hearts', 'hud-hp-fill', 'hud-hp-label'],
  ].forEach(([heartsId, fillId, labelId]) => {
    const hearts = document.getElementById(heartsId);
    const fill = document.getElementById(fillId);
    const label = document.getElementById(labelId);
    if (!hearts || !fill || !label) return;
    hearts.textContent = heartsText;
    fill.style.width = fillWidth;
    label.textContent = labelText;
  });
}

function updateSurvivalStats(dt) {
  if (damageCooldown > 0) damageCooldown = Math.max(0, damageCooldown - dt);
  if (gameMode !== 'survival') return;

  if (player.landedFallSpeed > 13) {
    damagePlayer(Math.ceil((player.landedFallSpeed - 13) * 0.55));
    player.landedFallSpeed = 0;
  }

  const eye = player.eyePos();
  const headBlock = world.get(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
  if (headBlock === BLOCK.WATER) {
    breathTimer += dt;
    if (breathTimer > 7) {
      damagePlayer(1);
      breathTimer = 6.2;
    }
  } else {
    breathTimer = Math.max(0, breathTimer - dt * 2);
  }

  if (player.pos.y < -8) damagePlayer(4);

  if (playerHp < MAX_HP && player.onGround && breathTimer <= 0 && damageCooldown <= 0) {
    regenTimer += dt;
    if (regenTimer >= 4) {
      healPlayer(1);
      regenTimer = 0;
    }
  } else {
    regenTimer = 0;
  }
}

function getCatalogItem(id) {
  if (typeof MINECRAFT_GENERAL_CATALOG === 'undefined') return null;
  return MINECRAFT_GENERAL_CATALOG.find((item) => item.id === id) || null;
}

function getCreativeCatalogItems() {
  const hotbarItems = HOTBAR_BLOCKS.map((item) => makeSlotItem(item.id, item.label, 1, getBlockDisplayColor(item.id)));
  const resources = RESOURCE_ITEMS.map((item) => makeSlotItem(item.id, item.label, 1, item.color));
  const seen = new Set();
  return hotbarItems.concat(resources).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}


function getInventoryItemDefinition(id) {
  const block = HOTBAR_BLOCKS.find((item) => String(item.id) === String(id));
  if (block) return makeSlotItem(block.id, block.label, getBlockInventoryCount(block.id), getBlockDisplayColor(block.id));
  const resource = RESOURCE_ITEMS.find((item) => item.id === id);
  if (resource) return makeSlotItem(resource.id, resource.label, getInventoryCount(resource.id), resource.color);
  const craftItem = CRAFT_ITEMS[id];
  if (craftItem) return makeSlotItem(id, craftItem.label, getInventoryCount(id), craftItem.color);
  const catalogItem = getCatalogItem(id);
  if (catalogItem) return makeSlotItem(catalogItem.id, catalogItem.label, 1, catalogItem.color || '#8b8f98');
  return null;
}

function normalizeSlotItem(item) {
  if (!item) return null;
  return getInventoryItemDefinition(item.id) || cloneSlotItem(item);
}

function getSlotArray(slotId) {
  if (slotId.startsWith('hotbar-')) return { slots: hotbarSlots, index: Number(slotId.slice(7)) };
  if (slotId.startsWith('main-')) return { slots: mainInventorySlots, index: Number(slotId.slice(5)) };
  return null;
}

function getSlotItem(slotId) {
  const target = getSlotArray(slotId);
  if (!target || Number.isNaN(target.index)) return null;
  return target.slots[target.index] || null;
}

function setSlotItem(slotId, item) {
  const target = getSlotArray(slotId);
  if (!target || Number.isNaN(target.index)) return false;
  target.slots[target.index] = item ? normalizeSlotItem(item) : null;
  return true;
}

function isMovableInventorySlot(slotId) {
  return slotId.startsWith('hotbar-') || slotId.startsWith('main-');
}

function syncMainInventorySlots() {
  for (let i = 0; i < mainInventorySlots.length; i++) {
    const item = mainInventorySlots[i];
    if (!item) continue;
    const count = gameMode === 'survival' ? getInventoryCount(item.id) : 1;
    mainInventorySlots[i] = count > 0 ? normalizeSlotItem(item) : null;
  }
  if (gameMode !== 'survival') return;

  const ownedItems = HOTBAR_BLOCKS.map((item) => getInventoryItemDefinition(item.id))
    .concat(RESOURCE_ITEMS.map((item) => getInventoryItemDefinition(item.id)))
    .concat(Object.keys(CRAFT_ITEMS).map((itemId) => getInventoryItemDefinition(itemId)))
    .filter((item) => item && item.count > 0);

  ownedItems.forEach((item) => {
    if (mainInventorySlots.some((slot) => slot && String(slot.id) === String(item.id))) return;
    if (hotbarSlots.some((slot) => slot && String(slot.id) === String(item.id))) return;
    const empty = mainInventorySlots.indexOf(null);
    if (empty >= 0) mainInventorySlots[empty] = item;
  });
}

function moveInventorySlot(sourceSlotId, targetSlotId, item) {
  if (!isMovableInventorySlot(targetSlotId)) return false;
  const sourceIsMovable = sourceSlotId && isMovableInventorySlot(sourceSlotId);
  const sourceItem = sourceIsMovable ? getSlotItem(sourceSlotId) : normalizeSlotItem(item);
  if (!sourceItem || sourceSlotId === targetSlotId) return false;
  const targetItem = getSlotItem(targetSlotId);
  setSlotItem(targetSlotId, sourceItem);
  if (sourceIsMovable) setSlotItem(sourceSlotId, targetItem);
  if (targetSlotId.startsWith('hotbar-')) selectHotbar(Number(targetSlotId.slice(7)));
  buildHotbar();
  renderInventoryScreen();
  saveGameState(true);
  return true;
}

function renderMcSlot(parent, item = null, slotId = '', onSelect = null) {
  const slot = document.createElement('div');
  slot.className = 'mc-slot' + (slotId && selectedInventorySlot === slotId ? ' selected' : '');
  if (slotId) slot.dataset.slotId = slotId;
  if (item && item.count > 0) {
    slot.title = item.label;
    slot.innerHTML = `<div class="swatch" style="${swatchStyle(item.id, item.color)}"></div><span>${item.label}</span><span class="count">${item.count > 1 ? item.count : ''}</span>`;
    slot.draggable = true;
    slot.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify(cloneSlotItem(item)));
      e.dataTransfer.effectAllowed = 'copy';
    });
  }
  if (slotId.startsWith('hotbar-')) {
    const index = Number(slotId.slice(7));
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      try {
        hotbarSlots[index] = cloneSlotItem(JSON.parse(raw));
        selectHotbar(index);
        buildHotbar();
        renderInventoryScreen();
      } catch (err) {
        console.warn('Invalid dragged item', err);
      }
    });
  }
  if (onSelect) {
    slot.addEventListener('click', () => {
      selectedInventorySlot = slotId;
      onSelect(item, slotId);
      renderInventoryScreen();
    });
  }
  parent.appendChild(slot);
}

function getMainInventoryItems() {
  // 持っているものだけを並べる。ブロック・資源・クラフト品をすべて対象にする。
  const blocks = HOTBAR_BLOCKS
    .filter((item) => getBlockInventoryCount(item.id) > 0)
    .map((item) => makeSlotItem(item.id, item.label, getBlockInventoryCount(item.id), item.color));
  const resources = RESOURCE_ITEMS
    .filter((item) => getInventoryCount(item.id) > 0)
    .map((item) => makeSlotItem(item.id, item.label, getInventoryCount(item.id), item.color));
  const crafted = Object.entries(CRAFT_ITEMS)
    .filter(([itemId]) => getInventoryCount(itemId) > 0)
    .map(([itemId, item]) => makeSlotItem(itemId, item.label, getInventoryCount(itemId), item.color));
  return blocks.concat(resources, crafted).slice(0, 27);
}

function renderInventoryScreen() {
  document.getElementById('inventory-layout').classList.toggle('survival-layout', gameMode !== 'creative');
  const creativeCatalog = document.getElementById('creative-catalog');
  const creativeGrid = document.getElementById('creative-catalog-grid');
  creativeCatalog.classList.toggle('active', gameMode === 'creative');
  creativeGrid.innerHTML = '';
  if (gameMode === 'creative') {
    getCreativeCatalogItems().forEach((item, i) => {
      renderMcSlot(creativeGrid, item, `creative-${i}`, (selected) => {
        selectedInventoryItem = selected;
      });
    });
  }

  const armorGrid = document.getElementById('armor-grid');
  armorGrid.innerHTML = '';
  ARMOR_ITEM_IDS.forEach((itemId, i) => {
    const equippedItemId = equippedArmor[i];
    const item = equippedItemId ? CRAFT_ITEMS[equippedItemId] : null;
    renderMcSlot(
      armorGrid,
      item ? makeSlotItem(equippedItemId, `${ARMOR_SLOT_LABELS[i]}: ${item.label}`, 1, item.color) : makeSlotItem(itemId, ARMOR_SLOT_LABELS[i], 0, '#4b5563'),
      `armor-${i}`,
      () => {
        if (!unequipArmor(i)) return;
        updateSurvivalUI();
        renderInventoryScreen();
        saveGameState(true);
      }
    );
  });

  const offhand = document.getElementById('offhand-slot');
  offhand.innerHTML = '';
  renderMcSlot(offhand, null, 'offhand-0', () => {});

  renderCraftRecipes();

  const mainGrid = document.getElementById('main-inventory-grid');
  mainGrid.innerHTML = '';
  const mainItems = getMainInventoryItems();
  for (let i = 0; i < 27; i++) renderMcSlot(mainGrid, mainItems[i] || null, `main-${i}`, (item) => {
    if (item && getArmorSlotIndex(item.id) >= 0 && equipArmor(item.id)) {
      updateSurvivalUI();
      saveGameState(true);
      return;
    }
    selectedInventoryItem = item;
  });

  const hotbarGrid = document.getElementById('inventory-hotbar-grid');
  hotbarGrid.innerHTML = '';
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const item = hotbarSlots[i];
    renderMcSlot(
      hotbarGrid,
      item ? makeSlotItem(item.id, item.label, gameMode === 'survival' && typeof item.id === 'number' ? getBlockInventoryCount(item.id) : 1, typeof item.id === 'number' ? getBlockDisplayColor(item.id) : item.color) : null,
      `hotbar-${i}`,
      () => selectHotbar(i)
    );
  }
}

function renderCraftRecipes() {
  const box = document.getElementById('craft-recipes');
  if (!box) return;
  box.innerHTML = '';
  RECIPES.forEach((recipe) => {
    const ready = canCraft(recipe);
    const row = document.createElement('div');
    row.className = 'craft-row' + (ready ? ' ready' : '');

    const name = document.createElement('div');
    name.className = 'craft-name';
    name.innerHTML =
      `<span class="swatch" style="${swatchStyle(recipeOutputKey(recipe), craftKeyColor(recipeOutputKey(recipe)))}"></span>` +
      `<span>${recipeLabel(recipe)}<span class="craft-need">${recipeInputText(recipe)}</span></span>`;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '作る';
    button.disabled = !ready;
    button.addEventListener('click', () => {
      if (!craft(recipe)) return;
      renderInventoryScreen();
    });

    row.appendChild(name);
    row.appendChild(button);
    box.appendChild(row);
  });
}

function setInventoryOpen(open) {
  const wasOpen = inventoryOpen;
  inventoryOpen = open;
  if (inventoryOpen) miningHeld = false;
  const screen = document.getElementById('inventory-screen');
  screen.classList.toggle('open', inventoryOpen);
  if (inventoryOpen) {
    if (pointerLocked && document.exitPointerLock) {
      openingInventory = true;
      document.exitPointerLock();
    }
    panel.classList.add('hidden');
    overlay.style.display = 'none';
    renderInventoryScreen();
  } else {
    openingInventory = false;
    if (wasOpen) {
      suppressPauseAfterInventoryClose = true;
      setTimeout(() => {
        resumeGame();
        setTimeout(() => { suppressPauseAfterInventoryClose = false; }, 120);
      }, 0);
    }
  }
}

// 拾ったブロックを空いているホットバー枠に自動で入れる。
// これが無いと、集めたブロックが画面のどこにも出ず、置くこともできない。
function autoAssignHotbarSlot(blockId) {
  if (hotbarSlots.some((slot) => slot && slot.id === blockId)) return;
  const empty = hotbarSlots.indexOf(null);
  if (empty < 0) return;
  const def = HOTBAR_BLOCKS.find((item) => item.id === blockId);
  if (!def) return;
  hotbarSlots[empty] = makeSlotItem(def.id, def.label, 1, def.color);
}

// クリエイティブは壊しても何も手に入らない代わりにブロックが無限に使える。
// ホットバーが空のままだと何も置けないので、空き枠を既定のブロックで埋める。
function ensureCreativeHotbar() {
  if (gameMode !== 'creative') return;
  HOTBAR_BLOCKS.slice(0, HOTBAR_SIZE).forEach((def, i) => {
    if (!hotbarSlots[i]) hotbarSlots[i] = makeSlotItem(def.id, def.label, 1, def.color);
  });
}

function addBlockToInventory(blockId, amount) {
  if (blockId === BLOCK.AIR || blockId === BLOCK.WATER || blockId === BLOCK.COLOR ||
      blockId === BLOCK.CHEST || blockId === BLOCK.ITEM_NODE || blockId === BLOCK.BEDROCK) return;
  addInventoryCount(blockId, amount);
  autoAssignHotbarSlot(blockId);
  const resourceId = RESOURCE_DROPS[blockId];
  if (resourceId) addInventoryCount(resourceId, amount);
  updateSurvivalUI();
  if (inventoryOpen) renderInventoryScreen();
}

function addItemToInventory(itemId, amount) {
  addInventoryCount(itemId, amount);
  updateSurvivalUI();
  if (inventoryOpen) renderInventoryScreen();
}

function collectLootChest(x, y, z) {
  const items = world.takeLootChest(x, y, z);
  items.forEach((item) => addItemToInventory(item.id, item.count));
}

function collectItemNode(x, y, z) {
  const item = world.takeItemNode(x, y, z);
  if (!item) return;
  addItemToInventory(item.id, item.count);
}

function getSurvivalDropBlockId(blockId) {
  const selectedTool = getSelectedToolId();
  const needsPickaxe = [BLOCK.STONE, BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.BRICK].includes(blockId);
  if (needsPickaxe && selectedTool !== 'pickaxe') return null;
  if (blockId === BLOCK.LEAVES && selectedTool !== 'shears') return null;
  if (blockId === BLOCK.GRASS) return BLOCK.DIRT;
  return blockId;
}

// 道具が無くて回収できなかったときに理由を出す。
// 黙って何も落ちないと「壊せない/バグ」に見えるため。
const MISSING_TOOL_HINT = {
  pickaxe: 'ツルハシが必要です(木材3+棒2でクラフト)',
  shears: 'ハサミが必要です(鉄インゴット2でクラフト)',
};

function warnMissingTool(blockId) {
  const role = getPreferredTool(blockId);
  const hint = MISSING_TOOL_HINT[role];
  if (!hint) return;
  showToast(`${hint}`);
}

let toastTimer = null;
function showToast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function collectMinedDrop(blockId, x, y, z) {
  if (blockId === BLOCK.CHEST) {
    collectLootChest(x, y, z);
  } else if (blockId === BLOCK.ITEM_NODE) {
    collectItemNode(x, y, z);
  } else if (gameMode === 'survival') {
    const dropBlockId = getSurvivalDropBlockId(blockId);
    if (dropBlockId !== null) addBlockToInventory(dropBlockId, 1);
    else warnMissingTool(blockId);
  }
}

function getSelectedPlaceBlockId() {
  const item = hotbarSlots[hotbarIndex];
  if (!item) return null;
  return typeof item.id === 'number' ? item.id : null;
}

function placeSelectedHotbarItem(x, y, z) {
  const item = hotbarSlots[hotbarIndex];
  if (!item) return false;
  const blockId = getSelectedPlaceBlockId();
  if (blockId !== null) {
    world.set(x, y, z, blockId);
    return true;
  }
  const catalogItem = getCatalogItem(item.id);
  if (gameMode === 'creative' && catalogItem && catalogItem.color) {
    world.setColor(x, y, z, Number.parseInt(catalogItem.color.replace('#', ''), 16));
    return true;
  }
  return false;
}

function isBreakableBlock(blockId) {
  return blockId !== BLOCK.AIR && blockId !== BLOCK.WATER && blockId !== BLOCK.BEDROCK;
}

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

// 所持していないツールは選べていても効果を持たない(素手扱い)。
function getSelectedToolId() {
  if (gameMode !== 'survival') return 'creative';
  const role = SURVIVAL_TOOLS[selectedToolIndex]?.id;
  if (!role) return 'hand';
  return ownedToolItem(role) ? role : 'hand';
}

function getPreferredTool(blockId) {
  if ([BLOCK.STONE, BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.BRICK].includes(blockId)) return 'pickaxe';
  if ([BLOCK.LOG, BLOCK.PLANK].includes(blockId)) return 'axe';
  if ([BLOCK.DIRT, BLOCK.GRASS, BLOCK.SAND, BLOCK.SNOW].includes(blockId)) return 'shovel';
  if (blockId === BLOCK.LEAVES) return 'shears';
  return 'hand';
}

function getBlockHardness(blockId) {
  const hardness = {
    [BLOCK.GRASS]: 0.6,
    [BLOCK.DIRT]: 0.5,
    [BLOCK.STONE]: 1.5,
    [BLOCK.SAND]: 0.5,
    [BLOCK.LOG]: 2.0,
    [BLOCK.LEAVES]: 0.2,
    [BLOCK.SNOW]: 0.1,
    [BLOCK.PLANK]: 2.0,
    [BLOCK.BRICK]: 2.0,
    [BLOCK.COAL_ORE]: 3.0,
    [BLOCK.IRON_ORE]: 3.0,
    [BLOCK.GOLD_ORE]: 3.0,
    [BLOCK.CHEST]: 2.5,
    [BLOCK.ITEM_NODE]: 3.0,
  };
  return hardness[blockId] ?? 1.0;
}

function getBreakDuration(blockId) {
  if (gameMode === 'creative') return 0;
  const preferred = getPreferredTool(blockId);
  const selected = getSelectedToolId();
  const toolMultiplier = selected === preferred || preferred === 'hand' ? 0.34 : 1.15;
  return Math.max(0.12, getBlockHardness(blockId) * toolMultiplier);
}

function clearMiningProgress() {
  miningTarget = null;
  miningProgress = 0;
  breakBox.visible = false;
  breakBoxMaterial.opacity = 0;
}

function updateBreakOverlay(hit, progress) {
  if (!hit) {
    breakBox.visible = false;
    return;
  }
  breakBox.visible = true;
  breakBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  breakBoxMaterial.opacity = Math.min(0.95, 0.18 + progress * 0.72);
}

function consumeSelectedBlock() {
  const item = hotbarSlots[hotbarIndex];
  if (!item) return false;
  if (gameMode !== 'survival') return true;
  if (typeof item.id !== 'number') return false;
  const blockId = item.id;
  const count = getBlockInventoryCount(blockId);
  if (count <= 0) return false;
  setInventoryCount(blockId, count - 1);
  updateSurvivalUI();
  if (inventoryOpen) renderInventoryScreen();
  buildHotbar();
  return true;
}

function interactBlock(button) {
  const eye = player.eyePos();
  const dir = player.lookDir();
  const hit = raycastVoxel(world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 8);
  if (!hit) return false;

  if (button === 0) {
    const brokenBlock = world.get(hit.x, hit.y, hit.z);
    if (!isBreakableBlock(brokenBlock)) return false;
    collectMinedDrop(brokenBlock, hit.x, hit.y, hit.z);
    world.set(hit.x, hit.y, hit.z, BLOCK.AIR);
    rebuildAround(hit.x, hit.y, hit.z);
    clearMiningProgress();
    saveGameState(true);
    return true;
  }

  if (button === 2) {
    const now = performance.now();
    if (now - lastPlaceTime < PLACE_COOLDOWN * 1000) return false;
    const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
    const target = world.get(px, py, pz);
    if (world.inBounds(px, py, pz) &&
        (target === BLOCK.AIR || target === BLOCK.WATER) &&
        !player.intersectsBlock(px, py, pz)) {
      if (!consumeSelectedBlock()) return false;
      if (!placeSelectedHotbarItem(px, py, pz)) return false;
      rebuildAround(px, py, pz);
      lastPlaceTime = now;
      saveGameState(true);
      return true;
    }
  }

  return false;
}

document.addEventListener('mousedown', (e) => {
  if (!pointerLocked) return;

  if (e.button === 0) {
    miningHeld = true;
    miningCooldown = 0;
    clearMiningProgress();
  } else if (e.button === 2) {
    placingHeld = true;
    placeCooldown = PLACE_COOLDOWN;
    interactBlock(2);
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    miningHeld = false;
    clearMiningProgress();
  } else if (e.button === 2) {
    placingHeld = false;
  }
});
window.addEventListener('blur', () => {
  miningHeld = false;
  placingHeld = false;
  clearMiningProgress();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ============ 照準ブロックのハイライト ============ */
const highlightBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x111111 })
);
highlightBox.visible = false;
scene.add(highlightBox);

const breakBoxMaterial = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
const breakBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.012, 1.012, 1.012)),
  breakBoxMaterial
);
breakBox.visible = false;
scene.add(breakBox);

function updateHighlight() {
  const eye = player.eyePos();
  const dir = player.lookDir();
  const hit = raycastVoxel(world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 8);
  if (hit) {
    highlightBox.visible = true;
    highlightBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else {
    highlightBox.visible = false;
  }
}

/* ============ ホットバー UI ============ */
function buildHotbar() {
  const bar = document.getElementById('hotbar');
  bar.innerHTML = '';
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const item = hotbarSlots[i];
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === hotbarIndex ? ' selected' : '');
    const itemColor = item && typeof item.id === 'number' ? getBlockDisplayColor(item.id) : item?.color;
    slot.innerHTML = item
      ? `<span class="key">${i + 1}</span><span class="swatch" style="${swatchStyle(item.id, itemColor)}"></span><span class="name">${item.label}</span><span class="count">${gameMode === 'survival' && typeof item.id === 'number' ? getBlockInventoryCount(item.id) : '?'}</span>`
      : `<span class="key">${i + 1}</span><span class="name">?</span><span class="count"></span>`;
    slot.addEventListener('click', () => selectHotbar(i));
    bar.appendChild(slot);
  }
}
function selectHotbar(i) {
  hotbarIndex = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  selectedInventorySlot = `hotbar-${hotbarIndex}`;
  selectedInventoryItem = hotbarSlots[hotbarIndex];
  document.querySelectorAll('#hotbar .slot').forEach((el, j) => {
    el.classList.toggle('selected', j === hotbarIndex);
  });
  if (inventoryOpen) renderInventoryScreen();
}

document.addEventListener('wheel', (e) => {
  if (!(pointerLocked || touchPlayActive) || inventoryOpen) return;
  if (Math.abs(e.deltaY) < 1) return;
  e.preventDefault();
  selectHotbar(hotbarIndex + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });

function buildSurvivalUI() {
  const tools = document.getElementById('tool-list');
  tools.innerHTML = '';
  SURVIVAL_TOOLS.forEach((tool, i) => {
    const owned = ownedToolItem(tool.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool-chip' + (i === selectedToolIndex ? ' selected' : '') + (owned ? '' : ' unowned');
    btn.title = owned ? tool.targets : `${tool.targets}(未所持・素手扱い)`;
    btn.textContent = owned ? CRAFT_ITEMS[owned].label : `${tool.label}(未所持)`;
    btn.addEventListener('click', () => {
      selectedToolIndex = i;
      updateSurvivalUI();
    });
    tools.appendChild(btn);
  });

  const armor = document.getElementById('armor-list');
  armor.innerHTML = '';
  ARMOR_ITEM_IDS.forEach((itemId, slotIndex) => {
    const count = getInventoryCount(itemId);
    const equipped = equippedArmor[slotIndex] === itemId;
    const item = document.createElement('div');
    item.className = 'item' + (count > 0 || equipped ? '' : ' unowned');
    const label = document.createElement('span');
    label.textContent = `${ARMOR_SLOT_LABELS[slotIndex]}: ${CRAFT_ITEMS[itemId].label}`;
    const status = document.createElement('span');
    status.className = 'count';
    status.textContent = equipped ? '装備中' : count;
    item.appendChild(label);
    item.appendChild(status);
    item.addEventListener('click', () => {
      const changed = equipped ? unequipArmor(slotIndex) : equipArmor(itemId);
      if (!changed) return;
      updateSurvivalUI();
      if (inventoryOpen) renderInventoryScreen();
      saveGameState(true);
    });
    armor.appendChild(item);
  });
}

function updateSurvivalUI() {
  const section = document.getElementById('survival-section');
  if (section) section.classList.toggle('active', gameMode === 'survival');
  document.getElementById('survival-hud').classList.toggle('active', gameMode === 'survival');
  updateHpUI();

  const grid = document.getElementById('inventory-grid');
  if (grid) {
    grid.innerHTML = '';
    HOTBAR_BLOCKS.slice(0, HOTBAR_SIZE).forEach((block) => {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<span>${block.label}</span><span class="count">${getBlockInventoryCount(block.id)}</span>`;
      grid.appendChild(item);
    });
  }

  const resourceGrid = document.getElementById('resource-grid');
  if (resourceGrid) {
    resourceGrid.innerHTML = '';
    RESOURCE_ITEMS.forEach((resource) => {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<span>${resource.label}</span><span class="count">${getInventoryCount(resource.id)}</span>`;
      resourceGrid.appendChild(item);
    });
  }

  // 所持状況でツール名と装備の個数が変わるので作り直す
  buildSurvivalUI();

  document.querySelectorAll('#hotbar .slot').forEach((el, i) => {
    const item = hotbarSlots[i];
    const count = item && typeof item.id === 'number' ? getBlockInventoryCount(item.id) : '';
    const countEl = el.querySelector('.count');
    if (countEl) countEl.textContent = item ? (gameMode === 'survival' ? count : '?') : '';
  });
  buildHotbar();
  updateHudMode();
}

function setGameMode(mode) {
  gameMode = mode === 'survival' ? 'survival' : 'creative';
  if (gameMode === 'survival' && player.fly) {
    player.fly = false;
    player.vel.y = 0;
  }
  if (gameMode === 'survival') resetPlayerHp();
  ensureCreativeHotbar();
  updateSurvivalUI();
  saveGameState(true);
}

function setupGameModeUI() {
  const select = document.getElementById('game-mode-select');
  select.value = gameMode;
  select.addEventListener('change', () => setGameMode(select.value));
  ensureCreativeHotbar();
  buildSurvivalUI();
  updateSurvivalUI();
}

function formatKeyCode(code) {
  const names = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    Slash: '/',
    Backslash: '\\',
    Enter: 'Enter',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace('Numpad', 'Num ');
}

function updateKeyConfigUI() {
  document.querySelectorAll('#key-config button').forEach((btn) => {
    const action = btn.dataset.action;
    btn.textContent = rebindingAction === action ? '入力待ち' : formatKeyCode(KEY_BINDINGS[action]);
    btn.classList.toggle('listening', rebindingAction === action);
  });
}

function setupKeyConfigUI() {
  const box = document.getElementById('key-config');
  box.innerHTML = '';
  KEY_CONFIG_ITEMS.forEach((item) => {
    const label = document.createElement('div');
    label.className = 'key-label';
    label.textContent = item.label;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.action = item.id;
    btn.addEventListener('click', () => {
      rebindingAction = item.id;
      keys.clear();
      updateKeyConfigUI();
    });

    box.appendChild(label);
    box.appendChild(btn);
  });
  updateKeyConfigUI();
}



/* ============ ワールド生成・UI ============ */
function setTouchButtonActive(el, active) {
  el.classList.toggle('active', active);
}

function setupVisualSettingsUI() {
  const shadowToggle = document.getElementById('toggle-shadows');
  if (!shadowToggle) return;
  shadowToggle.checked = visualShadowsEnabled;
  shadowToggle.addEventListener('change', () => {
    visualShadowsEnabled = shadowToggle.checked;
    localStorage.setItem(VISUAL_SHADOWS_STORAGE, visualShadowsEnabled ? 'on' : 'off');
    if (world) rebuildAllChunks();
    saveGameState(true);
  });
  renderBlockColorSettingsUI();
}

function setupSettingsAccordion() {
  document.querySelectorAll('.settings-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.closest('.settings-section');
      if (!section) return;
      section.classList.toggle('open');
    });
  });
}

function renderBlockColorSettingsUI() {
  const box = document.getElementById('block-color-settings');
  if (!box) return;
  box.innerHTML = '';

  const targetButton = document.createElement('button');
  targetButton.type = 'button';
  targetButton.className = 'texture-target-button';
  const currentBlock = HOTBAR_BLOCKS.find((block) => block.id === textureEditorBlockId) || HOTBAR_BLOCKS[0];
  targetButton.textContent = `変更するブロックの対象：${currentBlock.label}`;
  box.appendChild(targetButton);

  const targetList = document.createElement('div');
  targetList.className = 'texture-target-list';
  HOTBAR_BLOCKS.forEach((block) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = block.id === textureEditorBlockId ? 'active' : '';
    item.textContent = block.label;
    item.addEventListener('click', () => {
      textureEditorBlockId = block.id;
      textureEditorDraft = null;
      renderBlockColorSettingsUI();
    });
    targetList.appendChild(item);
  });
  targetButton.addEventListener('click', () => targetList.classList.toggle('open'));
  box.appendChild(targetList);

  const tools = document.createElement('div');
  tools.className = 'texture-tools';
  const colorLabel = document.createElement('span');
  colorLabel.textContent = 'ペンの色';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = textureEditorPaintColor;
  colorInput.addEventListener('input', () => {
    textureEditorPaintColor = colorInput.value.toLowerCase();
  });
  tools.appendChild(colorLabel);
  tools.appendChild(colorInput);
  box.appendChild(tools);

  const baseTexture = blockTextureOverrides[textureEditorBlockId] || makeSolidTexture('#ffffff');
  if (!textureEditorDraft) textureEditorDraft = baseTexture.slice();

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'texture-canvas-wrap';
  const grid = document.createElement('div');
  grid.id = 'texture-pixel-grid';

  function paintPixel(index, pixel) {
    textureEditorDraft[index] = textureEditorPaintColor;
    pixel.style.background = textureEditorPaintColor;
  }

  textureEditorDraft.forEach((color, index) => {
    const pixel = document.createElement('button');
    pixel.type = 'button';
    pixel.className = 'texture-pixel';
    pixel.style.background = color;
    pixel.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      textureEditorMouseDown = true;
      paintPixel(index, pixel);
    });
    pixel.addEventListener('pointerenter', () => {
      if (textureEditorMouseDown) paintPixel(index, pixel);
    });
    grid.appendChild(pixel);
  });
  canvasWrap.appendChild(grid);
  box.appendChild(canvasWrap);

  const actions = document.createElement('div');
  actions.className = 'texture-actions';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = '白紙にする';
  clear.addEventListener('click', () => {
    textureEditorDraft = makeSolidTexture('#ffffff');
    renderBlockColorSettingsUI();
  });
  actions.appendChild(clear);

  const fill = document.createElement('button');
  fill.type = 'button';
  fill.textContent = 'ペン色で塗りつぶし';
  fill.addEventListener('click', () => {
    textureEditorDraft = makeSolidTexture(textureEditorPaintColor);
    renderBlockColorSettingsUI();
  });
  actions.appendChild(fill);

  const resetBlock = document.createElement('button');
  resetBlock.type = 'button';
  resetBlock.textContent = 'このブロックをリセット';
  resetBlock.addEventListener('click', () => {
    delete blockTextureOverrides[textureEditorBlockId];
    delete blockColorOverrides[textureEditorBlockId];
    textureEditorDraft = makeSolidTexture('#ffffff');
    applyBlockColorOverrides();
    renderBlockColorSettingsUI();
    rebuildAllChunks();
    buildHotbar();
    if (inventoryOpen) renderInventoryScreen();
    saveGameState(true);
  });
  actions.appendChild(resetBlock);

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'texture-apply-button';
  apply.textContent = '適用';
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try {
      await applyTextureEditorDraft();
    } finally {
      apply.disabled = false;
    }
  });
  actions.appendChild(apply);

  box.appendChild(actions);
}

window.addEventListener('pointerup', () => {
  textureEditorMouseDown = false;
});
function setupTouchHoldButton(id, actionId) {
  const btn = document.getElementById(id);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startTouchPlay();
    touchKeys.add(KEY_BINDINGS[actionId]);
    setTouchButtonActive(btn, true);
  });
  const release = (e) => {
    e.preventDefault();
    e.stopPropagation();
    touchKeys.delete(KEY_BINDINGS[actionId]);
    setTouchButtonActive(btn, false);
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', () => {
    touchKeys.delete(KEY_BINDINGS[actionId]);
    setTouchButtonActive(btn, false);
  });
}

function setupTouchActionButton(id, action) {
  const btn = document.getElementById(id);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startTouchPlay();
    setTouchButtonActive(btn, true);
    action();
  });
  const release = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTouchButtonActive(btn, false);
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
}

function setupTouchMiningButton(id) {
  const btn = document.getElementById(id);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startTouchPlay();
    miningHeld = true;
    miningCooldown = 0;
    clearMiningProgress();
    setTouchButtonActive(btn, true);
  });
  const release = (e) => {
    e.preventDefault();
    e.stopPropagation();
    miningHeld = false;
    clearMiningProgress();
    setTouchButtonActive(btn, false);
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', () => {
    miningHeld = false;
    clearMiningProgress();
    setTouchButtonActive(btn, false);
  });
}

function setupTouchPlacingButton(id) {
  const btn = document.getElementById(id);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startTouchPlay();
    placingHeld = true;
    placeCooldown = PLACE_COOLDOWN;
    setTouchButtonActive(btn, true);
    interactBlock(2);
  });
  const release = (e) => {
    e.preventDefault();
    e.stopPropagation();
    placingHeld = false;
    setTouchButtonActive(btn, false);
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', () => {
    placingHeld = false;
    setTouchButtonActive(btn, false);
  });
}

async function toggleFullscreen() {
  const root = document.documentElement;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else if (root.requestFullscreen) {
    await root.requestFullscreen({ navigationUI: 'hide' });
  } else if (root.webkitRequestFullscreen) {
    root.webkitRequestFullscreen();
  }
}

function toggleFlyMode() {
  if (gameMode === 'survival') {
    updateHudMode();
    return;
  }
  player.fly = !player.fly;
  player.vel.y = 0;
  updateHudMode();
}

function setupTouchControls() {
  const stick = document.getElementById('move-stick');
  const knob = document.getElementById('move-knob');
  const lookPad = document.getElementById('look-pad');
  let stickPointer = null;
  let lookPointer = null;
  let lookX = 0;
  let lookY = 0;

  function updateStick(clientX, clientY) {
    const rect = stick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const max = rect.width * 0.34;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = dx / len * max;
      dy = dy / len * max;
    }
    touchMove.x = dx / max;
    touchMove.z = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function resetStick() {
    stickPointer = null;
    touchMove.x = 0;
    touchMove.z = 0;
    knob.style.transform = 'translate(0, 0)';
  }

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startTouchPlay();
    stickPointer = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    updateStick(e.clientX, e.clientY);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    e.preventDefault();
    updateStick(e.clientX, e.clientY);
  });
  stick.addEventListener('pointerup', resetStick);
  stick.addEventListener('pointercancel', resetStick);

  lookPad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startTouchPlay();
    lookPointer = e.pointerId;
    lookX = e.clientX;
    lookY = e.clientY;
    lookPad.setPointerCapture(e.pointerId);
  });
  lookPad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookPointer) return;
    e.preventDefault();
    const dx = e.clientX - lookX;
    const dy = e.clientY - lookY;
    lookX = e.clientX;
    lookY = e.clientY;
    player.yaw -= dx * 0.004;
    player.pitch -= dy * 0.004;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
  });
  lookPad.addEventListener('pointerup', () => { lookPointer = null; });
  lookPad.addEventListener('pointercancel', () => { lookPointer = null; });

  setupTouchHoldButton('btn-touch-jump', 'jump');
  setupTouchHoldButton('btn-touch-sprint', 'sprint');
  setupTouchMiningButton('btn-touch-break');
  setupTouchPlacingButton('btn-touch-place');
  setupTouchActionButton('btn-touch-fly', toggleFlyMode);
  setupTouchActionButton('btn-touch-shot', saveScreenshot);
  setupTouchActionButton('btn-touch-inventory', () => setInventoryOpen(!inventoryOpen));
  setupTouchActionButton('btn-touch-fullscreen', () => {
    toggleFullscreen().catch(() => {});
  });
}

function setupInventoryUI() {
  document.getElementById('inventory-close').addEventListener('click', () => setInventoryOpen(false));
}

function renderChat() {
  const log = document.getElementById('chat-log');
  log.innerHTML = '';
  chatState.messages.slice(-60).forEach((message) => {
    const row = document.createElement('div');
    row.className = 'msg';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = message.name;
    row.appendChild(name);
    row.append(document.createTextNode(`: ${message.text}`));
    log.appendChild(row);
  });
  log.scrollTop = log.scrollHeight;
}

function addChatMessage(name, text) {
  const cleanText = text.trim();
  if (!cleanText) return;
  chatState.messages.push({ name: name.trim() || 'Player', text: cleanText, time: Date.now() });
  renderChat();
}

function getChatSignalUrl() {
  return window.VOICE_SIGNAL_URL || localStorage.getItem('block_world_voice_signal_url') || '';
}

function closeChatSocket() {
  if (chatState.socket) chatState.socket.close();
  chatState.socket = null;
  chatState.socketRoomId = '';
}

function ensureChatSocket() {
  const url = getChatSignalUrl();
  const roomId = activeWorldId || chatState.roomId;
  if (!url || !roomId) return null;
  if (chatState.socket?.readyState === WebSocket.OPEN && chatState.socketRoomId === roomId) return chatState.socket;
  if (chatState.socket && chatState.socket.readyState !== WebSocket.CLOSED) closeChatSocket();
  const socket = new WebSocket(url);
  chatState.socket = socket;
  chatState.socketRoomId = roomId;
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', kind: 'chat', roomId, name: 'Player' }));
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'chat') addChatMessage(message.name || 'Player', message.text || '');
    } catch (err) {
      console.warn('Chat message error', err);
    }
  });
  socket.addEventListener('close', () => {
    if (chatState.socket === socket) {
      chatState.socket = null;
      chatState.socketRoomId = '';
    }
  });
  return socket;
}

function sendChatNetwork(text) {
  const socket = ensureChatSocket();
  if (!socket) return;
  const send = () => socket.send(JSON.stringify({ type: 'chat', text }));
  if (socket.readyState === WebSocket.OPEN) send();
  else socket.addEventListener('open', send, { once: true });
}

function setupChatUI() {
  renderChat();
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      e.stopPropagation();
      handleEscapeKey(e);
    }
  });

  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value;
    addChatMessage('Player', text);
    sendChatNetwork(text);
    input.value = '';
    input.blur();
  });
  document.getElementById('btn-chat-collapse').addEventListener('click', () => {
    chatState.collapsed = !chatState.collapsed;
    document.getElementById('chat-log').style.display = chatState.collapsed ? 'none' : 'block';
    document.getElementById('chat-form').style.display = chatState.collapsed ? 'none' : 'grid';
    document.getElementById('btn-chat-collapse').textContent = chatState.collapsed ? '表示' : '最小化';
  });
}

async function regenerate(presetKey, seed = null, savedState = null, shouldSave = true) {
  setLoadingProgress(0.05, 'ワールドを読み込み中...');
  await nextFrame();
  currentPreset = presetKey;
  currentSeed = seed ?? ((Math.random() * 0xffffffff) >>> 0);
  if (savedState) blockColorOverrides = normalizeBlockColors(savedState.blockColors);
  if (savedState) blockTextureOverrides = normalizeBlockTextures(savedState.blockTextures);
  if (savedState) textureEditorDraft = null;
  setLoadingProgress(0.18, '地形を生成中...');
  await nextFrame();
  world = generateWorld(presetKey, currentSeed);
  if (savedState?.worldEdits) world.applyEdits(savedState.worldEdits);
  world.trackEdits = true;
  applyBlockColorOverrides();
  player.spawn(world);
  if (savedState) restorePlayerState(savedState);
  player.fly = false;
  if (savedState) player.fly = Boolean(savedState.fly && gameMode === 'creative');
  resetPlayerHp();
  if (savedState) restorePlayerState(savedState);
  setLoadingProgress(0.35, '近くのブロックを描画中...');
  await rebuildNearbyChunksWithProgress(player.pos.x, player.pos.z, (progress) => {
    setLoadingProgress(0.35 + progress * 0.45, '近くのブロックを描画中...');
  });
  updateHudMode();
  renderBlockColorSettingsUI();
  document.querySelectorAll('#presets button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === presetKey);
  });
  if (shouldSave) saveGameState(true);
  setLoadingProgress(0.9, '遠くの地形を裏で準備中...');
  await nextFrame();
  setLoadingProgress(1, '完了');
  await nextFrame();
  hideLoadingProgress();
}

function buildPresetButtons() {
  const box = document.getElementById('presets');
  for (const [key, p] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.textContent = p.label;
    btn.dataset.preset = key;
    btn.addEventListener('click', () => { regenerate(key); });
    box.appendChild(btn);
  }
  document.getElementById('btn-regen').addEventListener('click', () => { regenerate(currentPreset); });
}

function setupMenuUI() {
  document.getElementById('btn-resume').addEventListener('click', () => {
    if (panel.classList.contains('pause-open')) resumeGame();
    else showWorldSelect();
  });
  document.getElementById('btn-settings').addEventListener('click', () => {
    panel.classList.remove('world-select-open');
    panel.classList.toggle('settings-open');
  });
  document.getElementById('btn-exit').addEventListener('click', () => {
    saveGameState(true);
    showTitleMenu();
  });
  document.getElementById('btn-lang-ja')?.addEventListener('click', () => setLanguage('ja'));
  document.getElementById('btn-lang-en')?.addEventListener('click', () => setLanguage('en'));
  applyLanguage();
}

function updateHudMode() {
  const label = (PRESETS[currentPreset] && PRESETS[currentPreset].label) || '画像';
  const moveMode = player.fly ? '飛行' : '歩行';
  const toolText = gameMode === 'survival' ? ` / ${SURVIVAL_TOOLS[selectedToolIndex].label}` : '';
  hudMode.textContent = `${label} / ${gameModeLabel()} / ${moveMode}モード${toolText} (同じキー2回で飛行切替)`;
}

/* ============ 画像インポート ============ */
function saveScreenshot() {
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = 'block-world.png';
  a.click();
}

/* ============ メインループ ============ */
function updateHeldMining(dt) {
  if (!miningHeld || inventoryOpen || !(pointerLocked || touchPlayActive)) {
    miningCooldown = 0;
    clearMiningProgress();
    return;
  }
  if (miningCooldown > 0) {
    miningCooldown = Math.max(0, miningCooldown - dt);
    return;
  }

  const eye = player.eyePos();
  const dir = player.lookDir();
  const hit = raycastVoxel(world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 8);
  if (!hit) {
    clearMiningProgress();
    return;
  }
  const blockId = world.get(hit.x, hit.y, hit.z);
  if (!isBreakableBlock(blockId)) {
    clearMiningProgress();
    return;
  }

  const key = blockKey(hit.x, hit.y, hit.z);
  if (!miningTarget || miningTarget.key !== key || miningTarget.blockId !== blockId) {
    miningTarget = { key, blockId };
    miningProgress = 0;
  }

  if (gameMode === 'creative') {
    interactBlock(0);
    miningCooldown = 0.10;
    return;
  }

  const duration = getBreakDuration(blockId);
  miningProgress += dt / duration;
  updateBreakOverlay(hit, miningProgress);
  if (miningProgress >= 1) {
    interactBlock(0);
    miningCooldown = 0.12;
  }
}

function updateHeldPlacing(dt) {
  if (!placingHeld || inventoryOpen || !(pointerLocked || touchPlayActive)) {
    placeCooldown = 0;
    return;
  }
  placeCooldown -= dt;
  if (placeCooldown > 0) return;
  interactBlock(2);
  placeCooldown = PLACE_COOLDOWN;
}

let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (!inventoryOpen && (pointerLocked || touchPlayActive)) {
    const activeKeys = new Set(keys);
    for (const code of touchKeys) activeKeys.add(code);
    player.update(dt, activeKeys, world, touchMove, KEY_BINDINGS);
  }
  updateHeldMining(dt);
  updateHeldPlacing(dt);
  updateSurvivalStats(dt);

  // カメラをプレイヤーの目に同期
  const eye = player.eyePos();
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // 雲をゆっくり流す
  for (const cloud of cloudGroup.children) {
    cloud.position.x += dt * 1.2;
    if (cloud.position.x > WORLD_SX * 1.4) cloud.position.x = -WORLD_SX * 0.4;
  }

  updateHighlight();
  updateChunkVisibility();

  // 水中の色かぶり
  const headBlock = world.get(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
  waterOverlay.style.display = headBlock === BLOCK.WATER ? 'block' : 'none';

  const hpText = gameMode === 'survival' ? ` / HP:${playerHp}/${MAX_HP}` : '';
  hudPos.textContent = `X:${player.pos.x.toFixed(0)} Y:${player.pos.y.toFixed(0)} Z:${player.pos.z.toFixed(0)}${hpText}`;

  saveGameState();
  renderer.render(scene, camera);
}

window.addEventListener('beforeunload', () => saveGameState(true));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGameState(true);
});

/* ============ 起動 ============ */
buildPresetButtons();
setupMenuUI();
buildHotbar();
setupGameModeUI();
setupRenderDistanceUI();
setupKeyConfigUI();
setupVisualSettingsUI();
setupSettingsAccordion();
setupTouchControls();
setupInventoryUI();
setupChatUI();
(async () => {
  await regenerate('plains', null, null, false);
  renderWorldList();
  animate();
})();
