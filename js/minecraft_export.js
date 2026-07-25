'use strict';

const MINECRAFT_EXPORT_RANGE_DEFAULT = 48;
const MINECRAFT_EXPORT_RANGE_MAX = 160;
const MINECRAFT_FUNCTION_COMMAND_LIMIT = 9000;

const JAVA_BLOCK_NAMES = {
  [BLOCK.GRASS]: 'minecraft:grass_block',
  [BLOCK.DIRT]: 'minecraft:dirt',
  [BLOCK.STONE]: 'minecraft:stone',
  [BLOCK.SAND]: 'minecraft:sand',
  [BLOCK.WATER]: 'minecraft:water',
  [BLOCK.LOG]: 'minecraft:oak_log',
  [BLOCK.LEAVES]: 'minecraft:oak_leaves[persistent=true]',
  [BLOCK.SNOW]: 'minecraft:snow_block',
  [BLOCK.PLANK]: 'minecraft:oak_planks',
  [BLOCK.BRICK]: 'minecraft:bricks',
  [BLOCK.COAL_ORE]: 'minecraft:coal_ore',
  [BLOCK.IRON_ORE]: 'minecraft:iron_ore',
  [BLOCK.GOLD_ORE]: 'minecraft:gold_ore',
  [BLOCK.CHEST]: 'minecraft:chest',
  [BLOCK.BEDROCK]: 'minecraft:bedrock',
  [BLOCK.ITEM_NODE]: 'minecraft:amethyst_block',
};

const BEDROCK_BLOCK_NAMES = {
  [BLOCK.GRASS]: 'minecraft:grass',
  [BLOCK.DIRT]: 'minecraft:dirt',
  [BLOCK.STONE]: 'minecraft:stone',
  [BLOCK.SAND]: 'minecraft:sand',
  [BLOCK.WATER]: 'minecraft:water',
  [BLOCK.LOG]: 'minecraft:log',
  [BLOCK.LEAVES]: 'minecraft:leaves',
  [BLOCK.SNOW]: 'minecraft:snow',
  [BLOCK.PLANK]: 'minecraft:planks',
  [BLOCK.BRICK]: 'minecraft:brick_block',
  [BLOCK.COAL_ORE]: 'minecraft:coal_ore',
  [BLOCK.IRON_ORE]: 'minecraft:iron_ore',
  [BLOCK.GOLD_ORE]: 'minecraft:gold_ore',
  [BLOCK.CHEST]: 'minecraft:chest',
  [BLOCK.BEDROCK]: 'minecraft:bedrock',
  [BLOCK.ITEM_NODE]: 'minecraft:amethyst_block',
};

const CONCRETE_PALETTE = [
  ['white', 0xf9fffe], ['orange', 0xf9801d], ['magenta', 0xc74ebd], ['light_blue', 0x3ab3da],
  ['yellow', 0xfed83d], ['lime', 0x80c71f], ['pink', 0xf38baa], ['gray', 0x474f52],
  ['light_gray', 0x9d9d97], ['cyan', 0x169c9c], ['purple', 0x8932b8], ['blue', 0x3c44aa],
  ['brown', 0x835432], ['green', 0x5e7c16], ['red', 0xb02e26], ['black', 0x1d1d21],
];

function minecraftExportUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    return (char === 'x' ? value : (value & 0x3 | 0x8)).toString(16);
  });
}

function closestConcreteName(rgb) {
  let best = CONCRETE_PALETTE[0][0];
  let bestDistance = Infinity;
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  for (const [name, color] of CONCRETE_PALETTE) {
    const cr = (color >> 16) & 255;
    const cg = (color >> 8) & 255;
    const cb = color & 255;
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}

function minecraftBlockName(world, blockId, index, edition) {
  if (blockId === BLOCK.AIR) return '';
  if (blockId === BLOCK.COLOR) {
    const color = world.colors.get(index) ?? 0xffffff;
    return `minecraft:${closestConcreteName(color)}_concrete`;
  }
  const names = edition === 'bedrock' ? BEDROCK_BLOCK_NAMES : JAVA_BLOCK_NAMES;
  return names[blockId] || 'minecraft:stone';
}

function clampMinecraftExportRange(value) {
  const range = Number.parseInt(value, 10);
  if (!Number.isFinite(range)) return MINECRAFT_EXPORT_RANGE_DEFAULT;
  return Math.max(8, Math.min(MINECRAFT_EXPORT_RANGE_MAX, range));
}

function collectMinecraftExportCommands(world, player, options = {}) {
  const edition = options.edition === 'bedrock' ? 'bedrock' : 'java';
  const range = clampMinecraftExportRange(options.range);
  const centerX = Math.floor(player.pos.x);
  const centerZ = Math.floor(player.pos.z);
  const x0 = Math.max(0, centerX - range);
  const x1 = Math.min(world.sx - 1, centerX + range);
  const z0 = Math.max(0, centerZ - range);
  const z1 = Math.min(world.sz - 1, centerZ + range);
  const commands = [];

  for (let y = 0; y < world.sy; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const index = world.index(x, y, z);
        const blockId = world.data[index];
        if (blockId === BLOCK.AIR) continue;
        const blockName = minecraftBlockName(world, blockId, index, edition);
        if (!blockName) continue;
        const dx = x - centerX;
        const dy = y - Math.floor(player.pos.y);
        const dz = z - centerZ;
        commands.push(`setblock ~${dx} ~${dy} ~${dz} ${blockName}`);
      }
    }
  }

  return {
    commands,
    range,
    bounds: { x0, x1, z0, z1, y0: 0, y1: world.sy - 1 },
    origin: { x: centerX, y: Math.floor(player.pos.y), z: centerZ },
  };
}

