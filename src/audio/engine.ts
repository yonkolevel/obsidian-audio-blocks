/**
 * AudioEngine — singleton that manages the Web Audio context and sample playback.
 *
 * For this prototype we use plain Web Audio API (AudioBufferSourceNode) for
 * one-shot sample playback. Elementary Audio's DSP graph will be integrated in
 * a later task when we need effects chains and sequencing.
 *
 * The AudioContext is created lazily on the first user gesture (pad tap) to
 * comply with browser autoplay policies.
 */

import { generateDrumKit } from "./synth-samples";
import { SoundbankManager } from "./soundbank-manager";

/** Bookkeeping for an active note that can be stopped on demand. */
interface ActiveNote {
	/** Call to trigger the release phase and clean up. */
	stop: () => void;
}

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private sampleBuffers: AudioBuffer[] = [];
	private initialized = false;
	private soundbankManager: SoundbankManager | null = null;
	/** Master output with compressor to prevent clipping when layering notes. */
	private masterOut: GainNode | null = null;

	/**
	 * Map of MIDI note number → active note info.
	 * Used by playToneWithRelease / playSoundbankNoteWithRelease + stopNote.
	 */
	private activeNotes: Map<number, ActiveNote> = new Map();

	/**
	 * Attach a SoundbankManager so the engine can play real samples.
	 */
	setSoundbankManager(manager: SoundbankManager): void {
		this.soundbankManager = manager;
	}

	/**
	 * Lazily create the AudioContext and generate the built-in drum kit.
	 * Must be called from a user gesture handler.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		this.ctx = new AudioContext();

		// Resume in case the context starts in a suspended state
		if (this.ctx.state === "suspended") {
			await this.ctx.resume();
		}

		// Master output chain: gain → compressor → destination
		// Prevents clipping when layering chords and multiple notes
		const compressor = this.ctx.createDynamicsCompressor();
		compressor.threshold.value = -12;
		compressor.knee.value = 6;
		compressor.ratio.value = 4;
		compressor.attack.value = 0.003;
		compressor.release.value = 0.1;

		this.masterOut = this.ctx.createGain();
		this.masterOut.gain.value = 0.8;
		this.masterOut.connect(compressor);
		compressor.connect(this.ctx.destination);

		this.sampleBuffers = generateDrumKit(this.ctx);
		this.initialized = true;
	}

	/** Get the output node all audio should connect to. */
	private get output(): AudioNode {
		return this.masterOut ?? this.ctx!.destination;
	}

	/**
	 * Get the AudioContext (initializing if needed). Useful for callers
	 * that need to pass it to the SoundbankManager for decoding.
	 */
	getAudioContext(): AudioContext | null {
		return this.ctx;
	}

	/**
	 * Play a one-shot sample for the given pad index (0-15).
	 */
	playSample(padIndex: number): void {
		if (!this.ctx || !this.initialized) return;
		if (padIndex < 0 || padIndex >= this.sampleBuffers.length) return;

		const buffer = this.sampleBuffers[padIndex];
		if (!buffer) return;

		const source = this.ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(this.output);
		source.start();
	}

	/**
	 * Play a soundbank sample for the given MIDI note.
	 *
	 * If the exact note or a range match is found, it plays at normal speed.
	 * If no direct match exists, the nearest available sample is played with
	 * pitch-shifting via `playbackRate` — standard Web Audio resampling that
	 * shifts pitch by the semitone difference between the target and root notes.
	 *
	 * Falls back to synthesized FM tone only if no soundbank is loaded at all.
	 */
	playSoundbankNote(slug: string, midiNote: number): void {
		if (!this.ctx || !this.initialized) return;

		if (this.soundbankManager) {
			const match = this.soundbankManager.findNearestSample(
				slug,
				midiNote
			);
			if (match) {
				const source = this.ctx.createBufferSource();
				source.buffer = match.buffer;

				// Pitch-shift: 2^(semitones/12) gives the playback rate
				// that transposes from rootNote to the target midiNote.
				// When rootNote === midiNote, rate is 1.0 (no shift).
				const semitoneDiff = midiNote - match.rootNote;
				source.playbackRate.value = Math.pow(
					2,
					semitoneDiff / 12
				);

				source.connect(this.output);
				source.start();
				return;
			}
		}

		// Fallback to synthesized tone (no soundbank loaded)
		this.playTone(midiNote);
	}

	/**
	 * Lazy-load a soundbank by slug. Returns true if loaded successfully.
	 * Safe to call multiple times — loading is cached.
	 */
	async loadSoundbankForBlock(slug: string): Promise<boolean> {
		if (!this.soundbankManager || !this.ctx) return false;

		const loaded = await this.soundbankManager.loadSoundbank(
			slug,
			this.ctx
		);
		return loaded !== null;
	}

	/**
	 * Get the default octave for a soundbank, or null if not available.
	 */
	getSoundbankDefaultOctave(slug: string): number | null {
		if (!this.soundbankManager) return null;
		const config = this.soundbankManager.getConfig(slug);
		return config?.defaultOctave ?? null;
	}

	/**
	 * Get a human-readable sample name for a MIDI note in a soundbank.
	 */
	getSampleNameForNote(slug: string, midiNote: number): string | null {
		return (
			this.soundbankManager?.getSampleNameForNote(slug, midiNote) ??
			null
		);
	}

	/**
	 * Build a full map of MIDI note number → human-readable name for a soundbank.
	 */
	getNoteNamesForSoundbank(slug: string): Map<number, string> {
		const map = new Map<number, string>();
		if (!this.soundbankManager) return map;
		const config = this.soundbankManager.getConfig(slug);
		if (!config) return map;
		for (const sample of config.samples) {
			const name = this.soundbankManager.getSampleNameForNote(
				slug,
				sample.midiNumber
			);
			if (name) map.set(sample.midiNumber, name);
		}
		return map;
	}

	/**
	 * Create the additive piano synth voice and connect it to the output.
	 * Returns { master, oscillators } for envelope control.
	 *
	 * The synth uses:
	 * - Fundamental + slightly detuned copy for warmth/chorus
	 * - 2nd and 3rd harmonics with faster decay for brightness
	 * - Short filtered noise burst for the hammer/attack transient
	 */
	private createPianoVoice(freq: number): {
		master: GainNode;
		oscillators: OscillatorNode[];
	} {
		const ctx = this.ctx!;
		const t = ctx.currentTime;

		const master = ctx.createGain();
		master.gain.value = 0;
		master.connect(this.output);

		const oscillators: OscillatorNode[] = [];

		// Harmonic partials: [frequency multiplier, initial gain, decay rate]
		const partials: [number, number, number][] = [
			[1.0, 0.35, 0.8],      // fundamental
			[1.002, 0.2, 0.8],     // detuned copy for warmth
			[2.0, 0.1, 0.4],      // octave harmonic
			[3.01, 0.03, 0.25],   // slightly inharmonic 5th
			[4.0, 0.015, 0.15],   // 2nd octave (bright shimmer)
		];

		for (const [ratio, gain, decayRate] of partials) {
			const osc = ctx.createOscillator();
			const g = ctx.createGain();
			osc.type = "sine";
			osc.frequency.value = freq * ratio;

			// Each partial has its own gain with independent decay
			g.gain.setValueAtTime(gain, t);
			if (ratio > 1.5) {
				// Higher partials decay faster → tone mellows over time
				g.gain.setTargetAtTime(gain * 0.02, t + 0.01, decayRate);
			}

			osc.connect(g);
			g.connect(master);
			osc.start(t);
			oscillators.push(osc);
		}

		// Attack transient: short burst of filtered noise (hammer hit)
		const noiseLen = Math.floor(ctx.sampleRate * 0.015);
		const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
		const noiseData = noiseBuf.getChannelData(0);
		for (let i = 0; i < noiseLen; i++) {
			noiseData[i] = (Math.random() * 2 - 1);
		}
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuf;

		const noiseFilter = ctx.createBiquadFilter();
		noiseFilter.type = "bandpass";
		noiseFilter.frequency.value = Math.min(freq * 6, 8000);
		noiseFilter.Q.value = 1.5;

		const noiseGain = ctx.createGain();
		noiseGain.gain.setValueAtTime(0.06, t);
		noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);

		noise.connect(noiseFilter);
		noiseFilter.connect(noiseGain);
		noiseGain.connect(master);
		noise.start(t);

		return { master, oscillators };
	}

	/**
	 * Play a melodic tone at the given MIDI note number.
	 * Uses additive synthesis with noise transient for a piano-like sound.
	 */
	playTone(midiNote: number, duration = 1.5): void {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

		const { master, oscillators } = this.createPianoVoice(freq);

		// Envelope: fast attack → initial decay → slow sustain decay → release
		master.gain.setValueAtTime(0, t);
		master.gain.linearRampToValueAtTime(1.0, t + 0.003);
		master.gain.setTargetAtTime(0.35, t + 0.003, 0.12);
		master.gain.setTargetAtTime(0.001, t + duration * 0.7, duration * 0.15);

		// Stop oscillators after full duration + tail
		const stopTime = t + duration + 0.3;
		for (const osc of oscillators) {
			osc.stop(stopTime);
		}
	}

	/**
	 * Play a melodic tone that sustains until explicitly stopped.
	 * Returns a stop function, or null if engine not initialized.
	 */
	playToneWithRelease(midiNote: number): (() => void) | null {
		if (!this.ctx) return null;

		this.stopNote(midiNote);

		const ctx = this.ctx;
		const t = ctx.currentTime;
		const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

		const { master, oscillators } = this.createPianoVoice(freq);

		// Envelope: fast attack → decay to sustain level, hold indefinitely
		master.gain.setValueAtTime(0, t);
		master.gain.linearRampToValueAtTime(1.0, t + 0.003);
		master.gain.setTargetAtTime(0.35, t + 0.003, 0.12);

		let released = false;

		const stop = () => {
			if (released) return;
			released = true;
			this.activeNotes.delete(midiNote);

			const now = ctx.currentTime;
			const releaseDuration = 0.2;

			master.gain.cancelScheduledValues(now);
			master.gain.setValueAtTime(master.gain.value, now);
			master.gain.linearRampToValueAtTime(0, now + releaseDuration);

			for (const osc of oscillators) {
				osc.stop(now + releaseDuration + 0.01);
			}
		};

		this.activeNotes.set(midiNote, { stop });
		return stop;
	}

	/**
	 * Play a soundbank sample that sustains until explicitly stopped.
	 *
	 * Uses `findNearestSample` for pitch-shifted playback — if the exact
	 * note is not available, the nearest sample is played at an adjusted
	 * playback rate.
	 *
	 * Falls back to `playToneWithRelease` if no soundbank is loaded at all.
	 * The note is tracked in activeNotes so it can be stopped via
	 * `stopNote(midiNote)`.
	 */
	playSoundbankNoteWithRelease(slug: string, midiNote: number): (() => void) | null {
		if (!this.ctx || !this.initialized) return null;

		if (this.soundbankManager) {
			const match = this.soundbankManager.findNearestSample(slug, midiNote);
			if (match) {
				// Re-trigger: stop previous instance
				this.stopNote(midiNote);

				const ctx = this.ctx;
				const source = ctx.createBufferSource();
				const output = ctx.createGain();
				source.buffer = match.buffer;

				// Pitch-shift to the target note
				const semitoneDiff = midiNote - match.rootNote;
				source.playbackRate.value = Math.pow(2, semitoneDiff / 12);

				output.gain.setValueAtTime(1, ctx.currentTime);

				source.connect(output);
				output.connect(this.output);
				source.start();

				let released = false;

				const stop = () => {
					if (released) return;
					released = true;
					this.activeNotes.delete(midiNote);

					const now = ctx.currentTime;
					const releaseDuration = 0.05; // Shorter release for samples

					output.gain.cancelScheduledValues(now);
					output.gain.setValueAtTime(output.gain.value, now);
					output.gain.linearRampToValueAtTime(0, now + releaseDuration);

					// Stop the source after the gain ramp finishes
					try {
						source.stop(now + releaseDuration + 0.01);
					} catch {
						// Source may have already ended naturally
					}
				};

				this.activeNotes.set(midiNote, { stop });
				return stop;
			}
		}

		// Fallback to synthesized tone with release
		return this.playToneWithRelease(midiNote);
	}

	/**
	 * Stop an active note by MIDI note number.
	 *
	 * Triggers the release envelope for the note and removes it from the
	 * active notes map. No-op if the note is not currently playing.
	 *
	 * TODO: Renderers (PianoRoll, PianoKeys, DrumPads) should call this
	 * from their handleNoteOff callbacks for interactive keyboard support.
	 */
	stopNote(midiNote: number): void {
		const active = this.activeNotes.get(midiNote);
		if (active) {
			active.stop();
			// stop() itself calls activeNotes.delete, but be safe
			this.activeNotes.delete(midiNote);
		}
	}

	/**
	 * Stop all currently active notes. Useful when switching views or
	 * cleaning up.
	 */
	stopAllNotes(): void {
		for (const [, active] of this.activeNotes) {
			active.stop();
		}
		this.activeNotes.clear();
	}

	/**
	 * Play a short metronome click (high-pitched sine tick).
	 */
	playClick(): void {
		if (!this.ctx) return;
		const osc = this.ctx.createOscillator();
		const gain = this.ctx.createGain();
		osc.type = "sine";
		osc.frequency.value = 1000;
		gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(
			0.001,
			this.ctx.currentTime + 0.05
		);
		osc.connect(gain);
		gain.connect(this.output);
		osc.start();
		osc.stop(this.ctx.currentTime + 0.05);
	}

	/**
	 * Clean up resources when the plugin is unloaded.
	 */
	dispose(): void {
		this.stopAllNotes();
		if (this.ctx) {
			this.ctx.close();
		}
		this.ctx = null;
		this.sampleBuffers = [];
		this.initialized = false;
	}
}
