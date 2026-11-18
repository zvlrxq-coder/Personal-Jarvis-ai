
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
      responseBox.textContent =
        "Command captured successfully. AI connection pending.";
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
