// ==================================
// CLOCK
// ==================================

function updateClock() {
  const now = new Date();

  document.getElementById("clock").textContent =
    now.toLocaleTimeString("en-IN", { hour12: false });

  document.getElementById("date").textContent =
    now.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).toUpperCase();
}

updateClock();
setInterval(updateClock, 1000);


// ==================================
// ELEMENTS + MODES
// ==================================

const voiceBtn = document.getElementById("voiceBtn");
const handsBtn = document.getElementById("handsBtn");
const voiceSelect = document.getElementById("voiceSelect");
const state = document.getElementById("state");
const voiceStatus = document.getElementById("voiceStatus");
const transcriptBox = document.getElementById("transcript");
const responseBox = document.getElementById("response");
const clearBtn = document.getElementById("clearBtn");
const orb = document.getElementById("orb");

let handsFree = false;
let busy = false;           // true while thinking or speaking
let awaitingCommand = false; // heard "Jarvis" alone, waiting for the command
let restartTimer = null;

function setMode(mode) {
  document.body.dataset.mode = mode; // idle | wake | listening | thinking | speaking
}

function idle() {
  setMode(handsFree ? "wake" : "idle");
  state.textContent = handsFree ? "SAY 'JARVIS' TO WAKE ME" : "AWAITING YOUR COMMAND";
}

function finishTurn() {
  busy = false;
  idle();
  if (handsFree) scheduleWake(500);
}

orb.onclick = function () {
  voiceBtn.click();
};


// ==================================
// CHIME (wake sound)
// ==================================

let audioCtx = null;

function initAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {}
}

function chime() {
  try {
    initAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.15);
  } catch (e) {}
}


// ==================================
// API KEY
// ==================================

let API_KEY = localStorage.getItem("gemini_key");

function getKey() {
  if (!API_KEY || API_KEY === "null") {
    const k = prompt("Paste your Gemini API key");
    if (k && k.trim()) {
      API_KEY = k.trim();
      localStorage.setItem("gemini_key", API_KEY);
    } else {
      API_KEY = null;
    }
  }
  return API_KEY;
}


// ==================================
// MEMORY (conversation history)
// ==================================

const MAX_HISTORY = 12; // last 12 messages (6 exchanges)
let history = [];

try {
  history = JSON.parse(localStorage.getItem("jarvis_history") || "[]");
  if (!Array.isArray(history)) history = [];
} catch (e) {
  history = [];
}

function saveHistory() {
  if (history.length > MAX_HISTORY) {
    history = history.slice(history.length - MAX_HISTORY);
  }
  while (history.length && history[0].role !== "user") history.shift();
  try {
    localStorage.setItem("jarvis_history", JSON.stringify(history));
  } catch (e) {}
  document.title = "JARVIS AI (" + history.length + " in memory)";
}

saveHistory();


// ==================================
// MODEL LIST + DAILY LIMIT TRACKING
// ==================================

let MODELS = ["gemini-3.8-flash"];
let modelsLoaded = false;

const COOLDOWN_MS = 3 * 60 * 60 * 1000;

function getExhausted() {
  try {
    const all = JSON.parse(localStorage.getItem("jarvis_exhausted") || "{}");
    const now = Date.now();
    const fresh = {};
    Object.keys(all).forEach(m => {
      if (now - all[m] < COOLDOWN_MS) fresh[m] = all[m];
    });
    return fresh;
  } catch (e) {
    return {};
  }
}

function markExhausted(model) {
  const all = getExhausted();
  all[model] = Date.now();
  try {
    localStorage.setItem("jarvis_exhausted", JSON.stringify(all));
  } catch (e) {}
}

async function loadModels() {
  modelsLoaded = true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=" + API_KEY,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    const d = await r.json();

    const found = (d.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name.replace("models/", ""))
      .filter(n =>
        n.includes("flash") &&
        !n.includes("image") &&
        !n.includes("tts") &&
        !n.includes("live") &&
        !n.includes("audio")
      );

    if (found.length) {
      const lite = found.filter(n => n.includes("lite"));
      const rest = found.filter(n => !n.includes("lite"));
      MODELS = lite.concat(rest).slice(0, 6);
    }
  } catch (e) {
    // keep the default list
  }
}


