
// ==================================
// JARVIS 2.0 - CLOCK
// ==================================

function updateClock() {
  const now = new Date();

  document.getElementById("clock").textContent =
    now.toLocaleTimeString("en-IN", {
      hour12: false
    });

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
// JARVIS - VOICE RECOGNITION
// ==================================

const voiceBtn = document.getElementById("voiceBtn");
const state = document.getElementById("state");
const voiceStatus = document.getElementById("voiceStatus");
const transcriptBox = document.getElementById("transcript");
const responseBox = document.getElementById("response");
const clearBtn = document.getElementById("clearBtn");

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

let recognition;
let listening = false;
let finalText = "";

if (SpeechRecognition) {

  recognition = new SpeechRecognition();

  recognition.lang = "en-IN";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = function() {
    listening = true;

    state.textContent = "LISTENING TO YOUR COMMAND...";
    voiceStatus.textContent = "LISTENING";
    voiceBtn.textContent = "STOP LISTENING";
    voiceBtn.classList.add("listening-active");

    responseBox.textContent = "JARVIS is listening.";
  };

  recognition.onresult = function(event) {

    let interimText = "";

    for (
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ) {

      const text = event.results[i][0].transcript;

      if (event.results[i].isFinal) {
        finalText += text + " ";
      } else {
        interimText += text;
      }
    }

    transcriptBox.textContent =
      (finalText + interimText).trim();
  };

  recognition.onerror = function(event) {

    const errors = {
      "not-allowed": "Microphone permission denied.",
      "no-speech": "No speech detected. Try again.",
      "network": "Speech recognition network error.",
      "audio-capture": "Microphone unavailable."
    };

    responseBox.textContent =
      errors[event.error] ||
      "Voice recognition error: " + event.error;
  };

  recognition.onend = function() {

    listening = false;

    voiceStatus.textContent = "STANDBY";
    voiceBtn.textContent = "ACTIVATE MICROPHONE";
    voiceBtn.classList.remove("listening-active");

    state.textContent = "AWAITING YOUR COMMAND";

    if (finalText.trim()) {
  askJarvis(finalText.trim());
}
  };

  voiceBtn.onclick = function() {

    if (listening) {
      recognition.stop();
      return;
    }

    finalText = "";

    transcriptBox.textContent =
      "Listening for your words...";

    try {
      recognition.start();
    } catch (error) {
      responseBox.textContent =
        "Please wait a moment and try again.";
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
// CLEAR COMMAND CONSOLE
// ==================================

clearBtn.onclick = function() {

  finalText = "";

  transcriptBox.textContent =
    "Your spoken words will appear here...";

  responseBox.textContent =
    "Voice recognition ready. Awaiting input.";
};
// ==================================
// JARVIS - AI BRAIN (GEMINI)
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

const MODEL = "gemini-2.5-flash";

async function askJarvis(text) {
  if (!getKey()) {
    responseBox.textContent = "API key needed. Tap the mic and try again.";
    return;
  }

  responseBox.textContent = "JARVIS is thinking...";
  state.textContent = "PROCESSING...";

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "You are JARVIS, a witty, polite AI assistant. Keep answers short (1-3 sentences) because they will be spoken aloud. No markdown." }]
          },
          contents: [{ role: "user", parts: [{ text }] }]
        })
      }
    );

    const data = await res.json();

    if (!res.ok) {
      responseBox.textContent = "AI error: " + (data.error?.message || res.status);
      state.textContent = "AWAITING YOUR COMMAND";
      return;
    }

    const reply = data.candidates[0].content.parts[0].text;
    responseBox.textContent = reply;
    speak(reply);

  } catch (err) {
    responseBox.textContent = "Connection failed. Check your internet.";
  }

  state.textContent = "AWAITING YOUR COMMAND";
}

function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-IN";
  speechSynthesis.speak(u);
}
