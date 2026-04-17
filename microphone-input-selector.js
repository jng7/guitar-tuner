import { PitchDetector } from "https://esm.sh/pitchy@4";

class MicrophoneInputSelector extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({ mode: "open" });

    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.sourceNode = null;
    this.pitchDetector = null;
    this.timeDomainBuffer = null;
    this.rafId = 0;
    this.devices = [];
    this.isRunning = false;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          margin-top: 22px;
          color: #eef8f4;
          font-family: "Space Grotesk", sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        .shell {
          display: grid;
          gap: 18px;
        }

        .top-row {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) auto auto;
          gap: 12px;
          align-items: end;
        }

        .field {
          display: grid;
          gap: 8px;
        }

        label {
          color: #9fb7b2;
          font-size: 0.86rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        select,
        button {
          font: inherit;
        }

        select {
          width: 100%;
          min-height: 48px;
          padding: 0.85rem 1rem;
          border-radius: 16px;
          color: #eef8f4;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          outline: none;
        }

        button {
          min-height: 48px;
          padding: 0.85rem 1rem;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.05);
          color: #eef8f4;
          cursor: pointer;
          transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
        }

        button:hover {
          transform: translateY(-1px);
        }

        .primary {
          background: linear-gradient(135deg, rgba(244, 201, 93, 0.22), rgba(255, 175, 69, 0.16));
          border-color: rgba(244, 201, 93, 0.38);
        }

        .status-card {
          display: grid;
          gap: 14px;
          padding: 18px;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          padding: 0.45rem 0.75rem;
          border-radius: 999px;
          background: rgba(159, 183, 178, 0.16);
          border: 1px solid rgba(159, 183, 178, 0.18);
          color: #eef8f4;
        }

        .pill.live {
          background: rgba(156, 229, 191, 0.12);
          border-color: rgba(156, 229, 191, 0.24);
          color: #9ce5bf;
        }

        .copy {
          color: #9fb7b2;
          margin: 0;
        }

        .meter-shell {
          display: grid;
          gap: 10px;
        }

        .meter-track {
          position: relative;
          height: 16px;
          border-radius: 999px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.06);
        }

        .meter-fill {
          position: absolute;
          inset: 0 auto 0 0;
          width: 0%;
          border-radius: inherit;
          background: linear-gradient(90deg, #38d39f 0%, #f4c95d 65%, #ff8576 100%);
          transition: width 80ms linear;
        }

        .meter-labels,
        .stats {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .stats strong {
          font-size: 1.5rem;
        }

        .helper {
          color: #9fb7b2;
          font-size: 0.92rem;
        }

        @media (max-width: 720px) {
          .top-row {
            grid-template-columns: 1fr;
            align-items: stretch;
          }
        }
      </style>

      <div class="shell">
        <div class="top-row">
          <div class="field">
            <label for="deviceSelect">Microphone Input</label>
            <select id="deviceSelect">
              <option value="">Loading microphones...</option>
            </select>
          </div>

          <button id="refreshButton" type="button">Refresh</button>
          <button class="primary" id="toggleButton" type="button">Start Preview</button>
        </div>

        <div class="status-card">
          <div class="status-row">
            <span class="pill" id="statusPill">Idle</span>
            <span class="helper" id="statusText">Choose a device, then start the microphone preview.</span>
          </div>

          <div class="meter-shell">
            <div class="stats">
              <div>
                <div class="helper">Live Volume Preview</div>
                <strong id="volumePercent">0%</strong>
              </div>
              <div class="helper" id="activeDevice">No active input</div>
            </div>

            <div class="meter-track" aria-hidden="true">
              <div class="meter-fill" id="meterFill"></div>
            </div>

            <div class="meter-labels">
              <span class="helper">Quiet</span>
              <span class="helper">Speaking</span>
              <span class="helper">Hot</span>
            </div>
          </div>

          <p class="copy">
            This component ingests audio through <code>navigator.mediaDevices.getUserMedia()</code>,
            lets you switch available microphone inputs, previews the input volume through a Web Audio analyser node,
            and matches the incoming sound to a pitch with <code>pitchy</code>.
          </p>
        </div>
      </div>
    `;

    this.deviceSelect = this.shadowRoot.getElementById("deviceSelect");
    this.refreshButton = this.shadowRoot.getElementById("refreshButton");
    this.toggleButton = this.shadowRoot.getElementById("toggleButton");
    this.statusPill = this.shadowRoot.getElementById("statusPill");
    this.statusText = this.shadowRoot.getElementById("statusText");
    this.volumePercent = this.shadowRoot.getElementById("volumePercent");
    this.activeDevice = this.shadowRoot.getElementById("activeDevice");
    this.meterFill = this.shadowRoot.getElementById("meterFill");

    this.handleRefresh = this.handleRefresh.bind(this);
    this.handleToggle = this.handleToggle.bind(this);
    this.handleDeviceChange = this.handleDeviceChange.bind(this);
    this.handleDeviceListChanged = this.handleDeviceListChanged.bind(this);
    this.updateMeter = this.updateMeter.bind(this);
  }

  connectedCallback() {
    this.refreshButton.addEventListener("click", this.handleRefresh);
    this.toggleButton.addEventListener("click", this.handleToggle);
    this.deviceSelect.addEventListener("change", this.handleDeviceChange);

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", this.handleDeviceListChanged);
    }

    this.loadDevices();
  }

  disconnectedCallback() {
    this.refreshButton.removeEventListener("click", this.handleRefresh);
    this.toggleButton.removeEventListener("click", this.handleToggle);
    this.deviceSelect.removeEventListener("change", this.handleDeviceChange);

    if (navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener("devicechange", this.handleDeviceListChanged);
    }

    this.stopPreview();
  }

  async handleRefresh() {
    await this.loadDevices();
  }

  async handleToggle() {
    if (this.isRunning) {
      this.stopPreview();
      this.setStatus("Idle", "Preview stopped. You can switch microphones or start again.", false);
      return;
    }

    await this.startPreview();
  }

  async handleDeviceChange() {
    if (this.isRunning) {
      await this.startPreview();
    }
  }

  async handleDeviceListChanged() {
    await this.loadDevices();
  }

  async loadDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.setStatus("Unsupported", "This browser does not support microphone device enumeration.", false);
      this.deviceSelect.innerHTML = `<option value="">Unsupported browser</option>`;
      this.toggleButton.disabled = true;
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.devices = devices.filter((device) => device.kind === "audioinput");

      if (this.devices.length === 0) {
        this.deviceSelect.innerHTML = `<option value="">No microphones found</option>`;
        this.toggleButton.disabled = true;
        this.activeDevice.textContent = "No active input";
        this.setStatus("No Input", "No audio input devices are currently available.", false);
        return;
      }

      const previousValue = this.deviceSelect.value;
      this.deviceSelect.innerHTML = this.devices
        .map((device, index) => {
          const label = device.label || `Microphone ${index + 1}`;
          return `<option value="${device.deviceId}">${this.escapeHtml(label)}</option>`;
        })
        .join("");

      const nextValue = this.devices.some((device) => device.deviceId === previousValue)
        ? previousValue
        : this.devices[0].deviceId;

      this.deviceSelect.value = nextValue;
      this.toggleButton.disabled = false;

      if (!this.isRunning) {
        this.activeDevice.textContent = this.getSelectedDeviceLabel();
      }

      if (!this.isRunning) {
        this.setStatus("Ready", "Microphones loaded. Start preview to inspect live input volume.", false);
      }
    } catch (error) {
      this.deviceSelect.innerHTML = `<option value="">Unable to load devices</option>`;
      this.toggleButton.disabled = true;
      this.setStatus("Error", error.message || "Unable to enumerate microphone devices.", false);
    }
  }

  async startPreview() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus("Unsupported", "This browser does not support microphone capture.", false);
      return;
    }

    this.stopPreview();

    const selectedId = this.deviceSelect.value;
    const audioConstraints = selectedId
      ? {
          deviceId: { exact: selectedId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      : true;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = this.audioContext || new AudioContextClass();

      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.pitchDetector = PitchDetector.forFloat32Array(this.analyser.fftSize);
      this.timeDomainBuffer = new Float32Array(this.analyser.fftSize);
      this.sourceNode.connect(this.analyser);

      this.isRunning = true;
      this.toggleButton.textContent = "Stop Preview";
      this.statusPill.classList.add("live");
      this.setStatus("Live", "Microphone preview is active. Speak or play near the selected input.", true);
      this.activeDevice.textContent = this.getSelectedDeviceLabel();
      this.updateMeter();
    } catch (error) {
      this.stopPreview();
      this.setStatus("Blocked", error.message || "Microphone access was denied or failed.", false);
    }
  }

  stopPreview() {
    this.isRunning = false;
    this.toggleButton.textContent = "Start Preview";
    this.statusPill.classList.remove("live");

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.analyser = null;
    this.pitchDetector = null;
    this.timeDomainBuffer = null;
    this.meterFill.style.width = "0%";
    this.volumePercent.textContent = "0%";

    this.dispatchEvent(
      new CustomEvent("microphone-analysis", {
        detail: {
          level: 0,
          percent: 0,
          pitchHz: null,
          clarity: 0,
          hasPitch: false,
          isRunning: false,
          deviceId: this.deviceSelect.value,
          label: this.getSelectedDeviceLabel(),
        },
      }),
    );
  }

  updateMeter() {
    if (!this.analyser || !this.isRunning || !this.timeDomainBuffer || !this.pitchDetector) {
      return;
    }

    let sumSquares = 0;
    if (typeof this.analyser.getFloatTimeDomainData === "function") {
      this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
    } else {
      const byteBuffer = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(byteBuffer);

      for (let index = 0; index < byteBuffer.length; index += 1) {
        this.timeDomainBuffer[index] = (byteBuffer[index] - 128) / 128;
      }
    }

    for (let index = 0; index < this.timeDomainBuffer.length; index += 1) {
      const normalized = this.timeDomainBuffer[index];
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / this.timeDomainBuffer.length);
    const level = Math.min(1, rms * 4.5);
    const percent = Math.round(level * 100);
    const [pitchHz, clarity] = this.pitchDetector.findPitch(this.timeDomainBuffer, this.audioContext.sampleRate);
    const hasPitch = Number.isFinite(pitchHz) && pitchHz > 0 && clarity >= 0.85;

    this.meterFill.style.width = `${percent}%`;
    this.volumePercent.textContent = `${percent}%`;

    this.dispatchEvent(
      new CustomEvent("microphone-analysis", {
        detail: {
          level,
          percent,
          pitchHz: hasPitch ? pitchHz : null,
          clarity,
          hasPitch,
          isRunning: true,
          deviceId: this.deviceSelect.value,
          label: this.getSelectedDeviceLabel(),
        },
      }),
    );

    this.rafId = requestAnimationFrame(this.updateMeter);
  }

  setStatus(pillText, message, isLive) {
    this.statusPill.textContent = pillText;
    this.statusText.textContent = message;

    if (isLive) {
      this.statusPill.classList.add("live");
    } else {
      this.statusPill.classList.remove("live");
    }
  }

  getSelectedDeviceLabel() {
    const selectedOption = this.deviceSelect.selectedOptions[0];
    return selectedOption ? selectedOption.textContent : "No active input";
  }

  escapeHtml(text) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

customElements.define("microphone-input-selector", MicrophoneInputSelector);