// ==================================
// TRY MODELS ONE AT A TIME
// ==================================

async function tryModels(body) {
  const exhausted = getExhausted();
  const candidates = MODELS.filter(m => !exhausted[m]);

  if (!candidates.length) {
    throw new Error("QUOTA_ALL");
  }

  let lastErr = "Unknown error";
  let quotaHits = 0;

  for (const model of candidates) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal
      });
      clearTimeout(timer);

      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (res.ok && reply) {
        return { model, reply };
      }

      if (res.status === 429) {
        markExhausted(model);
        quotaHits++;
        lastErr = "Quota reached on " + model;
        responseBox.textContent = "Limit reached on one model, trying another...";
        continue;
      }

      if (res.status === 503 || res.status === 404) {
        lastErr = data.error?.message || ("Error " + res.status);
        responseBox.textContent = "Model busy, trying another...";
        continue;
      }

      throw new Error(data.error?.message || ("Error " + res.status));

    } catch (err) {
      if (err.name === "AbortError") {
        lastErr = "Timed out";
        continue;
      }
      throw err;
    }
  }

  if (quotaHits === candidates.length) throw new Error("QUOTA_ALL");
  throw new Error(lastErr);
}


// ==================================
// VOICES + VOICE PICKER
// ==================================

let voices = [];
let chosenVoiceName = localStorage.getItem("jarvis_voice") || "";

function buildVoiceList() {
  if (!("speechSynthesis" in window)) {
    voiceSelect.innerHTML = "<option>Voice not supported</option>";
    return;
  }

  voices = speechSynthesis.getVoices() || [];

  if (!voices.length) {
    voiceSelect.innerHTML = "<option>No voices found yet...</option>";
    return;
  }

  let list = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith("en"));
  if (!list.length) list = voices.slice();

  voiceSelect.innerHTML = "";

  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "AUTO (best English voice)";
  voiceSelect.appendChild(auto);

  list.forEach(v => {
    const o = document.createElement("option");
    o.value = v.name;
    o.textContent = v.name + " (" + v.lang + ")";
    voiceSelect.appendChild(o);
  });

  const exists = list.some(v => v.name === chosenVoiceName);
  voiceSelect.value = exists ? chosenVoiceName : "";
  if (!exists) chosenVoiceName = "";
}

if ("speechSynthesis" in window) {
  buildVoiceList();
  speechSynthesis.onvoiceschanged = buildVoiceList;
  setTimeout(buildVoiceList, 800);
  setTimeout(buildVoiceList, 2500);
}

voiceSelect.onchange = function () {
  chosenVoiceName = voiceSelect.value;
  try {
    localStorage.setItem("jarvis_voice", chosenVoiceName);
  } catch (e) {}
  speak("Good day, sir. This is how I sound.");
};

function pickVoice() {
  if (!voices.length) voices = speechSynthesis.getVoices() || [];

  if (chosenVoiceName) {
    const chosen = voices.find(v => v.name === chosenVoiceName);
    if (chosen) return chosen;
  }

  return (
    voices.find(v => v.lang === "en-IN") ||
    voices.find(v => v.lang === "en-GB") ||
    voices.find(v => v.lang === "en-US") ||
    voices.find(v => v.lang && v.lang.startsWith("en")) ||
    null
  );
}


// ==================================
// SPEAK
// ==================================

let currentUtterance = null; // keeps Chrome from dropping the utterance mid-speech

function unlockSpeech() {
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch (e) {}
}

