/**
 * recorder.js — Audio recording with MediaRecorder API
 * One continuous session: multiple start/stop cycles merge into a single recording.
 */

import { addChunk, updateSession } from './storage.js';

let mediaRecorder = null;
let audioStream = null;
let sessionId = null;
let chunkOrder = 0;
let recordingStartTime = null;
let accumulatedDuration = 0;
let stateChangeCallbacks = [];
let autoSaveInterval = null;

const AUTOSAVE_INTERVAL_MS = 3000;
const TIMESLICE_MS = 2000;

export const RecorderState = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PAUSED: 'paused',
};

let currentState = RecorderState.IDLE;

export function getState() {
  return currentState;
}

export function onStateChange(cb) {
  stateChangeCallbacks.push(cb);
}

function setState(s) {
  currentState = s;
  stateChangeCallbacks.forEach(cb => cb(s));
}

/**
 * Set accumulated duration directly — used to restore timer from storage
 * before initRecorder is called (so the session timer shows the right value).
 */
export function setAccumulatedDuration(ms) {
  accumulatedDuration = ms;
}

/**
 * Request microphone access and prepare the recorder for a session.
 *
 * @param {string} sid - Session ID
 * @param {number} startChunkOrder - Index to start new chunks from (0 for new sessions,
 *   existing chunk count for restored sessions — prevents order-bug on restore).
 * @param {number} startDuration - Previously accumulated recording time in ms
 *   (0 for new sessions, stored value for restored sessions).
 */
export async function initRecorder(sid, startChunkOrder = 0, startDuration = 0) {
  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }

  sessionId = sid;
  chunkOrder = startChunkOrder;        // Fix #1: continue from end, not from 0
  accumulatedDuration = startDuration; // Fix #3: restore accumulated time
  recordingStartTime = null;

  audioStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 22050,
    },
  });

  const mimeType = getSupportedMimeType();
  const options = { mimeType, audioBitsPerSecond: 32000 };

  mediaRecorder = new MediaRecorder(audioStream, options);

  mediaRecorder.ondataavailable = async (e) => {
    if (e.data && e.data.size > 0) {
      const buf = await e.data.arrayBuffer();
      await addChunk(sessionId, buf, chunkOrder++);
    }
  };

  mediaRecorder.onerror = (e) => {
    console.error('MediaRecorder error:', e);
  };
}

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/**
 * Start or resume recording.
 */
export function startRecording() {
  if (!mediaRecorder) throw new Error('Recorder not initialised');

  if (currentState === RecorderState.PAUSED && mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
  } else if (mediaRecorder.state === 'inactive') {
    mediaRecorder.start(TIMESLICE_MS);
  }

  recordingStartTime = Date.now();
  startAutoSave();
  setState(RecorderState.RECORDING);
}

/**
 * Pause recording (does not finalise the session).
 */
export function pauseRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

  mediaRecorder.pause();
  accumulatedDuration += Date.now() - (recordingStartTime || Date.now());
  recordingStartTime = null;
  stopAutoSave();
  setState(RecorderState.PAUSED);
}

/**
 * Finalise the session — flushes remaining data.
 * Returns total accumulated recording duration in ms.
 */
export async function finalizeRecording() {
  if (!mediaRecorder) return accumulatedDuration;

  if (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused') {
    if (recordingStartTime) {
      accumulatedDuration += Date.now() - recordingStartTime;
      recordingStartTime = null;
    }

    await new Promise((resolve) => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
    });
  }

  stopAutoSave();

  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }

  const total = accumulatedDuration;
  mediaRecorder = null;
  setState(RecorderState.IDLE);

  return total;
}

/**
 * Abort recording without saving final state.
 */
export function abortRecording() {
  stopAutoSave();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }
  mediaRecorder = null;
  setState(RecorderState.IDLE);
}

/**
 * Get total recording duration in milliseconds.
 * Works at all times — returns accumulated + current segment (if recording).
 */
export function getRecordingDuration() {
  let total = accumulatedDuration;
  if (recordingStartTime) total += Date.now() - recordingStartTime;
  return total;
}

function startAutoSave() {
  stopAutoSave();
  autoSaveInterval = setInterval(() => {
    if (sessionId) {
      updateSession(sessionId, {
        recordingDuration: getRecordingDuration(),
      }).catch(() => {});
    }
  }, AUTOSAVE_INTERVAL_MS);
}

function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}
