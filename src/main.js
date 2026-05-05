/**
 * main.js — App entry point and orchestration
 * Coordinates: video, recorder, storage, ui
 */

import './style.css';

import {
  initYouTubeAPI,
  extractVideoId,
  fetchVideoTitle,
  loadVideo,
  pauseVideo,
  playVideo,
  getCurrentTime,
  seekTo,
  hasVideo,
  onPlayerReady,
  onPlayerStateChange,
  resetPlayer,
} from './video.js';

import {
  initRecorder,
  startRecording,
  pauseRecording,
  finalizeRecording,
  abortRecording,
  getRecordingDuration,
  setAccumulatedDuration,
  getState,
  onStateChange,
  RecorderState,
} from './recorder.js';

import {
  createSession,
  updateSession,
  getLastActiveSession,
  finalizeSession,
  deleteSession,
  getChunks,
} from './storage.js';

import {
  els,
  showToast,
  showPlayer,
  setVideoTitle,
  showSessionBar,
  hideSessionBar,
  startRecordingIndicator,
  stopRecordingIndicator,
  startSessionTimer,
  stopSessionTimer,
  setRecordButtonState,
  enableControls,
  disableControls,
  resetUI,
  openHistoryDrawer,
  closeHistoryDrawer,
  renderHistory,
  showRecoveryBanner,
  hideRecoveryBanner,
  showNewSessionDialog,
} from './ui.js';

// ── App state ─────────────────────────────────────────────────

let currentSession = null;
let currentVideoId = null;
let currentVideoTitle = null;
let videoTimestampSaveInterval = null;

const REWIND_SECONDS = 4;
const TIMESTAMP_SAVE_INTERVAL_MS = 3000;

// ── Init ──────────────────────────────────────────────────────

async function init() {
  initYouTubeAPI();
  bindEvents();
  await checkForRecovery();
  registerServiceWorker();
}

// ── Event bindings ────────────────────────────────────────────

function bindEvents() {
  els.loadBtn.addEventListener('click', handleLoadVideo);
  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLoadVideo();
  });

  els.recordBtn.addEventListener('click', handleRecordToggle);
  els.stopSessionBtn.addEventListener('click', handleStopSession);
  if (els.newSessionBtn) els.newSessionBtn.addEventListener('click', handleNewSession);

  els.historyBtn.addEventListener('click', () => {
    renderHistory(updateHistoryBadge).then(() => openHistoryDrawer());
  });
  els.closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
  els.historyOverlay.addEventListener('click', closeHistoryDrawer);

  els.recoveryRestoreBtn.addEventListener('click', handleRestore);
  els.recoveryDismissBtn.addEventListener('click', handleDismissRecovery);

  onStateChange((state) => {
    if (state === RecorderState.RECORDING) {
      setRecordButtonState('recording');
      startRecordingIndicator();
    } else if (state === RecorderState.PAUSED) {
      setRecordButtonState('paused');
      stopRecordingIndicator();
    } else {
      setRecordButtonState('idle');
      stopRecordingIndicator();
    }
  });

  onPlayerStateChange((ytState) => {
    if (ytState === 1) {
      startTimestampSave();
    } else {
      stopTimestampSave();
    }
  });
}

// ── Load video ────────────────────────────────────────────────

