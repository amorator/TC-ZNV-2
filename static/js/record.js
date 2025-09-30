function disable(x) { if (!x) return; x.disabled = true; x.style.display = 'none'; }
function enable(x) { if (!x) return; x.disabled = false; x.style.display = 'inline-block'; }

window.onbeforeunload = null;

const BYTES_IN_MB = 1048576;

let buttonCamera, buttonStart, buttonPause, buttonStop, buttonSave, video, fileName, dirName, fileText;
let sizeText, statusText, progressBar;
let uploadProgress, uploadProgressBar;
let h = 0, m = 0, s = 0;
let recorded = [];
let timerInterval;
let recorder;
let recState = { recording: false, paused: false, hasData: false };

function postState() {
  try {
    if (window.parent) {
      window.parent.postMessage({ type: 'rec:state', state: recState }, '*');
    }
  } catch(e) {}
}

document.addEventListener('DOMContentLoaded', function() {
  buttonCamera = document.getElementById('camera');
  buttonStart = document.getElementById('start');
  buttonPause = document.getElementById('pause');
  buttonStop = document.getElementById('stop');
  buttonSave = document.getElementById('save');
  video = document.getElementById('video');
  fileName = document.getElementById('name');
  dirName = document.getElementById('type');
  fileText = document.getElementById('desc');

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
  postState();
  // Hotkeys inside iframe: Enter to save (except textarea), Esc to stop
  const handleKey = function (event) {
    const isTextarea = document.activeElement && document.activeElement.tagName === 'TEXTAREA';
    if (event.key === 'Enter' && !isTextarea) {
      event.preventDefault();
      try {
        if (recorder && recorder.state === 'recording') {
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

function setStoppedUI() {
  try { video.style.borderColor = 'green'; } catch(e) {}
  try { buttonStart.textContent = 'Начать запись'; } catch(e) {}
  try { disable(buttonPause); } catch(e) {}
  try { disable(buttonStop); } catch(e) {}
  try { if (buttonSave) buttonSave.disabled = false; } catch(e) {}
  resetTimer(true);
}

function resetAfterSave() {
  try { if (uploadProgress) uploadProgress.style.display = 'none'; } catch(e) {}
  try { if (uploadProgressBar) uploadProgressBar.style.width = '0%'; } catch(e) {}
  try { video.style.borderColor = 'gray'; } catch(e) {}
  try { buttonStart.textContent = 'Начать запись'; } catch(e) {}
  try { enable(buttonCamera); } catch(e) {}
  try { enable(buttonStart); } catch(e) {}
  try { disable(buttonPause); } catch(e) {}
  try { disable(buttonStop); } catch(e) {}
  try { if (buttonSave) { buttonSave.disabled = true; buttonSave.style.display = 'none'; } } catch(e) {}
  resetTimer(true);
  recorded = [];
  // Fully stop camera and reset state
  try { stopCameraStream(); } catch(e) {}
  recorder = null;
  recState = { recording: false, paused: false, hasData: false };
  postState();
}

function stopCameraStream() {
  try {
    if (video && video.srcObject) {
      try { video.srcObject.getTracks().forEach(t => t.stop()); } catch(e) {}
      video.srcObject = null;
    }
  } catch(e) {}
  try { buttonCamera.textContent = 'Включить камеру'; } catch(e) {}
}

async function onCameraClick() {
  try {
    if (buttonCamera.textContent == 'Выключить камеру') {
      disable(buttonStart);
      disable(buttonPause);
      disable(buttonStop);
      buttonCamera.textContent = 'Включить камеру';
      var tracks = video.srcObject.getTracks();
      tracks.forEach((track) => track.stop());
      video.style.borderColor = 'gray';
      clearInterval(timerInterval);
      return;
    } else {
      // Conservative defaults to avoid encoder artifacts
      const baseConstraints = {
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
      };
      var stream = await navigator.mediaDevices.getUserMedia(baseConstraints);
      buttonCamera.textContent = 'Выключить камеру';
    }
    video.srcObject = stream;
    try { video.muted = true; video.defaultMuted = true; video.volume = 0; } catch(e) {}
    video.play();
    video.style.borderColor = 'green';

    // Prefer VP8 for broader stability, fallback up/down as needed
    let mime = 'video/webm;codecs=vp8';
    if (!('MediaRecorder' in window)) {
      alert('MediaRecorder не поддерживается в этом браузере');
      return;
    }
    if (!MediaRecorder.isTypeSupported(mime)) {
      mime = 'video/webm;codecs=vp9';
    }
    if (!MediaRecorder.isTypeSupported(mime)) {
      mime = 'video/webm';
    }
    try { stream.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch(e) {} }); } catch(e) {}
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 5000000,
      audioBitsPerSecond: 192000
    });
    timerInterval = setInterval(timer, 1000);

    recorder.addEventListener('dataavailable', function (e) {
      recorded.push(e.data);
      if (recorded.length > 0) { recState.hasData = true; postState(); }
    });

    //recorder.addEventListener('stop', () => {
    //  saveFile();
    //  if (buttonSave.disabled) {
    //    recorded = []
    //  }
    //});
    recorded = [];
    enable(buttonStart);
    disable(buttonPause);
    disable(buttonStop);
    recState = { recording: false, paused: false, hasData: false };
    postState();
  } catch (error) {
    console.log(error);
    alert('Невозможно получить доступ к камере!');
  }
}

function onStartClick() {
  if (buttonStart.textContent == 'Начать запись') {
    recorder.start();
    buttonStart.textContent = 'Продолжить';
  } else {
    recorder.resume();
  }
  video.style.borderColor = 'red';

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

function onPauseClick() {
  recorder.pause();
  video.style.borderColor = 'green';
  enable(buttonStart);
  disable(buttonPause);
  recState.recording = false;
  recState.paused = true;
  postState();
}

function onStopClick() {
  recorder.pause();
  recorder.stop();
  setStoppedUI();
  recState.recording = false;
  recState.paused = false;
  recState.hasData = recorded.length > 0;
  postState();
}

function onSaveClick() {
  // If recording, stop first to flush data
  if (recorder && recorder.state === 'recording') {
    return stopRecorder().then(() => onSaveClick());
  }
  saveFile()
    .then((response) => {})
    .catch((e) => alert(e));
  if (buttonSave.disabled) {
    recorded = [];
  }
}

function timer() {
  if (recorder.state == 'recording') {
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

async function saveFile() {
  var buttonSave = document.getElementById('save');
  try {
    if (fileName.value.search(/[/\\:*?"<>|]/g) != -1) {
      throw 'Указано недопустимое имя файла!';
    }
    if (!recorded || recorded.length === 0) {
      throw 'Нет записанных данных';
    }
    let recordedData = new FormData();
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', progressHandler, false);
    xhr.addEventListener('load', loadHandler, false);

    const url = generateUrlString(
      fileName.value,
      fileText.value,
      document.getElementById('did'),
      document.getElementById('sdid')
    );

    let blob = new Blob(recorded, { type: 'video/webm' });

    // Create or update a single styled download button
    const settings = document.getElementsByClassName('record-page__settings')[0];
    if (settings) {
      let downloadLink = document.getElementById('download-record-link');
      if (!downloadLink) {
        downloadLink = document.createElement('a');
        downloadLink.id = 'download-record-link';
        downloadLink.className = 'button';
        settings.appendChild(downloadLink);
      }
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = fileName.value + '.webm';
      downloadLink.textContent = 'Скачать последнюю запись';
    }

    recordedData.append(fileName.value + '.webm', blob);

    xhr.open('POST', url);
    xhr.send(recordedData);
    recordedData = null;

    buttonSave.disabled = true;
    enable(buttonCamera);
    enable(buttonStart);
    // Clear buffer after send
    recorded = [];
    recState.hasData = false;
    postState();
  } catch (e) {
    alert('Сохранить видео не удалось (' + e + ')!');
  }
}

function generateUrlString(fileName, fileText, did, sdid) {
  const name = encodeURIComponent(fileName);
  const desc = encodeURIComponent(fileText);
  const base = window.location.origin;
  return `${base}/fls/rec/save/${name}/q${desc}/${did.value}/${sdid.value}`;
}

function progressHandler(event) {
  const loadedMB = (event.loaded / BYTES_IN_MB).toFixed(1);
  const totalSizeMb = event.total ? (event.total / BYTES_IN_MB).toFixed(1) : '0';
  const percentLoaded = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
  if (uploadProgressBar) uploadProgressBar.style.width = `${percentLoaded}%`;
}

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
      recorded = [];
      if (buttonSave) buttonSave.disabled = true;
      disable(buttonPause);
      disable(buttonStop);
      enable(buttonCamera);
      enable(buttonStart);
      video.style.borderColor = 'gray';
      resetTimer(true);
      recState = { recording: false, paused: false, hasData: false };
      postState();
      if (window.parent) {
        window.parent.postMessage({ type: 'rec:discarded' }, '*');
      }
    } catch(e) {}
  }
});

function resetTimer(resetDisplayOnly) {
  try { clearInterval(timerInterval); } catch(e) {}
  timerInterval = null;
  h = 0; m = 0; s = 0;
  try { document.getElementById('time').innerHTML = '00:00:00'; } catch(e) {}
}

function stopRecorder() {
  return new Promise((resolve) => {
    try {
      if (!recorder || recorder.state === 'inactive') { resolve(); return; }
      const handleStop = () => {
        try { recorder.removeEventListener('stop', handleStop); } catch(e) {}
        // Harmonize UI with manual stop
        try { setStoppedUI(); } catch(e) {}
        // recorder has fired dataavailable already in most browsers
        setTimeout(resolve, 0);
      };
      try { recorder.addEventListener('stop', handleStop); } catch(e) { resolve(); }
      try {
        recorder.pause();
      } catch(e) {}
      try {
        recorder.stop();
      } catch(e) { resolve(); }
    } catch(e) { resolve(); }
  });
}
