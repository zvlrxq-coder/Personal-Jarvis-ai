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
// MODEL LIST (fast models first)
// ==================================

let MODELS = ["gemini-3.8-flash"];
let modelsLoaded = false;

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
      MODELS = lite.concat(rest).slice(0, 3);
    }
  } catch (e) {
    // keep the default list
  }
}


// ==================================
// RACE MODELS (first good answer wins)
// ==================================

function raceModels(models, body, ms) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    let failed = 0;
    let lastErr = "Unknown error";
    let done = false;

    models.forEach(model => {
      const c = new AbortController();
      controllers.push(c);
      const timer = setTimeout(() => c.abort(), ms);

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: c.signal
      })
        .then(async res => {
          const data = await res.json();
          clearTimeout(timer);

          const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

          if (res.ok && reply) {
            if (!done) {
              done = true;
              controllers.forEach(x => { if (x !== c) x.abort(); });
              resolve({ model, reply });
            }
            return;
          }

          throw new Error(data.error?.message || ("Error " + res.status));
        })
        .catch(err => {
          clearTimeout(timer);
          lastErr = err.name === "AbortError" ? "Timed out" : err.message;
          failed++;
          if (!done && failed === models.length) reject(new Error(lastErr));
        });
    });
  });
}


// ==================================
// SPEAK
// ==================================

function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-IN";
  u.onstart = function () {
    setMode("speaking");
    state.textContent = "JARVIS IS SPEAKING...";
  };
  u.onend = u.onerror = function () {
    setMode("idle");
    state.textContent = "AWAITING YOUR COMMAND";
  };
  speechSynthesis.speak(u);
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

  const body = JSON.stringify({
    systemInstruction: {
      parts: [{ text: "You are JARVIS, a witty, polite AI assistant. Keep answers short (1-3 sentences) because they will be spoken aloud. No markdown." }]
    },
    contents: [{ role: "user", parts: [{ text }] }]
  });

  const started = Date.now();

  try {
    if (!modelsLoaded) await loadModels();

    const result = await raceModels(MODELS, body, 20000);
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    // The [model · seconds] tag is for testing. Delete it later if you like.
    responseBox.textContent = result.reply + "  [" + result.model + " · " + secs + "s]";
    speak(result.reply);

  } catch (err) {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    responseBox.textContent = "AI error after " + secs + "s: " + err.message;
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
// CLEAR CONSOLE
// ==================================

clearBtn.onclick = function () {
  finalText = "";
  speechSynthesis.cancel();
  setMode("idle");
  transcriptBox.textContent = "Your spoken words will appear here...";
  responseBox.textContent = "Voice recognition ready. Awaiting input.";
};
