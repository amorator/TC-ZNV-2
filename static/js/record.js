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
/** @type {boolean} */ let isScreenRecording = false;
/** @type {boolean} */ let isDualRecording = false;

/** @typedef {{recording: boolean, paused: boolean, hasData: boolean}} RecState */
/** @type {RecState} */ let recState = { recording: false, paused: false, hasData: false };

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
  try { document.addEventListener('DOMContentLoaded', syncOnce); } catch(_) {}
  try { setInterval(syncOnce, 1000); } catch(_) {}
  try {
    /**
     * Listen for theme change messages from parent.
     * @param {MessageEvent<{type:string,className?:string}>} ev - Message event from parent window
     */
    window.addEventListener('message', function(ev){
      if (!ev || !ev.data) return;
      if (ev.data && ev.data.type === 'theme:changed') {
        try {
          if (ev.data.className) {
            var dstRoot = document.documentElement;
            dstRoot.className = (dstRoot.className || '').split(/\s+/).filter(function(c){ return !/^theme-/.test(c); }).join(' ');
            dstRoot.className = (dstRoot.className ? dstRoot.className + ' ' : '') + ev.data.className;
          } else {
            syncOnce();
          }
        } catch(_) { syncOnce(); }
      }
    });
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
  fileName = document.getElementById('name');
  dirName = document.getElementById('type');
  fileText = document.getElementById('desc');
  sourceCamera = document.getElementById('source-camera');
  sourceScreen = document.getElementById('source-screen');
  sourceBoth = document.getElementById('source-both');

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
  
  // Initial UI state
  updateVideoVisibility();
  
  postState();
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
      event.preventDefault();
      try { onStopClick(); } catch(e) {}
    }
  };
  try { window.addEventListener('keydown', handleKey, true); } catch(e) {}
  try { document.addEventListener('keydown', handleKey, true); } catch(e) {}
});

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
  try { if (buttonSave) buttonSave.disabled = false; } catch(e) {}
  resetTimer(true);
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
  try { buttonStart.textContent = 'Начать запись'; } catch(e) {}
  try { enable(buttonCamera); } catch(e) {}
  try { enable(buttonStart); } catch(e) {}
  try { disable(buttonPause); } catch(e) {}
  try { disable(buttonStop); } catch(e) {}
  try { if (buttonSave) { buttonSave.disabled = true; buttonSave.style.display = 'none'; } } catch(e) {}
  resetTimer(true);
  recordedScreen = [];
  recordedCamera = [];
  // Fully stop camera and reset state
  try { stopCameraStream(); } catch(e) {}
  recorderScreen = null;
  recorderCamera = null;
  recState = { recording: false, paused: false, hasData: false };
  
  // Update video visibility after reset
  updateVideoVisibility();
  
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
    }
    buttonCamera.textContent = buttonText; 
  } catch(e) {}
  isScreenRecording = false;
  isDualRecording = false;
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
    
    // Show/hide video elements based on mode
    if (videoScreen) {
      videoScreen.style.display = (isScreenMode || isBothMode) ? 'block' : 'none';
    }
    if (videoCamera) {
      videoCamera.style.display = (isCameraMode || isBothMode) ? 'block' : 'none';
    }
    
    // Show/hide labels - find labels by their text content
    const videoLabels = document.querySelectorAll('.record-page__video-label');
    videoLabels.forEach(label => {
      if (label.textContent.includes('Экран')) {
        label.style.display = (isScreenMode || isBothMode) ? 'block' : 'none';
      } else if (label.textContent.includes('Камера')) {
        label.style.display = (isCameraMode || isBothMode) ? 'block' : 'none';
      }
    });
  } catch(e) {}
}

/**
 * Handle source selection change (camera/screen/both).
 * @returns {void}
 */
