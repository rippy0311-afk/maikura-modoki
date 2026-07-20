'use strict';

let hotbarIndex = 0;
let selectedToolIndex = 0;

const HOTBAR_SIZE = 9;
const MAIN_INVENTORY_SIZE = 27;
const hotbarSlots = Array(HOTBAR_SIZE).fill(null);
const mainInventorySlots = Array(MAIN_INVENTORY_SIZE).fill(null);

const SURVIVAL_TOOLS = [
  { id: 'pickaxe', label: '鉄のツルハシ', targets: '石・鉱石' },
  { id: 'axe', label: '鉄の斧', targets: '木材' },
  { id: 'shovel', label: '鉄のシャベル', targets: '土・砂・雪' },
  { id: 'hoe', label: '鉄のクワ', targets: '畑づくり' },
  { id: 'sword', label: '鉄の剣', targets: '戦闘' },
  { id: 'shears', label: 'ハサミ', targets: '葉' },
];

const ARMOR_ITEM_IDS = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
const ARMOR_SLOT_LABELS = ['頭', '胴', '脚', '足'];
const equippedArmor = Array(ARMOR_ITEM_IDS.length).fill(null);

const RESOURCE_ITEMS = [
  { id: 'wood', label: '木', color: '#8a6238' },
  { id: 'stone', label: '石', color: '#7d7d7d' },
  { id: 'coal_ore', label: '石炭鉱石', color: '#2a2a2e' },
  { id: 'iron_ore', label: '鉄鉱石', color: '#cd8a59' },
  { id: 'gold_ore', label: '金鉱石', color: '#eec23e' },
];

const RESOURCE_DROPS = {
  [BLOCK.LOG]: 'wood',
  [BLOCK.STONE]: 'stone',
  [BLOCK.COAL_ORE]: 'coal_ore',
  [BLOCK.IRON_ORE]: 'iron_ore',
  [BLOCK.GOLD_ORE]: 'gold_ore',
};

const survivalInventory = {};

function isNumericBlockKey(itemId) {
  return typeof itemId === 'number' || (typeof itemId === 'string' && /^-?\d+$/.test(itemId));
}

function inventoryKey(itemId) {
  return isNumericBlockKey(itemId) ? `block:${Number(itemId)}` : `item:${String(itemId)}`;
}

function getInventoryCount(itemId) {
  return survivalInventory[inventoryKey(itemId)] || 0;
}

function getBlockInventoryCount(blockId) {
  return getInventoryCount(blockId);
}

function setInventoryCount(itemId, count) {
  survivalInventory[inventoryKey(itemId)] = Math.max(0, Math.floor(count || 0));
}

function addInventoryCount(itemId, amount) {
  setInventoryCount(itemId, getInventoryCount(itemId) + amount);
}

function makeSlotItem(id, label, count, color = '#8b8f98') {
  return { id, label, count, color };
}

function cloneSlotItem(item, count = 1) {
  if (!item) return null;
  return {
    id: item.id,
    label: item.label,
    count,
    color: item.color || '#8b8f98',
  };
}

function getArmorSlotIndex(itemId) {
  return ARMOR_ITEM_IDS.indexOf(itemId);
}

function getEquippedArmorDefense() {
  return equippedArmor.reduce((total, itemId) => {
    if (!itemId || !CRAFT_ITEMS[itemId]) return total;
    return total + (CRAFT_ITEMS[itemId].armorDefense || 0);
  }, 0);
}

function reduceDamageByArmor(amount) {
  const defense = getEquippedArmorDefense();
  if (defense <= 0) return amount;
  const multiplier = Math.max(0.2, 1 - defense * 0.04);
  return Math.max(1, Math.ceil(amount * multiplier));
}

function equipArmor(itemId) {
  const slotIndex = getArmorSlotIndex(itemId);
  if (slotIndex < 0 || getInventoryCount(itemId) <= 0) return false;
  const previous = equippedArmor[slotIndex];
  if (previous) addInventoryCount(previous, 1);
  equippedArmor[slotIndex] = itemId;
  addInventoryCount(itemId, -1);
  return true;
}

function unequipArmor(slotIndex) {
  const itemId = equippedArmor[slotIndex];
  if (!itemId) return false;
  equippedArmor[slotIndex] = null;
  addInventoryCount(itemId, 1);
  return true;
}

function getArmorState() {
  return equippedArmor.slice();
}

function restoreArmorState(items) {
  equippedArmor.fill(null);
  if (!Array.isArray(items)) return;
  items.slice(0, equippedArmor.length).forEach((itemId, index) => {
    if (ARMOR_ITEM_IDS[index] === itemId) equippedArmor[index] = itemId;
  });
}

function initializeSurvivalInventory() {
  HOTBAR_BLOCKS.forEach((item) => setInventoryCount(item.id, 0));
  RESOURCE_ITEMS.forEach((item) => setInventoryCount(item.id, 0));
  Object.keys(CRAFT_ITEMS).forEach((itemId) => setInventoryCount(itemId, 0));
}

initializeSurvivalInventory();
