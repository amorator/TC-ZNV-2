/**
 * Модуль записи видео и аудио
 * Обеспечивает функциональность записи экрана, камеры и аудио
 *
 * @namespace RecordModule
 */

// Синхронизация темы с родительским окном
(function syncThemeFromParent() {
  function applyTheme(theme) {
    if (!theme) return;

    document.documentElement.setAttribute("data-theme", theme);
    document.body && document.body.setAttribute("data-theme", theme);

    // Нормализация классов темы
    const root = document.documentElement;
    const classes = (root.className || "").split(/\s+/).filter(Boolean);
    const filtered = classes.filter((c) => !/^theme-/.test(c));
    filtered.push("theme-" + theme);
    root.className = filtered.join(" ");

    // Также нормализуем на body
    if (document.body) {
      const bClasses = (document.body.className || "")
        .split(/\s+/)
        .filter(Boolean);
      const bFiltered = bClasses.filter((c) => !/^theme-/.test(c));
      bFiltered.push("theme-" + theme);
      document.body.className = bFiltered.join(" ");
    }

    localStorage.setItem("theme", theme);

    // Убеждаемся, что фон использует текущие CSS переменные
    document.documentElement.style.backgroundColor =
      "var(--modal-bg, var(--body-bg))";
    document.body.style.backgroundColor = "var(--modal-bg, var(--body-bg))";
    document.body.style.color = "var(--body-text)";
  }

  // Инициализация из URL
  const params = new URLSearchParams(location.search);
  const t = params.get("theme");
  if (t) applyTheme(t);

  // Слушаем сообщения от родительского окна
  window.addEventListener("message", function (ev) {
    const data = ev && ev.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "theme") applyTheme(data.value);
  });
})();

// Ensure alerts are displayed as toasts in the recorder iframe instead of blocking modals
(function enforceToastAlerts(){
  try {
    window.showAlertModal = function(message, title){
      try {
        if (window.showToast) {
          window.showToast(message || (title || 'Ошибка'), 'error');
          return;
        }
      } catch(_) {}
      try {
        if (window.parent && window.parent.showToast) {
          window.parent.showToast(message || (title || 'Ошибка'), 'error');
          return;
        }
      } catch(_) {}
      try {
        alert((title ? (String(title) + '\n\n') : '') + (message == null ? '' : String(message)));
      } catch(_) {}
    };
  } catch(_) {}
})();
/**
 * Hide and disable a control if present.
 * @param {HTMLElement|HTMLButtonElement|null} x - Element to disable
 */
function disable(x) {
  if (!x) return;
  x.disabled = true;
  x.style.display = "none";
}

/**
 * Show and enable a control if present.
 * @param {HTMLElement|HTMLButtonElement|null} x - Element to enable
 */
function enable(x) {
  if (!x) return;
  x.disabled = false;
  x.style.display = "inline-block";
}

window.onbeforeunload = null;

/** Safe error report: never throws (e.g. in iframe/beforeunload ErrorHandler may be missing). */
function safeReportError(err, ctx) {
  try {
    if (typeof window !== "undefined" && window.ErrorHandler && typeof window.ErrorHandler.handleError === "function")
      window.ErrorHandler.handleError(err, ctx || "unknown");
  } catch (_) {}
}

const BYTES_IN_MB = 1048576;

/** Stream upload: send chunks to server to avoid OOM. Chunk interval (ms). */
const RECORD_STREAM_TIMESLICE_MS = 10000;
/** Max retries per chunk/finalize request. */
const RECORD_STREAM_MAX_RETRIES = 5;
/** Base backoff (ms) for retries. */
const RECORD_STREAM_RETRY_BASE_MS = 1000;

/** Per-stream state for streaming upload (uploadId, chunkIndex, tempName, finalized). */
const streamUploadState = {
  screen: { uploadId: null, chunkIndex: 0, tempName: null, finalized: false },
  camera: { uploadId: null, chunkIndex: 0, tempName: null, finalized: false },
  audio: { uploadId: null, chunkIndex: 0, tempName: null, finalized: false },
};
/** Pending chunk upload promise per stream: wait for it before sending finalize so last chunk (<10s) is not lost. */
let streamPendingChunk = { screen: null, camera: null, audio: null };
/** Set of stream types that are active this session (so we know how many finalizes to wait for). */
let streamUploadActiveTypes = [];
/** Resolve/reject when all active streams have finalized (used after Stop). */
let streamUploadAllFinalizedSettle = null;

/** Current recording file name (from input or default). */
function getRecordFileName() {
  try {
    return (fileName && fileName.value ? fileName.value : (typeof name === "function" ? name() : "")) || "rec";
  } catch (e) {
    return "rec";
  }
}

/** Send action to server for actions.log (fire-and-forget). */
function logRecordAction(action, details, status) {
  try {
    var baseUrl = window.location.origin;
    fetch(baseUrl + "/api/log-action", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({ action: action, details: details || "", status: status || "SUCCESS" }),
    }).catch(function () {});
  } catch (e) {}
}

/** Saving overlay: show "Сохранение... Ожидайте" popup, hide when done. */
var savingOverlayEl = null;
function getOrCreateSavingOverlay() {
  if (savingOverlayEl && document.body.contains(savingOverlayEl)) return savingOverlayEl;
  var el = document.createElement("div");
  el.id = "rec-saving-overlay";
  el.setAttribute("aria-live", "polite");
  el.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--modal-bg, #fff);color:var(--body-text, #000);padding:24px 32px;border-radius:8px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.3);";
  box.innerHTML = "<div style=\"font-size:1.25rem;margin-bottom:8px;\">Сохранение...</div><div style=\"font-size:0.95rem;opacity:0.9;\">Ожидайте</div>";
  el.appendChild(box);
  document.body.appendChild(el);
  savingOverlayEl = el;
  return el;
}
function showSavingOverlay() {
  try {
    var el = getOrCreateSavingOverlay();
    el.style.display = "flex";
  } catch (e) {}
}
function hideSavingOverlay() {
  try {
    if (savingOverlayEl) savingOverlayEl.style.display = "none";
  } catch (e) {}
}

// UI elements populated on DOMContentLoaded
/** @type {HTMLButtonElement|null} */ let buttonCamera;
/** @type {HTMLButtonElement|null} */ let buttonStart;
/** @type {HTMLButtonElement|null} */ let buttonPause;
/** @type {HTMLButtonElement|null} */ let buttonStop;
/** @type {HTMLVideoElement|null} */ let videoScreen;
/** @type {HTMLVideoElement|null} */ let videoCamera;
/** @type {HTMLInputElement|null} */ let fileName;
/** @type {HTMLElement|null} */ let dirName;
/** @type {HTMLTextAreaElement|null} */ let fileText;
/** @type {HTMLInputElement|null} */ let sourceCamera;
/** @type {HTMLInputElement|null} */ let sourceScreen;
/** @type {HTMLInputElement|null} */ let sourceScreenMic;
/** @type {HTMLInputElement|null} */ let sourceBoth;
/** @type {HTMLInputElement|null} */ let sourceAudio;
/** @type {HTMLElement|null} */ let audioIndicatorWrap;
/** @type {HTMLElement|null} */ let audioIndicator;
/** @type {HTMLElement|null} */ let audioIndicatorScreen;
/** @type {HTMLElement|null} */ let audioIndicatorCamera;
/** @type {AudioContext|null} */ let audioContext = null;
/** @type {number|null} */ let audioMeterRaf = null;
// Per-stream meters (separate; do NOT mix)
let audioMeters = {
  screen: { bar: null, analyser: null, source: null },
  camera: { bar: null, analyser: null, source: null },
  audio: { bar: null, analyser: null, source: null },
};

// Timer state
/** @type {number} */ let h = 0;
/** @type {number} */ let m = 0;
/** @type {number} */ let s = 0;

// Recording data buffers
/** @type {BlobPart[]} */ let recordedScreen = [];
/** @type {BlobPart[]} */ let recordedCamera = [];

// Media recording state
/** @type {number|null} */ let timerInterval = null;
/** @type {MediaRecorder|null} */ let recorderScreen;
/** @type {MediaRecorder|null} */ let recorderCamera;
/** @type {MediaStream|null} */ let currentStreamScreen = null;
/** @type {MediaStream|null} */ let currentStreamCamera = null;
/** @type {MediaStream|null} */ let currentStreamAudio = null;
/** @type {MediaStream|null} */ let currentStreamScreenMicMixed = null;
/** @type {boolean} */ let isScreenRecording = false;
/** @type {boolean} */ let isDualRecording = false;
/** @type {boolean} */ let isAudioOnly = false;
/** @type {boolean} */ let isScreenMicRecording = false;
/** @type {boolean} */ let hasAnyAudioTrack = false;

// Separate audio mixing context for "screen + mic" (do not share with meters)
let screenMicMix = { ctx: null, dest: null, srcScreen: null, srcMic: null };

/**
 * Try to get display media with audio; on failure retry without audio.
 * @param {MediaTrackConstraints|boolean} video
 * @param {MediaTrackConstraints|boolean} audio
 * @returns {Promise<MediaStream>}
 */
