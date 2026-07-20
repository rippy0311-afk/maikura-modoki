'use strict';

// クラフトで手に入る「ブロック以外のアイテム」の定義。
// 所持数の実体は js/inventory.js のヘルパー経由で扱う。
const CRAFT_ITEMS = {
  stick:      { label: '棒',           color: '#9a7b4f' },
  iron_ingot: { label: '鉄インゴット', color: '#d8d8d8' },

  wooden_pickaxe: { label: '木のツルハシ',   color: '#a98a5c', tool: 'pickaxe' },
  wooden_axe:     { label: '木の斧',         color: '#a98a5c', tool: 'axe' },
  wooden_shovel:  { label: '木のシャベル',   color: '#a98a5c', tool: 'shovel' },

  iron_pickaxe: { label: '鉄のツルハシ', color: '#cdd2d6', tool: 'pickaxe' },
  iron_axe:     { label: '鉄の斧',       color: '#cdd2d6', tool: 'axe' },
  iron_shovel:  { label: '鉄のシャベル', color: '#cdd2d6', tool: 'shovel' },
  iron_hoe:     { label: '鉄のクワ',     color: '#cdd2d6', tool: 'hoe' },
  iron_sword:   { label: '鉄の剣',       color: '#cdd2d6', tool: 'sword' },
  shears:       { label: 'ハサミ',       color: '#cdd2d6', tool: 'shears' },

  iron_helmet:     { label: '鉄のヘルメット',       color: '#bfc5c9', armor: 0, armorDefense: 2 },
  iron_chestplate: { label: '鉄のチェストプレート', color: '#bfc5c9', armor: 1, armorDefense: 6 },
  iron_leggings:   { label: '鉄のレギンス',         color: '#bfc5c9', armor: 2, armorDefense: 5 },
  iron_boots:      { label: '鉄のブーツ',           color: '#bfc5c9', armor: 3, armorDefense: 2 },
};

const TOOL_TIERS = {
  pickaxe: ['iron_pickaxe', 'wooden_pickaxe'],
  axe:     ['iron_axe', 'wooden_axe'],
  shovel:  ['iron_shovel', 'wooden_shovel'],
  hoe:     ['iron_hoe'],
  sword:   ['iron_sword'],
  shears:  ['shears'],
};

const RECIPES = [
  { input: { wood: 1 },                          output: { block: BLOCK.PLANK, count: 4 } },
  { input: { [BLOCK.PLANK]: 2 },                 output: { item: 'stick', count: 4 } },

  { input: { [BLOCK.PLANK]: 3, stick: 2 },       output: { item: 'wooden_pickaxe', count: 1 } },
  { input: { [BLOCK.PLANK]: 3, stick: 2 },       output: { item: 'wooden_axe', count: 1 } },
  { input: { [BLOCK.PLANK]: 1, stick: 2 },       output: { item: 'wooden_shovel', count: 1 } },

  { input: { iron_ore: 1 },                      output: { item: 'iron_ingot', count: 1 } },
  { input: { iron_ingot: 3, stick: 2 },          output: { item: 'iron_pickaxe', count: 1 } },
  { input: { iron_ingot: 3, stick: 2 },          output: { item: 'iron_axe', count: 1 } },
  { input: { iron_ingot: 1, stick: 2 },          output: { item: 'iron_shovel', count: 1 } },
  { input: { iron_ingot: 2, stick: 2 },          output: { item: 'iron_hoe', count: 1 } },
  { input: { iron_ingot: 2, stick: 1 },          output: { item: 'iron_sword', count: 1 } },
  { input: { iron_ingot: 2 },                    output: { item: 'shears', count: 1 } },

  { input: { iron_ingot: 5 },                    output: { item: 'iron_helmet', count: 1 } },
  { input: { iron_ingot: 8 },                    output: { item: 'iron_chestplate', count: 1 } },
  { input: { iron_ingot: 7 },                    output: { item: 'iron_leggings', count: 1 } },
  { input: { iron_ingot: 4 },                    output: { item: 'iron_boots', count: 1 } },

  { input: { stone: 4 },                         output: { block: BLOCK.BRICK, count: 1 } },
];

function craftKeyLabel(key) {
  if (CRAFT_ITEMS[key]) return CRAFT_ITEMS[key].label;
  const resource = RESOURCE_ITEMS.find((item) => item.id === key);
  if (resource) return resource.label;
  const block = HOTBAR_BLOCKS.find((item) => String(item.id) === String(key));
  return block ? block.label : String(key);
}

function craftKeyColor(key) {
  if (CRAFT_ITEMS[key]) return CRAFT_ITEMS[key].color;
  const resource = RESOURCE_ITEMS.find((item) => item.id === key);
  if (resource) return resource.color;
  const block = HOTBAR_BLOCKS.find((item) => String(item.id) === String(key));
  return block ? block.color : '#8b8f98';
}

function recipeOutputKey(recipe) {
  return recipe.output.block !== undefined ? recipe.output.block : recipe.output.item;
}

function recipeLabel(recipe) {
  const name = craftKeyLabel(recipeOutputKey(recipe));
  return recipe.output.count > 1 ? `${name} x${recipe.output.count}` : name;
}

function recipeInputText(recipe) {
  return Object.entries(recipe.input)
    .map(([key, need]) => `${craftKeyLabel(key)} ${getInventoryCount(key)}/${need}`)
    .join('、');
}

function canCraft(recipe) {
  return Object.entries(recipe.input).every(([key, need]) => getInventoryCount(key) >= need);
}

function craft(recipe) {
  if (!canCraft(recipe)) return false;
  for (const [key, need] of Object.entries(recipe.input)) {
    addInventoryCount(key, -need);
  }
  if (recipe.output.block !== undefined) {
    addBlockToInventory(recipe.output.block, recipe.output.count);
  } else {
    addItemToInventory(recipe.output.item, recipe.output.count);
  }
  return true;
}

function ownedToolItem(role) {
  const tiers = TOOL_TIERS[role] || [];
  return tiers.find((itemId) => getInventoryCount(itemId) > 0) || null;
}
