(function syncThemeFromParent(){
  try {
    function applyTheme(theme){
      try {
        if (!theme) return;
        document.documentElement.setAttribute('data-theme', theme);
        document.body && document.body.setAttribute('data-theme', theme);
        // normalize class theme-*
        try {
          const root = document.documentElement;
          const classes = (root.className || '').split(/\s+/).filter(Boolean);
          const filtered = classes.filter(c => !/^theme-/.test(c));
          filtered.push('theme-' + theme);
          root.className = filtered.join(' ');
        } catch(_) {}
        // also normalize on body to avoid stale theme-light
        try {
          if (document.body) {
            const bClasses = (document.body.className || '').split(/\s+/).filter(Boolean);
            const bFiltered = bClasses.filter(c => !/^theme-/.test(c));
            bFiltered.push('theme-' + theme);
            document.body.className = bFiltered.join(' ');
          }
        } catch(_) {}
        try { localStorage.setItem('theme', theme); } catch(_) {}
        // ensure background uses current CSS variables
        try {
          document.documentElement.style.backgroundColor = 'var(--modal-bg, var(--body-bg))';
          document.body.style.backgroundColor = 'var(--modal-bg, var(--body-bg))';
          document.body.style.color = 'var(--body-text)';
        } catch(_) {}
      } catch(_) {}
    }
    // Initial from URL
    try {
      const params = new URLSearchParams(location.search);
      const t = params.get('theme');
      if (t) applyTheme(t);
    } catch(_) {}
    // Listen to parent messages
    window.addEventListener('message', function(ev){
      try {
        const data = ev && ev.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'theme') applyTheme(data.value);
      } catch(_) {}
    });
  } catch(_) {}
})();
/**
 * Hide and disable a control if present.
 * @param {HTMLElement|HTMLButtonElement|null} x - Element to disable
 */
function disable(x) { if (!x) return; x.disabled = true; x.style.display = 'none'; }

/**
 * Show and enable a control if present.
 * @param {HTMLElement|HTMLButtonElement|null} x - Element to enable
 */
function enable(x) { if (!x) return; x.disabled = false; x.style.display = 'inline-block'; }

window.onbeforeunload = null;

const BYTES_IN_MB = 1048576;

// UI elements populated on DOMContentLoaded
/** @type {HTMLButtonElement|null} */ let buttonCamera;
/** @type {HTMLButtonElement|null} */ let buttonStart;
/** @type {HTMLButtonElement|null} */ let buttonPause;
/** @type {HTMLButtonElement|null} */ let buttonStop;
/** @type {HTMLButtonElement|null} */ let buttonSave;
/** @type {HTMLVideoElement|null} */ let videoScreen;
/** @type {HTMLVideoElement|null} */ let videoCamera;
/** @type {HTMLInputElement|null} */ let fileName;
/** @type {HTMLElement|null} */ let dirName;
/** @type {HTMLTextAreaElement|null} */ let fileText;
/** @type {HTMLElement|null} */ let sizeText;
/** @type {HTMLElement|null} */ let statusText;
/** @type {HTMLElement|null} */ let progressBar;
/** @type {HTMLElement|null} */ let uploadProgress;
/** @type {HTMLElement|null} */ let uploadProgressBar;
/** @type {HTMLInputElement|null} */ let sourceCamera;
/** @type {HTMLInputElement|null} */ let sourceScreen;
/** @type {HTMLInputElement|null} */ let sourceBoth;
/** @type {HTMLInputElement|null} */ let sourceAudio;
/** @type {HTMLElement|null} */ let audioIndicatorWrap;
/** @type {HTMLElement|null} */ let audioIndicator;

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
/** @type {boolean} */ let isScreenRecording = false;
/** @type {boolean} */ let isDualRecording = false;
/** @type {boolean} */ let isAudioOnly = false;

/**
 * Determine if any capture streams are currently active (live tracks).
 * @returns {boolean}
 */
function areAnyStreamsActive() {
  try {
    const hasLive = (stream) => !!(stream && stream.getTracks && stream.getTracks().some(t => t.readyState === 'live'));
    return hasLive(currentStreamScreen) || hasLive(currentStreamCamera) || hasLive(currentStreamAudio);
  } catch(_) { return false; }
}

/**
 * Enable/disable source selection radio controls.
 * @param {boolean} enabled
 */
function setSourceControlsEnabled(enabled) {
  try { if (sourceCamera) sourceCamera.disabled = !enabled; } catch(_) {}
  try { if (sourceScreen) sourceScreen.disabled = !enabled; } catch(_) {}
  try { if (sourceBoth) sourceBoth.disabled = !enabled; } catch(_) {}
  try { if (sourceAudio) sourceAudio.disabled = !enabled; } catch(_) {}
}

/**
 * Attach onended listeners to all tracks of given stream with a reason message.
 * @param {MediaStream|null} stream
 * @param {string} reason
 */
function attachOnEnded(stream, reason) {
  try {
    if (!stream || !stream.getTracks) return;
    const notify = function() { handleCaptureRevoked(reason); };
    stream.getTracks().forEach(function(t){ try { t.onended = notify; } catch(_) {} });
  } catch(_) {}
}

/**
 * Handle revoked capture or inactive stream. Stops recording, allows save, disables source controls, notifies.
 * @param {string} message
 */
function handleCaptureRevoked(message) {
  try {
    if (window.__recNotifiedRevoked) return;
    window.__recNotifiedRevoked = true;
  } catch(_) {}
  try {
    // If recording, transition to stopped UI and allow saving available data
    try { if (recorderScreen && recorderScreen.state === 'recording') recorderScreen.pause(); } catch(_) {}
    try { if (recorderCamera && recorderCamera.state === 'recording') recorderCamera.pause(); } catch(_) {}
    try { if (recorderAudio && recorderAudio.state === 'recording') { try { recorderAudio.pause && recorderAudio.pause(); } catch(e) {} } } catch(_) {}
    try { if (recorderScreen && recorderScreen.state !== 'inactive') recorderScreen.stop(); } catch(_) {}
    try { if (recorderCamera && recorderCamera.state !== 'inactive') recorderCamera.stop(); } catch(_) {}
    try { if (recorderAudio && recorderAudio.state !== 'inactive') recorderAudio.stop(); } catch(_) {}
    // Update state flags
    recState.recording = false;
    recState.paused = false;
    // Reflect UI and enable save if any data was collected
    setStoppedUI();
    updateSaveButtonVisibility();
    // Stop streams to free devices
    stopCameraStream();
    // Disable source switches until user re-enables manually
    setSourceControlsEnabled(false);
  } catch(_) {}
  try { alert(message || 'Источник захвата был отключён или отозваны разрешения. Данные можно сохранить, если они есть.'); } catch(_) {}
  // allow further notifications after short cooldown
  try { setTimeout(function(){ window.__recNotifiedRevoked = false; }, 1000); } catch(_) {}
}