async function handleLoadVideo() {
  const url = els.urlInput.value.trim();
  if (!url) { showToast('Paste a YouTube URL first'); return; }

  const videoId = extractVideoId(url);
  if (!videoId) {
    showToast('Could not find a YouTube video ID in that URL');
    return;
  }

  if (currentSession && currentVideoId && currentVideoId !== videoId) {
    if (!confirm('Switch video? The current session will end and be saved.')) return;
    await handleStopSession();
  }

  els.loadBtn.disabled = true;
  els.loadBtn.textContent = 'Loading…';

  try {
    currentVideoId = videoId;
    const title = await fetchVideoTitle(videoId);
    currentVideoTitle = title || `Video ${videoId}`;

    loadVideo(videoId);
    showPlayer(currentVideoTitle);
    setVideoTitle(currentVideoTitle);

    if (!currentSession) {
      currentSession = await createSession({ videoId, videoTitle: currentVideoTitle });
      showSessionBar();
      startSessionTimer(getRecordingDuration);
      enableControls(false);
    } else {
      await updateSession(currentSession.id, { videoId, videoTitle: currentVideoTitle });
      setVideoTitle(currentVideoTitle);
    }

    showToast(`"${currentVideoTitle}" loaded`);
  } catch (err) {
    console.error('Load video error:', err);
    showToast('Failed to load video');
  } finally {
    els.loadBtn.disabled = false;
    els.loadBtn.textContent = 'Load';
  }
}

// ── Record toggle ─────────────────────────────────────────────

async function handleRecordToggle() {
  if (!currentSession) {
    showToast('Load a video first');
    return;
  }

  const state = getState();

  if (state === RecorderState.IDLE) {
    try {
      els.recordBtn.disabled = true;

      const existingChunks = await getChunks(currentSession.id);
      const startChunkOrder = existingChunks.length;
      const startDuration = currentSession.recordingDuration || 0;

      await initRecorder(currentSession.id, startChunkOrder, startDuration);
    } catch (err) {
      els.recordBtn.disabled = false;
      if (err.name === 'NotAllowedError') {
        showToast('Microphone access denied. Please allow it and try again.');
      } else {
        showToast('Could not access microphone');
        console.error(err);
      }
      return;
    }
    pauseVideo();
    startRecording();
    enableControls(true);
    els.recordBtn.disabled = false;

  } else if (state === RecorderState.RECORDING) {
    pauseRecording();
    const currentTime = getCurrentTime();
    seekTo(Math.max(0, currentTime - REWIND_SECONDS));
    playVideo();

  } else if (state === RecorderState.PAUSED) {
    pauseVideo();
    startRecording();
  }

  if (currentSession) {
    await updateSession(currentSession.id, { videoTimestamp: getCurrentTime() });
  }
}

// ── Stop session ──────────────────────────────────────────────

async function handleStopSession() {
  if (!currentSession) return;
  if (!confirm('Stop and save this recording session?')) return;

  els.recordBtn.disabled = true;
  els.stopSessionBtn.disabled = true;

  pauseVideo();

  const state = getState();
  let duration = 0;

  if (state !== RecorderState.IDLE) {
    try {
      duration = await finalizeRecording();
    } catch (err) {
      console.error('Finalize recording error:', err);
    }
  }

  const chunks = await getChunks(currentSession.id);

  if (!chunks.length) {
    showToast('No audio recorded — session discarded');
    await deleteSession(currentSession.id).catch(() => {});
    resetAppState();
    return;
  }

  await updateSession(currentSession.id, {
    recordingDuration: duration || 0,
    chunkCount: chunks.length,
  });

  await finalizeSession(currentSession.id);

  showToast(`Session saved: "${currentVideoTitle}"`);
  resetAppState();
  resetPlayer(); // destroy the iframe so placeholder shows cleanly
  updateHistoryBadge();
}

// ── New session ───────────────────────────────────────────────

