/**
 * ui.js — DOM manipulation and UI state management
 */

import { getSessionAudioBlob, getFinalizedSessions, deleteSession, updateSession } from './storage.js';

// ── Elements ──────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

export const els = {
  urlInput: $('url-input'),
  loadBtn: $('load-btn'),
  playerPlaceholder: $('player-placeholder'),
  videoTitleBar: $('video-title-bar'),
  videoTitleText: $('video-title-text'),
  sessionBar: $('session-bar'),
  recordingIndicator: $('recording-indicator'),
  recTimer: $('rec-timer'),
  sessionIdleHint: $('session-idle-hint'),
  recordBtn: $('record-btn'),
  recordBtnLabel: $('record-btn-label'),
  stopSessionBtn: $('stop-session-btn'),
  newSessionBtn: $('new-session-btn'),
  historyBtn: $('history-btn'),
  historyBadge: $('history-badge'),
  historyOverlay: $('history-overlay'),
  historyDrawer: $('history-drawer'),
  closeHistoryBtn: $('close-history-btn'),
  historyList: $('history-list'),
  historyEmpty: $('history-empty'),
  recoveryBanner: $('recovery-banner'),
  recoveryText: $('recovery-text'),
  recoveryRestoreBtn: $('recovery-restore-btn'),
  recoveryDismissBtn: $('recovery-dismiss-btn'),
  toast: $('toast'),
  // Modal
  newSessionModal: $('new-session-modal'),
  modalSaveBtn: $('modal-save-btn'),
  modalDiscardBtn: $('modal-discard-btn'),
  modalCancelBtn: $('modal-cancel-btn'),
};

// ── Toast ─────────────────────────────────────────────────────

let toastTimeout = null;

export function showToast(msg, durationMs = 2500) {
  const t = els.toast;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), durationMs);
}

// ── Player UI ─────────────────────────────────────────────────

export function showPlayer(title) {
  els.playerPlaceholder.classList.add('hidden');
  if (title) {
    els.videoTitleText.textContent = title;
    els.videoTitleBar.classList.remove('hidden');
  }
}

export function setVideoTitle(title) {
  els.videoTitleText.textContent = title || '';
  els.videoTitleBar.classList.toggle('hidden', !title);
}

export function resetPlayerUI() {
  // Re-attach placeholder (player DOM was already rebuilt by resetPlayer())
  const placeholder = document.getElementById('player-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');
  els.videoTitleBar.classList.add('hidden');
  els.videoTitleText.textContent = '';
  els.urlInput.value = '';
}

// ── Session bar ───────────────────────────────────────────────

export function showSessionBar() {
  els.sessionBar.classList.remove('hidden');
}

export function hideSessionBar() {
  els.sessionBar.classList.add('hidden');
}

// ── Session timer (always visible while session is active) ────

let sessionTimerInterval = null;

export function startSessionTimer(getDurationFn) {
  clearInterval(sessionTimerInterval);
  els.recTimer.textContent = formatDuration(getDurationFn());
  sessionTimerInterval = setInterval(() => {
    els.recTimer.textContent = formatDuration(getDurationFn());
  }, 1000);
}

export function stopSessionTimer() {
  clearInterval(sessionTimerInterval);
  sessionTimerInterval = null;
  els.recTimer.textContent = '0:00';
}

// ── Recording indicator (REC dot + label only) ────────────────

export function startRecordingIndicator() {
  els.recordingIndicator.classList.remove('hidden');
  els.sessionIdleHint.classList.add('hidden');
}

export function stopRecordingIndicator() {
  els.recordingIndicator.classList.add('hidden');
  els.sessionIdleHint.classList.remove('hidden');
}

export function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Controls ──────────────────────────────────────────────────

export function setRecordButtonState(state) {
  const btn = els.recordBtn;
  if (state === 'recording') {
    btn.classList.add('is-recording');
    els.recordBtnLabel.textContent = 'Pause';
  } else {
    btn.classList.remove('is-recording');
    els.recordBtnLabel.textContent = state === 'paused' ? 'Resume' : 'Record';
  }
}

export function enableControls(hasSession) {
  els.recordBtn.disabled = false;
  els.stopSessionBtn.disabled = !hasSession;
}

export function disableControls() {
  els.recordBtn.disabled = true;
  els.stopSessionBtn.disabled = true;
}

// ── Full UI reset ─────────────────────────────────────────────

export function resetUI() {
  stopSessionTimer();
  stopRecordingIndicator();
  setRecordButtonState('idle');
  disableControls();
  hideSessionBar();
  hideRecoveryBanner();
  resetPlayerUI();
}

// ── New session modal ─────────────────────────────────────────

/**
 * Show the 3-option dialog and resolve with:
 *   'save'    → Save & Start New
 *   'discard' → Discard & Start New
 *   null      → Cancel
 */
export function showNewSessionDialog() {
  return new Promise((resolve) => {
    els.newSessionModal.classList.remove('hidden');

    function cleanup(result) {
      els.newSessionModal.classList.add('hidden');
      els.modalSaveBtn.removeEventListener('click', onSave);
      els.modalDiscardBtn.removeEventListener('click', onDiscard);
      els.modalCancelBtn.removeEventListener('click', onCancel);
      els.newSessionModal.removeEventListener('click', onOverlay);
      resolve(result);
    }

    const onSave    = () => cleanup('save');
    const onDiscard = () => cleanup('discard');
    const onCancel  = () => cleanup(null);
    const onOverlay = (e) => { if (e.target === els.newSessionModal) cleanup(null); };

    els.modalSaveBtn.addEventListener('click', onSave);
    els.modalDiscardBtn.addEventListener('click', onDiscard);
    els.modalCancelBtn.addEventListener('click', onCancel);
    els.newSessionModal.addEventListener('click', onOverlay);
  });
}