/** @typedef {{recording: boolean, paused: boolean, hasData: boolean}} RecState */
/** @type {RecState} */ let recState = { recording: false, paused: false, hasData: false };
/** @type {BlobPart[]} */ let recordedAudio = [];
/** @type {MediaRecorder|null} */ let recorderAudio = null;

/**
 * Sync theme classes from parent window into iframe (same-origin).
 * Copies `theme-*` classes from parent documentElement to iframe's documentElement.
 */
(function() {
  /**
   * Apply theme classes from a source element to the iframe root.
   * @param {Element|null|undefined} el - Source element to copy theme classes from
   */
  function applyThemeFrom(el) {
    try {
      var dstRoot = document.documentElement;
      if (!dstRoot || !el) return;
      dstRoot.className = (dstRoot.className || '').split(/\s+/).filter(function(c){ return !/^theme-/.test(c); }).join(' ');
      var src = (el.className || '').split(/\s+/).filter(function(c){ return /^theme-/.test(c); });
      if (src.length) {
        dstRoot.className = (dstRoot.className ? dstRoot.className + ' ' : '') + src.join(' ');
      }
    } catch(_) {}
  }
  /**
   * Perform a single sync attempt from parent document.
   */
  function syncOnce() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        applyThemeFrom(window.parent.document.documentElement);
      }
    } catch(_) {}
  }
  try { document.addEventListener('DOMContentLoaded', syncOnce, { once: true }); } catch(_) {}
  // Avoid perpetual intervals; rely on event-driven sync only
  try {
    /**
     * Listen for theme change messages from parent.
     * @param {MessageEvent<{type:string,className?:string}>} ev - Message event from parent window
     */
    function onThemeMessage(ev){
      if (!ev || !ev.data) return;
      if (ev.data && ev.data.type === 'theme:changed') {
        try {
          if (ev.data.className) {
            var dstRoot = document.documentElement;
            dstRoot.className = (dstRoot.className || '').split(/\s+/).filter(function(c){ return !/^theme-/.test(c); }).join(' ');
            dstRoot.className = (dstRoot.className ? dstRoot.className + ' ' : '') + ev.data.className;
            try {
              if (document.body) {
                document.body.className = (document.body.className || '').split(/\s+/).filter(function(c){ return !/^theme-/.test(c); }).join(' ');
                document.body.className = (document.body.className ? document.body.className + ' ' : '') + ev.data.className;
              }
            } catch(_) {}
          } else {
            syncOnce();
          }
        } catch(_) { syncOnce(); }
      }
    }
    window.addEventListener('message', onThemeMessage);
  } catch(_) {}
})();

/**
 * Send current recorder state to parent window (for guarded close logic).
 * @returns {void}
 */
function postState() {
  try {
    if (window.parent) {
      window.parent.postMessage({ type: 'rec:state', state: recState }, '*');
    }
  } catch(e) {}
}

/**
 * Initialize UI elements and event handlers when DOM is loaded.
 * @returns {void}
 */
document.addEventListener('DOMContentLoaded', function() {
  buttonCamera = document.getElementById('camera');
  buttonStart = document.getElementById('start');
  buttonPause = document.getElementById('pause');
  buttonStop = document.getElementById('stop');
  buttonSave = document.getElementById('save');
  videoScreen = document.getElementById('video-screen');
  videoCamera = document.getElementById('video-camera');
  audioIndicatorWrap = document.getElementById('audio-indicator-wrap');
  audioIndicator = document.getElementById('audio-indicator');
  fileName = document.getElementById('name');
  dirName = document.getElementById('type');
  fileText = document.getElementById('desc');
  sourceCamera = document.getElementById('source-camera');
  sourceScreen = document.getElementById('source-screen');
  sourceBoth = document.getElementById('source-both');
  sourceAudio = document.getElementById('source-audio');

  sizeText = document.getElementById('uploadForm_Size');
  statusText = document.getElementById('uploadForm_Status');
  progressBar = document.getElementById('progressBar');
  uploadProgress = document.getElementById('uploadProgress');
  uploadProgressBar = document.getElementById('uploadProgressBar');

disable(buttonStart);
disable(buttonPause);
disable(buttonStop);
  if (buttonSave) { buttonSave.disabled = true; try { buttonSave.style.display = 'none'; } catch(e) {} }
  if (fileName) fileName.value = name();

  if (buttonCamera) buttonCamera.onclick = onCameraClick;
  if (buttonStart) buttonStart.onclick = onStartClick;
  if (buttonPause) buttonPause.onclick = onPauseClick;
  if (buttonStop) buttonStop.onclick = onStopClick;
  if (buttonSave) buttonSave.onclick = onSaveClick;
  
  // Source selection change handlers
  if (sourceCamera) sourceCamera.addEventListener('change', onSourceChange);
  if (sourceScreen) sourceScreen.addEventListener('change', onSourceChange);
  if (sourceBoth) sourceBoth.addEventListener('change', onSourceChange);
  if (sourceAudio) sourceAudio.addEventListener('change', onSourceChange);
  
  // Backup behavior: no custom selected visuals for radio group
  
  // Initial UI state
  updateVideoVisibility();
  
  // Check camera state and update button states accordingly
  updateButtonStates();
  
  postState();
  // Recompute scrollbar on resize
  try {
    window.addEventListener('resize', function(){ try { updateVideoVisibility(); } catch(_) {} });
  } catch(_) {}
  // Ensure correct initial background/app state in parent
  // Hotkeys inside iframe: Enter to save (except textarea), Esc to stop
  /**
   * Handle keyboard shortcuts in the recorder iframe.
   * @param {KeyboardEvent} event - Keyboard event
   * @returns {void}
   */
  const handleKey = function (event) {
    const isTextarea = document.activeElement && document.activeElement.tagName === 'TEXTAREA';
    if (event.key === 'Enter' && !isTextarea) {
      event.preventDefault();
      try {
        if ((recorderScreen && recorderScreen.state === 'recording') || (recorderCamera && recorderCamera.state === 'recording')) {
          stopRecorder().then(() => { onSaveClick(); });
        } else {
          onSaveClick();
        }
      } catch(e) {}
    } else if (event.key === 'Escape') {
      // Delegate ESC to parent for guarded close logic
      try { event.preventDefault(); } catch(_) {}
      try { window.parent && window.parent.postMessage({ type: 'rec:esc' }, '*'); } catch(_) {}
      return;
    }
  };
  try { window.addEventListener('keydown', handleKey, true); } catch(e) {}
  try { document.addEventListener('keydown', handleKey, true); } catch(e) {}
});

