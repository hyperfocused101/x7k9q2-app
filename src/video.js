/**
 * video.js — YouTube IFrame API integration
 */

let player = null;
let isReady = false;
let pendingVideoId = null;

const onReadyCallbacks = [];
const onStateChangeCallbacks = [];

/**
 * Boot the YouTube IFrame API. Safe to call multiple times.
 */
export function initYouTubeAPI() {
  if (window.YT && window.YT.Player) {
    isReady = true;
    flushPending();
    return;
  }

  // Define the global callback before loading the script
  window.onYouTubeIframeAPIReady = () => {
    isReady = true;
    flushPending();
  };

  if (!document.getElementById('yt-api-script')) {
    const script = document.createElement('script');
    script.id = 'yt-api-script';
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  }
}

function flushPending() {
  if (pendingVideoId) {
    _createPlayer(pendingVideoId);
    pendingVideoId = null;
  }
}

/**
 * Extract the video ID from any YouTube URL format.
 */
export function extractVideoId(url) {
  try {
    const u = new URL(url.trim());
    // Standard: youtube.com/watch?v=ID
    if (u.searchParams.has('v')) return u.searchParams.get('v');
    // Shortened: youtu.be/ID
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    // Embed: youtube.com/embed/ID
    const embedMatch = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embedMatch) return embedMatch[1];
    // Shorts: youtube.com/shorts/ID
    const shortsMatch = u.pathname.match(/\/shorts\/([^/?]+)/);
    if (shortsMatch) return shortsMatch[1];
  } catch {
    // Not a valid URL — try regex fallback
    const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Fetch the video title via YouTube oEmbed (no API key needed).
 */
export async function fetchVideoTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}

/**
 * Load a YouTube video by ID. Creates or replaces the player.
 */
export function loadVideo(videoId) {
  if (!isReady) {
    pendingVideoId = videoId;
    return;
  }

  if (player) {
    player.loadVideoById(videoId);
  } else {
    _createPlayer(videoId);
  }
}

function _createPlayer(videoId) {
  // Clear the placeholder
  const container = document.getElementById('yt-player');
  container.innerHTML = '';

  player = new window.YT.Player('yt-player', {
    videoId,
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
    },
    events: {
      onReady: () => {
        onReadyCallbacks.forEach(cb => cb());
      },
      onStateChange: (event) => {
        onStateChangeCallbacks.forEach(cb => cb(event.data));
      },
      onError: (e) => {
        console.warn('YouTube player error:', e.data);
      },
    },
  });
}

/** Register a callback for when the player is ready. */
export function onPlayerReady(cb) {
  onReadyCallbacks.push(cb);
}

/** Register a callback for player state changes. */
export function onPlayerStateChange(cb) {
  onStateChangeCallbacks.push(cb);
}

/** Pause the video. */
export function pauseVideo() {
  if (player && typeof player.pauseVideo === 'function') {
    player.pauseVideo();
  }
}

/** Play the video. */
export function playVideo() {
  if (player && typeof player.playVideo === 'function') {
    player.playVideo();
  }
}

/** Get the current playback time in seconds. */
export function getCurrentTime() {
  if (player && typeof player.getCurrentTime === 'function') {
    return player.getCurrentTime() || 0;
  }
  return 0;
}

/** Seek to a specific time in seconds. */
export function seekTo(seconds) {
  if (player && typeof player.seekTo === 'function') {
    player.seekTo(Math.max(0, seconds), true);
  }
}

/** Returns true if a video is currently loaded. */
export function hasVideo() {
  return player !== null;
}

/**
 * Stop and destroy the player, restoring the blank state.
 * Safe to call even if no player exists.
 * Does NOT touch #player-placeholder — that element stays in the DOM
 * so existing references and CSS remain valid. We only restore the
 * #yt-player target div that the YouTube API replaces with an iframe.
 */
export function resetPlayer() {
  if (player) {
    try { player.stopVideo(); } catch {}
    try { player.destroy(); } catch {} // removes the iframe from the DOM
    player = null;
  }
  // After destroy() the iframe is gone. Recreate the #yt-player target
  // div (at the top of the container) so the next loadVideo() works.
  const container = document.getElementById('yt-player-container');
  if (container && !document.getElementById('yt-player')) {
    const div = document.createElement('div');
    div.id = 'yt-player';
    container.insertBefore(div, container.firstChild);
  }
}
