const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH_HISTORY_LIMIT = 8;
const INITIAL_LOCK_COUNT = 3;
const NOTE_SWITCH_CONFIRMATION = 4;
const SMOOTHING_FACTOR = 0.18;
const HOLD_FRAMES_ON_DROP = 10;

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

const tunerState = {
  recentSamples: [],
  lockedNoteKey: null,
  lockedMidi: null,
  smoothedFrequency: null,
  pendingNoteKey: null,
  pendingMidi: null,
  pendingFrames: 0,
  missingFrames: 0,
};

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

function resetDisplayState() {
  tunerState.recentSamples = [];
  tunerState.lockedNoteKey = null;
  tunerState.lockedMidi = null;
  tunerState.smoothedFrequency = null;
  tunerState.pendingNoteKey = null;
  tunerState.pendingMidi = null;
  tunerState.pendingFrames = 0;
  tunerState.missingFrames = 0;
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

function midiToFrequency(midi) {
  return referenceHz * 2 ** ((midi - 69) / 12);
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

function noteKeyFromMidi(midi) {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function noteKeyFromNoteData(noteData) {
  return `${noteData.note}${noteData.octave}`;
}

function parseNoteKey(noteKey) {
  const match = /^([A-G]#?)(-?\d+)$/.exec(noteKey);
  if (!match) {
    return null;
  }

  return {
    note: match[1],
    octave: Number(match[2]),
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function summarizeRecentSamples() {
  if (tunerState.recentSamples.length === 0) {
    return null;
  }

  const groupedSamples = new Map();

  tunerState.recentSamples.forEach((sample) => {
    const existing = groupedSamples.get(sample.noteKey);
    if (existing) {
      existing.frequencies.push(sample.frequency);
      existing.clarity.push(sample.clarity);
      return;
    }

    groupedSamples.set(sample.noteKey, {
      midi: sample.midi,
      frequencies: [sample.frequency],
      clarity: [sample.clarity],
    });
  });

  let dominantEntry = null;

  groupedSamples.forEach((value, key) => {
    if (!dominantEntry || value.frequencies.length > dominantEntry.count) {
      dominantEntry = {
        noteKey: key,
        midi: value.midi,
        count: value.frequencies.length,
        medianFrequency: median(value.frequencies),
        averageClarity:
          value.clarity.reduce((total, current) => total + current, 0) / value.clarity.length,
      };
    }
  });

  return dominantEntry;
}

function updateLockedPitch(summary) {
  if (!summary) {
    return false;
  }

  if (!tunerState.lockedNoteKey) {
    if (summary.count >= INITIAL_LOCK_COUNT) {
      tunerState.lockedNoteKey = summary.noteKey;
      tunerState.lockedMidi = summary.midi;
      tunerState.smoothedFrequency = summary.medianFrequency;
      tunerState.pendingNoteKey = null;
      tunerState.pendingMidi = null;
      tunerState.pendingFrames = 0;
      return true;
    }

    return false;
  }

  if (summary.noteKey === tunerState.lockedNoteKey) {
    tunerState.pendingNoteKey = null;
    tunerState.pendingMidi = null;
    tunerState.pendingFrames = 0;
    tunerState.smoothedFrequency +=
      (summary.medianFrequency - tunerState.smoothedFrequency) * SMOOTHING_FACTOR;
    return true;
  }

  if (summary.noteKey !== tunerState.pendingNoteKey) {
    tunerState.pendingNoteKey = summary.noteKey;
    tunerState.pendingMidi = summary.midi;
    tunerState.pendingFrames = 1;
    return true;
  }

  tunerState.pendingFrames += 1;

  if (summary.count >= NOTE_SWITCH_CONFIRMATION && tunerState.pendingFrames >= NOTE_SWITCH_CONFIRMATION) {
    tunerState.lockedNoteKey = summary.noteKey;
    tunerState.lockedMidi = summary.midi;
    tunerState.smoothedFrequency = summary.medianFrequency;
    tunerState.pendingNoteKey = null;
    tunerState.pendingMidi = null;
    tunerState.pendingFrames = 0;
  }

  return true;
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
  const tuningStateText = Math.abs(cents) <= 5 ? "In Tune" : `${formatSignedCents(cents)} cents`;
  const safeLabel = escapeHtml(label);
  const safeNote = escapeHtml(note);

  historyList.innerHTML = `
    <li><span>Input</span><strong>${safeLabel}</strong></li>
    <li><span>Detected</span><strong>${safeNote}</strong></li>
    <li><span>Clarity</span><strong>${roundedClarity}%</strong></li>
    <li><span>Tuning</span><strong>${tuningStateText}</strong></li>
  `;
}

function renderLockedPitch(label, percent, clarity) {
  if (!tunerState.lockedNoteKey || tunerState.smoothedFrequency === null || tunerState.lockedMidi === null) {
    resetTunerDisplay(true);
    return;
  }

  const noteParts = parseNoteKey(tunerState.lockedNoteKey);
  if (!noteParts) {
    resetTunerDisplay(true);
    return;
  }

  const targetFrequency = midiToFrequency(tunerState.lockedMidi);
  const cents = 1200 * Math.log2(tunerState.smoothedFrequency / targetFrequency);
  const clampedCents = Math.max(-50, Math.min(50, cents));
  const needleOffset = clampedCents * 0.9;
  const tuningStateText =
    Math.abs(cents) <= 5
      ? "In tune"
      : cents > 0
        ? `${Math.abs(Math.round(cents))} cents sharp`
        : `${Math.abs(Math.round(cents))} cents flat`;

  frequencyValue.textContent = `${tunerState.smoothedFrequency.toFixed(1)} Hz`;
  noteName.textContent = noteParts.note;
  noteVariant.textContent = `${noteParts.octave}`;
  noteMeta.textContent = `${tuningStateText} | clarity ${Math.round(clarity * 100)}%`;
  centsValue.textContent = formatSignedCents(cents);
  meterNeedle.style.left = `calc(50% + ${needleOffset}%)`;
  signalCopy.textContent = `Receiving live microphone input from ${label} at ${percent}% intensity.`;

  updateActiveString(noteParts.note, noteParts.octave);
  updateHistory(label, clarity, tunerState.lockedNoteKey, cents);
}

function handleMissingPitch(label, percent) {
  tunerState.missingFrames += 1;

  if (tunerState.lockedNoteKey && tunerState.missingFrames <= HOLD_FRAMES_ON_DROP) {
    livePill.textContent = "Holding Note";
    statusText.textContent = `Holding the last stable note from ${label} while the signal settles.`;
    signalCopy.textContent = `Listening on ${label}. Current input level is ${percent}% while waiting for a cleaner pitch.`;
    return;
  }

  resetDisplayState();
  signalCopy.textContent = `Listening on ${label}. Current input level is ${percent}% while waiting for a stable pitch.`;
  resetTunerDisplay(true);
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
    resetDisplayState();
    resetTunerDisplay(false);
    return;
  }

  livePill.textContent = hasPitch ? "Pitch Locked" : "Mic Live";
  statusText.textContent = `Monitoring ${label} through the microphone input component.`;

  if (!hasPitch || !pitchHz) {
    handleMissingPitch(label, percent);
    return;
  }

  tunerState.missingFrames = 0;

  const noteData = frequencyToNoteData(pitchHz);
  tunerState.recentSamples.push({
    frequency: pitchHz,
    clarity,
    midi: noteData.midi,
    noteKey: noteKeyFromNoteData(noteData),
  });

  if (tunerState.recentSamples.length > PITCH_HISTORY_LIMIT) {
    tunerState.recentSamples.shift();
  }

  const summary = summarizeRecentSamples();
  const hasLockedPitch = updateLockedPitch(summary);

  if (!hasLockedPitch) {
    livePill.textContent = "Stabilizing";
    statusText.textContent = `Monitoring ${label} while the tuner confirms a stable note.`;
    signalCopy.textContent = `Listening on ${label}. Building note stability from recent pitch frames.`;
    resetTunerDisplay(true);
    return;
  }

  renderLockedPitch(label, percent, summary ? summary.averageClarity : clarity);
}

renderSignalBars(0.08);
resetDisplayState();
resetTunerDisplay(false);

if (micComponent) {
  micComponent.addEventListener("microphone-analysis", updateTunerFromPitch);
}