// Stop media and cleanup when iframe is being unloaded (modal closed or navigation)
try {
  function __recCleanup(){
    try { stopRecorder(); } catch(_) {}
    try { stopCameraStream(); } catch(_) {}
    try { stopScreenStream && stopScreenStream(); } catch(_) {}
    try { recState = { recording: false, paused: false, hasData: (recordedScreen.length>0)||(recordedCamera.length>0)||(recordedAudio&&recordedAudio.length>0) }; postState(); } catch(_) {}
    try { if (window.__recSyncInterval) { clearInterval(window.__recSyncInterval); window.__recSyncInterval = null; } } catch(_) {}
  }
  window.addEventListener('beforeunload', __recCleanup);
  window.addEventListener('pagehide', __recCleanup);
} catch(_) {}

// Pause/cleanup on tab/iframe hidden to avoid camera left on in background
try {
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) {
      try { if (recorderScreen && recorderScreen.state === 'recording') recorderScreen.pause(); } catch(_) {}
      try { if (recorderCamera && recorderCamera.state === 'recording') recorderCamera.pause(); } catch(_) {}
      try { if (recorderAudio && recorderAudio.state === 'recording') try { recorderAudio.pause && recorderAudio.pause(); } catch(e) {} } catch(_) {}
      try { disable(buttonPause); enable(buttonStart); } catch(_) {}
      try { if (videoScreen) videoScreen.style.borderColor = 'green'; } catch(_) {}
      try { if (videoCamera) videoCamera.style.borderColor = 'green'; } catch(_) {}
      try { if (audioIndicator) audioIndicator.style.borderColor = 'green'; } catch(_) {}
      try { postState(); } catch(_) {}
    }
  });
} catch(_) {}

/**
 * Update UI to stopped state: borders, buttons, timer and save toggle.
 * @returns {void}
 */
function setStoppedUI() {
  try { if (videoScreen) videoScreen.style.borderColor = 'green'; } catch(e) {}
  try { if (videoCamera) videoCamera.style.borderColor = 'green'; } catch(e) {}
  try { buttonStart.textContent = 'Начать запись'; } catch(e) {}
  try { disable(buttonPause); } catch(e) {}
  try { disable(buttonStop); } catch(e) {}
  // Update save button visibility based on recorded data
  updateSaveButtonVisibility();
  // Don't reset timer when stopping - keep the recorded time visible
}

/**
 * Fully reset UI, state and camera after a successful save or discard.
 * @returns {void}
 */
function resetAfterSave() {
  try { if (uploadProgress) uploadProgress.style.display = 'none'; } catch(e) {}
  try { if (uploadProgressBar) uploadProgressBar.style.width = '0%'; } catch(e) {}
  try { if (videoScreen) videoScreen.style.borderColor = 'gray'; } catch(e) {}
  try { if (videoCamera) videoCamera.style.borderColor = 'gray'; } catch(e) {}
  try { if (audioIndicator) audioIndicator.style.borderColor = '#000000'; } catch(e) {}
  try { buttonStart.textContent = 'Начать запись'; } catch(e) {}
  try { enable(buttonCamera); } catch(e) {}
  try { enable(buttonStart); } catch(e) {}
  try { disable(buttonPause); } catch(e) {}
  try { disable(buttonStop); } catch(e) {}
  try { if (buttonSave) { buttonSave.disabled = true; buttonSave.style.display = 'none'; } } catch(e) {}
  resetTimer(true);
  recordedScreen = [];
  recordedCamera = [];
  recordedAudio = [];
  // Fully stop camera and reset state
  try { stopCameraStream(); } catch(e) {}
  recorderScreen = null;
  recorderCamera = null;
  recorderAudio = null;
  recState = { recording: false, paused: false, hasData: false };
  
  // Update video visibility after reset
  updateVideoVisibility();
  
  // Update button states after reset
  updateButtonStates();
  // Re-enable source controls after save/reset
  try { setSourceControlsEnabled(true); } catch(_) {}
  
  // Reinitialize button handlers to ensure they work
  if (buttonCamera) buttonCamera.onclick = onCameraClick;
  if (buttonStart) buttonStart.onclick = onStartClick;
  if (buttonPause) buttonPause.onclick = onPauseClick;
  if (buttonStop) buttonStop.onclick = onStopClick;
  if (buttonSave) buttonSave.onclick = onSaveClick;
  
  // Reinitialize source selection handlers
  if (sourceCamera) {
    sourceCamera.removeEventListener('change', onSourceChange);
    sourceCamera.addEventListener('change', onSourceChange);
  }
  if (sourceScreen) {
    sourceScreen.removeEventListener('change', onSourceChange);
    sourceScreen.addEventListener('change', onSourceChange);
  }
  if (sourceBoth) {
    sourceBoth.removeEventListener('change', onSourceChange);
    sourceBoth.addEventListener('change', onSourceChange);
  }
  if (sourceAudio) {
    sourceAudio.removeEventListener('change', onSourceChange);
    sourceAudio.addEventListener('change', onSourceChange);
  }
  
  postState();
}

/**
 * Stop all media tracks and clear video srcObject.
 * @returns {void}
 */
function stopCameraStream() {
  try {
    if (currentStreamScreen) {
      try { currentStreamScreen.getTracks().forEach(t => t.stop()); } catch(e) {}
      currentStreamScreen = null;
    }
    if (currentStreamCamera) {
      try { currentStreamCamera.getTracks().forEach(t => t.stop()); } catch(e) {}
      currentStreamCamera = null;
    }
    if (currentStreamAudio) {
      try { currentStreamAudio.getTracks().forEach(t => t.stop()); } catch(e) {}
      currentStreamAudio = null;
    }
    if (videoScreen && videoScreen.srcObject) {
      videoScreen.srcObject = null;
    }
    if (videoCamera && videoCamera.srcObject) {
      videoCamera.srcObject = null;
    }
  } catch(e) {}
  try { 
    let buttonText = 'Включить камеру';
    if (isDualRecording) {
      buttonText = 'Включить захват';
    } else if (isScreenRecording) {
      buttonText = 'Включить захват';
    } else if (isAudioOnly) {
      buttonText = 'Включить микрофон';
    }
    buttonCamera.textContent = buttonText; 
  } catch(e) {}
  isScreenRecording = false;
  isDualRecording = false;
  isAudioOnly = false;
  // If no streams left and not recording/paused, re-enable source controls
  try { if (!areAnyStreamsActive() && !recState.recording && !recState.paused) setSourceControlsEnabled(true); } catch(_) {}
}

/**
 * Update button states based on camera and recording state.
 * @returns {void}
 */