// ── Recovery banner ───────────────────────────────────────────

export function showRecoveryBanner(sessionTitle) {
  const title = sessionTitle || 'a previous session';
  els.recoveryText.textContent = `Session recovered: "${title}"`;
  els.recoveryBanner.classList.remove('hidden');
}

export function hideRecoveryBanner() {
  els.recoveryBanner.classList.add('hidden');
}

// ── History drawer ────────────────────────────────────────────

export function openHistoryDrawer() {
  els.historyOverlay.classList.remove('hidden');
  els.historyDrawer.classList.remove('hidden');
  requestAnimationFrame(() => {
    els.historyOverlay.classList.add('visible');
    els.historyDrawer.classList.add('visible');
  });
}

export function closeHistoryDrawer() {
  els.historyOverlay.classList.remove('visible');
  els.historyDrawer.classList.remove('visible');
  setTimeout(() => {
    els.historyOverlay.classList.add('hidden');
    els.historyDrawer.classList.add('hidden');
  }, 260);
}

export async function renderHistory(onDelete) {
  const sessions = await getFinalizedSessions();

  const count = sessions.length;
  els.historyBadge.textContent = count;
  els.historyBadge.classList.toggle('hidden', count === 0);

  const list = els.historyList;
  const cards = list.querySelectorAll('.session-card');
  cards.forEach(c => c.remove());

  if (!sessions.length) {
    els.historyEmpty.classList.remove('hidden');
    return;
  }

  els.historyEmpty.classList.add('hidden');

  for (const session of sessions) {
    const card = buildCard(session, onDelete);
    list.appendChild(card);
  }
}

function buildCard(session, onDelete) {
  const card = document.createElement('div');
  card.className = 'session-card' + (session.isDone ? ' is-done' : '');
  card.dataset.sessionId = session.id;

  const date = new Date(session.createdAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const time = new Date(session.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
  const duration = session.recordingDuration
    ? formatDuration(session.recordingDuration)
    : '--:--';

  card.innerHTML = `
    <div class="card-header">
      <input type="checkbox" class="card-done-checkbox" title="Mark as done" ${session.isDone ? 'checked' : ''} />
      <div class="card-title">${escapeHtml(session.videoTitle || 'Untitled')}</div>
    </div>
    <div class="card-meta">
      <span>${date} at ${time}</span>
      <span>${duration}</span>
    </div>
    <div class="card-audio-area"></div>
    <div class="card-actions">
      <button class="card-btn card-btn-play" title="Play audio">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Play
      </button>
      <button class="card-btn card-btn-download" title="Download audio">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="2" x2="12" y2="14"/><polyline points="8 10 12 14 16 10"/><line x1="4" y1="20" x2="20" y2="20"/></svg>
        Download
      </button>
      <button class="card-btn card-btn-delete" title="Delete recording">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </div>
  `;

  // ── Mark as done checkbox ──
  const checkbox = card.querySelector('.card-done-checkbox');
  checkbox.addEventListener('change', async () => {
    const isDone = checkbox.checked;
    card.classList.toggle('is-done', isDone);
    try {
      await updateSession(session.id, { isDone });
    } catch {
      checkbox.checked = !isDone;
      card.classList.toggle('is-done', !isDone);
      showToast('Could not save change.');
    }
  });

  // ── Play button ──
  const playBtn = card.querySelector('.card-btn-play');
  const audioArea = card.querySelector('.card-audio-area');
  let audioEl = null;

  playBtn.addEventListener('click', async () => {
    if (audioEl) {
      audioEl.remove();
      audioEl = null;
      playBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play`;
      return;
    }

    playBtn.innerHTML = `<span class="spinner"></span> Loading…`;
    try {
      const blob = await getSessionAudioBlob(session.id);
      if (!blob) { showToast('No audio found.'); return; }
      const url = URL.createObjectURL(blob);
      audioEl = document.createElement('audio');
      audioEl.src = url;
      audioEl.controls = true;
      audioEl.style.width = '100%';
      audioEl.style.marginBottom = '10px';
      audioEl.onended = () => URL.revokeObjectURL(url);
      audioArea.appendChild(audioEl);
      audioEl.play();
      playBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Close`;
    } catch {
      showToast('Could not load audio.');
      playBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play`;
    }
  });

  // ── Download button ──
  const downloadBtn = card.querySelector('.card-btn-download');
  downloadBtn.addEventListener('click', async () => {
    downloadBtn.innerHTML = `<span class="spinner"></span>`;
    try {
      const blob = await getSessionAudioBlob(session.id);
      if (!blob) { showToast('No audio to download.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (session.videoTitle || 'recording').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'recording';
      a.download = `${safeName}.webm`;
      a.href = url;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('Download started');
    } catch {
      showToast('Download failed.');
    } finally {
      downloadBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="2" x2="12" y2="14"/><polyline points="8 10 12 14 16 10"/><line x1="4" y1="20" x2="20" y2="20"/></svg> Download`;
    }
  });

  // ── Delete button ──
  const deleteBtn = card.querySelector('.card-btn-delete');
  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete this recording? This cannot be undone.')) return;
    try {
      await deleteSession(session.id);
      card.remove();
      if (onDelete) onDelete();
      showToast('Recording deleted');
      const remaining = els.historyList.querySelectorAll('.session-card').length;
      els.historyBadge.textContent = remaining;
      els.historyBadge.classList.toggle('hidden', remaining === 0);
      if (remaining === 0) els.historyEmpty.classList.remove('hidden');
    } catch {
      showToast('Could not delete recording.');
    }
  });

  return card;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
