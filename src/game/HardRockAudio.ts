type SfxName =
  | "jump"
  | "attack"
  | "throw"
  | "collect"
  | "enemyHit"
  | "playerHit"
  | "lifeLost"
  | "levelClear"
  | "win";

/**
 * Tiny procedural audio system:
 * - Generates hard-rock inspired loop with kick/snare and distorted chords.
 * - Plays short synthesized SFX for gameplay events.
 *
 * No external audio files are needed.
 */
export class HardRockAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private distortion: WaveShaperNode | null = null;
  private leadDistortion: WaveShaperNode | null = null;
  private musicTimer: number | null = null;
  private riffStep = 0;
  private soloActive = false;
  private soloEndStep = 0;
  private soloLastFreq = 659.25;
  private nextForcedSoloStep = 24;

  start(): void {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    if (this.musicTimer !== null) {
      return;
    }

    const beatMs = 125; // 120 BPM eighth-notes
    this.musicTimer = window.setInterval(() => {
      this.playRiffStep();
    }, beatMs);
    this.nextForcedSoloStep = Math.max(this.riffStep + 16, this.nextForcedSoloStep);
  }

  stop(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.soloActive = false;
    this.soloEndStep = 0;
    this.nextForcedSoloStep = this.riffStep + 24;
  }

  playSfx(name: SfxName): void {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const now = ctx.currentTime + 0.01;
    switch (name) {
      case "jump":
        this.playTone({
          frequency: 330,
          frequencyEnd: 440,
          duration: 0.08,
          gain: 0.15,
          type: "square",
          when: now,
        });
        break;
      case "attack":
        this.playNoiseBurst(now, 0.08, 0.22, 900, 2200);
        this.playTone({
          frequency: 170,
          frequencyEnd: 110,
          duration: 0.1,
          gain: 0.12,
          type: "sawtooth",
          when: now,
        });
        break;
      case "throw":
        this.playTone({
          frequency: 180,
          frequencyEnd: 120,
          duration: 0.14,
          gain: 0.14,
          type: "triangle",
          when: now,
        });
        break;
      case "collect":
        this.playTone({
          frequency: 700,
          frequencyEnd: 960,
          duration: 0.09,
          gain: 0.13,
          type: "triangle",
          when: now,
        });
        break;
      case "enemyHit":
        this.playTone({
          frequency: 220,
          frequencyEnd: 150,
          duration: 0.1,
          gain: 0.16,
          type: "square",
          when: now,
        });
        break;
      case "playerHit":
        this.playNoiseBurst(now, 0.12, 0.22, 100, 700);
        this.playTone({
          frequency: 130,
          frequencyEnd: 90,
          duration: 0.14,
          gain: 0.16,
          type: "sawtooth",
          when: now,
        });
        break;
      case "lifeLost":
        this.playTone({
          frequency: 180,
          frequencyEnd: 70,
          duration: 0.5,
          gain: 0.18,
          type: "triangle",
          when: now,
        });
        break;
      case "levelClear":
        this.playTone({
          frequency: 350,
          frequencyEnd: 500,
          duration: 0.2,
          gain: 0.17,
          type: "sawtooth",
          when: now,
        });
        this.playTone({
          frequency: 500,
          frequencyEnd: 650,
          duration: 0.22,
          gain: 0.14,
          type: "triangle",
          when: now + 0.14,
        });
        break;
      case "win":
        this.playTone({
          frequency: 330,
          frequencyEnd: 660,
          duration: 0.35,
          gain: 0.18,
          type: "sawtooth",
          when: now,
        });
        this.playTone({
          frequency: 660,
          frequencyEnd: 880,
          duration: 0.45,
          gain: 0.14,
          type: "triangle",
          when: now + 0.2,
        });
        break;
      default:
        break;
    }
  }

  private playRiffStep(): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime + 0.012;

    const riff = [82.41, 82.41, 98.0, 110.0, 82.41, 98.0, 123.47, 110.0];
    const root = riff[this.riffStep % riff.length];

    this.playPowerChord(root, now, 0.2);
    this.playBassNote(root / 2, now, 0.18);

    if (this.riffStep % 2 === 0) {
      this.playKick(now);
    }
    if (this.riffStep % 4 === 2) {
      this.playSnare(now);
    }

    this.maybeStartSolo();
    this.playSoloStep(now);

    this.riffStep += 1;
  }

  private maybeStartSolo(): void {
    if (this.soloActive) {
      return;
    }

    // Solos disabled on request.
    if (this.riffStep >= this.nextForcedSoloStep && this.nextForcedSoloStep < 0) {
      this.startSolo(24, 34);
      this.nextForcedSoloStep = this.riffStep + 52 + Math.floor(Math.random() * 28);
      return;
    }

    // Keep random gate at zero so lead solos never trigger.
    const onPhraseBoundary = this.riffStep % 16 === 0;
    if (onPhraseBoundary && Math.random() < 0) {
      this.startSolo(14, 24);
    }
  }

  private startSolo(minSteps: number, maxSteps: number): void {
    this.soloActive = true;
    this.soloEndStep =
      this.riffStep + minSteps + Math.floor(Math.random() * Math.max(1, maxSteps - minSteps));
  }

  private playSoloStep(when: number): void {
    if (!this.soloActive) {
      return;
    }

    if (this.riffStep >= this.soloEndStep) {
      this.soloActive = false;
      return;
    }

    // Keep a little space, but stay dense enough to be clearly audible.
    if (Math.random() < 0.08) {
      return;
    }

    const leadScale = [329.63, 392.0, 440.0, 493.88, 587.33, 659.25, 783.99, 880.0, 987.77, 1174.66, 1318.51];
    const chooseScaleNote = () => {
      // Biased random walk around the previous note gives "guitar lick" feel.
      const indexNow = leadScale.reduce((closestIdx, freq, idx, all) => {
        const bestDistance = Math.abs(all[closestIdx] - this.soloLastFreq);
        const currentDistance = Math.abs(freq - this.soloLastFreq);
        return currentDistance < bestDistance ? idx : closestIdx;
      }, 0);

      const offsets = [-4, -3, -2, -1, 1, 2, 3, 4];
      const offset = offsets[Math.floor(Math.random() * offsets.length)];
      const nextIndex = Math.min(leadScale.length - 1, Math.max(0, indexNow + offset));
      return leadScale[nextIndex];
    };

    const freq = Math.random() < 0.25
      ? chooseScaleNote() * 2
      : chooseScaleNote();
    this.soloLastFreq = freq;

    const bendDirection = Math.random() < 0.5 ? 1 : -1;
    const bendAmount = 1 + bendDirection * (0.06 + Math.random() * 0.24);
    const endFreq = Math.max(120, freq * bendAmount);
    const duration = 0.1 + Math.random() * 0.2;

    this.playLeadGuitarNote(freq, endFreq, when, duration);

    // Chance to add a quick extra trill note for a crazier solo phrase.
    if (Math.random() < 0.46) {
      const trillFreq = freq * (Math.random() < 0.5 ? 1.059 : 0.944);
      this.playLeadGuitarNote(trillFreq, freq, when + 0.045, 0.07);
    }
  }

  private playPowerChord(root: number, when: number, duration: number): void {
    const ctx = this.ensureContext();
    const output = this.ensureDistortion();

    const freqB = root * 1.5;
    const freqC = root * 2;
    const oscillators = [root, freqB, freqC].map((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, when);
      return osc;
    });

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200, when);
    filter.frequency.exponentialRampToValueAtTime(900, when + duration);
    filter.Q.value = 0.7;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(0.19, when + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    for (const osc of oscillators) {
      osc.connect(filter);
      osc.start(when);
      osc.stop(when + duration + 0.02);
    }

    filter.connect(output);
    output.connect(amp);
    amp.connect(this.musicBus ?? this.master!);
  }

  private playBassNote(root: number, when: number, duration: number): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(root, when);
    osc.frequency.exponentialRampToValueAtTime(root * 0.9, when + duration);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(500, when);
    filter.frequency.exponentialRampToValueAtTime(240, when + duration);

    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.17, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus ?? this.master!);

    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  private playKick(when: number): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(40, when + 0.11);

    gain.gain.setValueAtTime(0.32, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);

    osc.connect(gain);
    gain.connect(this.musicBus ?? this.master!);
    osc.start(when);
    osc.stop(when + 0.12);
  }

  private playSnare(when: number): void {
    this.playNoiseBurst(when, 0.12, 0.25, 1200, 5500, this.musicBus ?? undefined);
  }

  private playLeadGuitarNote(
    frequency: number,
    frequencyEnd: number,
    when: number,
    duration: number,
  ): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const noteGain = ctx.createGain();
    const delay = ctx.createDelay(0.35);
    const delayFeedback = ctx.createGain();
    const delayMix = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const distortion = this.ensureLeadDistortion();

    osc.type = Math.random() < 0.7 ? "sawtooth" : "square";
    osc.frequency.setValueAtTime(frequency, when);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(80, frequencyEnd),
      when + duration,
    );
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(frequency * 0.5, when);
    osc2.frequency.exponentialRampToValueAtTime(
      Math.max(80, frequencyEnd * 0.5),
      when + duration,
    );

    // Vibrato gives expressive electric-guitar style movement.
    lfo.type = "sine";
    lfo.frequency.setValueAtTime(5 + Math.random() * 4, when);
    lfoGain.gain.setValueAtTime(4 + Math.random() * 7, when);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2200, when);
    filter.frequency.exponentialRampToValueAtTime(1200, when + duration);
    filter.Q.value = 1.6;

    noteGain.gain.setValueAtTime(0.0001, when);
    noteGain.gain.exponentialRampToValueAtTime(0.16 + Math.random() * 0.1, when + 0.01);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    delay.delayTime.setValueAtTime(0.095 + Math.random() * 0.08, when);
    delayFeedback.gain.value = 0.3;
    delayMix.gain.value = 0.45;

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(distortion);
    distortion.connect(noteGain);
    noteGain.connect(this.musicBus ?? this.master!);

    noteGain.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayMix);
    delayMix.connect(this.musicBus ?? this.master!);

    osc.start(when);
    osc2.start(when);
    lfo.start(when);
    osc.stop(when + duration + 0.06);
    osc2.stop(when + duration + 0.06);
    lfo.stop(when + duration + 0.06);
  }

  private playTone(options: {
    frequency: number;
    frequencyEnd: number;
    duration: number;
    gain: number;
    type: OscillatorType;
    when: number;
  }): void {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = options.type;
    osc.frequency.setValueAtTime(options.frequency, options.when);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, options.frequencyEnd),
      options.when + options.duration,
    );

    amp.gain.setValueAtTime(0.0001, options.when);
    amp.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, options.gain),
      options.when + 0.01,
    );
    amp.gain.exponentialRampToValueAtTime(
      0.0001,
      options.when + options.duration,
    );

    osc.connect(amp);
    amp.connect(this.sfxBus ?? this.master!);
    osc.start(options.when);
    osc.stop(options.when + options.duration + 0.03);
  }

  private playNoiseBurst(
    when: number,
    duration: number,
    gainAmount: number,
    minFilter: number,
    maxFilter: number,
    destination?: AudioNode,
  ): void {
    const ctx = this.ensureContext();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(maxFilter, when);
    filter.frequency.exponentialRampToValueAtTime(minFilter, when + duration);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gainAmount, when);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    source.connect(filter);
    filter.connect(amp);
    amp.connect(destination ?? this.sfxBus ?? this.master!);

    source.start(when);
    source.stop(when + duration + 0.02);
  }

  private ensureDistortion(): WaveShaperNode {
    if (this.distortion) {
      return this.distortion;
    }

    const ctx = this.ensureContext();
    const waveShaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    const amount = 90;

    for (let i = 0; i < curve.length; i += 1) {
      const x = (i * 2) / curve.length - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) /
        (Math.PI + amount * Math.abs(x));
    }

    waveShaper.curve = curve;
    waveShaper.oversample = "4x";
    this.distortion = waveShaper;
    return waveShaper;
  }

  private ensureLeadDistortion(): WaveShaperNode {
    if (this.leadDistortion) {
      return this.leadDistortion;
    }

    const ctx = this.ensureContext();
    const waveShaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    const amount = 240;

    for (let i = 0; i < curve.length; i += 1) {
      const x = (i * 2) / curve.length - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) /
        (Math.PI + amount * Math.abs(x));
    }

    waveShaper.curve = curve;
    waveShaper.oversample = "4x";
    this.leadDistortion = waveShaper;
    return waveShaper;
  }

  private ensureContext(): AudioContext {
    if (this.context) {
      return this.context;
    }

    const context = new AudioContext();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;

    const master = context.createGain();
    master.gain.value = 0.46;

    const musicBus = context.createGain();
    musicBus.gain.value = 0.95;
    const sfxBus = context.createGain();
    sfxBus.gain.value = 0.78;

    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.master = master;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    return context;
  }
}

export const hardRockAudio = new HardRockAudio();