function onSourceChange() {
  try {
    if (sourceBoth && sourceBoth.checked) {
      isDualRecording = true;
      isScreenRecording = false;
      buttonCamera.textContent = 'Включить захват';
    } else if (sourceScreen && sourceScreen.checked) {
      isScreenRecording = true;
      isDualRecording = false;
      buttonCamera.textContent = 'Включить захват';
    } else {
      isScreenRecording = false;
      isDualRecording = false;
      buttonCamera.textContent = 'Включить камеру';
    }
    
    // Update video visibility
    updateVideoVisibility();
    
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
      if (videoScreen) videoScreen.style.borderColor = 'gray';
      if (videoCamera) videoCamera.style.borderColor = 'gray';
      clearInterval(timerInterval);
      return;
    } else {
      // Check current source selection
      const isScreenMode = sourceScreen && sourceScreen.checked;
      const isBothMode = sourceBoth && sourceBoth.checked;
      
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
          
        } catch (error) {
          console.log(error);
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
          
          if (videoScreen) {
            videoScreen.srcObject = currentStreamScreen;
            videoScreen.muted = true;
            videoScreen.play();
            videoScreen.style.borderColor = 'green';
          }
          
          buttonCamera.textContent = 'Остановить захват';
          isScreenRecording = true;
          
        } catch (error) {
          console.log(error);
          alert('Невозможно получить доступ к экрану!');
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
          
          if (videoCamera) {
            videoCamera.srcObject = currentStreamCamera;
            videoCamera.muted = true;
            videoCamera.play();
            videoCamera.style.borderColor = 'green';
          }
          
          buttonCamera.textContent = 'Выключить камеру';
          isScreenRecording = false;
          
        } catch (error) {
          console.log(error);
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

    let mime = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mime)) {
      mime = 'video/webm;codecs=vp9';
    }
    if (!MediaRecorder.isTypeSupported(mime)) {
      mime = 'video/webm';
    }

    // Clear previous recorders
    recorderScreen = null;
    recorderCamera = null;

    if (isDualRecording) {
      // Setup screen recorder
      if (currentStreamScreen) {
        try { currentStreamScreen.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
        recorderScreen = new MediaRecorder(currentStreamScreen, {
          mimeType: mime,
          videoBitsPerSecond: 8000000,
          audioBitsPerSecond: 192000
        });
      }
      
      // Setup camera recorder
      if (currentStreamCamera) {
        try { currentStreamCamera.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
        recorderCamera = new MediaRecorder(currentStreamCamera, {
          mimeType: mime,
          videoBitsPerSecond: 5000000,
          audioBitsPerSecond: 192000
        });
      }
    } else if (isScreenRecording) {
      // Setup screen recorder only
      if (currentStreamScreen) {
        try { currentStreamScreen.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
        recorderScreen = new MediaRecorder(currentStreamScreen, {
          mimeType: mime,
          videoBitsPerSecond: 8000000,
          audioBitsPerSecond: 192000
        });
      }
    } else {
      // Setup camera recorder only
      if (currentStreamCamera) {
        try { currentStreamCamera.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
        recorderCamera = new MediaRecorder(currentStreamCamera, {
          mimeType: mime,
          videoBitsPerSecond: 5000000,
          audioBitsPerSecond: 192000
        });
      }
    }

    // Setup event listeners for recorders
    if (recorderScreen) {
      recorderScreen.addEventListener('dataavailable', function (e) {
        recordedScreen.push(e.data);
        if (recordedScreen.length > 0) { recState.hasData = true; postState(); }
      });
    }
    
    if (recorderCamera) {
      recorderCamera.addEventListener('dataavailable', function (e) {
        recordedCamera.push(e.data);
        if (recordedCamera.length > 0) { recState.hasData = true; postState(); }
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
  } catch (error) {
    console.log(error);
    alert('Ошибка при настройке записи!');
  }
}

/**
 * Start or resume recording and update UI accordingly.
 */
/**
 * Start or resume recording and update UI accordingly.
 */
function onStartClick() {
  if (buttonStart.textContent == 'Начать запись') {
    // Start recording
    if (recorderScreen) recorderScreen.start();
    if (recorderCamera) recorderCamera.start();
    buttonStart.textContent = 'Продолжить';
  } else {
    // Resume recording
    if (recorderScreen) recorderScreen.resume();
    if (recorderCamera) recorderCamera.resume();
  }
  
  if (videoScreen) videoScreen.style.borderColor = 'red';
  if (videoCamera) videoCamera.style.borderColor = 'red';

  if (uploadProgress) uploadProgress.style.display = 'block';
  if (uploadProgressBar) uploadProgressBar.style.width = '0%';
  disable(buttonCamera);
  disable(buttonStart);
  enable(buttonPause);
  enable(buttonStop);
  try { if (buttonSave) { buttonSave.style.display = 'inline-block'; } } catch(e) {}
  recState.recording = true;
  recState.paused = false;
  postState();
}

/**
 * Pause recording and update UI.
 */
/**
 * Pause recording and update UI.
 */
function onPauseClick() {
  if (recorderScreen) recorderScreen.pause();
  if (recorderCamera) recorderCamera.pause();
  if (videoScreen) videoScreen.style.borderColor = 'green';
  if (videoCamera) videoCamera.style.borderColor = 'green';
  enable(buttonStart);
  disable(buttonPause);
  recState.recording = false;
  recState.paused = true;
  postState();
}

/**
 * Stop recording, set stopped UI, and publish state.
 */
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
  setStoppedUI();
  recState.recording = false;
  recState.paused = false;
  recState.hasData = (recordedScreen.length > 0) || (recordedCamera.length > 0);
  postState();
}

/**
 * Save recording. If still recording, ensures recorder is stopped first.
 */
/**
 * Save recording. If still recording, ensures recorder is stopped first.
 */
function onSaveClick() {
  // If recording, stop first to flush data
  const isRecording = (recorderScreen && recorderScreen.state === 'recording') || 
                     (recorderCamera && recorderCamera.state === 'recording');
  if (isRecording) {
    return stopRecorder().then(() => onSaveClick());
  }
  saveFile()
    .then((response) => {})
    .catch((e) => alert(e));
  if (buttonSave.disabled) {
    recordedScreen = [];
    recordedCamera = [];
  }
}

/**
 * Update recording timer once per second while recorder is active.
 */
/**
 * Update recording timer once per second while recorder is active.
 */
function timer() {
  const isRecording = (recorderScreen && recorderScreen.state === 'recording') || 
                     (recorderCamera && recorderCamera.state === 'recording');
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
 * Upload recorded data to the backend and expose a download link for the blob.
 */
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
    
    let uploadPromises = [];
    
    // Save screen recording if available
    if (recorderScreen && recordedScreen && recordedScreen.length > 0) {
      const screenBlob = new Blob(recordedScreen, { type: 'video/webm' });
      const screenFileName = fileName.value + '_screen.webm';
      
      // Create download link for screen
      const screenDownloadLink = document.createElement('a');
      screenDownloadLink.className = 'download-record-link button';
      screenDownloadLink.href = URL.createObjectURL(screenBlob);
      screenDownloadLink.download = screenFileName;
      screenDownloadLink.textContent = 'Скачать запись экрана';
      screenDownloadLink.style.marginRight = '10px';
      settings.appendChild(screenDownloadLink);
      
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
    
    // Save camera recording if available
    if (recorderCamera && recordedCamera && recordedCamera.length > 0) {
      const cameraBlob = new Blob(recordedCamera, { type: 'video/webm' });
      const cameraFileName = fileName.value + '_cam.webm';
      
      // Create download link for camera
      const cameraDownloadLink = document.createElement('a');
      cameraDownloadLink.className = 'download-record-link button';
      cameraDownloadLink.href = URL.createObjectURL(cameraBlob);
      cameraDownloadLink.download = cameraFileName;
      cameraDownloadLink.textContent = 'Скачать запись камеры';
      settings.appendChild(cameraDownloadLink);
      
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
  return `${base}/fls/rec/save/${name}/q${desc}/${did.value}/${sdid.value}`;
}

/**
 * XHR progress handler for upload.
 * @param {ProgressEvent} event
 */
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
 * XHR load handler: closes modal and informs parent on success.
 * @param {ProgressEvent} event
 */
/**
 * XHR load handler: close modal and inform parent on success.
 * @param {ProgressEvent} event
 */
function loadHandler(event) {
  const ok = event.target.status >= 200 && event.target.status < 400;
  if (uploadProgressBar) uploadProgressBar.style.width = ok ? '100%' : '0%';
  // Notify parent and auto-close on success
  if (ok && window.parent) {
    // Reset UI after successful upload
    resetAfterSave();
    try { window.parent.softRefreshFilesTable && window.parent.softRefreshFilesTable(); } catch(e) {}
    try { window.parent.popupToggle && window.parent.popupToggle('popup-rec'); } catch(e) {}
    try { window.parent.postMessage({ type: 'rec:saved' }, '*'); } catch(e) {}
    try { window.parent.alert && window.parent.alert('Видео успешно сохранено'); } catch(e) {}
  }
}

// Handle parent messages (query state, save, discard)
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
      resetTimer(true);
      recState = { recording: false, paused: false, hasData: false };
      
      // Update video visibility after discard
      updateVideoVisibility();
      
      postState();
      if (window.parent) {
        window.parent.postMessage({ type: 'rec:discarded' }, '*');
      }
    } catch(e) {}
  }
});

/**
 * Reset timer and optionally the visible display.
 * @param {boolean} resetDisplayOnly (kept for compatibility)
 */
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
          recorder.pause();
          recorder.stop();
        } catch(e) { 
          handleStop(); 
        }
      });
    } catch(e) { resolve(); }
  });
}