function splitMinecraftFunctions(commands, namespace) {
  const files = [];
  const partCount = Math.max(1, Math.ceil(commands.length / MINECRAFT_FUNCTION_COMMAND_LIMIT));
  for (let i = 0; i < partCount; i++) {
    const part = commands.slice(i * MINECRAFT_FUNCTION_COMMAND_LIMIT, (i + 1) * MINECRAFT_FUNCTION_COMMAND_LIMIT);
    files.push({ name: `build_${i}.mcfunction`, body: part.join('\n') + '\n' });
  }
  const dispatcher = [];
  for (let i = 0; i < partCount; i++) dispatcher.push(`function ${namespace}:build_${i}`);
  files.push({ name: 'build.mcfunction', body: dispatcher.join('\n') + '\n' });
  return files;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function writeUint16(out, value) {
  out.push(value & 255, (value >>> 8) & 255);
}

function writeUint32(out, value) {
  out.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const out = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path.replace(/\\/g, '/'));
    const dataBytes = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const checksum = crc32(dataBytes);
    const localOffset = offset;

    writeUint32(out, 0x04034b50);
    writeUint16(out, 20);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint32(out, checksum);
    writeUint32(out, dataBytes.length);
    writeUint32(out, dataBytes.length);
    writeUint16(out, nameBytes.length);
    writeUint16(out, 0);
    out.push(...nameBytes, ...dataBytes);
    offset = out.length;

    central.push({ nameBytes, dataBytes, checksum, localOffset });
  }

  const centralOffset = out.length;
  for (const entry of central) {
    writeUint32(out, 0x02014b50);
    writeUint16(out, 20);
    writeUint16(out, 20);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint32(out, entry.checksum);
    writeUint32(out, entry.dataBytes.length);
    writeUint32(out, entry.dataBytes.length);
    writeUint16(out, entry.nameBytes.length);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint32(out, 0);
    writeUint32(out, entry.localOffset);
    out.push(...entry.nameBytes);
  }
  const centralSize = out.length - centralOffset;

  writeUint32(out, 0x06054b50);
  writeUint16(out, 0);
  writeUint16(out, 0);
  writeUint16(out, central.length);
  writeUint16(out, central.length);
  writeUint32(out, centralSize);
  writeUint32(out, centralOffset);
  writeUint16(out, 0);

  return new Blob([new Uint8Array(out)], { type: 'application/zip' });
}

function makeMinecraftExportReadme(edition, meta) {
  if (edition === 'bedrock') {
    return [
      'Block World Bedrock export',
      '',
      '1. この .mcpack を Minecraft Bedrock で開いてインポートします。',
      '2. コピー先ワールドのビヘイビアーパックに Block World Export を追加します。',
      '3. チートを有効にして /function build を実行します。',
      '',
      `Exported blocks: ${meta.commands.length}`,
      `Area: x ${meta.bounds.x0}-${meta.bounds.x1}, z ${meta.bounds.z0}-${meta.bounds.z1}`,
      '注意: チェストの中身、独自アイテム、完全な色は近い標準ブロックに変換されます。',
    ].join('\n');
  }
  return [
    'Block World Java export',
    '',
    '1. この zip をコピー先ワールドの datapacks フォルダに入れます。',
    '2. ワールドを開いて /reload を実行します。',
    '3. コピーしたい位置で /function block_world_export:build を実行します。',
    '',
    `Exported blocks: ${meta.commands.length}`,
    `Area: x ${meta.bounds.x0}-${meta.bounds.x1}, z ${meta.bounds.z0}-${meta.bounds.z1}`,
    '注意: チェストの中身、独自アイテム、完全な色は近い標準ブロックに変換されます。',
  ].join('\n');
}

function buildJavaDatapack(world, player, range) {
  const namespace = 'block_world_export';
  const meta = collectMinecraftExportCommands(world, player, { edition: 'java', range });
  const functionFiles = splitMinecraftFunctions(meta.commands, namespace);
  const entries = [
    { path: 'pack.mcmeta', data: JSON.stringify({ pack: { pack_format: 48, description: 'Block World Java Export' } }, null, 2) },
    { path: 'README.txt', data: makeMinecraftExportReadme('java', meta) },
    ...functionFiles.map((file) => ({ path: `data/${namespace}/function/${file.name}`, data: file.body })),
  ];
  return { blob: createStoredZip(entries), meta };
}

function buildBedrockBehaviorPack(world, player, range) {
  const meta = collectMinecraftExportCommands(world, player, { edition: 'bedrock', range });
  const manifest = {
    format_version: 2,
    header: {
      name: 'Block World Export',
      description: 'Generated from Block World',
      uuid: minecraftExportUuid(),
      version: [1, 0, 0],
      min_engine_version: [1, 20, 0],
    },
    modules: [{
      type: 'data',
      uuid: minecraftExportUuid(),
      version: [1, 0, 0],
    }],
  };
  const functionFiles = splitMinecraftFunctions(meta.commands, '');
  const entries = [
    { path: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    { path: 'README.txt', data: makeMinecraftExportReadme('bedrock', meta) },
    ...functionFiles.map((file) => ({ path: `functions/${file.name}`, data: file.body.replace(/^function :/gm, 'function ') })),
  ];
  return { blob: createStoredZip(entries), meta };
}
