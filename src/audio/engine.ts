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

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private sampleBuffers: AudioBuffer[] = [];
	private initialized = false;

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