async function handleNewSession() {
  if (currentSession) {
    const choice = await showNewSessionDialog();
    if (choice === null) return; // User cancelled

    if (choice === 'save') {
      // Finalize the current session and save it
      pauseVideo();
      const state = getState();
      let duration = 0;
      if (state !== RecorderState.IDLE) {
        try { duration = await finalizeRecording(); } catch {}
      } else {
        duration = getRecordingDuration();
      }

      const chunks = await getChunks(currentSession.id);
      if (chunks.length) {
        await updateSession(currentSession.id, {
          recordingDuration: duration || 0,
          chunkCount: chunks.length,
        });
        await finalizeSession(currentSession.id);
        showToast('Session saved — ready to start fresh');
      } else {
        // Nothing recorded, just discard silently
        await deleteSession(currentSession.id).catch(() => {});
        showToast('No audio captured — starting fresh');
      }
      updateHistoryBadge();

    } else if (choice === 'discard') {
      // Abort recorder and delete everything
      const state = getState();
      if (state !== RecorderState.IDLE) {
        abortRecording();
      }
      await deleteSession(currentSession.id).catch(() => {});
      showToast('Session discarded — ready to start fresh');
    }
  }

  // Full app reset regardless of choice (save or discard)
  resetAppState();
  resetPlayer();
}

// ── Reset helpers ─────────────────────────────────────────────

/**
 * Clear all in-memory session state and reset the UI.
 * Does NOT touch the recorder (call abortRecording first if needed)
 * or the player (call resetPlayer if needed).
 */
function resetAppState() {
  stopTimestampSave();
  currentSession = null;
  currentVideoId = null;
  currentVideoTitle = null;
  recoveredSession = null;
  resetUI(); // resets timer, indicator, controls, player UI, recovery banner
}

// ── Session recovery ──────────────────────────────────────────

let recoveredSession = null;

async function checkForRecovery() {
  const session = await getLastActiveSession();
  if (!session) return;

  const chunks = await getChunks(session.id);
  if (!chunks.length) {
    await finalizeSession(session.id);
    return;
  }

  recoveredSession = session;
  showRecoveryBanner(session.videoTitle);
}

async function handleRestore() {
  if (!recoveredSession) return;
  hideRecoveryBanner();

  const session = recoveredSession;
  recoveredSession = null;

  currentSession = session;
  currentVideoId = session.videoId;
  currentVideoTitle = session.videoTitle;

  setAccumulatedDuration(session.recordingDuration || 0);

  const title = await fetchVideoTitle(session.videoId);
  currentVideoTitle = title || session.videoTitle;
  loadVideo(session.videoId);
  showPlayer(currentVideoTitle);
  setVideoTitle(currentVideoTitle);

  onPlayerReady(() => {
    if (session.videoTimestamp > 0) {
      seekTo(session.videoTimestamp);
    }
  });

  showSessionBar();
  startSessionTimer(getRecordingDuration);
  enableControls(true);
  showToast(`Session restored: "${currentVideoTitle}"`);
}

async function handleDismissRecovery() {
  if (!recoveredSession) { hideRecoveryBanner(); return; }
  await finalizeSession(recoveredSession.id);
  recoveredSession = null;
  hideRecoveryBanner();
  showToast('Previous session discarded');
}

// ── Timestamp auto-save ───────────────────────────────────────

function startTimestampSave() {
  stopTimestampSave();
  videoTimestampSaveInterval = setInterval(() => {
    if (currentSession && hasVideo()) {
      updateSession(currentSession.id, {
        videoTimestamp: getCurrentTime(),
      }).catch(() => {});
    }
  }, TIMESTAMP_SAVE_INTERVAL_MS);
}

function stopTimestampSave() {
  if (videoTimestampSaveInterval) {
    clearInterval(videoTimestampSaveInterval);
    videoTimestampSaveInterval = null;
  }
}

// ── History badge ─────────────────────────────────────────────

async function updateHistoryBadge() {
  const { getFinalizedSessions } = await import('./storage.js');
  const sessions = await getFinalizedSessions();
  const count = sessions.length;
  els.historyBadge.textContent = count;
  els.historyBadge.classList.toggle('hidden', count === 0);
}

// ── Service worker ────────────────────────────────────────────

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }
}

// ── Page visibility ───────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (currentSession && hasVideo()) {
      updateSession(currentSession.id, {
        videoTimestamp: getCurrentTime(),
      }).catch(() => {});
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────

init().catch(console.error);
updateHistoryBadge().catch(() => {});
