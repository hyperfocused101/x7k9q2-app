/**
 * storage.js — IndexedDB persistence layer
 * Stores sessions and audio chunks for zero-data-loss recording.
 */

const DB_NAME = 'voicenotes_db';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const CHUNKS_STORE = 'chunks';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessions = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        sessions.createIndex('createdAt', 'createdAt');
        sessions.createIndex('isFinalized', 'isFinalized');
      }

      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunks = db.createObjectStore(CHUNKS_STORE, { keyPath: 'id', autoIncrement: true });
        chunks.createIndex('sessionId', 'sessionId');
        chunks.createIndex('order', 'order');
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

function generateId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a new session record.
 */
export async function createSession({ videoId, videoTitle }) {
  const db = await openDB();
  const session = {
    id: generateId(),
    videoId,
    videoTitle: videoTitle || 'Untitled',
    videoTimestamp: 0,
    isFinalized: false,
    createdAt: Date.now(),
    recordingDuration: 0,
    chunkCount: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const req = tx.objectStore(SESSIONS_STORE).put(session);
    req.onsuccess = () => resolve(session);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update an existing session's metadata.
 */
export async function updateSession(sessionId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = () => {
      if (!getReq.result) return reject(new Error('Session not found'));
      const updated = { ...getReq.result, ...updates };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve(updated);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Add an audio chunk to a session.
 */
export async function addChunk(sessionId, arrayBuffer, order) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    const req = tx.objectStore(CHUNKS_STORE).add({ sessionId, data: arrayBuffer, order });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all chunks for a session, ordered correctly.
 */
export async function getChunks(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readonly');
    const idx = tx.objectStore(CHUNKS_STORE).index('sessionId');
    const req = idx.getAll(sessionId);
    req.onsuccess = () => {
      const chunks = req.result.sort((a, b) => a.order - b.order);
      resolve(chunks);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get the assembled audio blob for a session.
 */
export async function getSessionAudioBlob(sessionId) {
  const chunks = await getChunks(sessionId);
  if (!chunks.length) return null;
  const buffers = chunks.map(c => c.data);
  return new Blob(buffers, { type: 'audio/webm;codecs=opus' });
}

/**
 * Finalize a session — combine all chunks and mark as complete.
 */
export async function finalizeSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');

  await updateSession(sessionId, { isFinalized: true, finalizedAt: Date.now() });
}

/**
 * Get a single session by ID.
 */
export async function getSession(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const req = tx.objectStore(SESSIONS_STORE).get(sessionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all sessions ordered by createdAt descending.
 */
export async function getAllSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const req = tx.objectStore(SESSIONS_STORE).getAll();
    req.onsuccess = () => {
      const all = req.result.sort((a, b) => b.createdAt - a.createdAt);
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all finalized sessions (history list).
 */
export async function getFinalizedSessions() {
  const all = await getAllSessions();
  return all.filter(s => s.isFinalized);
}

/**
 * Get the most recent non-finalized session (for recovery).
 */
export async function getLastActiveSession() {
  const all = await getAllSessions();
  return all.find(s => !s.isFinalized) || null;
}

/**
 * Delete a session and all its chunks.
 */
export async function deleteSession(sessionId) {
  const db = await openDB();

  // Delete all chunks first
  const chunks = await getChunks(sessionId);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    const store = tx.objectStore(CHUNKS_STORE);
    let pending = chunks.length;
    if (!pending) return resolve();
    chunks.forEach(c => {
      const req = store.delete(c.id);
      req.onsuccess = () => { if (--pending === 0) resolve(); };
      req.onerror = () => reject(req.error);
    });
  });

  // Delete session
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const req = tx.objectStore(SESSIONS_STORE).delete(sessionId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
