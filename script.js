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
// ELEMENTS + ORB MODE
// ==================================

const voiceBtn = document.getElementById("voiceBtn");
const voiceSelect = document.getElementById("voiceSelect");
const state = document.getElementById("state");
const voiceStatus = document.getElementById("voiceStatus");
const transcriptBox = document.getElementById("transcript");
const responseBox = document.getElementById("response");
const clearBtn = document.getElementById("clearBtn");
const orb = document.getElementById("orb");

function setMode(mode) {
  document.body.dataset.mode = mode; // idle | listening | thinking | speaking
}

orb.onclick = function () {
  voiceBtn.click();
};


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

  // English voices first; if none, show everything
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

  // Restore saved choice if it still exists
  const exists = list.some(v => v.name === chosenVoiceName);
  voiceSelect.value = exists ? chosenVoiceName : "";
  if (!exists) chosenVoiceName = "";
}

if ("speechSynthesis" in window) {
  buildVoiceList();
  speechSynthesis.onvoiceschanged = buildVoiceList;
  // Android sometimes loads voices late
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
// SPEAK (with Android unlock)
// ==================================

function unlockSpeech() {
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch (e) {}
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    state.textContent = "VOICE OUTPUT NOT SUPPORTED";
    setMode("idle");
    return;
  }

  const clean = text.replace(/[*_#`]/g, "");

  speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice();
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.rate = 1;
  u.pitch = 1;
  u.volume = 1;

  u.onstart = function () {
    setMode("speaking");
    state.textContent = "JARVIS IS SPEAKING...";
  };
  u.onend = function () {
    setMode("idle");
    state.textContent = "AWAITING YOUR COMMAND";
  };
  u.onerror = function (e) {
    setMode("idle");
    state.textContent = "VOICE ERROR: " + (e.error || "unknown");
  };

  setTimeout(function () {
    speechSynthesis.speak(u);
  }, 100);
}


// ==================================
// AI BRAIN (GEMINI)
// ==================================

async function askJarvis(text) {
  if (!getKey()) {
    responseBox.textContent = "API key needed. Tap the orb and try again.";
    setMode("idle");
    return;
  }

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

    state.textContent = "AWAITING YOUR COMMAND";
    setMode("idle");
  }
}


// ==================================
// VOICE RECOGNITION
// ==================================

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition;
let listening = false;
let finalText = "";

if (SpeechRecognition) {

  recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = function () {
    listening = true;
    speechSynthesis.cancel();
    setMode("listening");

    state.textContent = "LISTENING TO YOUR COMMAND...";
    voiceStatus.textContent = "LISTENING";
    voiceBtn.textContent = "STOP LISTENING";
    voiceBtn.classList.add("listening-active");
    responseBox.textContent = "JARVIS is listening.";
  };

  recognition.onresult = function (event) {
    let interimText = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += text + " ";
      } else {
        interimText += text;
      }
    }

    transcriptBox.textContent = (finalText + interimText).trim();
  };

  recognition.onerror = function (event) {
    const errors = {
      "not-allowed": "Microphone permission denied.",
      "no-speech": "No speech detected. Try again.",
      "network": "Speech recognition network error.",
      "audio-capture": "Microphone unavailable."
    };

    responseBox.textContent =
      errors[event.error] || "Voice recognition error: " + event.error;
  };

  recognition.onend = function () {
    listening = false;

    voiceStatus.textContent = "STANDBY";
    voiceBtn.textContent = "ACTIVATE MICROPHONE";
    voiceBtn.classList.remove("listening-active");
    state.textContent = "AWAITING YOUR COMMAND";

    if (finalText.trim()) {
      askJarvis(finalText.trim());
    } else {
      setMode("idle");
    }
  };

  voiceBtn.onclick = function () {
    unlockSpeech();

    if (listening) {
      recognition.stop();
      return;
    }

    finalText = "";
    transcriptBox.textContent = "Listening for your words...";

    try {
      recognition.start();
    } catch (error) {
      responseBox.textContent = "Please wait a moment and try again.";
    }
  };

} else {
  voiceBtn.disabled = true;
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
  setMode("idle");
  transcriptBox.textContent = "Your spoken words will appear here...";
  responseBox.textContent = "Memory cleared. Awaiting input.";
};
