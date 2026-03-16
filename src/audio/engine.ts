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

		this.sampleBuffers = generateDrumKit(this.ctx);
		this.initialized = true;
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
		source.connect(this.ctx.destination);
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

				source.connect(this.ctx.destination);
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
	 * Play a melodic tone at the given MIDI note number.
	 * Uses FM synthesis to approximate an electric piano sound.
	 */
	playTone(midiNote: number, duration = 1.2): void {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

		// FM synthesis: modulator → carrier
		const carrier = this.ctx.createOscillator();
		const modulator = this.ctx.createOscillator();
		const modGain = this.ctx.createGain();
		const output = this.ctx.createGain();

		carrier.type = "sine";
		carrier.frequency.value = freq;

		// Modulator at 2x frequency, depth decays for bell-like attack
		modulator.type = "sine";
		modulator.frequency.value = freq * 2;
		modGain.gain.setValueAtTime(freq * 1.5, t);
		modGain.gain.exponentialRampToValueAtTime(freq * 0.01, t + duration * 0.8);

		modulator.connect(modGain);
		modGain.connect(carrier.frequency);

		// Piano-like envelope: fast attack, quick decay to sustain, then release
		output.gain.setValueAtTime(0, t);
		output.gain.linearRampToValueAtTime(0.25, t + 0.005);
		output.gain.exponentialRampToValueAtTime(0.08, t + 0.1);
		output.gain.exponentialRampToValueAtTime(0.001, t + duration);

		carrier.connect(output);
		output.connect(this.ctx.destination);

		carrier.start(t);
		modulator.start(t);
		carrier.stop(t + duration);
		modulator.stop(t + duration);
	}

	/**
	 * Play a melodic tone that sustains until explicitly stopped.
	 *
	 * Returns a stop function that triggers the release envelope, or null if
	 * the engine is not initialized. The note is also tracked in the
	 * activeNotes map so it can be stopped via `stopNote(midiNote)`.
	 *
	 * If the same MIDI note is already playing, the previous instance is
	 * stopped before the new one begins (re-trigger behavior).
	 *
	 * Used for interactive keyboard playing where the user holds a key and
	 * releases it. For sequencer playback with known durations, use
	 * `playTone(midiNote, duration)` instead.
	 */
	playToneWithRelease(midiNote: number): (() => void) | null {
		if (!this.ctx) return null;

		// Re-trigger: stop the previous instance of this note if still active
		this.stopNote(midiNote);

		const ctx = this.ctx;
		const t = ctx.currentTime;
		const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

		// FM synthesis: modulator → carrier (same timbre as playTone)
		const carrier = ctx.createOscillator();
		const modulator = ctx.createOscillator();
		const modGain = ctx.createGain();
		const output = ctx.createGain();

		carrier.type = "sine";
		carrier.frequency.value = freq;

		modulator.type = "sine";
		modulator.frequency.value = freq * 2;
		// Modulation depth decays to a sustain level (not to silence)
		modGain.gain.setValueAtTime(freq * 1.5, t);
		modGain.gain.exponentialRampToValueAtTime(freq * 0.3, t + 0.3);

		modulator.connect(modGain);
		modGain.connect(carrier.frequency);

		// Envelope: fast attack → decay → sustain at 0.08
		output.gain.setValueAtTime(0, t);
		output.gain.linearRampToValueAtTime(0.25, t + 0.005);
		output.gain.exponentialRampToValueAtTime(0.08, t + 0.1);
		// Hold at sustain level indefinitely (no scheduled stop)

		carrier.connect(output);
		output.connect(ctx.destination);

		carrier.start(t);
		modulator.start(t);

		let released = false;

		const stop = () => {
			if (released) return;
			released = true;
			this.activeNotes.delete(midiNote);

			const now = ctx.currentTime;
			const releaseDuration = 0.15;

			// Cancel any in-progress ramps and ramp to silence
			output.gain.cancelScheduledValues(now);
			output.gain.setValueAtTime(output.gain.value, now);
			output.gain.linearRampToValueAtTime(0, now + releaseDuration);

			// Also fade out the modulation depth
			modGain.gain.cancelScheduledValues(now);
			modGain.gain.setValueAtTime(modGain.gain.value, now);
			modGain.gain.linearRampToValueAtTime(0, now + releaseDuration);

			// Stop oscillators after the release finishes
			carrier.stop(now + releaseDuration + 0.01);
			modulator.stop(now + releaseDuration + 0.01);
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
				output.connect(ctx.destination);
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
		gain.connect(this.ctx.destination);
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