function updateButtonStates() {
  try {
    // Check if camera is currently active
    const isCameraActive = buttonCamera && (
      buttonCamera.textContent.includes('Выключить') || 
      buttonCamera.textContent.includes('Остановить')
    );
    
    // Check if we have active camera stream
    const hasActiveStream = videoCamera && videoCamera.srcObject && 
      videoCamera.srcObject.getTracks && 
      videoCamera.srcObject.getTracks().some(track => track.readyState === 'live');
    
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
    
    // Hide save button on initialization
    if (buttonSave) {
      buttonSave.disabled = true;
      try { buttonSave.style.display = 'none'; } catch(e) {}
    }
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
    const isBothMode = sourceBoth && sourceBoth.checked;
    const isCameraMode = sourceCamera && sourceCamera.checked;
    const isAudioMode = sourceAudio && sourceAudio.checked;
    
    // Show/hide video elements based on mode
    if (videoScreen) {
      videoScreen.style.display = (isScreenMode || isBothMode) ? 'block' : 'none';
    }
    if (videoCamera) {
      videoCamera.style.display = (isCameraMode || isBothMode) ? 'block' : 'none';
    }
    if (audioIndicatorWrap) {
      audioIndicatorWrap.style.display = isAudioMode ? 'block' : 'none';
    }
    
    // Show/hide labels - find labels by their text content
    const videoLabels = document.querySelectorAll('.record-page__video-label');
    videoLabels.forEach(label => {
      if (label.textContent.includes('Экран')) {
        label.style.display = (isScreenMode || isBothMode) ? 'block' : 'none';
      } else if (label.textContent.includes('Камера')) {
        label.style.display = (isCameraMode || isBothMode) ? 'block' : 'none';
      } else if (label.textContent.includes('Микрофон')) {
        label.style.display = isAudioMode ? 'block' : 'none';
      }
    });

    // Single inner scrollbar on body; keep html hidden to avoid double bars
    try {
      document.documentElement.style.setProperty('overflow-y', 'hidden', 'important');
      document.body.style.setProperty('overflow-y', 'auto', 'important');
    } catch(_) {}
  } catch(e) {}
}

// Removed selected-state visuals to match backup styling

/**
 * Update save button visibility based on recorded data
 * @returns {void}
 */
function updateSaveButtonVisibility() {
  try {
    if (buttonSave) {
      const hasRecordedData = (recordedScreen.length > 0) || (recordedCamera.length > 0) || (recordedAudio.length > 0);
      const canShow = hasRecordedData && !recState.recording; // show only when paused or stopped
      if (canShow) {
        buttonSave.disabled = false;
        buttonSave.style.display = 'inline-block';
      } else {
buttonSave.disabled = true;
        buttonSave.style.display = 'none';
      }
    }
  } catch(e) {}
}

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
  } catch(_) {}
  try {
    if (sourceBoth && sourceBoth.checked) {
      isDualRecording = true;
      isScreenRecording = false;
      isAudioOnly = false;
      buttonCamera.textContent = 'Включить захват';
    } else if (sourceScreen && sourceScreen.checked) {
      isScreenRecording = true;
      isDualRecording = false;
      isAudioOnly = false;
      buttonCamera.textContent = 'Включить захват';
    } else if (sourceAudio && sourceAudio.checked) {
      isScreenRecording = false;
      isDualRecording = false;
      isAudioOnly = true;
      buttonCamera.textContent = 'Включить микрофон';
    } else {
      isScreenRecording = false;
      isDualRecording = false;
      isAudioOnly = false;
      buttonCamera.textContent = 'Включить камеру';
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
    if (buttonSave) { 
buttonSave.disabled = true;
      try { buttonSave.style.display = 'none'; } catch(e) {} 
    }
    if (videoScreen) videoScreen.style.borderColor = 'gray';
    if (videoCamera) videoCamera.style.borderColor = 'gray';
    if (audioIndicator) audioIndicator.style.borderColor = '#000000';
    resetTimer(true);
  } catch(e) {}
}

/**
 * Toggle camera/screen on/off and setup MediaRecorder.
 * Handles camera-only, screen-only, or dual recording modes.
 * @returns {Promise<void>}
 */
