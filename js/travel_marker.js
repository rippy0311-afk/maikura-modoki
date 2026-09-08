'use strict';

const TRAVEL_MARKER_STORAGE = 'block_world_travel_markers';

let travelMarkerMesh = null;

function getTravelMarkerStore() {
  try {
    const raw = localStorage.getItem(TRAVEL_MARKER_STORAGE);
    const data = JSON.parse(raw || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    console.warn('Invalid travel marker data', err);
    return {};
  }
}

function saveTravelMarkerStore(store) {
  localStorage.setItem(TRAVEL_MARKER_STORAGE, JSON.stringify(store));
}

function getTravelMarkerWorldId() {
  return typeof activeWorldId === 'string' && activeWorldId ? activeWorldId : '';
}

function getCurrentTravelMarker() {
  const worldId = getTravelMarkerWorldId();
  if (!worldId) return null;
  const marker = getTravelMarkerStore()[worldId];
  if (!marker) return null;
  const x = Number(marker.x);
  const y = Number(marker.y);
  const z = Number(marker.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z, savedAt: marker.savedAt || 0 };
}

function formatTravelMarker(marker) {
  if (!marker) return 'まだ記録地点はありません。';
  const date = marker.savedAt ? new Date(marker.savedAt).toLocaleString() : '保存済み';
  return `記録地点: X ${marker.x.toFixed(1)} / Y ${marker.y.toFixed(1)} / Z ${marker.z.toFixed(1)} (${date})`;
}

function updateTravelMarkerStatus() {
  const status = document.getElementById('travel-marker-status');
  if (status) status.textContent = formatTravelMarker(getCurrentTravelMarker());
}

function ensureTravelMarkerMesh() {
  if (travelMarkerMesh || typeof THREE === 'undefined' || typeof scene === 'undefined') return travelMarkerMesh;
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 2.2, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffd75e })
  );
  pole.position.y = 1.1;
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.55, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x203abd })
  );
  flag.position.set(0.48, 1.85, 0);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x7fceff, transparent: true, opacity: 0.78 })
  );
  glow.position.y = 2.55;
  group.add(pole, flag, glow);
  group.visible = false;
  scene.add(group);
  travelMarkerMesh = group;
  return travelMarkerMesh;
}

function updateTravelMarkerMesh() {
  const mesh = ensureTravelMarkerMesh();
  if (!mesh) return;
  const marker = getCurrentTravelMarker();
  mesh.visible = Boolean(marker);
  if (marker) mesh.position.set(marker.x, marker.y, marker.z);
}

function saveCurrentTravelMarker() {
  const worldId = getTravelMarkerWorldId();
  if (!worldId || typeof player === 'undefined') {
    showToast('先にワールドに入ってください');
    return;
  }
  const store = getTravelMarkerStore();
  store[worldId] = {
    x: Number(player.pos.x),
    y: Number(player.pos.y),
    z: Number(player.pos.z),
    savedAt: Date.now(),
  };
  saveTravelMarkerStore(store);
  updateTravelMarkerStatus();
  updateTravelMarkerMesh();
  showToast('現在地を旅のしおりに記録しました');
}

function returnToTravelMarker() {
  const marker = getCurrentTravelMarker();
  if (!marker || typeof player === 'undefined') {
    showToast('記録地点がありません');
    return;
  }
  player.pos = { x: marker.x, y: marker.y, z: marker.z };
  player.vel = { x: 0, y: 0, z: 0 };
  if (typeof clearMovementState === 'function') clearMovementState();
  if (typeof saveGameState === 'function') saveGameState(true);
  showToast('記録地点へ戻りました');
}

function clearTravelMarker() {
  const worldId = getTravelMarkerWorldId();
  if (!worldId) return;
  const store = getTravelMarkerStore();
  delete store[worldId];
  saveTravelMarkerStore(store);
  updateTravelMarkerStatus();
  updateTravelMarkerMesh();
  showToast('旅のしおりを消しました');
}

function setupTravelMarkerFeature() {
  document.getElementById('btn-travel-save')?.addEventListener('click', saveCurrentTravelMarker);
  document.getElementById('btn-travel-return')?.addEventListener('click', returnToTravelMarker);
  document.getElementById('btn-travel-clear')?.addEventListener('click', clearTravelMarker);
  updateTravelMarkerStatus();
  setInterval(() => {
    updateTravelMarkerStatus();
    updateTravelMarkerMesh();
  }, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupTravelMarkerFeature);
} else {
  setupTravelMarkerFeature();
}
