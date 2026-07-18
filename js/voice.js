'use strict';

const VOICE_SIGNAL_STORAGE = 'block_world_voice_signal_url';
const voiceState = {
  ws: null,
  peerId: '',
  joined: false,
  muted: false,
  localStream: null,
  peers: new Map(),
};

function getVoiceSignalUrl() {
  return window.VOICE_SIGNAL_URL || localStorage.getItem(VOICE_SIGNAL_STORAGE) || '';
}

function setVoiceStatus(text) {
  const status = document.getElementById('voice-status');
  if (status) status.textContent = text;
}

function updateVoiceButtons() {
  const joinButton = document.getElementById('btn-voice-join');
  const muteButton = document.getElementById('btn-voice-mute');
  if (joinButton) joinButton.textContent = voiceState.joined ? '退出' : 'ボイス参加';
  if (muteButton) {
    muteButton.disabled = !voiceState.localStream;
    muteButton.textContent = voiceState.muted ? 'ミュート解除' : 'ミュート';
  }
}

function voiceRoomId() {
  return activeWorldId || chatState?.roomId || 'lobby';
}

function voiceSend(payload) {
  if (voiceState.ws?.readyState === WebSocket.OPEN) {
    voiceState.ws.send(JSON.stringify(payload));
  }
}

function closePeer(peerId) {
  const peer = voiceState.peers.get(peerId);
  if (!peer) return;
  peer.audio?.remove();
  peer.pc?.close();
  voiceState.peers.delete(peerId);
}

function stopVoice() {
  for (const peerId of [...voiceState.peers.keys()]) closePeer(peerId);
  if (voiceState.ws) voiceState.ws.close();
  if (voiceState.localStream) {
    voiceState.localStream.getTracks().forEach((track) => track.stop());
  }
  voiceState.ws = null;
  voiceState.peerId = '';
  voiceState.joined = false;
  voiceState.localStream = null;
  setVoiceStatus('未接続');
  updateVoiceButtons();
}

function createPeer(peerId) {
  if (voiceState.peers.has(peerId)) return voiceState.peers.get(peerId);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.playsInline = true;
  document.body.appendChild(audio);

  voiceState.localStream?.getTracks().forEach((track) => pc.addTrack(track, voiceState.localStream));
  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0];
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) voiceSend({ type: 'ice', to: peerId, candidate: event.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (['closed', 'failed', 'disconnected'].includes(pc.connectionState)) closePeer(peerId);
    setVoiceStatus(`接続中: ${voiceState.peers.size}人`);
  };

  const peer = { pc, audio };
  voiceState.peers.set(peerId, peer);
  return peer;
}

async function callPeer(peerId) {
  const { pc } = createPeer(peerId);
  const description = await pc.createOffer();
  await pc.setLocalDescription(description);
  voiceSend({ type: 'offer', to: peerId, description: pc.localDescription });
}

async function handleVoiceMessage(message) {
  if (message.type === 'welcome') {
    voiceState.peerId = message.peerId;
    voiceState.joined = true;
    setVoiceStatus(`接続中: ${(message.peers || []).length + 1}人`);
    updateVoiceButtons();
    for (const peer of message.peers || []) await callPeer(peer.peerId);
    return;
  }

  if (message.type === 'peer-left') {
    closePeer(message.peerId);
    setVoiceStatus(`接続中: ${voiceState.peers.size + 1}人`);
    return;
  }

  if (message.type === 'peer-joined') {
    setVoiceStatus(`接続中: ${voiceState.peers.size + 2}人`);
    return;
  }

  if (message.type === 'offer') {
    const { pc } = createPeer(message.from);
    await pc.setRemoteDescription(message.description);
    const description = await pc.createAnswer();
    await pc.setLocalDescription(description);
    voiceSend({ type: 'answer', to: message.from, description: pc.localDescription });
    return;
  }

  if (message.type === 'answer') {
    const peer = voiceState.peers.get(message.from);
    if (peer) await peer.pc.setRemoteDescription(message.description);
    return;
  }

  if (message.type === 'ice') {
    const peer = voiceState.peers.get(message.from);
    if (peer && message.candidate) await peer.pc.addIceCandidate(message.candidate);
  }
}

async function startVoice() {
  const signalUrl = getVoiceSignalUrl();
  if (!signalUrl) {
    const entered = prompt('ボイスサーバーのURLを入力してください（例: wss://example.com）');
    if (!entered) return;
    localStorage.setItem(VOICE_SIGNAL_STORAGE, entered.trim());
  }

  try {
    voiceState.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    voiceState.localStream.getAudioTracks().forEach((track) => { track.enabled = !voiceState.muted; });
    voiceState.ws = new WebSocket(getVoiceSignalUrl());
    voiceState.ws.addEventListener('open', () => {
      voiceSend({ type: 'join', roomId: voiceRoomId(), name: 'Player' });
      setVoiceStatus('参加中...');
    });
    voiceState.ws.addEventListener('message', async (event) => {
      try {
        await handleVoiceMessage(JSON.parse(event.data));
      } catch (err) {
        console.warn('Voice message error', err);
      }
    });
    voiceState.ws.addEventListener('close', stopVoice);
    voiceState.ws.addEventListener('error', () => setVoiceStatus('接続エラー'));
    setVoiceStatus('マイク接続中...');
    updateVoiceButtons();
  } catch (err) {
    console.warn('Voice start failed', err);
    setVoiceStatus('マイク許可が必要');
    stopVoice();
  }
}

function toggleMuteVoice() {
  voiceState.muted = !voiceState.muted;
  voiceState.localStream?.getAudioTracks().forEach((track) => { track.enabled = !voiceState.muted; });
  updateVoiceButtons();
}

function setupVoiceUI() {
  document.getElementById('btn-voice-join')?.addEventListener('click', () => {
    if (voiceState.joined || voiceState.ws) stopVoice();
    else startVoice();
  });
  document.getElementById('btn-voice-mute')?.addEventListener('click', toggleMuteVoice);
  document.getElementById('btn-voice-config')?.addEventListener('click', () => {
    const current = getVoiceSignalUrl();
    const entered = prompt('ボイスサーバーのURL', current);
    if (entered !== null) localStorage.setItem(VOICE_SIGNAL_STORAGE, entered.trim());
  });
  updateVoiceButtons();
  setVoiceStatus(getVoiceSignalUrl() ? '未接続' : 'サーバー未設定');
}

setupVoiceUI();
