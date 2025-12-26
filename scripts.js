/* =========================================
   JAVASCRIPT (LOGIKA) - SpeakSmart PRO
   ========================================= */

/* KONFIGURASI DAN VARIABEL DOM */
const recordBtn = document.getElementById("recordBtn");
const downloadBtn = document.getElementById("downloadBtn");
const targetInput = document.getElementById("target");
const transcriptEl = document.getElementById("transcript");
const scoreEl = document.getElementById("score");
const feedbackEl = document.getElementById("feedback");
const player = document.getElementById("player");
const timerEl = document.getElementById("timer");
const transcriptionMode = document.getElementById("transcriptionMode");
const apiKeyInput = document.getElementById("apiKey");
const vuLevelEl = document.getElementById("vuLevel");

// Visualizer Canvas
const waveCanvas = document.getElementById("wave");
const waveCtx = waveCanvas.getContext("2d");

// Audio Variables
let mediaRecorder;
let audioChunks = [];
let recordedBlob = null;
let audioCtx;
let analyser;
let sourceNode;
let rafId = null; // Request Animation Frame ID

// State
let isRecording = false;
let startTime = null;
let timerInterval = null;

// Web Speech API Setup
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let finalTranscript = "";

if (window.SpeechRecognition) {
  recognition = new window.SpeechRecognition();
  recognition.lang = "en-US"; // Bahasa Inggris
  recognition.interimResults = true; // Tampilkan hasil sementara
  recognition.continuous = true;     // Jangan stop otomatis saat jeda sebentar

  recognition.onresult = (event) => {
    let interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    // Tampilkan hasil sementara
    transcriptEl.innerText = finalTranscript + interimTranscript;
    
    // Live feedback (opsional)
    if(finalTranscript || interimTranscript) {
         const currentText = finalTranscript + interimTranscript;
         onTranscriptionUpdate(currentText);
    }
  };

  recognition.onerror = (event) => {
    console.warn("Speech recognition error", event.error);
  };
} else {
  console.warn("Web Speech API tidak didukung di browser ini.");
  transcriptEl.innerText = "Browser ini tidak mendukung Web Speech API. Gunakan Chrome/Edge.";
}

/* ================= FUNGSI UTAMA ================= */

// 1. Toggle Rekam
recordBtn.addEventListener("click", async () => {
  if (!isRecording) {
    await startRecording();
  } else {
    stopRecording();
  }
});

// 2. Mulai Rekam
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Reset Data
    audioChunks = [];
    finalTranscript = "";
    transcriptEl.innerText = "Mendengarkan...";
    scoreEl.innerText = "-";
    feedbackEl.innerHTML = "Sedang merekam...";
    downloadBtn.disabled = true;

    // Setup Audio Context untuk Visualizer
    setupAudioContext(stream);

    // Setup MediaRecorder
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // Membuat Blob Audio
      recordedBlob = new Blob(audioChunks, { type: "audio/webm" });
      const audioUrl = URL.createObjectURL(recordedBlob);
      player.src = audioUrl;
      downloadBtn.disabled = false;

      // Hentikan Stream Mic
      stream.getTracks().forEach(track => track.stop());

      // Jika mode Whisper dipilih, kirim ke OpenAI
      if (transcriptionMode.value === "whisper") {
         await processWhisperAPI(recordedBlob);
      } else {
         // Jika Web Speech API, hasil sudah ada di finalTranscript
         onTranscriptionUpdate(finalTranscript || transcriptEl.innerText);
      }
    };

    mediaRecorder.start();

    // Mulai Web Speech API (jika mode default)
    if (transcriptionMode.value === "webSpeech" && recognition) {
      try { recognition.start(); } catch(e) { console.log("Recognition already started"); }
    }

    // Update UI
    isRecording = true;
    recordBtn.classList.add("recording");
    recordBtn.innerHTML = "⏹ Berhenti";
    startTimer();

  } catch (err) {
    alert("Gagal mengakses mikrofon: " + err.message);
    console.error(err);
  }
}

// 3. Berhenti Rekam
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  // Stop Tools
  if (mediaRecorder) mediaRecorder.stop();
  if (recognition) recognition.stop();
  
  // Stop Timer
  stopTimer();
  
  // Stop Visualizer
  if (audioCtx) audioCtx.close();
  cancelAnimationFrame(rafId);
  waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height); // Bersihkan kanvas

  // Update UI
  recordBtn.classList.remove("recording");
  recordBtn.innerHTML = "🎤 Mulai Rekam";
}