async function onCameraClick() {
  try {
    const isCurrentlyActive = buttonCamera.textContent.includes('Выключить') || buttonCamera.textContent.includes('Остановить');
    
    if (isCurrentlyActive) {
      disable(buttonStart);
      disable(buttonPause);
      disable(buttonStop);
      let buttonText = 'Включить камеру';
      if (isDualRecording) {
        buttonText = 'Включить захват';
      } else if (isScreenRecording) {
        buttonText = 'Включить захват';
      }
      buttonCamera.textContent = buttonText;
      stopCameraStream();
      // Update buttons after turning off
      try { updateButtonStates(); } catch(_) {}
      if (videoScreen) videoScreen.style.borderColor = 'gray';
      if (videoCamera) videoCamera.style.borderColor = 'gray';
      clearInterval(timerInterval);
      return;
    } else {
      // Disable source toggles once capture is about to start
      try { setSourceControlsEnabled(false); } catch(_) {}
      // Check current source selection
      const isScreenMode = sourceScreen && sourceScreen.checked;
      const isBothMode = sourceBoth && sourceBoth.checked;
      const isAudioMode = sourceAudio && sourceAudio.checked;
      
      if (isBothMode) {
        // Dual recording: both screen and camera
        try {
          // Get screen stream
          currentStreamScreen = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: 1920, max: 1920 },
              height: { ideal: 1080, max: 1080 },
              frameRate: { ideal: 30, max: 30 }
            },
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              sampleRate: 48000
            }
          });
          attachOnEnded(currentStreamScreen, 'Захват экрана был остановлен. Вы можете сохранить уже записанное.');
          
          // Get camera stream
          currentStreamCamera = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 30, max: 30 }
            },
        audio: {
          channels: 2,
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
              sampleRate: 48000,
              sampleSize: 16
            }
          });
          attachOnEnded(currentStreamCamera, 'Камера была отключена. Вы можете сохранить уже записанное.');
          
          // Setup video elements
          if (videoScreen) {
            videoScreen.srcObject = currentStreamScreen;
            videoScreen.muted = true;
            videoScreen.play();
            videoScreen.style.borderColor = 'green';
          }
          if (videoCamera) {
            videoCamera.srcObject = currentStreamCamera;
            videoCamera.muted = true;
            videoCamera.play();
            videoCamera.style.borderColor = 'green';
          }
          
          buttonCamera.textContent = 'Остановить захват';
          isDualRecording = true;
          try { updateButtonStates(); } catch(_) {}
          
        } catch (error) {
          alert('Невозможно получить доступ к экрану или камере!');
          return;
        }
      } else if (isScreenMode) {
        // Screen recording only
        try {
          currentStreamScreen = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: 1920, max: 1920 },
              height: { ideal: 1080, max: 1080 },
              frameRate: { ideal: 30, max: 30 }
            },
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              sampleRate: 48000
            }
          });
          attachOnEnded(currentStreamScreen, 'Захват экрана был остановлен. Вы можете сохранить уже записанное.');
          
          if (videoScreen) {
            videoScreen.srcObject = currentStreamScreen;
            videoScreen.muted = true;
            videoScreen.play();
            videoScreen.style.borderColor = 'green';
          }
          
          buttonCamera.textContent = 'Остановить захват';
          isScreenRecording = true;
          try { updateButtonStates(); } catch(_) {}
          
        } catch (error) {
          alert('Невозможно получить доступ к экрану!');
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
              sampleSize: 16
            }
          });
          attachOnEnded(currentStreamAudio, 'Микрофон был отключён. Вы можете сохранить уже записанное.');
          if (audioIndicator) {
            audioIndicator.style.borderColor = 'green';
            audioIndicator.textContent = 'Микрофон включен';
          }
          buttonCamera.textContent = 'Выключить микрофон';
          isAudioOnly = true;
          try { updateButtonStates(); } catch(_) {}
        } catch (error) {
          alert('Невозможно получить доступ к микрофону!');
          return;
        }
      } else {
        // Camera recording only
        try {
          currentStreamCamera = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 30, max: 30 }
            },
            audio: {
              channels: 2,
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              sampleRate: 48000,
              sampleSize: 16
            }
          });
          attachOnEnded(currentStreamCamera, 'Камера была отключена. Вы можете сохранить уже записанное.');
          
          if (videoCamera) {
            videoCamera.srcObject = currentStreamCamera;
            videoCamera.muted = true;
            videoCamera.play();
            videoCamera.style.borderColor = 'green';
          }
          
          buttonCamera.textContent = 'Выключить камеру';
          isScreenRecording = false;
          try { updateButtonStates(); } catch(_) {}
          
        } catch (error) {
          alert('Невозможно получить доступ к камере!');
          return;
        }
      }
    }

    // Setup MediaRecorder(s)
    if (!('MediaRecorder' in window)) {
      alert('MediaRecorder не поддерживается в этом браузере');
      return;
    }

    // Prefer audio-capable MIME types when audio tracks present; fallback robustly
    const hasScreenAudio = currentStreamScreen && currentStreamScreen.getAudioTracks().length > 0;
    const hasCameraAudio = currentStreamCamera && currentStreamCamera.getAudioTracks().length > 0;
    const needsAudio = !!(hasScreenAudio || hasCameraAudio);
    let candidates = [];
    if (needsAudio) {
      candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
    } else {
      candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
    }
    let mime = candidates.find(function(m){ try { return MediaRecorder.isTypeSupported(m); } catch(_) { return false; } }) || 'video/webm';

    // Clear previous recorders
    recorderScreen = null;
    recorderCamera = null;

    if (isDualRecording) {
      // Setup screen recorder
      if (currentStreamScreen) {
        try { currentStreamScreen.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
        try {
          recorderScreen = new MediaRecorder(currentStreamScreen, {
            mimeType: mime,
            videoBitsPerSecond: 8000000,
            audioBitsPerSecond: 192000
          });
        } catch (error) {
          console.error('Failed to create screen MediaRecorder:', error);
          alert('Ошибка: браузер не поддерживает запись экрана. Попробуйте другой браузер.');
          return;
        }
      }
      
      // Setup camera recorder
      if (currentStreamCamera) {
        try { currentStreamCamera.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
        try {
          recorderCamera = new MediaRecorder(currentStreamCamera, {
            mimeType: mime,
            videoBitsPerSecond: 5000000,
            audioBitsPerSecond: 192000
          });
        } catch (error) {
          console.error('Failed to create camera MediaRecorder:', error);
          alert('Ошибка: браузер не поддерживает запись с камеры. Попробуйте другой браузер.');
          return;
        }
      }
    } else if (isScreenRecording) {
      // Setup screen recorder only
      if (currentStreamScreen) {
        try { currentStreamScreen.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
        try {
          recorderScreen = new MediaRecorder(currentStreamScreen, {
            mimeType: mime,
            videoBitsPerSecond: 8000000,
            audioBitsPerSecond: 192000
          });
        } catch (error) {
          console.error('Failed to create screen MediaRecorder:', error);
          alert('Ошибка: браузер не поддерживает запись экрана. Попробуйте другой браузер.');
          return;
        }
      }
    } else if (isAudioOnly) {
      // Setup audio recorder only
      if (currentStreamAudio) {
        // Check for supported audio MIME types
        let audioMimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(audioMimeType)) {
          audioMimeType = 'audio/webm';
          if (!MediaRecorder.isTypeSupported(audioMimeType)) {
            audioMimeType = 'audio/mp4';
            if (!MediaRecorder.isTypeSupported(audioMimeType)) {
              audioMimeType = 'audio/wav';
              if (!MediaRecorder.isTypeSupported(audioMimeType)) {
                audioMimeType = ''; // Let browser choose
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
          console.error('Failed to create audio MediaRecorder:', error);
          alert('Ошибка: браузер не поддерживает аудио-запись. Попробуйте другой браузер.');
          return;
        }
      }
    } else {
      // Setup camera recorder only
      if (currentStreamCamera) {
        try { currentStreamCamera.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
        try {
          recorderCamera = new MediaRecorder(currentStreamCamera, {
            mimeType: mime,
            videoBitsPerSecond: 5000000,
            audioBitsPerSecond: 192000
          });
        } catch (error) {
          console.error('Failed to create camera MediaRecorder:', error);
          alert('Ошибка: браузер не поддерживает запись с камеры. Попробуйте другой браузер.');
          return;
        }
      }
    }

    // Setup event listeners for recorders
    if (recorderScreen) {
      recorderScreen.addEventListener('dataavailable', function (e) {
        recordedScreen.push(e.data);
        if (recordedScreen.length > 0) { 
          recState.hasData = true; 
          postState();
          // Update save button when we have data
          updateSaveButtonVisibility();
        }
      });
      recorderScreen.addEventListener('stop', function () {
        // Update UI when recording is actually stopped
        updateSaveButtonVisibility();
      });
    }
    
    if (recorderCamera) {
      recorderCamera.addEventListener('dataavailable', function (e) {
        recordedCamera.push(e.data);
        if (recordedCamera.length > 0) { 
          recState.hasData = true; 
          postState();
          // Update save button when we have data
          updateSaveButtonVisibility();
        }
      });
      recorderCamera.addEventListener('stop', function () {
        // Update UI when recording is actually stopped
        updateSaveButtonVisibility();
      });
    }
    if (recorderAudio) {
      recorderAudio.addEventListener('dataavailable', function (e) {
        recordedAudio.push(e.data);
        if (recordedAudio.length > 0) {
          recState.hasData = true;
          postState();
          updateSaveButtonVisibility();
        }
      });
      recorderAudio.addEventListener('stop', function () {
        updateSaveButtonVisibility();
      });
    }

    // Update video visibility after setting up streams
    updateVideoVisibility();

    timerInterval = setInterval(timer, 1000);
    recordedScreen = [];
    recordedCamera = [];
    enable(buttonStart);
    disable(buttonPause);
    disable(buttonStop);
    recState = { recording: false, paused: false, hasData: false };
    postState();
    // Re-enable source controls when idle and no active streams
    try { if (!areAnyStreamsActive()) setSourceControlsEnabled(true); } catch(_) {}
  } catch (error) {
    alert('Ошибка при настройке записи!');
  }
  }

/**
 * Start or resume recording and update UI accordingly.
 */
function onStartClick() {
  if (buttonStart.textContent == 'Начать запись') {
    // Start recording
    try { if (recorderScreen) recorderScreen.start(); } catch(e) { handleCaptureRevoked('Невозможно начать запись: источник экрана недоступен.'); return; }
    try { if (recorderCamera) recorderCamera.start(); } catch(e) { handleCaptureRevoked('Невозможно начать запись: камера недоступна.'); return; }
    try { if (recorderAudio) recorderAudio.start(); } catch(e) { handleCaptureRevoked('Невозможно начать запись: микрофон недоступен.'); return; }
    try { setSourceControlsEnabled(false); } catch(_) {}
    buttonStart.textContent = 'Продолжить';
    try { if (!timerInterval) { timerInterval = setInterval(timer, 1000); } } catch(e) {}
  } else {
    // Resume recording
    if (recorderScreen) recorderScreen.resume();
    if (recorderCamera) recorderCamera.resume();
    if (recorderAudio) try { recorderAudio.resume && recorderAudio.resume(); } catch(e) {}
    try { if (!timerInterval) { timerInterval = setInterval(timer, 1000); } } catch(e) {}
  }
  
  if (videoScreen) videoScreen.style.borderColor = 'red';
  if (videoCamera) videoCamera.style.borderColor = 'red';
  if (audioIndicator) audioIndicator.style.borderColor = 'red';

  if (uploadProgress) uploadProgress.style.display = 'block';
  if (uploadProgressBar) uploadProgressBar.style.width = '0%';
  disable(buttonCamera);
  disable(buttonStart);
  enable(buttonPause);
  enable(buttonStop);
  // Hide save while actively recording
  try { if (buttonSave) { buttonSave.style.display = 'none'; buttonSave.disabled = true; } } catch(e) {}
  recState.recording = true;
  recState.paused = false;
  postState();
}

/**
 * Pause recording and update UI.
 */
function onPauseClick() {
  if (recorderScreen) recorderScreen.pause();
  if (recorderCamera) recorderCamera.pause();
  if (recorderAudio) try { recorderAudio.pause && recorderAudio.pause(); } catch(e) {}
  if (videoScreen) videoScreen.style.borderColor = 'green';
  if (videoCamera) videoCamera.style.borderColor = 'green';
  if (audioIndicator) audioIndicator.style.borderColor = 'green';
  enable(buttonStart);
  disable(buttonPause);
  // Show save when paused and data exists
  updateSaveButtonVisibility();
  recState.recording = false;
  recState.paused = true;
  postState();
  try { setSourceControlsEnabled(false); } catch(_) {}
}

/**
 * Stop recording, set stopped UI, and publish state.
 */
function onStopClick() {
  if (recorderScreen) {
    recorderScreen.pause();
    recorderScreen.stop();
  }
  if (recorderCamera) {
    recorderCamera.pause();
    recorderCamera.stop();
  }
  if (recorderAudio) {
    try { recorderAudio.stop(); } catch(e) {}
  }
  
  // Update state immediately
  recState.recording = false;
  recState.paused = false;
  recState.hasData = (recordedScreen.length > 0) || (recordedCamera.length > 0) || (recordedAudio.length > 0);
  try { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } } catch(e) {}
  
  // Update UI with current data state
  setStoppedUI();
  // Show save after stop if there is data
  updateSaveButtonVisibility();
  postState();
  // Allow changing source only after full cleanup happens elsewhere
}

/**
 * Save recording. If still recording, ensures recorder is stopped first.
 */
function onSaveClick() {
  // If recording, stop first to flush data
  const isRecording = (recorderScreen && recorderScreen.state === 'recording') || 
                     (recorderCamera && recorderCamera.state === 'recording');
  const isPaused = (!isRecording) && (
    (recorderScreen && recorderScreen.state === 'paused') ||
    (recorderCamera && recorderCamera.state === 'paused')
  );
  if (isRecording || isPaused) {
    // Always stop to flush data before saving
    return stopRecorder().then(() => onSaveClick());
  }
  saveFile()
    .then((response) => {})
    .catch((e) => alert(e));
  if (buttonSave.disabled) {
    recordedScreen = [];
    recordedCamera = [];
    recordedAudio = [];
  }
  }

/**
 * Update recording timer once per second while recorder is active.
 */
function timer() {
  const isRecording = (recorderScreen && recorderScreen.state === 'recording') || 
                     (recorderCamera && recorderCamera.state === 'recording') ||
                     (recorderAudio && recorderAudio.state === 'recording');
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
    const hours = String(h).padStart(2, '0');
    const minutes = String(m).padStart(2, '0');
    const seconds = String(s).padStart(2, '0');
    const answer = `${hours}:${minutes}:${seconds}`;
    document.getElementById('time').innerHTML = answer;
  }
}

/**
 * Generate default file name: Rec_DD.MM.YYYY_HH.MM.SS
 * @returns {string}
 */
function name() {
  const currentdate = new Date();
  const date = String(currentdate.getDate()).padStart(2, '0');
  const month = String(currentdate.getMonth() + 1).padStart(2, '0');
  const year = currentdate.getFullYear();
  const hours = String(currentdate.getHours()).padStart(2, '0');
  const minutes = String(currentdate.getMinutes()).padStart(2, '0');
  const seconds = String(currentdate.getSeconds()).padStart(2, '0');
  const answer = `Rec_${date}.${month}.${year}_${hours}.${minutes}.${seconds}`;
  return answer;
}

/**
 * Upload recorded data to the backend and provide download links.
 * @returns {Promise<void>}
 */
async function saveFile() {
  var buttonSave = document.getElementById('save');
  try {
    if (fileName.value.search(/[/\\:*?"<>|]/g) != -1) {
      throw 'Указано недопустимое имя файла!';
    }
    
    const settings = document.getElementsByClassName('record-page__settings')[0];
    if (!settings) return;
    
    // Clear existing download links
    const existingLinks = settings.querySelectorAll('.download-record-link');
    existingLinks.forEach(link => link.remove());
    
    // Create a container for download links to avoid DOM conflicts
    let downloadContainer = document.getElementById('download-container');
    if (!downloadContainer) {
      downloadContainer = document.createElement('div');
      downloadContainer.id = 'download-container';
      downloadContainer.className = 'record-download-container';
      settings.appendChild(downloadContainer);
    }
    
    let uploadPromises = [];
    
    // Save screen recording if available
    if (recorderScreen && recordedScreen && recordedScreen.length > 0) {
      const screenBlob = new Blob(recordedScreen, { type: 'video/webm' });
      const screenFileName = fileName.value + '_screen.webm';
      
      // Create download link for screen
      const screenDownloadLink = document.createElement('a');
      screenDownloadLink.className = 'download-record-link btn btn-primary';
      try { if (screenDownloadLink.href && screenDownloadLink.href.indexOf('blob:') === 0) { URL.revokeObjectURL(screenDownloadLink.href); } } catch(_) {}
      screenDownloadLink.href = URL.createObjectURL(screenBlob);
      screenDownloadLink.download = screenFileName;
      screenDownloadLink.textContent = 'Скачать запись экрана';
      downloadContainer.appendChild(screenDownloadLink);
      try { screenDownloadLink.addEventListener('click', function(){ var href=screenDownloadLink.href; setTimeout(function(){ try { if (href && href.indexOf('blob:') === 0) URL.revokeObjectURL(href); } catch(_) {} }, 3000); }, { once: true }); } catch(_) {}
      
      // Upload screen recording
      const screenData = new FormData();
      screenData.append(screenFileName, screenBlob);
      const screenUrl = generateUrlString(
        fileName.value + '_screen',
      fileText.value,
      document.getElementById('did'),
      document.getElementById('sdid')
    );

      uploadPromises.push(uploadFile(screenData, screenUrl));
    }
    
  // Save audio recording if available (audio-only or from camera/screen if present)
  if (recordedAudio && recordedAudio.length > 0) {
    // Get the actual MIME type from the recorder
    const audioMimeType = recorderAudio ? recorderAudio.mimeType : 'audio/webm';
    const audioBlob = new Blob(recordedAudio, { type: audioMimeType });
    
    // Determine file extension based on MIME type
    let audioExtension = 'webm';
    if (audioMimeType.includes('mp4')) {
      audioExtension = 'm4a';
    } else if (audioMimeType.includes('wav')) {
      audioExtension = 'wav';
    }
    
    const audioFileName = fileName.value + '_audio.' + audioExtension;
  // Create download link for audio
  const audioDownloadLink = document.createElement('a');
  audioDownloadLink.className = 'download-record-link btn btn-primary';
  try { if (audioDownloadLink.href && audioDownloadLink.href.indexOf('blob:') === 0) { URL.revokeObjectURL(audioDownloadLink.href); } } catch(_) {}
  audioDownloadLink.href = URL.createObjectURL(audioBlob);
    audioDownloadLink.download = audioFileName;
    audioDownloadLink.textContent = 'Скачать аудио';
    downloadContainer.appendChild(audioDownloadLink);
  try { audioDownloadLink.addEventListener('click', function(){ var href=audioDownloadLink.href; setTimeout(function(){ try { if (href && href.indexOf('blob:') === 0) URL.revokeObjectURL(href); } catch(_) {} }, 3000); }, { once: true }); } catch(_) {}
    // Upload audio
    const audioData = new FormData();
    audioData.append(audioFileName, audioBlob);
    const audioUrl = generateUrlString(
      fileName.value + '_audio',
      fileText.value,
      document.getElementById('did'),
      document.getElementById('sdid')
    );
    uploadPromises.push(uploadFile(audioData, audioUrl));
  }

    // Save camera recording if available
    if (recorderCamera && recordedCamera && recordedCamera.length > 0) {
      const cameraBlob = new Blob(recordedCamera, { type: 'video/webm' });
      const cameraFileName = fileName.value + '_cam.webm';
      
      // Create download link for camera
      const cameraDownloadLink = document.createElement('a');
      cameraDownloadLink.className = 'download-record-link btn btn-primary';
      try { if (cameraDownloadLink.href && cameraDownloadLink.href.indexOf('blob:') === 0) { URL.revokeObjectURL(cameraDownloadLink.href); } } catch(_) {}
      cameraDownloadLink.href = URL.createObjectURL(cameraBlob);
      cameraDownloadLink.download = cameraFileName;
      cameraDownloadLink.textContent = 'Скачать запись камеры';
      downloadContainer.appendChild(cameraDownloadLink);
      try { cameraDownloadLink.addEventListener('click', function(){ var href=cameraDownloadLink.href; setTimeout(function(){ try { if (href && href.indexOf('blob:') === 0) URL.revokeObjectURL(href); } catch(_) {} }, 3000); }, { once: true }); } catch(_) {}
      
      // Upload camera recording
      const cameraData = new FormData();
      cameraData.append(cameraFileName, cameraBlob);
      const cameraUrl = generateUrlString(
        fileName.value + '_cam',
      fileText.value,
      document.getElementById('did'),
      document.getElementById('sdid')
    );

      uploadPromises.push(uploadFile(cameraData, cameraUrl));
    }
    
    if (uploadPromises.length === 0) {
      throw 'Нет записанных данных';
    }
    
    // Wait for all uploads to complete
    await Promise.all(uploadPromises);

    // Simulate successful upload event to trigger modal close
    const mockEvent = {
      target: { status: 200 }
    };
    loadHandler(mockEvent);
    
    // Don't modify parent window elements to avoid blocking issues
    
    // Immediately try to fix any blocking elements
    setTimeout(() => {
      // Remove any elements that might be blocking clicks
      const potentialBlockers = document.querySelectorAll('[style*="position: absolute"], [style*="position: fixed"]');
      potentialBlockers.forEach(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const zIndex = parseInt(style.zIndex) || 0;
        
        // If element covers screen and has high z-index, disable pointer events
        if (zIndex > 0 && rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5) {
          element.style.pointerEvents = 'none';
          element.style.zIndex = '-1';
          element.style.display = 'none';
        }
      });
      
      // Also check for any elements with high z-index
      const allElements = document.querySelectorAll('*');
      allElements.forEach(element => {
        const style = getComputedStyle(element);
        const zIndex = parseInt(style.zIndex) || 0;
        const rect = element.getBoundingClientRect();
        
        if (zIndex > 0 && rect.width > window.innerWidth * 0.3 && rect.height > window.innerHeight * 0.3) {
          element.style.pointerEvents = 'none';
          element.style.zIndex = '-1';
          element.style.display = 'none';
        }
      });
    }, 50);
    
    // Re-verify event handlers are still working after DOM changes
    setTimeout(() => {
      // Reattach event listeners to ensure they work
      if (sourceCamera) {
        sourceCamera.removeEventListener('change', onSourceChange);
        sourceCamera.addEventListener('change', onSourceChange);
      }
      if (sourceScreen) {
        sourceScreen.removeEventListener('change', onSourceChange);
        sourceScreen.addEventListener('change', onSourceChange);
      }
      if (sourceBoth) {
        sourceBoth.removeEventListener('change', onSourceChange);
        sourceBoth.addEventListener('change', onSourceChange);
      }
      if (sourceAudio) {
        sourceAudio.removeEventListener('change', onSourceChange);
        sourceAudio.addEventListener('change', onSourceChange);
      }
      
    }, 100);
  } catch (e) {
    alert('Сохранить видео не удалось (' + e + ')!');
  }
}

/**
 * Upload a single file to the backend.
 * @param {FormData} formData
 * @param {string} url
 * @returns {Promise<void>}
 */
function uploadFile(formData, url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', progressHandler, false);
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 400) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    
    xhr.open('POST', url);
    xhr.send(formData);
  });
}