function speak(text, useDefault) {
  if (!("speechSynthesis" in window)) {
    state.textContent = "VOICE OUTPUT NOT SUPPORTED";
    finishTurn();
    return;
  }

  // Stop the mic while Jarvis talks so it doesn't hear itself
  busy = true;
  clearTimeout(restartTimer);
  try { if (recognition) recognition.abort(); } catch (e) {}

  const clean = text.replace(/[*_#`]/g, "");

  speechSynthesis.cancel();
  speechSynthesis.resume();

  const u = new SpeechSynthesisUtterance(clean);
  currentUtterance = u;

  if (useDefault) {
    u.lang = "en-US";
  } else {
    const v = pickVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
  }

  u.rate = 1;
  u.pitch = 1;
  u.volume = 1;

  u.onstart = function () {
    setMode("speaking");
    state.textContent = "JARVIS IS SPEAKING...";
  };

  u.onend = function () {
    finishTurn();
  };

  u.onerror = function (e) {
    if (e.error === "canceled" || e.error === "interrupted") return;

    if (!useDefault) {
      speak(text, true);
      return;
    }

    finishTurn();
    state.textContent = "VOICE ERROR: " + (e.error || "unknown");
  };

  setTimeout(function () {
    speechSynthesis.speak(u);
    speechSynthesis.resume();
  }, 150);
}


// ==================================
// AI BRAIN (GEMINI)
// ==================================

async function askJarvis(text) {
  if (!getKey()) {
    responseBox.textContent = "API key needed. Tap the orb and try again.";
    finishTurn();
    return;
  }

  busy = true;
  setMode("thinking");
  responseBox.textContent = "JARVIS is thinking...";
  state.textContent = "PROCESSING...";

  history.push({ role: "user", parts: [{ text }] });
  saveHistory();

  const body = JSON.stringify({
    systemInstruction: {
      parts: [{ text: "You are JARVIS, a witty, polite AI assistant. Keep answers short (1-3 sentences) because they will be spoken aloud. No markdown. Use the earlier conversation for context." }]
    },
    contents: history
  });

  try {
    if (!modelsLoaded) await loadModels();

    const result = await tryModels(body);

    history.push({ role: "model", parts: [{ text: result.reply }] });
    saveHistory();

    responseBox.textContent = result.reply;
    speak(result.reply);

  } catch (err) {
    history.pop();
    saveHistory();

    if (err.message === "QUOTA_ALL") {
      responseBox.textContent =
        "Daily free limit reached on all available models. It resets within a day. Try again later.";
    } else {
      responseBox.textContent = "AI error: " + err.message;
    }

    finishTurn();
  }
}


// ==================================
// VOICE RECOGNITION (manual + hands-free)
// ==================================

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

const WAKE = /\b(jarvis|jarvish|jarvas|jarviz|jervis|garvis)\b/i;

let recognition;
let running = false;        // is the recognizer currently on?
let manualSession = false;  // started by tapping the mic button
let switching = false;      // switching from wake listening to manual
let finalText = "";
let errorStreak = 0;

function scheduleWake(ms) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(startWake, ms || 400);
}

function startWake() {
  if (!handsFree || busy || running || manualSession || switching) return;
  try {
    recognition.start();
  } catch (e) {
    scheduleWake(800);
  }
}

function updateHandsUI() {
  handsBtn.textContent = "HANDS-FREE: " + (handsFree ? "ON" : "OFF");
  handsBtn.classList.toggle("on", handsFree);
  voiceStatus.textContent = handsFree ? "WAKE WORD" : "STANDBY";
  if (!busy) idle();
}

if (SpeechRecognition) {

  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = function () {
    running = true;

    if (manualSession) {
      speechSynthesis.cancel();
      setMode("listening");
      state.textContent = "LISTENING TO YOUR COMMAND...";
      voiceStatus.textContent = "LISTENING";
      voiceBtn.textContent = "STOP LISTENING";
      voiceBtn.classList.add("listening-active");
      responseBox.textContent = "JARVIS is listening.";
    } else {
      finalText = "";
    }
  };

  recognition.onresult = function (event) {
    errorStreak = 0;
    let interimText = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += text + " ";
      } else {
        interimText += text;
      }
    }

    const shown = (finalText + interimText).trim();

    // In hands-free, only show speech that involves Jarvis
    if (manualSession || awaitingCommand || WAKE.test(shown)) {
      transcriptBox.textContent = shown;
    }
  };

  recognition.onerror = function (event) {
    if (event.error === "aborted") return;

    if (event.error === "no-speech") {
      if (manualSession) responseBox.textContent = "No speech detected. Try again.";
      return;
    }

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      handsFree = false;
      updateHandsUI();
      responseBox.textContent = "Microphone permission denied.";
      return;
    }

    const errors = {
      "network": "Speech recognition network error.",
      "audio-capture": "Microphone unavailable."
    };

    responseBox.textContent =
      errors[event.error] || "Voice recognition error: " + event.error;

    errorStreak++;
    if (handsFree && errorStreak > 6) {
      handsFree = false;
      updateHandsUI();
      responseBox.textContent = "Hands-free turned off after repeated errors.";
    }
  };

  recognition.onend = function () {
    running = false;

    if (switching) return; // the mic button is taking over

    // ---------- manual (button) session ----------
    if (manualSession) {
      manualSession = false;
      voiceBtn.textContent = "ACTIVATE MICROPHONE";
      voiceBtn.classList.remove("listening-active");
      voiceStatus.textContent = handsFree ? "WAKE WORD" : "STANDBY";

      const t = finalText.trim();
      if (t) {
        askJarvis(t);
      } else {
        idle();
        if (handsFree) scheduleWake(400);
      }
      return;
    }

    // ---------- hands-free session ----------
    if (!handsFree || busy) return;

    const t = finalText.trim();
    finalText = "";

    if (!t) {
      if (awaitingCommand) {
        awaitingCommand = false;
        idle();
      }
      scheduleWake(300);
      return;
    }

    if (awaitingCommand) {
      awaitingCommand = false;
      transcriptBox.textContent = t;
      askJarvis(t);
      return;
    }

    const m = t.match(WAKE);
    if (!m) {
      scheduleWake(300);
      return;
    }

    const cmd = t
      .slice(m.index + m[0].length)
      .replace(/^[\s,.:;!?-]+/, "")
      .trim();

    transcriptBox.textContent = t;

    if (cmd.length > 1) {
      askJarvis(cmd);
    } else {
      chime();
      awaitingCommand = true;
      setMode("listening");
      state.textContent = "YES, SIR?";
      scheduleWake(150);
    }
  };

  // ----- Mic button: one-shot command -----
  voiceBtn.onclick = function () {
    unlockSpeech();
    initAudio();

    if (manualSession && running) {
      recognition.stop();
      return;
    }

    clearTimeout(restartTimer);
    awaitingCommand = false;

    const begin = function () {
      switching = false;
      manualSession = true;
      finalText = "";
      transcriptBox.textContent = "Listening for your words...";
      try {
        recognition.start();
      } catch (error) {
        manualSession = false;
        responseBox.textContent = "Please wait a moment and try again.";
        if (handsFree) scheduleWake(800);
      }
    };

    if (running) {
      switching = true;
      try { recognition.abort(); } catch (e) {}
      setTimeout(begin, 350);
    } else {
      begin();
    }
  };

  // ----- Hands-free toggle -----
  handsBtn.onclick = function () {
    unlockSpeech();
    initAudio();

    handsFree = !handsFree;
    awaitingCommand = false;
    errorStreak = 0;
    updateHandsUI();

    if (handsFree) {
      scheduleWake(200);
    } else {
      clearTimeout(restartTimer);
      if (!manualSession) {
        try { recognition.abort(); } catch (e) {}
      }
    }
  };

} else {
  voiceBtn.disabled = true;
  handsBtn.disabled = true;
  state.textContent = "VOICE RECOGNITION NOT SUPPORTED";
  voiceStatus.textContent = "UNAVAILABLE";
  responseBox.textContent =
    "Your browser does not support Web Speech Recognition. Try an updated Chrome browser.";
}


// ==================================
// CLEAR CONSOLE (also wipes memory)
// ==================================

clearBtn.onclick = function () {
  finalText = "";
  history = [];
  try { localStorage.removeItem("jarvis_history"); } catch (e) {}
  saveHistory();
  speechSynthesis.cancel();
  busy = false;
  idle();
  transcriptBox.textContent = "Your spoken words will appear here...";
  responseBox.textContent = "Memory cleared. Awaiting input.";
  if (handsFree) scheduleWake(500);
};
