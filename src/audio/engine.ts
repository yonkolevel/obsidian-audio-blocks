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
	 * Play a melodic tone at the given MIDI note number.
	 * Uses a triangle oscillator with a quick exponential decay.
	 */
	playTone(midiNote: number, duration = 0.3): void {
		if (!this.ctx) return;
		const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
		const osc = this.ctx.createOscillator();
		const gain = this.ctx.createGain();
		osc.type = "triangle";
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(
			0.001,
			this.ctx.currentTime + duration
		);
		osc.connect(gain);
		gain.connect(this.ctx.destination);
		osc.start();
		osc.stop(this.ctx.currentTime + duration);
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
