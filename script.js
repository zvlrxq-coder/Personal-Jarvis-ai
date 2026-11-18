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
let busy = false;            // true while thinking or speaking
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

// Show text in the response box, with an optional tap-to-open link
function showResponse(text, link) {
  responseBox.textContent = text;
  if (link) {
    responseBox.appendChild(document.createElement("br"));
    const a = document.createElement("a");
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "open-link";
    a.textContent = "▶ OPEN " + link.label.toUpperCase();
    responseBox.appendChild(a);
  }
}


// ==================================
// CHIME
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
// COMMAND HELPERS: NUMBERS + DURATIONS
// ==================================

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60
};

function normalizeNumbers(t) {
  let s = t.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)\b/g,
    w => String(NUMBER_WORDS[w])
  );
  // "20 5" -> 25
  s = s.replace(/\b([2-6]0)\s+([1-9])\b/g, (m, a, b) => String(+a + +b));
  return s;
}

function fmtDur(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h) parts.push(h + (h === 1 ? " hour" : " hours"));
  if (m) parts.push(m + (m === 1 ? " minute" : " minutes"));
  if (s) parts.push(s + (s === 1 ? " second" : " seconds"));
  return parts.join(" ") || "0 seconds";
}

function parseDuration(t) {
  const re = /(\d+(?:\.\d+)?|half an?|an?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/g;
  let sec = 0;
  let found = false;
  let m;

  while ((m = re.exec(t)) !== null) {
    let val;
    if (m[1].indexOf("half") === 0) val = 0.5;
    else if (m[1] === "a" || m[1] === "an") val = 1;
    else val = parseFloat(m[1]);

    const u = m[2][0];
    if (u === "h") sec += val * 3600;
    else if (u === "m") sec += val * 60;
    else sec += val;
    found = true;
  }

  return found ? Math.round(sec) : 0;
}


// ==================================
// TIMERS + REMINDERS
// ==================================

let timers = [];

function saveTimers() {
  try {
    localStorage.setItem(
      "jarvis_timers",
      JSON.stringify(timers.map(t => ({ id: t.id, endsAt: t.endsAt, label: t.label, note: t.note })))
    );
  } catch (e) {}
}

function fireTimer(t) {
  timers = timers.filter(x => x.id !== t.id);
  saveTimers();

  chime();
  setTimeout(chime, 450);
  setTimeout(chime, 900);
  try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) {}

  const msg = t.note
    ? "Sir, reminder: " + t.note + "."
    : "Sir, your timer for " + t.label + " is done.";

  responseBox.textContent = msg;
  setTimeout(function () { speak(msg); }, 1300);
}

function armTimer(t) {
  const ms = Math.max(0, t.endsAt - Date.now());
  t.handle = setTimeout(function () { fireTimer(t); }, ms);
}

function addTimer(sec, note) {
  const t = {
    id: Date.now() + Math.random(),
    endsAt: Date.now() + sec * 1000,
    label: fmtDur(sec),
    note: note || ""
  };
  timers.push(t);
  armTimer(t);
  saveTimers();
  return t;
}

// Re-arm timers saved before a page reload
try {
  const saved = JSON.parse(localStorage.getItem("jarvis_timers") || "[]");
  saved.forEach(function (t) {
    if (t.endsAt > Date.now()) {
      timers.push(t);
      armTimer(t);
    }
  });
  saveTimers();
} catch (e) {}

function timerCommand(t, n) {
  // Cancel
  if (/\b(cancel|stop|clear|delete|remove)\b.*\btimers?\b|\bturn off (?:the )?timer\b/.test(t)) {
    if (!timers.length) return { say: "You have no timers running, sir." };
    timers.forEach(x => clearTimeout(x.handle));
    timers = [];
    saveTimers();
    return { say: "All timers cancelled, sir." };
  }

  // Status
  if (/\btimers?\b/.test(t) && /\b(left|remaining|how much|how long|status|running)\b/.test(t)) {
    if (!timers.length) return { say: "You have no timers running, sir." };
    const next = timers.slice().sort((a, b) => a.endsAt - b.endsAt)[0];
    const left = Math.max(0, (next.endsAt - Date.now()) / 1000);
    return { say: fmtDur(left) + " remaining on your timer." };
  }

  // Reminder: "remind me in 10 minutes to drink water"
  let m = n.match(/remind me (?:in|after)\s+(.+?)\s+(?:to|that)\s+(.+)$/);
  if (m) {
    const sec = parseDuration(m[1]);
    if (!sec) return { say: "How long from now, sir? Say, for example, remind me in 10 minutes to stretch." };
    const tm = addTimer(sec, m[2].trim());
    return { say: "Understood. I'll remind you in " + tm.label + "." };
  }

  // Set timer
  if (/\b(timer|countdown)\b/.test(t) || /\b(set|start)\b.*\b(alarm)\b.*\bin\b/.test(t)) {
    const sec = parseDuration(n);
    if (!sec) {
      return { say: "For how long, sir? Say, for example, set a timer for 5 minutes." };
    }
    const tm = addTimer(sec);
    return { say: "Timer set for " + tm.label + "." };
  }

  return null;
}