async function getDisplayMediaWithAudioFallback(video, audio) {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video, audio });
    return s;
  } catch (e) {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
      return s;
    } catch (err) {
      throw err;
    }
  }
}

/**
 * Try to get user media with audio; on failure retry without audio.
 * @param {MediaTrackConstraints|boolean} video
 * @param {MediaTrackConstraints|boolean} audio
 * @returns {Promise<MediaStream>}
 */
async function getUserMediaWithAudioFallback(video, audio) {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video, audio });
    return s;
  } catch (e) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      return s;
    } catch (err) {
      throw err;
    }
  }
}

/**
 * Determine if any capture streams are currently active (live tracks).
 * @returns {boolean}
 */
function areAnyStreamsActive() {
  try {
    const hasLive = (stream) =>
      !!(
        stream &&
        stream.getTracks &&
        stream.getTracks().some((t) => t.readyState === "live")
      );
    return (
      hasLive(currentStreamScreen) ||
      hasLive(currentStreamCamera) ||
      hasLive(currentStreamAudio)
    );
  } catch (_) {
    return false;
  }
}

/**
 * Enable/disable source selection radio controls.
 * @param {boolean} enabled
 */
function setSourceControlsEnabled(enabled) {
  try {
    if (sourceCamera) sourceCamera.disabled = !enabled;
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    if (sourceScreen) sourceScreen.disabled = !enabled;
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    if (sourceScreenMic) sourceScreenMic.disabled = !enabled;
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    if (sourceBoth) sourceBoth.disabled = !enabled;
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    if (sourceAudio) sourceAudio.disabled = !enabled;
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

/**
 * Attach onended listeners to all tracks of given stream with a reason message.
 * @param {MediaStream|null} stream
 * @param {string} reason
 */
function attachOnEnded(stream, reason) {
  try {
    if (!stream || !stream.getTracks) return;
    const notify = function () {
      try {
        if (window.__recIntentionalStop) return;
      } catch (_) {}
      handleCaptureRevoked(reason);
    };
    stream.getTracks().forEach(function (t) {
      try {
        t.onended = notify;
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    });
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

/**
 * Handle revoked capture or inactive stream. Stops recording, allows save, disables source controls, notifies.
 * @param {string} message
 */
function handleCaptureRevoked(message) {
  try {
    if (window.__recNotifiedRevoked) return;
    window.__recNotifiedRevoked = true;
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    // If recording, transition to stopped UI and allow saving available data
    try {
      if (recorderScreen && recorderScreen.state === "recording")
        recorderScreen.pause();
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    try {
      if (recorderCamera && recorderCamera.state === "recording")
        recorderCamera.pause();
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    try {
      if (recorderAudio && recorderAudio.state === "recording") {
        try {
          recorderAudio.pause && recorderAudio.pause();
        } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    try {
      if (recorderScreen && recorderScreen.state !== "inactive")
        recorderScreen.stop();
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    try {
      if (recorderCamera && recorderCamera.state !== "inactive")
        recorderCamera.stop();
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    try {
      if (recorderAudio && recorderAudio.state !== "inactive")
        recorderAudio.stop();
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    // Update state flags
    recState.recording = false;
    recState.paused = false;
    // Reflect UI
    setStoppedUI();
    // Stop streams to free devices
    stopCameraStream();
    // Disable source switches until user re-enables manually
    setSourceControlsEnabled(false);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    window.showAlertModal(
      message ||
        "Источник захвата был отключён или отозваны разрешения. Данные можно сохранить, если они есть.",
      "Предупреждение"
    );
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  // allow further notifications after short cooldown
  try {
    setTimeout(function () {
      window.__recNotifiedRevoked = false;
    }, 1000);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

/** @typedef {{recording: boolean, paused: boolean, hasData: boolean}} RecState */
/** @type {RecState} */ let recState = {
  recording: false,
  paused: false,
  hasData: false,
};
/** @type {BlobPart[]} */ let recordedAudio = [];
/** @type {MediaRecorder|null} */ let recorderAudio = null;

/**
 * Sync theme classes from parent window into iframe (same-origin).
 * Copies `theme-*` classes from parent documentElement to iframe's documentElement.
 */
(function () {
  /**
   * Apply theme classes from a source element to the iframe root.
   * @param {Element|null|undefined} el - Source element to copy theme classes from
   */
  function applyThemeFrom(el) {
    try {
      var dstRoot = document.documentElement;
      if (!dstRoot || !el) return;
      dstRoot.className = (dstRoot.className || "")
        .split(/\s+/)
        .filter(function (c) {
          return !/^theme-/.test(c);
        })
        .join(" ");
      var src = (el.className || "").split(/\s+/).filter(function (c) {
        return /^theme-/.test(c);
      });
      if (src.length) {
        dstRoot.className =
          (dstRoot.className ? dstRoot.className + " " : "") + src.join(" ");
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  }
  /**
   * Perform a single sync attempt from parent document.
   */
  function syncOnce() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        applyThemeFrom(window.parent.document.documentElement);
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  }
  try {
    document.addEventListener("DOMContentLoaded", syncOnce, { once: true });
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  // Avoid perpetual intervals; rely on event-driven sync only
  try {
    /**
     * Listen for theme change messages from parent.
     * @param {MessageEvent<{type:string,className?:string}>} ev - Message event from parent window
     */
    function onThemeMessage(ev) {
      if (!ev || !ev.data) return;
      if (ev.data && ev.data.type === "theme:changed") {
        try {
          if (ev.data.className) {
            var dstRoot = document.documentElement;
            dstRoot.className = (dstRoot.className || "")
              .split(/\s+/)
              .filter(function (c) {
                return !/^theme-/.test(c);
              })
              .join(" ");
            dstRoot.className =
              (dstRoot.className ? dstRoot.className + " " : "") +
              ev.data.className;
            try {
              if (document.body) {
                document.body.className = (document.body.className || "")
                  .split(/\s+/)
                  .filter(function (c) {
                    return !/^theme-/.test(c);
                  })
                  .join(" ");
                document.body.className =
                  (document.body.className
                    ? document.body.className + " "
                    : "") + ev.data.className;
              }
            } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
          } else {
            syncOnce();
          }
        } catch (_) {
          syncOnce();
        }
      }
    }
    window.addEventListener("message", onThemeMessage);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
})();

/**
 * Send current recorder state to parent window (for guarded close logic).
 * @returns {void}
 */
function postState() {
  try {
    if (window.parent) {
      window.parent.postMessage({ type: "rec:state", state: recState }, "*");
    }
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

/**
 * Initialize UI elements and event handlers when DOM is loaded.
 * @returns {void}
 */
document.addEventListener("DOMContentLoaded", function () {
  buttonCamera = document.getElementById("camera");
  buttonStart = document.getElementById("start");
  buttonPause = document.getElementById("pause");
  buttonStop = document.getElementById("stop");
  videoScreen = document.getElementById("video-screen");
  videoCamera = document.getElementById("video-camera");
  audioIndicatorWrap = document.getElementById("audio-indicator-wrap");
  audioIndicator = document.getElementById("audio-indicator");
  audioIndicatorScreen = document.getElementById("audio-indicator-screen");
  audioIndicatorCamera = document.getElementById("audio-indicator-camera");
  fileName = document.getElementById("name");
  dirName = document.getElementById("type");
  fileText = document.getElementById("desc");
  sourceCamera = document.getElementById("source-camera");
  sourceScreen = document.getElementById("source-screen");
  sourceScreenMic = document.getElementById("source-screen-mic");
  sourceBoth = document.getElementById("source-both");
  sourceAudio = document.getElementById("source-audio");

  // legacy upload status UI removed
  // progress UI removed

  disable(buttonStart);
  disable(buttonPause);
  disable(buttonStop);
  if (fileName) fileName.value = name();

  if (buttonCamera) buttonCamera.onclick = onCameraClick;
  if (buttonStart) buttonStart.onclick = onStartClick;
  if (buttonPause) buttonPause.onclick = onPauseClick;
  if (buttonStop) buttonStop.onclick = onStopClick;

  // Source selection change handlers
  if (sourceCamera) sourceCamera.addEventListener("change", onSourceChange);
  if (sourceScreen) sourceScreen.addEventListener("change", onSourceChange);
  if (sourceScreenMic) sourceScreenMic.addEventListener("change", onSourceChange);
  if (sourceBoth) sourceBoth.addEventListener("change", onSourceChange);
  if (sourceAudio) sourceAudio.addEventListener("change", onSourceChange);

  // Backup behavior: no custom selected visuals for radio group

  // Initial UI state
  updateVideoVisibility();

  // Check camera state and update button states accordingly
  updateButtonStates();

  postState();
  // Recompute scrollbar on resize
  try {
    window.addEventListener("resize", function () {
      try {
        updateVideoVisibility();
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    });
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  // Ensure correct initial background/app state in parent
  // Hotkeys inside iframe: Esc to stop
  /**
   * Handle keyboard shortcuts in the recorder iframe.
   * @param {KeyboardEvent} event - Keyboard event
   * @returns {void}
   */
  const handleKey = function (event) {
    const isTextarea =
      document.activeElement && document.activeElement.tagName === "TEXTAREA";
    if (event.key === "Escape") {
      // Delegate ESC to parent for guarded close logic
      try {
        event.preventDefault();
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      try {
        window.parent && window.parent.postMessage({ type: "rec:esc" }, "*");
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      return;
    }
  };
  try {
    window.addEventListener("keydown", handleKey, true);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    document.addEventListener("keydown", handleKey, true);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
});

// Stop media and cleanup when iframe is being unloaded (modal closed or navigation)
try {
  function __recCleanup() {
    try {
      stopRecorder();
    } catch (err) {
      safeReportError(err);
    }
    try {
      stopCameraStream();
    } catch (err) {
      safeReportError(err);
    }
    try {
      stopScreenStream && stopScreenStream();
    } catch (err) {
      safeReportError(err);
    }
    try {
      recState = {
        recording: false,
        paused: false,
        hasData:
          recordedScreen.length > 0 ||
          recordedCamera.length > 0 ||
          (recordedAudio && recordedAudio.length > 0),
      };
      postState();
    } catch (err) {
      safeReportError(err);
    }
    try {
      if (window.__recSyncInterval) {
        clearInterval(window.__recSyncInterval);
        window.__recSyncInterval = null;
      }
    } catch (err) {
      safeReportError(err);
    }
  }
  window.addEventListener("beforeunload", __recCleanup);
  window.addEventListener("pagehide", __recCleanup);
} catch (err) {
      safeReportError(err);
    }

// Pause/cleanup on tab/iframe hidden to avoid camera left on in background
try {
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      try {
        if (recorderScreen && recorderScreen.state === "recording")
          recorderScreen.pause();
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      try {
        if (recorderCamera && recorderCamera.state === "recording")
          recorderCamera.pause();
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      try {
        if (recorderAudio && recorderAudio.state === "recording")
          try {
            recorderAudio.pause && recorderAudio.pause();
          } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      try {
        disable(buttonPause);
        enable(buttonStart);
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      try {
        if (videoScreen) videoScreen.style.borderColor = "green";
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      try {
        if (videoCamera) videoCamera.style.borderColor = "green";
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      try {
        if (audioIndicator) audioIndicator.style.borderColor = "green";
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      try {
        postState();
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    }
  });
} catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }

/**
 * Update UI to stopped state: borders, buttons, timer and save toggle.
 * @returns {void}
 */
function setStoppedUI() {
  try {
    if (videoScreen) videoScreen.style.borderColor = "green";
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    if (videoCamera) videoCamera.style.borderColor = "green";
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    buttonStart.textContent = "Начать запись";
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    disable(buttonPause);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    disable(buttonStop);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  // Don't reset timer when stopping - keep the recorded time visible
}

/**
 * Fully reset UI, state and camera after a successful save or discard.
 * @returns {void}
 */
function resetAfterSave() {
  // progress UI removed
  try {
    if (videoScreen) videoScreen.style.borderColor = "gray";
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    if (videoCamera) videoCamera.style.borderColor = "gray";
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    if (audioIndicator) audioIndicator.style.borderColor = "#000000";
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    buttonStart.textContent = "Начать запись";
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    enable(buttonCamera);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    enable(buttonStart);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    disable(buttonPause);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    disable(buttonStop);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  resetTimer(true);
  recordedScreen = [];
  recordedCamera = [];
  recordedAudio = [];
  streamUploadActiveTypes = [];
  streamUploadState.screen.uploadId = null;
  streamUploadState.screen.chunkIndex = 0;
  streamUploadState.screen.tempName = null;
  streamUploadState.screen.finalized = false;
  streamUploadState.camera.uploadId = null;
  streamUploadState.camera.chunkIndex = 0;
  streamUploadState.camera.tempName = null;
  streamUploadState.camera.finalized = false;
  streamUploadState.audio.uploadId = null;
  streamUploadState.audio.chunkIndex = 0;
  streamUploadState.audio.tempName = null;
  streamUploadState.audio.finalized = false;
  streamUploadAllFinalizedSettle = null;
  streamPendingChunk.screen = null;
  streamPendingChunk.camera = null;
  streamPendingChunk.audio = null;
  // Fully stop camera and reset state
  try {
    stopCameraStream();
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  recorderScreen = null;
  recorderCamera = null;
  recorderAudio = null;
  recState = { recording: false, paused: false, hasData: false };

  // Update video visibility after reset
  updateVideoVisibility();

  // Update button states after reset
  updateButtonStates();
  // Re-enable source controls after save/reset
  try {
    setSourceControlsEnabled(true);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }

  // Reinitialize button handlers to ensure they work
  if (buttonCamera) buttonCamera.onclick = onCameraClick;
  if (buttonStart) buttonStart.onclick = onStartClick;
  if (buttonPause) buttonPause.onclick = onPauseClick;
  if (buttonStop) buttonStop.onclick = onStopClick;

  // Reinitialize source selection handlers
  if (sourceCamera) {
    sourceCamera.removeEventListener("change", onSourceChange);
    sourceCamera.addEventListener("change", onSourceChange);
  }
  if (sourceScreen) {
    sourceScreen.removeEventListener("change", onSourceChange);
    sourceScreen.addEventListener("change", onSourceChange);
  }
  if (sourceBoth) {
    sourceBoth.removeEventListener("change", onSourceChange);
    sourceBoth.addEventListener("change", onSourceChange);
  }
  if (sourceAudio) {
    sourceAudio.removeEventListener("change", onSourceChange);
    sourceAudio.addEventListener("change", onSourceChange);
  }

  postState();
}

/**
 * Stop a single stream: stop every track and release.
 * @param {MediaStream|null} stream
 */
function stopStream(stream) {
  if (!stream || !stream.getTracks) return;
  try {
    stream.getTracks().forEach(function (t) {
      try {
        try { t.onended = null; } catch (_) {}
        if (t.readyState === "live") t.stop();
      } catch (_) {}
    });
  } catch (_) {}
}

/**
 * Stop all media tracks and clear video srcObject. Ensures devices are released on all code paths.
 * @returns {void}
 */
function stopCameraStream() {
  try {
    stopAudioMeter();
  } catch (_) {}
  // Stop and reset screen+mic audio mixer (if used)
  try {
    currentStreamScreenMicMixed = null;
  } catch (_) {}
  try {
    if (screenMicMix && screenMicMix.ctx && screenMicMix.ctx.state !== "closed") {
      screenMicMix.ctx.close().catch(function () {});
    }
  } catch (_) {}
  screenMicMix = { ctx: null, dest: null, srcScreen: null, srcMic: null };
  var screen = currentStreamScreen;
  var camera = currentStreamCamera;
  var audio = currentStreamAudio;
  currentStreamScreen = null;
  currentStreamCamera = null;
  currentStreamAudio = null;
  if (videoScreen && videoScreen.srcObject) {
    try { videoScreen.srcObject = null; } catch (_) {}
  }
  if (videoCamera && videoCamera.srcObject) {
    try { videoCamera.srcObject = null; } catch (_) {}
  }
  try { window.__recIntentionalStop = true; } catch (_) {}
  stopStream(screen);
  stopStream(camera);
  stopStream(audio);
  try { setTimeout(function(){ try { window.__recIntentionalStop = false; } catch (_) {} }, 0); } catch (_) {}
  try {
    let buttonText = "Включить камеру";
    if (isDualRecording) {
      buttonText = "Включить захват";
    } else if (isScreenRecording) {
      buttonText = "Включить захват";
    } else if (isScreenMicRecording) {
      buttonText = "Включить захват";
    } else if (isAudioOnly) {
      buttonText = "Включить микрофон";
    }
    buttonCamera.textContent = buttonText;
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  isScreenRecording = false;
  isDualRecording = false;
  isScreenMicRecording = false;
  isAudioOnly = false;
  // If no streams left and not recording/paused, re-enable source controls
  try {
    if (!areAnyStreamsActive() && !recState.recording && !recState.paused)
      setSourceControlsEnabled(true);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

/**
 * Initialize horizontal audio meters (separate per stream; do NOT mix).
 * - `audio-indicator-screen`: screen stream audio
 * - `audio-indicator-camera`: camera stream audio
 * - `audio-indicator` (wrap): audio-only stream
 */
function setupAudioMeterFromBestAvailableStream() {
  try { updateVideoVisibility(); } catch(_) {}
  try {
    const hasScreen = currentStreamScreen && currentStreamScreen.getAudioTracks && currentStreamScreen.getAudioTracks().length > 0;
    const hasCamera = currentStreamCamera && currentStreamCamera.getAudioTracks && currentStreamCamera.getAudioTracks().length > 0;
    const hasAudio = currentStreamAudio && currentStreamAudio.getAudioTracks && currentStreamAudio.getAudioTracks().length > 0;
    if (!hasScreen && !hasCamera && !hasAudio) {
      stopAudioMeter();
      return;
    }

    function ensureBar(container, key) {
      if (!container) return null;
      if (!audioMeters[key].bar) {
        try {
          const b = document.createElement('div');
          b.style.height = '6px';
          b.style.width = '0%';
          b.style.background = 'var(--btn-focus, #0d6efd)';
          b.style.borderRadius = '8px';
          b.style.transition = 'width 60ms linear';
          b.setAttribute('aria-label', 'Индикатор громкости');
          audioMeters[key].bar = b;
        } catch(_) {}
      }
      try {
        if (audioMeters[key].bar && !container.contains(audioMeters[key].bar)) {
          try { container.textContent = ''; } catch(_) {}
          container.appendChild(audioMeters[key].bar);
        }
      } catch(_) {}
      return audioMeters[key].bar;
    }

    if (!audioContext) {
      try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch(_) { audioContext = null; }
    }
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(function() {});
    }

    function setupOne(stream, key, container) {
      if (!stream) return;
      ensureBar(container, key);
      try { if (audioMeters[key].source) { audioMeters[key].source.disconnect(); } } catch(_) {}
      try { if (audioMeters[key].analyser) { audioMeters[key].analyser.disconnect(); } } catch(_) {}
      audioMeters[key].source = null;
      audioMeters[key].analyser = null;
      try {
        audioMeters[key].source = audioContext.createMediaStreamSource(stream);
        audioMeters[key].analyser = audioContext.createAnalyser();
        audioMeters[key].analyser.fftSize = 1024;
        audioMeters[key].analyser.smoothingTimeConstant = 0.5;
        audioMeters[key].source.connect(audioMeters[key].analyser);
      } catch(_) {}
    }

    if (hasScreen) setupOne(currentStreamScreen, 'screen', audioIndicatorScreen);
    if (hasCamera) setupOne(currentStreamCamera, 'camera', audioIndicatorCamera);
    if (hasAudio) setupOne(currentStreamAudio, 'audio', audioIndicator);

    function tick() {
      try {
        ['screen', 'camera', 'audio'].forEach(function (k) {
          const an = audioMeters[k].analyser;
          const bar = audioMeters[k].bar;
          if (!an || !bar) return;
          const bufferLength = an.fftSize;
          const data = new Uint8Array(bufferLength);
          an.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / bufferLength);
          const pct = Math.min(100, Math.max(0, Math.round((rms * 100))));
          bar.style.width = Math.max(2, pct) + '%';
        });
      } catch(_) {}
      audioMeterRaf = requestAnimationFrame(tick);
    }
    cancelAnimationFrameSafe(audioMeterRaf);
    audioMeterRaf = requestAnimationFrame(tick);
  } catch (err) {
    try { console.warn('[recorder] audio meter setup failed', err); } catch(_) {}
  }
}

function cancelAnimationFrameSafe(id){
  try { if (id != null) cancelAnimationFrame(id); } catch(_) {}
}

/**
 * Stop and tear down audio meter. Closes AudioContext so next setup gets a fresh one (fixes meter after mode switch).
 */
function stopAudioMeter() {
  try {
    cancelAnimationFrameSafe(audioMeterRaf);
    audioMeterRaf = null;
  } catch(_) {}
  try {
    ['screen', 'camera', 'audio'].forEach(function (k) {
      try { if (audioMeters[k].source) audioMeters[k].source.disconnect(); } catch(_) {}
      try { if (audioMeters[k].analyser) audioMeters[k].analyser.disconnect(); } catch(_) {}
      audioMeters[k].source = null;
      audioMeters[k].analyser = null;
      try { if (audioMeters[k].bar) audioMeters[k].bar.style.width = '0%'; } catch(_) {}
    });
  } catch(_) {}
  try {
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close().catch(function() {});
    }
    audioContext = null;
  } catch(_) {}
}

/**
 * Update button states based on camera and recording state.
 * @returns {void}
 */
function updateButtonStates() {
  try {
    // Check if camera is currently active
    const isCameraActive =
      buttonCamera &&
      (buttonCamera.textContent.includes("Выключить") ||
        buttonCamera.textContent.includes("Остановить"));

    // Check if we have any active capture stream (camera or screen)
    const hasActiveStream =
      ((videoCamera &&
        videoCamera.srcObject &&
        videoCamera.srcObject.getTracks &&
        videoCamera.srcObject
          .getTracks()
          .some((track) => track.readyState === "live")) ||
        (videoScreen &&
          videoScreen.srcObject &&
          videoScreen.srcObject.getTracks &&
          videoScreen.srcObject
            .getTracks()
            .some((track) => track.readyState === "live")));

    // Update start button based on camera state
    if (buttonStart) {
      if (isCameraActive || hasActiveStream) {
        enable(buttonStart);
      } else {
        disable(buttonStart);
      }
    }

    // Always disable pause and stop buttons on initialization
    if (buttonPause) disable(buttonPause);
    if (buttonStop) disable(buttonStop);

  } catch (e) {
    // Silent fail - ensure buttons are in safe state
    if (buttonStart) disable(buttonStart);
    if (buttonPause) disable(buttonPause);
    if (buttonStop) disable(buttonStop);
  }
}

/**
 * Update video element visibility based on current recording mode.
 * @returns {void}
 */
function updateVideoVisibility() {
  try {
    const isScreenMode = sourceScreen && sourceScreen.checked;
    const isScreenMicMode = sourceScreenMic && sourceScreenMic.checked;
    const isBothMode = sourceBoth && sourceBoth.checked;
    const isCameraMode = sourceCamera && sourceCamera.checked;
    const isAudioMode = sourceAudio && sourceAudio.checked;

    // Show/hide video elements based on mode
    if (videoScreen) {
      videoScreen.style.display = isScreenMode || isScreenMicMode || isBothMode ? "block" : "none";
    }
    if (videoCamera) {
      videoCamera.style.display = isCameraMode || isBothMode ? "block" : "none";
    }
    if (audioIndicatorWrap) {
      // Audio-only meter lives in this block; other modes have their own meters under screen/camera videos
      audioIndicatorWrap.style.display = (isAudioMode || isScreenMicMode) ? "block" : "none";
    }
    if (audioIndicatorScreen) {
      audioIndicatorScreen.style.display = (isScreenMode || isScreenMicMode || isBothMode) ? "block" : "none";
    }
    if (audioIndicatorCamera) {
      audioIndicatorCamera.style.display = (isCameraMode || isBothMode) ? "block" : "none";
    }

    // Show/hide labels - find labels by their text content
    const videoLabels = document.querySelectorAll(".record-page__video-label");
    videoLabels.forEach((label) => {
      if (label.textContent.includes("Экран")) {
        label.style.display = isScreenMode || isScreenMicMode || isBothMode ? "block" : "none";
      } else if (label.textContent.includes("Камера")) {
        label.style.display = isCameraMode || isBothMode ? "block" : "none";
      } else if (label.textContent.includes("Микрофон")) {
        label.style.display = (isAudioMode || isScreenMicMode) ? "block" : "none";
      }
    });

    // Single inner scrollbar on body; keep html hidden to avoid double bars
    try {
      document.documentElement.style.setProperty(
        "overflow-y",
        "hidden",
        "important"
      );
      document.body.style.setProperty("overflow-y", "auto", "important");
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

// Removed selected-state visuals to match backup styling

/**
 * Handle source selection change (camera/screen/both).
 * @returns {void}
 */
function onSourceChange() {
  // Block changing source while any stream active or during/paused recording
  try {
    if (areAnyStreamsActive() || recState.recording || recState.paused) {
      setSourceControlsEnabled(false);
      return;
    }
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  try {
    if (sourceBoth && sourceBoth.checked) {
      isDualRecording = true;
      isScreenRecording = false;
      isScreenMicRecording = false;
      isAudioOnly = false;
      buttonCamera.textContent = "Включить захват";
    } else if (sourceScreen && sourceScreen.checked) {
      isScreenRecording = true;
      isDualRecording = false;
      isScreenMicRecording = false;
      isAudioOnly = false;
      buttonCamera.textContent = "Включить захват";
    } else if (sourceScreenMic && sourceScreenMic.checked) {
      isScreenRecording = false;
      isDualRecording = false;
      isScreenMicRecording = true;
      isAudioOnly = false;
      buttonCamera.textContent = "Включить захват";
    } else if (sourceAudio && sourceAudio.checked) {
      isScreenRecording = false;
      isDualRecording = false;
      isScreenMicRecording = false;
      isAudioOnly = true;
      buttonCamera.textContent = "Включить микрофон";
    } else {
      isScreenRecording = false;
      isDualRecording = false;
      isScreenMicRecording = false;
      isAudioOnly = false;
      buttonCamera.textContent = "Включить камеру";
    }

    // Backup behavior: rely on native radio styling only

    // Update video visibility
    updateVideoVisibility();

    // Update button states based on new source selection
    updateButtonStates();

    // Stop current streams if any
    stopCameraStream();
    // Reset UI state
    disable(buttonStart);
    disable(buttonPause);
    disable(buttonStop);
    if (videoScreen) videoScreen.style.borderColor = "gray";
    if (videoCamera) videoCamera.style.borderColor = "gray";
    if (audioIndicator) audioIndicator.style.borderColor = "#000000";
    resetTimer(true);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

/**
 * Toggle camera/screen on/off and setup MediaRecorder.
 * Handles camera-only, screen-only, or dual recording modes.
 * @returns {Promise<void>}
 */
async function onCameraClick() {
  try {
    const isCurrentlyActive =
      buttonCamera.textContent.includes("Выключить") ||
      buttonCamera.textContent.includes("Остановить");

    if (isCurrentlyActive) {
      disable(buttonStart);
      disable(buttonPause);
      disable(buttonStop);
      let buttonText = "Включить камеру";
      if (isDualRecording) {
        buttonText = "Включить захват";
      } else if (isScreenRecording) {
        buttonText = "Включить захват";
      }
      buttonCamera.textContent = buttonText;
      stopCameraStream();
      stopAudioMeter();
      enable(buttonCamera);
      try {
        updateButtonStates();
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      if (videoScreen) videoScreen.style.borderColor = "gray";
      if (videoCamera) videoCamera.style.borderColor = "gray";
      clearInterval(timerInterval);
      return;
    } else {
      // Disable source toggles once capture is about to start
      try {
        setSourceControlsEnabled(false);
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
      // Check current source selection
      const isScreenMode = sourceScreen && sourceScreen.checked;
      const isScreenMicMode = sourceScreenMic && sourceScreenMic.checked;
      const isBothMode = sourceBoth && sourceBoth.checked;
      const isAudioMode = sourceAudio && sourceAudio.checked;

      if (isBothMode) {
        // Dual recording: both screen and camera
        try {
          // Get screen stream
          currentStreamScreen = await getDisplayMediaWithAudioFallback(
            {
              width: { ideal: 1920, max: 1920 },
              height: { ideal: 1080, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
            },
            {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              sampleRate: 48000,
            }
          );
          attachOnEnded(
            currentStreamScreen,
            "Захват экрана был остановлен. Вы можете сохранить уже записанное."
          );

          // Get camera stream
          currentStreamCamera = await getUserMediaWithAudioFallback(
            {
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
            },
            {
              channels: 2,
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              sampleRate: 48000,
              sampleSize: 16,
            }
          );
          attachOnEnded(
            currentStreamCamera,
            "Камера была отключена. Вы можете сохранить уже записанное."
          );

          // Setup video elements
          if (videoScreen) {
            videoScreen.srcObject = currentStreamScreen;
            videoScreen.muted = true;
            videoScreen.play();
            videoScreen.style.borderColor = "green";
          }
          if (videoCamera) {
            videoCamera.srcObject = currentStreamCamera;
            videoCamera.muted = true;
            videoCamera.play();
            videoCamera.style.borderColor = "green";
          }
          try { setupAudioMeterFromBestAvailableStream(); } catch (_) {}

          buttonCamera.textContent = "Остановить захват";
          isDualRecording = true;
          try {
            updateButtonStates();
          } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
        } catch (error) {
          window.showAlertModal("Невозможно получить доступ к экрану или камере!", "Ошибка");
          return;
        }
      } else if (isScreenMode) {
        // Screen recording only
        try {
          currentStreamScreen = await getDisplayMediaWithAudioFallback(
            {
              width: { ideal: 1920, max: 1920 },
              height: { ideal: 1080, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
            },
            {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              sampleRate: 48000,
            }
          );
          attachOnEnded(
            currentStreamScreen,
            "Захват экрана был остановлен. Вы можете сохранить уже записанное."
          );

          if (videoScreen) {
            videoScreen.srcObject = currentStreamScreen;
            videoScreen.muted = true;
            videoScreen.play();
            videoScreen.style.borderColor = "green";
          }
          // Prefer screen audio if present; else none
          try { setupAudioMeterFromBestAvailableStream(); } catch (_) {}

          buttonCamera.textContent = "Остановить захват";
          isScreenRecording = true;
          try {
            updateButtonStates();
          } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
        } catch (error) {
          window.showAlertModal("Невозможно получить доступ к экрану!", "Ошибка");
          return;
        }
      } else if (isScreenMicMode) {
        // Screen + microphone: one video file, audio mixed (screen audio + mic)
        try {
          currentStreamScreen = await getDisplayMediaWithAudioFallback(
            {
              width: { ideal: 1920, max: 1920 },
              height: { ideal: 1080, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
            },
            {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              sampleRate: 48000,
            }
          );
          attachOnEnded(
            currentStreamScreen,
            "Захват экрана был остановлен. Вы можете сохранить уже записанное."
          );

          currentStreamAudio = await navigator.mediaDevices.getUserMedia({
            audio: {
              channels: 2,
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              sampleRate: 48000,
              sampleSize: 16,
            },
          });
          attachOnEnded(
            currentStreamAudio,
            "Микрофон был отключён. Вы можете сохранить уже записанное."
          );

          if (videoScreen) {
            videoScreen.srcObject = currentStreamScreen;
            videoScreen.muted = true;
            videoScreen.play();
            videoScreen.style.borderColor = "green";
          }
          if (audioIndicator) {
            audioIndicator.style.borderColor = "green";
          }
          try { setupAudioMeterFromBestAvailableStream(); } catch (_) {}

          buttonCamera.textContent = "Остановить захват";
          isScreenMicRecording = true;
          try { updateButtonStates(); } catch (_) {}
        } catch (error) {
          window.showAlertModal("Невозможно получить доступ к экрану или микрофону!", "Ошибка");
          return;
        }
      } else if (isAudioMode) {
        // Audio-only recording
        try {
          currentStreamAudio = await navigator.mediaDevices.getUserMedia({
            audio: {
              channels: 2,
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              sampleRate: 48000,
              sampleSize: 16,
            },
          });
          attachOnEnded(
            currentStreamAudio,
            "Микрофон был отключён. Вы можете сохранить уже записанное."
          );
          if (audioIndicator) {
            audioIndicator.style.borderColor = "green";
          }
          try { setupAudioMeterFromBestAvailableStream(); } catch (_) {}
          buttonCamera.textContent = "Выключить микрофон";
          isAudioOnly = true;
          try {
            updateButtonStates();
          } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
        } catch (error) {
          window.showAlertModal(
            "Невозможно получить доступ к микрофону!",
            "Ошибка"
          );
          return;
        }
      } else {
        // Camera recording only
        try {
          currentStreamCamera = await getUserMediaWithAudioFallback(
            {
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
            },
            {
              channels: 2,
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              sampleRate: 48000,
              sampleSize: 16,
            }
          );
          attachOnEnded(
            currentStreamCamera,
            "Камера была отключена. Вы можете сохранить уже записанное."
          );

          if (videoCamera) {
            videoCamera.srcObject = currentStreamCamera;
            videoCamera.muted = true;
            videoCamera.play();
            videoCamera.style.borderColor = "green";
          }
          try { setupAudioMeterFromBestAvailableStream(); } catch (_) {}

          buttonCamera.textContent = "Выключить камеру";
          isScreenRecording = false;
          try {
            updateButtonStates();
          } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
        } catch (error) {
          window.showAlertModal("Невозможно получить доступ к камере!", "Ошибка");
          return;
        }
      }
    }

    // Setup MediaRecorder(s)
    if (!("MediaRecorder" in window)) {
      window.showAlertModal(
        "MediaRecorder не поддерживается в этом браузере",
        "Ошибка"
      );
      return;
    }

    // Prefer audio-capable MIME types when audio tracks present; fallback robustly
    const hasScreenAudio =
      currentStreamScreen && currentStreamScreen.getAudioTracks().length > 0;
    const hasCameraAudio =
      currentStreamCamera && currentStreamCamera.getAudioTracks().length > 0;
    const hasMicAudio =
      currentStreamAudio && currentStreamAudio.getAudioTracks && currentStreamAudio.getAudioTracks().length > 0;
    const needsAudio = !!(hasScreenAudio || hasCameraAudio || hasMicAudio);
    let candidates = [];
    if (needsAudio) {
      candidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ];
    } else {
      candidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ];
    }
    let mime =
      candidates.find(function (m) {
        try {
          return MediaRecorder.isTypeSupported(m);
        } catch (_) {
          return false;
        }
      }) || "video/webm";

    // Clear previous recorders
    recorderScreen = null;
    recorderCamera = null;
    recorderAudio = null;

    // Track if any audio track is present to drive UI/meter
    try {
      const a1 = currentStreamScreen && currentStreamScreen.getAudioTracks && currentStreamScreen.getAudioTracks().length > 0;
      const a2 = currentStreamCamera && currentStreamCamera.getAudioTracks && currentStreamCamera.getAudioTracks().length > 0;
      const a3 = currentStreamAudio && currentStreamAudio.getAudioTracks && currentStreamAudio.getAudioTracks().length > 0;
      hasAnyAudioTrack = !!(a1 || a2 || a3);
    } catch(_) { hasAnyAudioTrack = false; }

    if (isScreenMicRecording) {
      // Mix audio: screen audio (if present) + mic into one track, record as a single screen video file
      currentStreamScreenMicMixed = null;
      try {
        if (screenMicMix && screenMicMix.ctx && screenMicMix.ctx.state !== 'closed') {
          screenMicMix.ctx.close().catch(function(){});
        }
      } catch (_) {}
      screenMicMix = { ctx: null, dest: null, srcScreen: null, srcMic: null };
      try {
        const mixCtx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = mixCtx.createMediaStreamDestination();
        screenMicMix.ctx = mixCtx;
        screenMicMix.dest = dest;
        try {
          if (currentStreamScreen && currentStreamScreen.getAudioTracks && currentStreamScreen.getAudioTracks().length > 0) {
            screenMicMix.srcScreen = mixCtx.createMediaStreamSource(currentStreamScreen);
            screenMicMix.srcScreen.connect(dest);
          }
        } catch (_) {}
        try {
          if (currentStreamAudio && currentStreamAudio.getAudioTracks && currentStreamAudio.getAudioTracks().length > 0) {
            screenMicMix.srcMic = mixCtx.createMediaStreamSource(currentStreamAudio);
            screenMicMix.srcMic.connect(dest);
          }
        } catch (_) {}
        try { if (mixCtx.state === 'suspended') mixCtx.resume().catch(function(){}); } catch(_) {}

        currentStreamScreenMicMixed = new MediaStream();
        try {
          (currentStreamScreen && currentStreamScreen.getVideoTracks ? currentStreamScreen.getVideoTracks() : []).forEach(function (t) {
            try { currentStreamScreenMicMixed.addTrack(t); } catch(_) {}
          });
        } catch(_) {}
        try {
          (dest.stream && dest.stream.getAudioTracks ? dest.stream.getAudioTracks() : []).forEach(function (t) {
            try { currentStreamScreenMicMixed.addTrack(t); } catch(_) {}
          });
        } catch(_) {}
      } catch (_) {
        currentStreamScreenMicMixed = null;
      }

      const recordStream = currentStreamScreenMicMixed || currentStreamScreen;
      if (recordStream) {
        try {
          recorderScreen = new MediaRecorder(recordStream, {
            mimeType: mime,
            videoBitsPerSecond: 8000000,
            audioBitsPerSecond: 192000,
          });
        } catch (_) {
          try { recorderScreen = new MediaRecorder(recordStream, { mimeType: mime }); } catch (_) {}
        }
      }
    } else if (isDualRecording) {
      // Setup screen recorder
      if (currentStreamScreen) {
        try {
          currentStreamScreen.getVideoTracks().forEach((t) => {
            try {
              t.contentHint = "motion";
            } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
          });
        } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
        try {
          recorderScreen = new MediaRecorder(currentStreamScreen, {
            mimeType: mime,
            videoBitsPerSecond: 8000000,
            audioBitsPerSecond: 192000,
          });
        } catch (error) {
          window.ErrorHandler && window.ErrorHandler.handleError("Failed to create screen MediaRecorder:", error, "app");
          window.showAlertModal(
            "Ошибка: браузер не поддерживает запись экрана. Попробуйте другой браузер.",
            "Ошибка"
          );
          return;
        }
      }

      // Setup camera recorder
      if (currentStreamCamera) {
        try {
          currentStreamCamera.getVideoTracks().forEach((t) => {
            try {
              t.contentHint = "motion";
            } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
          });
        } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
        try {
          recorderCamera = new MediaRecorder(currentStreamCamera, {
            mimeType: mime,
            videoBitsPerSecond: 5000000,
            audioBitsPerSecond: 192000,
          });
        } catch (error) {
          window.ErrorHandler && window.ErrorHandler.handleError("Failed to create camera MediaRecorder:", error, "app");
          window.showAlertModal(
            "Ошибка: браузер не поддерживает запись с камеры. Попробуйте другой браузер.",
            "Ошибка"
          );
          return;
        }
      }
    } else if (isScreenRecording) {
      // Setup screen recorder only
      if (currentStreamScreen) {
        try {
          currentStreamScreen.getVideoTracks().forEach((t) => {
            try {
              t.contentHint = "motion";
            } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
          });
        } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
        try {
          recorderScreen = new MediaRecorder(currentStreamScreen, {
            mimeType: mime,
            videoBitsPerSecond: 8000000,
            audioBitsPerSecond: 192000,
          });
        } catch (error) {
          window.ErrorHandler && window.ErrorHandler.handleError("Failed to create screen MediaRecorder:", error, "app");
          window.showAlertModal(
            "Ошибка: браузер не поддерживает запись экрана. Попробуйте другой браузер.",
            "Ошибка"
          );
          return;
        }
      }
    } else if (isAudioOnly) {
      // Setup audio recorder only
      if (currentStreamAudio) {
        // Check for supported audio MIME types
        let audioMimeType = "audio/webm;codecs=opus";
        if (!MediaRecorder.isTypeSupported(audioMimeType)) {
          audioMimeType = "audio/webm";
          if (!MediaRecorder.isTypeSupported(audioMimeType)) {
            audioMimeType = "audio/mp4";
            if (!MediaRecorder.isTypeSupported(audioMimeType)) {
              audioMimeType = "audio/wav";
              if (!MediaRecorder.isTypeSupported(audioMimeType)) {
                audioMimeType = ""; // Let browser choose
              }
            }
          }
        }

        const audioOptions = { audioBitsPerSecond: 192000 };
        if (audioMimeType) {
          audioOptions.mimeType = audioMimeType;
        }

        try {
          recorderAudio = new MediaRecorder(currentStreamAudio, audioOptions);
        } catch (error) {
          window.ErrorHandler && window.ErrorHandler.handleError("Failed to create audio MediaRecorder:", error, "app");
          window.showAlertModal(
            "Ошибка: браузер не поддерживает аудио-запись. Попробуйте другой браузер.",
            "Ошибка"
          );
          return;
        }
      }
    } else {
      // Setup camera recorder only
      if (currentStreamCamera) {
        try {
          currentStreamCamera.getVideoTracks().forEach((t) => {
            try {
              t.contentHint = "motion";
            } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
          });
        } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
        try {
          recorderCamera = new MediaRecorder(currentStreamCamera, {
            mimeType: mime,
            videoBitsPerSecond: 5000000,
            audioBitsPerSecond: 192000,
          });
        } catch (error) {
          window.ErrorHandler && window.ErrorHandler.handleError("Failed to create camera MediaRecorder:", error, "app");
          window.showAlertModal(
            "Ошибка: браузер не поддерживает запись с камеры. Попробуйте другой браузер.",
            "Ошибка"
          );
          return;
        }
      }
    }

    // Setup event listeners for recorders (streaming: upload chunks to avoid OOM)
    streamPendingChunk.screen = null;
    streamPendingChunk.camera = null;
    streamPendingChunk.audio = null;
    if (recorderScreen) {
      recorderScreen.addEventListener("dataavailable", function (e) {
        if (streamUploadState.screen.uploadId && e.data && e.data.size > 0) {
          var p = streamUploadChunk("screen", e.data, false);
          streamPendingChunk.screen = (streamPendingChunk.screen || Promise.resolve()).then(function () { return p; });
        } else if (!streamUploadState.screen.uploadId) {
          recordedScreen.push(e.data);
        }
        if (recordedScreen.length > 0 || streamUploadState.screen.uploadId) {
          recState.hasData = true;
          postState();
        }
      });
      recorderScreen.addEventListener("stop", function () {
        if (streamUploadState.screen.uploadId) {
          var doFinalize = function () { return streamUploadChunk("screen", null, true); };
          (streamPendingChunk.screen || Promise.resolve()).then(doFinalize, doFinalize);
        }
      });
    }

    if (recorderCamera) {
      recorderCamera.addEventListener("dataavailable", function (e) {
        if (streamUploadState.camera.uploadId && e.data && e.data.size > 0) {
          var p = streamUploadChunk("camera", e.data, false);
          streamPendingChunk.camera = (streamPendingChunk.camera || Promise.resolve()).then(function () { return p; });
        } else if (!streamUploadState.camera.uploadId) {
          recordedCamera.push(e.data);
        }
        if (recordedCamera.length > 0 || streamUploadState.camera.uploadId) {
          recState.hasData = true;
          postState();
        }
      });
      recorderCamera.addEventListener("stop", function () {
        if (streamUploadState.camera.uploadId) {
          var doFinalize = function () { return streamUploadChunk("camera", null, true); };
          (streamPendingChunk.camera || Promise.resolve()).then(doFinalize, doFinalize);
        }
      });
    }
    if (recorderAudio) {
      recorderAudio.addEventListener("dataavailable", function (e) {
        if (streamUploadState.audio.uploadId && e.data && e.data.size > 0) {
          var p = streamUploadChunk("audio", e.data, false);
          streamPendingChunk.audio = (streamPendingChunk.audio || Promise.resolve()).then(function () { return p; });
        } else if (!streamUploadState.audio.uploadId) {
          recordedAudio.push(e.data);
        }
        if (recordedAudio.length > 0 || streamUploadState.audio.uploadId) {
          recState.hasData = true;
          postState();
        }
      });
      recorderAudio.addEventListener("stop", function () {
        if (streamUploadState.audio.uploadId) {
          var doFinalize = function () { return streamUploadChunk("audio", null, true); };
          (streamPendingChunk.audio || Promise.resolve()).then(doFinalize, doFinalize);
        }
      });
    }

    // Update video visibility after setting up streams
    updateVideoVisibility();

    timerInterval = setInterval(timer, 1000);
    recordedScreen = [];
    recordedCamera = [];
    streamUploadActiveTypes = [];
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      if (recorderScreen) {
        streamUploadState.screen.uploadId = crypto.randomUUID();
        streamUploadState.screen.chunkIndex = 0;
        streamUploadState.screen.finalized = false;
        streamUploadActiveTypes.push("screen");
      }
      if (recorderCamera) {
        streamUploadState.camera.uploadId = crypto.randomUUID();
        streamUploadState.camera.chunkIndex = 0;
        streamUploadState.camera.finalized = false;
        streamUploadActiveTypes.push("camera");
      }
      if (recorderAudio) {
        streamUploadState.audio.uploadId = crypto.randomUUID();
        streamUploadState.audio.chunkIndex = 0;
        streamUploadState.audio.finalized = false;
        streamUploadActiveTypes.push("audio");
      }
    }
    enable(buttonStart);
    disable(buttonPause);
    disable(buttonStop);
    recState = { recording: false, paused: false, hasData: false };
    postState();
    // Re-enable source controls when idle and no active streams
    try {
      if (!areAnyStreamsActive()) setSourceControlsEnabled(true);
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "onCameraClick");
    }
  } catch (error) {
    window.showAlertModal("Ошибка при настройке записи!", "Ошибка");
  }
}

/**
 * Start or resume recording and update UI accordingly.
 */
function onStartClick() {
  if (buttonStart.textContent == "Начать запись") {
    // Start recording (with timeslice to stream chunks and avoid OOM)
    try {
      if (recorderScreen) recorderScreen.start(RECORD_STREAM_TIMESLICE_MS);
    } catch (e) {
      handleCaptureRevoked(
        "Невозможно начать запись: источник экрана недоступен."
      );
      return;
    }
    try {
      if (recorderCamera) recorderCamera.start(RECORD_STREAM_TIMESLICE_MS);
    } catch (e) {
      handleCaptureRevoked("Невозможно начать запись: камера недоступна.");
      return;
    }
    try {
      if (recorderAudio) recorderAudio.start(RECORD_STREAM_TIMESLICE_MS);
    } catch (e) {
      handleCaptureRevoked("Невозможно начать запись: микрофон недоступен.");
      return;
    }
    try {
      setSourceControlsEnabled(false);
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "onStartClick");
    }
    buttonStart.textContent = "Продолжить";
    try {
      if (!timerInterval) {
        timerInterval = setInterval(timer, 1000);
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "onStartClick");
    }
  } else {
    // Resume recording
    if (recorderScreen) recorderScreen.resume();
    if (recorderCamera) recorderCamera.resume();
    if (recorderAudio)
      try {
        recorderAudio.resume && recorderAudio.resume();
      } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "onStartClick");
    }
    try {
      if (!timerInterval) {
        timerInterval = setInterval(timer, 1000);
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "onStartClick");
    }
  }

  if (videoScreen) videoScreen.style.borderColor = "red";
  if (videoCamera) videoCamera.style.borderColor = "red";
  if (audioIndicator) audioIndicator.style.borderColor = "red";

  // progress UI removed
  disable(buttonCamera);
  disable(buttonStart);
  enable(buttonPause);
  enable(buttonStop);
  recState.recording = true;
  recState.paused = false;
  postState();
  logRecordAction("RECORD_START", "start recording name=" + getRecordFileName(), "SUCCESS");
}

/**
 * Pause recording and update UI.
 */
function onPauseClick() {
  if (recorderScreen) recorderScreen.pause();
  if (recorderCamera) recorderCamera.pause();
  if (recorderAudio)
    try {
      recorderAudio.pause && recorderAudio.pause();
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  if (videoScreen) videoScreen.style.borderColor = "green";
  if (videoCamera) videoCamera.style.borderColor = "green";
  if (audioIndicator) audioIndicator.style.borderColor = "green";
  enable(buttonStart);
  disable(buttonPause);
  recState.recording = false;
  recState.paused = true;
  postState();
  try {
    setSourceControlsEnabled(false);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

/**
 * Stop recording, set stopped UI, and publish state.
 * When streaming, waits for all chunk finalizes then closes modal on success.
 */
function onStopClick() {
  logRecordAction("RECORD_STOP", "stop recording name=" + getRecordFileName(), "SUCCESS");
  var hadStreaming = streamUploadActiveTypes.length > 0;
  var finalizePromise = null;
  if (hadStreaming) {
    finalizePromise = new Promise(function (resolve, reject) {
      streamUploadAllFinalizedSettle = { resolve: resolve, reject: reject };
    });
  }

  if (recorderScreen) {
    recorderScreen.pause();
    recorderScreen.stop();
  }
  if (recorderCamera) {
    recorderCamera.pause();
    recorderCamera.stop();
  }
  if (recorderAudio) {
    try {
      recorderAudio.stop();
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  }

  // Update state immediately
  recState.recording = false;
  recState.paused = false;
  recState.hasData =
    recordedScreen.length > 0 ||
    recordedCamera.length > 0 ||
    recordedAudio.length > 0;
  try {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }

  // Update UI with current data state
  setStoppedUI();
  postState();

  if (hadStreaming && finalizePromise) {
    showSavingOverlay();
    finalizePromise.then(function () {
      hideSavingOverlay();
      try {
        loadHandler({ target: { status: 200 } });
      } catch (err) {
        window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
      }
    }).catch(function (err) {
      hideSavingOverlay();
      try {
        window.showAlertModal("Ошибка сохранения: " + (err && err.message ? err.message : err), "Ошибка");
      } catch (_) {}
    });
  }
}

/**
 * Update recording timer once per second while recorder is active.
 */
function timer() {
  const isRecording =
    (recorderScreen && recorderScreen.state === "recording") ||
    (recorderCamera && recorderCamera.state === "recording") ||
    (recorderAudio && recorderAudio.state === "recording");
  if (isRecording) {
    s += 1;
    if (s == 60) {
      s = 0;
      m += 1;
    }
    if (m == 60) {
      m = 0;
      h += 1;
    }
    const hours = String(h).padStart(2, "0");
    const minutes = String(m).padStart(2, "0");
    const seconds = String(s).padStart(2, "0");
    const answer = `${hours}:${minutes}:${seconds}`;
    document.getElementById("time").innerHTML = answer;
  }
}

/**
 * Generate default file name: Rec_DD.MM.YYYY_HH.MM.SS
 * @returns {string}
 */
function name() {
  const currentdate = new Date();
  const date = String(currentdate.getDate()).padStart(2, "0");
  const month = String(currentdate.getMonth() + 1).padStart(2, "0");
  const year = currentdate.getFullYear();
  const hours = String(currentdate.getHours()).padStart(2, "0");
  const minutes = String(currentdate.getMinutes()).padStart(2, "0");
  const seconds = String(currentdate.getSeconds()).padStart(2, "0");
  const answer = `Rec_${date}.${month}.${year}_${hours}.${minutes}.${seconds}`;
  return answer;
}

/**
 * Upload one chunk or finalize for streaming record. Retries on failure.
 * @param {string} streamType - 'screen' | 'camera' | 'audio'
 * @param {Blob|null} blob - chunk data, or null for finalize-only
 * @param {boolean} isFinal
 * @returns {Promise<void>}
 */
function streamUploadChunk(streamType, blob, isFinal) {
  const state = streamUploadState[streamType];
  if (!state || (!state.uploadId && !isFinal)) return Promise.resolve();

  const uploadId = state.uploadId;
  const chunkIndex = state.chunkIndex;
  const baseUrl = window.location.origin;
  const params = new URLSearchParams(window.location.search || "");
  const catId = params.get("cat_id") || "";
  const subId = params.get("sub_id") || "";
  const recName =
    (fileName && fileName.value ? fileName.value : name()) +
    (streamType === "screen"
      ? (isScreenMicRecording ? "_screenmic" : "_screen")
      : streamType === "camera"
        ? "_cam"
        : "_audio");
  const desc = (fileText && fileText.value ? fileText.value : "");

  function doSend() {
    const form = new FormData();
    form.append("upload_id", uploadId);
    form.append("chunk_index", String(chunkIndex));
    form.append("is_final", isFinal ? "1" : "0");
    form.append("name", recName);
    form.append("desc", desc);
    form.append("cat_id", catId);
    form.append("sub_id", subId);
    if (state.tempName) form.append("temp_name", state.tempName);
    if (blob && blob.size > 0) form.append("file", blob, "chunk.webm");

    var headers = { "X-Requested-With": "XMLHttpRequest" };
    try {
      var cid = (window.parent && window.parent.__filesClientId) || window.__filesClientId || "";
      if (cid) headers["X-Client-Id"] = cid;
    } catch (_) {}
    return fetch(baseUrl + "/files/rec/chunk", {
      method: "POST",
      credentials: "include",
      body: form,
      headers: headers,
    }).then(function (r) {
      if (r.ok) return r.json();
      var err = new Error("HTTP " + r.status);
      err.status = r.status;
      throw err;
    });
  }

  function attempt(attemptIndex) {
    return doSend().catch(function (err) {
      if (err && err.status === 400) return Promise.reject(err);
      if (attemptIndex >= RECORD_STREAM_MAX_RETRIES) throw err;
      var delay = RECORD_STREAM_RETRY_BASE_MS * Math.pow(2, attemptIndex);
      return new Promise(function (res) {
        setTimeout(res, delay);
      }).then(function () {
        return attempt(attemptIndex + 1);
      });
    });
  }

  return attempt(0).then(function (data) {
    if (data && data.temp_name) state.tempName = data.temp_name;
    if (!isFinal) {
      state.chunkIndex = chunkIndex + 1;
    } else {
      state.finalized = true;
      var allDone = streamUploadActiveTypes.every(function (t) {
        return streamUploadState[t] && streamUploadState[t].finalized;
      });
      if (allDone && streamUploadAllFinalizedSettle) {
        if (streamUploadAllFinalizedSettle.resolve) streamUploadAllFinalizedSettle.resolve();
        streamUploadAllFinalizedSettle = null;
      }
    }
  }).catch(function (err) {
    if (isFinal) {
      state.finalized = true;
      var allDone = streamUploadActiveTypes.every(function (t) {
        return streamUploadState[t] && streamUploadState[t].finalized;
      });
      if (allDone && streamUploadAllFinalizedSettle) {
        if (streamUploadAllFinalizedSettle.reject) streamUploadAllFinalizedSettle.reject(err);
        streamUploadAllFinalizedSettle = null;
      }
    }
    throw err;
  });
}

/**
 * XHR load handler: close modal and inform parent on success.
 * @param {ProgressEvent} event
 */
function loadHandler(event) {
  const ok = event.target.status >= 200 && event.target.status < 400;
  // progress UI removed

  // Notify parent and auto-close on success
  if (ok && window.parent) {
    // Ensure modal has correct z-index before closing
    try {
      const parentOverlay =
        window.parent.document.querySelector(".overlay-container");
      const parentPopup = window.parent.document.querySelector(".popup");
      if (parentOverlay) {
        parentOverlay.style.zIndex = "1050";
        parentOverlay.style.pointerEvents = "auto";
      }
      if (parentPopup) {
        parentPopup.style.zIndex = "1050";
        parentPopup.style.pointerEvents = "auto";
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }

    // Reset UI after successful upload
    resetAfterSave();
    try {
      window.parent.softRefreshFilesTable &&
        window.parent.softRefreshFilesTable();
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }

    // Close modal directly like in scripts.js and restore page scroll
    try {
      const overlay = window.parent.document.getElementById("popup-rec");
      if (overlay) {
        overlay.classList.remove("show");
        overlay.classList.remove("visible");
        overlay.style.display = "none";
      }
      // Reset popup variable in parent
      if (window.parent.popup === "popup-rec") {
        window.parent.popup = null;
      }
      // Ensure body scroll is restored in parent after closing overlay
      try {
        window.parent.document.body.style.overflow = "";
      } catch (e) {
        // noop
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }

    try {
      window.parent.postMessage({ type: "rec:saved" }, "*");
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
    try {
      if (
        window.parent &&
        window.parent.window &&
        window.parent.window.showToast
      ) {
        window.parent.window.showToast("Видео успешно сохранено", "success");
      } else if (
        window.parent &&
        window.parent.window &&
        window.parent.window.showAlertModal
      ) {
        window.parent.window.showAlertModal("Видео успешно сохранено", "Успех");
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }

    // Simple restoration like other modals
    setTimeout(() => {
      if (window.parent && window.parent !== window) {
        try {
          // Restore critical elements only
          const parentHtml = window.parent.document.documentElement;
          const parentBody = window.parent.document.body;
          if (parentHtml) {
            parentHtml.style.pointerEvents = "auto";
            parentHtml.style.zIndex = "auto";
          }
          if (parentBody) {
            parentBody.style.pointerEvents = "auto";
            parentBody.style.zIndex = "auto";
          }
        } catch (e) {
          // Silent fail
        }
      }

      // Also restore elements inside iframe
      try {
        const allElements = document.querySelectorAll("*");
        allElements.forEach((element) => {
          try {
            element.style.pointerEvents = "auto";
            element.style.zIndex = "auto";
          } catch (e) {
            // Skip elements that can't be modified
          }
        });
      } catch (e) {
        // Silent fail
      }
    }, 100); // Short delay
  }
}

// Handle parent messages (query state, save, discard)
/**
 * Handle parent messages: state query, save, discard.
 * @param {MessageEvent} ev
 */
window.addEventListener("message", function (ev) {
  const msg = ev.data || {};
  if (msg.type === "rec:state?") {
    postState();
    try {
      // Inform parent of current recording state for guards
      if (window.parent && window.parent !== window) {
        window.parent.__recIsRecording = !!(recState && recState.recording);
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  } else if (msg.type === "rec:discard") {
    try {
      var baseUrl = window.location.origin;
      var discardPromises = [];
      ["screen", "camera", "audio"].forEach(function (streamType) {
        var state = streamUploadState[streamType];
        if (state && state.tempName) {
          var form = new FormData();
          form.append("temp_name", state.tempName);
          form.append("name", getRecordFileName());
          discardPromises.push(
            fetch(baseUrl + "/files/rec/discard", {
              method: "POST",
              credentials: "include",
              body: form,
              headers: { "X-Requested-With": "XMLHttpRequest" },
            })
          );
        }
      });
      Promise.all(discardPromises).catch(function () {});

      stopCameraStream();
      recordedScreen = [];
      recordedCamera = [];
      recordedAudio = [];
      disable(buttonPause);
      disable(buttonStop);
      enable(buttonCamera);
      enable(buttonStart);
      if (videoScreen) videoScreen.style.borderColor = "gray";
      if (videoCamera) videoCamera.style.borderColor = "gray";
      if (audioIndicator) {
        audioIndicator.style.borderColor = "#000000";
        audioIndicator.textContent = "";
      }
      resetTimer(true);
      recState = { recording: false, paused: false, hasData: false };
      streamUploadActiveTypes = [];
      streamUploadState.screen.tempName = null;
      streamUploadState.camera.tempName = null;
      streamUploadState.audio.tempName = null;

      updateVideoVisibility();
      postState();
      if (window.parent) {
        window.parent.postMessage({ type: "rec:discarded" }, "*");
      }
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  } else if (msg.type === "rec:close") {
    try {
      // Stop all streams immediately so devices are released (microphone/camera)
      stopCameraStream();
      stopRecorder().then(function () {
        try { resetAfterSave(); } catch (_) {}
        try {
          recState = { recording: false, paused: false, hasData: !!(recordedScreen.length || recordedCamera.length || recordedAudio.length) };
          postState();
        } catch (_) {}
      }).catch(function () {});
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  } else if (msg.type === "rec:reset") {
    try {
      stopCameraStream();
      stopRecorder().then(function () {
        try { resetAfterSave(); } catch (_) {}
        try {
          recState = { recording: false, paused: false, hasData: false };
          postState();
        } catch (_) {}
        try {
          if (buttonStart) buttonStart.textContent = "Начать запись";
          disable(buttonPause);
          disable(buttonStop);
          enable(buttonCamera);
          enable(buttonStart);
          if (videoScreen) videoScreen.style.borderColor = "gray";
          if (videoCamera) videoCamera.style.borderColor = "gray";
          if (audioIndicator) {
            audioIndicator.style.borderColor = "#000000";
            audioIndicator.textContent = "";
          }
          resetTimer(true);
          updateVideoVisibility();
        } catch (_) {}
      }).catch(function () {});
    } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  }
});

document.addEventListener("visibilitychange", function () {
  try {
    if (document.hidden) stopCameraStream();
  } catch (_) {}
});
window.addEventListener("pagehide", function () {
  try { stopCameraStream(); } catch (_) {}
});

/**
 * Reset timer and optionally the visible display.
 * @param {boolean} resetDisplayOnly
 */
function resetTimer(resetDisplayOnly) {
  try {
    clearInterval(timerInterval);
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
  timerInterval = null;
  h = 0;
  m = 0;
  s = 0;
  try {
    document.getElementById("time").innerHTML = "00:00:00";
  } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
}

/**
 * Ensure MediaRecorder is stopped and resolve when stop completes.
 * @returns {Promise<void>}
 */
function stopRecorder() {
  return new Promise((resolve) => {
    try {
      let activeRecorders = [];
      if (recorderScreen && recorderScreen.state !== "inactive")
        activeRecorders.push(recorderScreen);
      if (recorderCamera && recorderCamera.state !== "inactive")
        activeRecorders.push(recorderCamera);
      if (recorderAudio && recorderAudio.state !== "inactive")
        activeRecorders.push(recorderAudio);

      if (activeRecorders.length === 0) {
        resolve();
        return;
      }

      let completed = 0;
      const handleStop = () => {
        completed++;
        if (completed >= activeRecorders.length) {
          try {
            setStoppedUI();
          } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
          setTimeout(resolve, 0);
        }
      };

      activeRecorders.forEach((recorder) => {
        try {
          recorder.addEventListener("stop", handleStop);
          if (recorder.pause)
            try {
              recorder.pause();
            } catch (err) {
      window.ErrorHandler && window.ErrorHandler.handleError(err, "unknown");
    }
          recorder.stop();
        } catch (e) {
          handleStop();
        }
      });
    } catch (e) {
      resolve();
    }
  });
}
