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

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private sampleBuffers: AudioBuffer[] = [];
	private initialized = false;
	private soundbankManager: SoundbankManager | null = null;

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
	 * Falls back to synthesized tone if the soundbank is not loaded or
	 * the note is not found.
	 */
	playSoundbankNote(slug: string, midiNote: number): void {
		if (!this.ctx || !this.initialized) return;

		if (this.soundbankManager) {
			const buffer = this.soundbankManager.findSampleForNote(
				slug,
				midiNote
			);
			if (buffer) {
				const source = this.ctx.createBufferSource();
				source.buffer = buffer;
				source.connect(this.ctx.destination);
				source.start();
				return;
			}
		}

		// Fallback to synthesized tone
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
		if (this.ctx) {
			this.ctx.close();
		}
		this.ctx = null;
		this.sampleBuffers = [];
		this.initialized = false;
	}
}