// ==================================
// OPEN APPS / SEARCH / SETTINGS LINKS
// ==================================

const APPS = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  gmail: "https://mail.google.com",
  mail: "https://mail.google.com",
  email: "https://mail.google.com",
  maps: "https://maps.google.com",
  googlemaps: "https://maps.google.com",
  whatsapp: "https://wa.me/",
  instagram: "https://www.instagram.com",
  insta: "https://www.instagram.com",
  facebook: "https://www.facebook.com",
  twitter: "https://x.com",
  x: "https://x.com",
  spotify: "https://open.spotify.com",
  netflix: "https://www.netflix.com",
  amazon: "https://www.amazon.in",
  flipkart: "https://www.flipkart.com",
  wikipedia: "https://www.wikipedia.org",
  github: "https://github.com",
  calendar: "https://calendar.google.com",
  drive: "https://drive.google.com",
  photos: "https://photos.google.com",
  news: "https://news.google.com",
  translate: "https://translate.google.com",
  classroom: "https://classroom.google.com",
  meet: "https://meet.google.com",
  playstore: "https://play.google.com/store",
  googleplay: "https://play.google.com/store"
};

const SETTINGS_LIST = [
  { re: /wi-?fi|wifi|wireless/, action: "WIFI_SETTINGS", name: "Wi-Fi settings" },
  { re: /bluetooth/, action: "BLUETOOTH_SETTINGS", name: "Bluetooth settings" },
  { re: /airplane|flight mode/, action: "AIRPLANE_MODE_SETTINGS", name: "airplane mode settings" },
  { re: /display|brightness|screen timeout/, action: "DISPLAY_SETTINGS", name: "display settings" },
  { re: /sound|volume|silent/, action: "SOUND_SETTINGS", name: "sound settings" },
  { re: /location|gps/, action: "LOCATION_SOURCE_SETTINGS", name: "location settings" },
  { re: /battery saver|power saver/, action: "BATTERY_SAVER_SETTINGS", name: "battery saver settings" },
  { re: /\bsettings\b/, action: "SETTINGS", name: "settings" }
];

function openLink(url, label) {
  let w = null;
  try { w = window.open(url, "_blank"); } catch (e) {}
  if (w) return { say: "Opening " + label + ", sir." };
  // Chrome blocked the pop-up: give a tap link instead
  return { say: "Tap the link to open " + label + ".", link: { url: url, label: label } };
}

function settingsCommand(t) {
  const verb = /\b(turn|switch|toggle|enable|disable|open|go to|change|show|take me to)\b/.test(t);
  if (!verb || t.split(/\s+/).length > 8) return null;

  for (const s of SETTINGS_LIST) {
    if (s.re.test(t)) {
      const url = "intent:#Intent;action=android.settings." + s.action + ";end";
      return {
        say: "I can't switch that myself, sir, but tap the link to open " + s.name + ".",
        link: { url: url, label: s.name }
      };
    }
  }
  return null;
}

function openCommand(t) {
  const m = t.match(/^(?:please\s+)?(?:open|launch|go to)\s+(.+)$/);
  if (!m) return null;

  let name = m[1]
    .replace(/\b(the|app|website|site|please|for me)\b/g, "")
    .replace(/\.com$/, "")
    .replace(/\s+/g, "")
    .trim();

  if (APPS[name]) return openLink(APPS[name], m[1].replace(/\b(the|app|please)\b/g, "").trim());

  // Looks like a web address, e.g. "open example.com"
  const dom = m[1].replace(/\s+/g, "");
  if (/^[a-z0-9-]+\.[a-z]{2,}(\/\S*)?$/.test(dom)) {
    return openLink("https://" + dom, dom);
  }

  return { say: "I don't know how to open that yet, sir." };
}

function searchCommand(t) {
  let m;

  // Call a number
  m = t.match(/^(?:call|dial|phone)\s+([\d\s+()-]{6,})$/);
  if (m) {
    const num = m[1].replace(/[^\d+]/g, "");
    return openLink("tel:" + num, "dialer for " + num);
  }

  // YouTube
  m = t.match(/^(?:search|find|play|watch)\s+(.+?)\s+on\s+youtube$/) ||
      t.match(/^(?:search youtube for|youtube search|play|watch)\s+(.+)$/);
  if (m) {
    const q = m[1].trim();
    return openLink(
      "https://www.youtube.com/results?search_query=" + encodeURIComponent(q),
      "YouTube results for " + q
    );
  }

  // Directions
  m = t.match(/(?:directions? to|navigate to|take me to|route to|how do i get to|how to get to)\s+(.+)$/);
  if (m) {
    const q = m[1].trim();
    return openLink(
      "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q),
      "directions to " + q
    );
  }

  // Places nearby
  m = t.match(/^(?:find|show|search)\s+(.+?)\s+(?:near me|nearb
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
