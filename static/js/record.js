function disable(x) {
  x.disabled = true;
  x.style.display = 'none';
}

function enable(x) {
  x.disabled = false;
  x.style.display = 'inline-block';
}

window.onbeforeunload = function () {
  return true;
};

const server = 'znv.vts.vitebsk.energo.net';

const BYTES_IN_MB = 1048576;

var buttonCamera = document.getElementById('camera');
var buttonStart = document.getElementById('start');
var buttonPause = document.getElementById('pause');
var buttonStop = document.getElementById('stop');
var buttonSave = document.getElementById('save');
var video = document.getElementById('video');
var fileName = document.getElementById('name');
var dirName = document.getElementById('type');
var fileText = document.getElementById('desc');

const sizeText = document.getElementById('uploadForm_Size');
const statusText = document.getElementById('uploadForm_Status');
const progressBar = document.getElementById('progressBar');

var h = 0;
var m = 0;
var s = 0;
var recorded = [];

disable(buttonStart);
disable(buttonPause);
disable(buttonStop);
buttonSave.disabled = true;

fileName.value = name();

let timerInterval;

buttonCamera.onclick = async function () {
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
      var stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: {
          channels: 2,
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      buttonCamera.textContent = 'Выключить камеру';
    }
    video.srcObject = stream;
    video.play();
    video.style.borderColor = 'green';

    recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    timerInterval = setInterval(timer, 1000);

    recorder.addEventListener('dataavailable', function (e) {
      recorded.push(e.data);
    });

    //recorder.addEventListener('stop', () => {
    //  saveFile();
    //  if (buttonSave.disabled) {
    //    recorded = []
    //  }
    //});
    enable(buttonStart);
    disable(buttonPause);
    disable(buttonStop);
  } catch (error) {
    console.log(error);
    alert('Невозможно получить доступ к камере!');
  }
};

buttonStart.onclick = function () {
  if (buttonStart.textContent == 'Начать запись') {
    recorder.start();
    buttonStart.textContent = 'Продолжить';
  } else {
    recorder.resume();
  }
  video.style.borderColor = 'red';

  progressBar.value = 0;
  sizeText.textContent = '';
  statusText.textContent = '';
  disable(buttonCamera);
  disable(buttonStart);
  enable(buttonPause);
  enable(buttonStop);
};

buttonPause.onclick = function () {
  recorder.pause();
  video.style.borderColor = 'green';
  enable(buttonStart);
  disable(buttonPause);
};

buttonStop.onclick = function () {
  recorder.pause();
  recorder.stop();
  video.style.borderColor = 'green';
  buttonStart.textContent = 'Начать запись';
  disable(buttonPause);
  disable(buttonStop);
  buttonSave.disabled = false;
  h = 0;
  m = 0;
  s = 0;
};

buttonSave.onclick = function () {
  saveFile()
    .then((response) => {})
    .catch((e) => alert(e));
  if (buttonSave.disabled) {
    recorded = [];
  }
};

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
    let recordedData = new FormData();
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', progressHandler, false);
    xhr.addEventListener('load', loadHandler, false);

    const url = generateUrlString(
      server,
      fileName.value,
      fileText.value,
      document.getElementById('did'),
      document.getElementById('sdid')
    );

    let blob = new Blob(recorded, { type: 'video/webm' });

    const downloadLink = document.createElement('a');
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = fileName.value + '.webm';
    downloadLink.innerHTML = 'Скачать на компьютер';
    document
      .getElementsByClassName('record-page__settings')[0]
      .appendChild(downloadLink);

    recordedData.append(fileName.value + '.webm', blob);

    xhr.open('POST', url);
    xhr.send(recordedData);
    recordedData = null;

    buttonSave.disabled = true;
    enable(buttonCamera);
    enable(buttonStart);
  } catch (e) {
    alert('Сохранить видео не удалось (' + e + ')!');
  }
}

function generateUrlString(server, fileName, fileText, did, sdid) {
  return `https://${server}/fls/rec/save/${fileName}/q${fileText}/${did.value}/${sdid.value}`;
}

function progressHandler(event) {
  const loadedMB = (event.loaded / BYTES_IN_MB).toFixed(1);
  const totalSizeMb = (event.total / BYTES_IN_MB).toFixed(1);
  const percentLoaded = Math.round((event.loaded / event.total) * 100);

  progressBar.value = percentLoaded;
  sizeText.textContent = `${loadedMB} из ${totalSizeMb} МБ`;
  statusText.textContent = `Загружено ${percentLoaded}% | `;
}

function loadHandler(event) {
  statusText.textContent =
    event.target.status == 200
      ? 'Загружено'
      : 'Ошибка' + event.target.responseText;
  progressBar.value = 0;
}
