const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const stringGrid = document.getElementById("stringGrid");
const stringCards = Array.from(document.querySelectorAll(".string-card"));
const signalBars = Array.from(document.querySelectorAll("#signalBars span"));
const signalCopy = document.getElementById("signalCopy");
const livePill = document.getElementById("livePill");
const statusText = document.getElementById("statusText");
const micComponent = document.querySelector("microphone-input-selector");
const frequencyValue = document.getElementById("frequencyValue");
const noteName = document.getElementById("noteName");
const noteVariant = document.getElementById("noteVariant");
const noteMeta = document.getElementById("noteMeta");
const meterNeedle = document.getElementById("meterNeedle");
const centsValue = document.getElementById("centsValue");
const historyList = document.getElementById("historyList");
const referenceSlider = document.getElementById("referenceSlider");
const referenceValue = document.getElementById("referenceValue");

let referenceHz = Number(referenceSlider?.value || 440);

if (stringGrid) {
  stringGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".string-card");
    if (!button) {
      return;
    }

    stringCards.forEach((card) => {
      card.classList.remove("active");
    });

    button.classList.add("active");
  });
}

if (referenceSlider && referenceValue) {
  referenceSlider.addEventListener("input", () => {
    referenceHz = Number(referenceSlider.value);
    referenceValue.textContent = `A4 = ${referenceHz} Hz`;
  });
}

function renderSignalBars(level) {
  const scaledLevel = Math.max(0.04, Math.min(1, level));

  signalBars.forEach((bar, index) => {
    const relativeIntensity = Math.max(0.12, scaledLevel * (0.55 + index * 0.18));
    const height = Math.min(100, Math.round(relativeIntensity * 100));
    bar.style.height = `${height}%`;
  });
}

function resetTunerDisplay(isLive) {
  frequencyValue.textContent = "-- Hz";
  noteName.textContent = "--";
  noteVariant.textContent = "-";
  noteMeta.textContent = isLive ? "Listening for a clear note" : "Waiting for signal";
  centsValue.textContent = "+00";
  meterNeedle.style.left = "50%";
}

function frequencyToNoteData(frequency) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / referenceHz));
  const closestFrequency = referenceHz * 2 ** ((midi - 69) / 12);
  const cents = 1200 * Math.log2(frequency / closestFrequency);
  const noteIndex = ((midi % 12) + 12) % 12;

  return {
    midi,
    cents,
    closestFrequency,
    note: NOTE_NAMES[noteIndex],
    octave: Math.floor(midi / 12) - 1,
  };
}

function formatSignedCents(cents) {
  const rounded = Math.round(cents);
  const absolute = String(Math.abs(rounded)).padStart(2, "0");
  const sign = rounded >= 0 ? "+" : "-";
  return `${sign}${absolute}`;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateActiveString(note, octave) {
  const matchedNote = `${note}${octave}`;
  const matchingCard = stringCards.find((card) => card.dataset.note === matchedNote);

  if (!matchingCard) {
    return;
  }

  stringCards.forEach((card) => {
    card.classList.toggle("active", card === matchingCard);
  });
}

function updateHistory(label, clarity, note, cents) {
  if (!historyList) {
    return;
  }

  const roundedClarity = Math.round(clarity * 100);
  const tuningState = Math.abs(cents) <= 5 ? "In Tune" : `${formatSignedCents(cents)} cents`;
  const safeLabel = escapeHtml(label);
  const safeNote = escapeHtml(note);

  historyList.innerHTML = `
    <li><span>Input</span><strong>${safeLabel}</strong></li>
    <li><span>Detected</span><strong>${safeNote}</strong></li>
    <li><span>Clarity</span><strong>${roundedClarity}%</strong></li>
    <li><span>Tuning</span><strong>${tuningState}</strong></li>
  `;
}

function updateTunerFromPitch(event) {
  const { percent, level, label, pitchHz, clarity, hasPitch, isRunning } = event.detail;

  renderSignalBars(level);

  if (!isRunning) {
    livePill.textContent = "Mic Idle";
    statusText.textContent = "Use the browser microphone API to start live tuning";
    signalCopy.textContent = "Mic level visualization will respond when live input starts.";
    if (historyList) {
      historyList.innerHTML = `
        <li><span>Listening</span><strong>Waiting</strong></li>
        <li><span>Pitch Model</span><strong>Pitchy MPM</strong></li>
        <li><span>Input</span><strong>Browser Mic API</strong></li>
      `;
    }
    resetTunerDisplay(false);
    return;
  }

  livePill.textContent = hasPitch ? "Pitch Locked" : "Mic Live";
  statusText.textContent = `Monitoring ${label} through the microphone input component.`;

  if (!hasPitch || !pitchHz) {
    signalCopy.textContent = `Listening on ${label}. Current input level is ${percent}% while waiting for a stable pitch.`;
    resetTunerDisplay(true);
    return;
  }

  const noteData = frequencyToNoteData(pitchHz);
  const clampedCents = Math.max(-50, Math.min(50, noteData.cents));
  const needleOffset = clampedCents * 0.9;
  const tuningState =
    Math.abs(noteData.cents) <= 5
      ? "In tune"
      : noteData.cents > 0
        ? `${Math.abs(Math.round(noteData.cents))} cents sharp`
        : `${Math.abs(Math.round(noteData.cents))} cents flat`;

  frequencyValue.textContent = `${pitchHz.toFixed(1)} Hz`;
  noteName.textContent = noteData.note;
  noteVariant.textContent = `${noteData.octave}`;
  noteMeta.textContent = `${tuningState} | clarity ${Math.round(clarity * 100)}%`;
  centsValue.textContent = formatSignedCents(noteData.cents);
  meterNeedle.style.left = `calc(50% + ${needleOffset}%)`;
  signalCopy.textContent = `Receiving live microphone input from ${label} at ${percent}% intensity.`;

  updateActiveString(noteData.note, noteData.octave);
  updateHistory(label, clarity, `${noteData.note}${noteData.octave}`, noteData.cents);
}

renderSignalBars(0.08);
resetTunerDisplay(false);

if (micComponent) {
  micComponent.addEventListener("microphone-analysis", updateTunerFromPitch);
}