/**
 * Build save URL from form values.
 * @param {string} fileName
 * @param {string} fileText
 * @param {HTMLInputElement} did
 * @param {HTMLInputElement} sdid
 * @returns {string}
 */
function generateUrlString(fileName, fileText, did, sdid) {
  const name = encodeURIComponent(fileName);
  const desc = encodeURIComponent(fileText);
  const base = window.location.origin;
  return `${base}/files/rec/save/${name}/q${desc}/${did.value}/${sdid.value}`;
}

/**
 * XHR progress handler for upload.
 * @param {ProgressEvent} event
 */
function progressHandler(event) {
  const loadedMB = (event.loaded / BYTES_IN_MB).toFixed(1);
  const totalSizeMb = event.total ? (event.total / BYTES_IN_MB).toFixed(1) : '0';
  const percentLoaded = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
  if (uploadProgressBar) uploadProgressBar.style.width = `${percentLoaded}%`;
}

/**
 * XHR load handler: close modal and inform parent on success.
 * @param {ProgressEvent} event
 */
function loadHandler(event) {
  const ok = event.target.status >= 200 && event.target.status < 400;
  if (uploadProgressBar) uploadProgressBar.style.width = ok ? '100%' : '0%';
  // Notify parent and auto-close on success
  if (ok && window.parent) {
    // Ensure modal has correct z-index before closing
    try {
      const parentOverlay = window.parent.document.querySelector('.overlay-container');
      const parentPopup = window.parent.document.querySelector('.popup');
      if (parentOverlay) {
        parentOverlay.style.zIndex = '1050';
        parentOverlay.style.pointerEvents = 'auto';
      }
      if (parentPopup) {
        parentPopup.style.zIndex = '1050';
        parentPopup.style.pointerEvents = 'auto';
      }
    } catch(e) {}
    
    // Reset UI after successful upload
    resetAfterSave();
    try { window.parent.softRefreshFilesTable && window.parent.softRefreshFilesTable(); } catch(e) {}
    
    // Close modal directly like in scripts.js
    try {
      const overlay = window.parent.document.getElementById('popup-rec');
      if (overlay) {
        overlay.classList.remove('show');
        overlay.classList.remove('visible');
        overlay.style.display = 'none';
      }
      // Reset popup variable in parent
      if (window.parent.popup === 'popup-rec') {
        window.parent.popup = null;
      }
    } catch(e) {}
    
    try { window.parent.postMessage({ type: 'rec:saved' }, '*'); } catch(e) {}
    try { window.parent.alert && window.parent.alert('Видео успешно сохранено'); } catch(e) {}
    
    // Simple restoration like other modals
    setTimeout(() => {
      if (window.parent && window.parent !== window) {
        try {
          // Restore critical elements only
          const parentHtml = window.parent.document.documentElement;
          const parentBody = window.parent.document.body;
          if (parentHtml) { parentHtml.style.pointerEvents = 'auto'; parentHtml.style.zIndex = 'auto'; }
          if (parentBody) { parentBody.style.pointerEvents = 'auto'; parentBody.style.zIndex = 'auto'; }
        } catch (e) {
          // Silent fail
        }
      }
      
      // Also restore elements inside iframe
      try {
        const allElements = document.querySelectorAll('*');
        allElements.forEach(element => {
          try {
            element.style.pointerEvents = 'auto';
            element.style.zIndex = 'auto';
          } catch(e) {
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
window.addEventListener('message', function(ev) {
  const msg = ev.data || {};
  if (msg.type === 'rec:state?') {
    postState();
  } else if (msg.type === 'rec:save') {
    // Ensure recorder fully stops so dataavailable fires before saving
    stopRecorder().then(() => {
      try { onSaveClick(); } catch(e) {}
    });
  } else if (msg.type === 'rec:discard') {
    try {
      // stop tracks
      stopCameraStream();
      recordedScreen = [];
      recordedCamera = [];
      if (buttonSave) buttonSave.disabled = true;
      disable(buttonPause);
      disable(buttonStop);
      enable(buttonCamera);
      enable(buttonStart);
    if (videoScreen) videoScreen.style.borderColor = 'gray';
    if (videoCamera) videoCamera.style.borderColor = 'gray';
    if (audioIndicator) { audioIndicator.style.borderColor = '#000000'; audioIndicator.textContent = ''; }
      resetTimer(true);
      recState = { recording: false, paused: false, hasData: false };
      
      // Update video visibility after discard
      updateVideoVisibility();
      
      postState();
      if (window.parent) {
        window.parent.postMessage({ type: 'rec:discarded' }, '*');
      }
    } catch(e) {}
  } else if (msg.type === 'rec:close') {
    try {
      // Ensure everything is stopped and UI is reset when parent closes
      stopRecorder().then(() => {
        try { stopCameraStream(); } catch(_) {}
        try { resetAfterSave(); } catch(_) {}
        try { recState = { recording: false, paused: false, hasData: (recordedScreen.length>0)||(recordedCamera.length>0) }; postState(); } catch(_) {}
      });
    } catch(_) {}
  }
});

/**
 * Reset timer and optionally the visible display.
 * @param {boolean} resetDisplayOnly
 */
function resetTimer(resetDisplayOnly) {
  try { clearInterval(timerInterval); } catch(e) {}
  timerInterval = null;
  h = 0; m = 0; s = 0;
  try { document.getElementById('time').innerHTML = '00:00:00'; } catch(e) {}
}

/**
 * Ensure MediaRecorder is stopped and resolve when stop completes.
 * @returns {Promise<void>}
 */
function stopRecorder() {
  return new Promise((resolve) => {
    try {
      let activeRecorders = [];
      if (recorderScreen && recorderScreen.state !== 'inactive') activeRecorders.push(recorderScreen);
      if (recorderCamera && recorderCamera.state !== 'inactive') activeRecorders.push(recorderCamera);
      if (recorderAudio && recorderAudio.state !== 'inactive') activeRecorders.push(recorderAudio);
      
      if (activeRecorders.length === 0) { resolve(); return; }
      
      let completed = 0;
      const handleStop = () => {
        completed++;
        if (completed >= activeRecorders.length) {
          try { setStoppedUI(); } catch(e) {}
          setTimeout(resolve, 0);
        }
      };
      
      activeRecorders.forEach(recorder => {
        try { 
          recorder.addEventListener('stop', handleStop); 
          if (recorder.pause) try { recorder.pause(); } catch(e) {}
          recorder.stop();
        } catch(e) { 
          handleStop(); 
        }
      });
    } catch(e) { resolve(); }
  });
}