// 4. Download Handler
downloadBtn.addEventListener("click", () => {
  if (!recordedBlob) return;
  
  const url = URL.createObjectURL(recordedBlob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `speaksmart_recording_${Date.now()}.wav`; // Simpan sebagai .wav
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
});

/* ================= LOGIKA SKOR & FEEDBACK ================= */

function onTranscriptionUpdate(spokenText) {
  const targetText = targetInput.value;
  if (!spokenText.trim()) return;

  // Hitung Skor
  const score = calculateSimilarity(targetText, spokenText);
  scoreEl.innerText = score + "/100";

  // Generate Feedback HTML
  feedbackEl.innerHTML = generateWordFeedback(targetText, spokenText);
}

// Algoritma Levenshtein (Menghitung perbedaan string)
function calculateSimilarity(s1, s2) {
  let longer = s1.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  let shorter = s2.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  if (longer.length < shorter.length) [longer, shorter] = [shorter, longer];
  let longerLength = longer.length;
  if (longerLength === 0) return 100;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return Math.round(((longerLength - editDistance) / longerLength) * 100);
}

function levenshteinDistance(s, t) {
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const arr = [];
  for (let i = 0; i <= t.length; i++) {
    arr[i] = [i];
    for (let j = 1; j <= s.length; j++) {
      arr[i][j] =
        i === 0
          ? j
          : Math.min(
              arr[i - 1][j] + 1,
              arr[i][j - 1] + 1,
              arr[i - 1][j - 1] + (s[j - 1] === t[i - 1] ? 0 : 1)
            );
    }
  }
  return arr[t.length][s.length];
}

// Feedback visual per kata (Hijau = Pas, Merah = Beda)
function generateWordFeedback(target, spoken) {
  const tWords = target.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/);
  const sWords = spoken.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/);
  
  let html = "";
  tWords.forEach((word) => {
    if (sWords.includes(word)) {
      html += `<span style="color:green; font-weight:bold; margin-right:4px;">${word}</span> `;
    } else {
      html += `<span style="color:red; text-decoration:underline; margin-right:4px;">${word}</span> `;
    }
  });
  return html;
}

/* ================= VISUALIZER (GELOMBANG SUARA) ================= */

function setupAudioContext(stream) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  sourceNode = audioCtx.createMediaStreamSource(stream);
  sourceNode.connect(analyser);

  drawWaveform();
}

function drawWaveform() {
  if (!isRecording) return;
  
  rafId = requestAnimationFrame(drawWaveform);
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  // Hitung Volume (RMS) untuk display angka
  let sum = 0;
  for(let i=0; i<bufferLength; i++) {
      let x = (dataArray[i] - 128) / 128.0;
      sum += x * x;
  }
  let rms = Math.sqrt(sum / bufferLength);
  vuLevelEl.innerText = rms.toFixed(3);

  // Gambar Garis Gelombang
  waveCtx.fillStyle = "#ffffff";
  waveCtx.fillRect(0, 0, waveCanvas.width, waveCanvas.height);
  waveCtx.lineWidth = 2;
  waveCtx.strokeStyle = "#4c63ff";
  waveCtx.beginPath();

  const sliceWidth = (waveCanvas.width * 1.0) / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * waveCanvas.height) / 2;

    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);

    x += sliceWidth;
  }

  waveCtx.lineTo(waveCanvas.width, waveCanvas.height / 2);
  waveCtx.stroke();
}

/* ================= WHISPER API (OPSIONAL) ================= */
async function processWhisperAPI(blob) {
    const apiKey = apiKeyInput.value.trim();
    if(!apiKey) {
        transcriptEl.innerText = "Error: API Key kosong. Masukkan key atau ganti ke mode Web Speech.";
        return;
    }

    transcriptEl.innerText = "Mengirim ke OpenAI Whisper...";
    
    const formData = new FormData();
    formData.append("file", blob, "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "en"); // Paksa bahasa Inggris

    try {
        const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`
            },
            body: formData
        });

        const data = await response.json();
        if(data.text) {
            transcriptEl.innerText = data.text;
            onTranscriptionUpdate(data.text);
        } else {
            transcriptEl.innerText = "Gagal memproses: " + JSON.stringify(data);
        }
    } catch(e) {
        transcriptEl.innerText = "Error koneksi API: " + e.message;
    }
}

/* ================= UTILS (TIMER & SIDEBAR) ================= */

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const delta = Date.now() - startTime;
    const s = Math.floor(delta / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    timerEl.innerText = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

// Fungsi untuk Sidebar Prompt
function usePrompt(type) {
  let text = "";
  switch (type) {
    case 'latihan':
      text = "Hello, let me introduce myself. My name is Alex and I enjoy coding.";
      break;
    case 'perbaiki':
      text = targetInput.value.charAt(0).toUpperCase() + targetInput.value.slice(1).trim();
      if(!text.endsWith('.')) text += ".";
      break;
    case 'buatkalimat':
       const sentences = [
           "The early bird catches the worm.",
           "Actions speak louder than words.",
           "I would like to order a cup of coffee please.",
           "Can you tell me how to get to the nearest station?"
       ];
       text = sentences[Math.floor(Math.random() * sentences.length)];
       break;
    case 'pengucapan':
      text = "She sells seashells by the seashore.";
      break;
    case 'bisnis':
      text = "We need to schedule a meeting to discuss the project timeline.";
      break;
  }
  targetInput.value = text;
}