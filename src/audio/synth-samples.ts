/**
 * Programmatic drum sound synthesis.
 *
 * Each generator creates sample data as Float32Array for loading into
 * Elementary Audio's Virtual File System. The same math is also available
 * wrapped in AudioBuffers for legacy callers (generateDrumKit).
 */

export interface SampleGenerator {
	(ctx: AudioContext): AudioBuffer;
}

// ---------------------------------------------------------------------------
// Core renderers (pure math → Float32Array, no AudioContext needed)
// ---------------------------------------------------------------------------

function renderKick(sampleRate: number, pitchMul = 1): Float32Array {
	const duration = 0.35;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const freq = 150 * pitchMul * Math.exp(-t * 20);
		const amp = Math.exp(-t * 8);
		data[i] = Math.sin(2 * Math.PI * freq * t) * amp * 0.9;
	}
	return data;
}

function renderSnare(sampleRate: number, toneMix = 0.3): Float32Array {
	const duration = 0.2;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const noise = Math.random() * 2 - 1;
		const tone = Math.sin(2 * Math.PI * 200 * t);
		const amp = Math.exp(-t * 15);
		data[i] = (noise * (1 - toneMix) + tone * toneMix) * amp * 0.8;
	}
	return data;
}

function renderClap(sampleRate: number): Float32Array {
	const duration = 0.15;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const noise = Math.random() * 2 - 1;
		const burst =
			(t < 0.01 ? 1 : 0) +
			(t > 0.015 && t < 0.025 ? 0.8 : 0) +
			(t > 0.03 && t < 0.04 ? 0.6 : 0) +
			(t > 0.04 ? Math.exp(-(t - 0.04) * 30) : 0);
		data[i] = noise * burst * 0.7;
	}
	return data;
}

function renderRimshot(sampleRate: number): Float32Array {
	const duration = 0.08;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const tone = Math.sin(2 * Math.PI * 800 * t);
		const amp = Math.exp(-t * 50);
		data[i] = tone * amp * 0.6;
	}
	return data;
}

function renderClosedHiHat(sampleRate: number): Float32Array {
	const duration = 0.06;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const noise = Math.random() * 2 - 1;
		const amp = Math.exp(-t * 60);
		data[i] = noise * amp * 0.4;
	}
	return data;
}

function renderOpenHiHat(sampleRate: number): Float32Array {
	const duration = 0.3;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const noise = Math.random() * 2 - 1;
		const amp = Math.exp(-t * 10);
		data[i] = noise * amp * 0.35;
	}
	return data;
}

function renderPerc(sampleRate: number, freq: number, decay: number): Float32Array {
	const duration = 0.25;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const tone = Math.sin(2 * Math.PI * freq * t);
		const noise = Math.random() * 2 - 1;
		const amp = Math.exp(-t * decay);
		data[i] = (tone * 0.6 + noise * 0.4) * amp * 0.5;
	}
	return data;
}

function renderTom(sampleRate: number, freq: number): Float32Array {
	const duration = 0.3;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const f = freq * Math.exp(-t * 8);
		const amp = Math.exp(-t * 10);
		data[i] = Math.sin(2 * Math.PI * f * t) * amp * 0.7;
	}
	return data;
}

function renderFX(sampleRate: number, variant: number): Float32Array {
	const duration = 0.4;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	const baseFreq = 300 + variant * 100;
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const sweep = variant % 2 === 0 ? 1 + t * 5 : Math.exp(-t * 3);
		const tone = Math.sin(2 * Math.PI * baseFreq * sweep * t);
		const amp = Math.exp(-t * 6);
		data[i] = tone * amp * 0.4;
	}
	return data;
}

// ---------------------------------------------------------------------------
// VFS generators (Float32Array, for Elementary Audio's Virtual File System)
// ---------------------------------------------------------------------------

/**
 * Generate 16 drum samples as Float32Arrays for VFS loading.
 * Returns array indexed by pad number (0-15).
 */
export function generateDrumKitVFS(sampleRate: number): Float32Array[] {
	return [
		renderKick(sampleRate, 1),        // 0  Kick
		renderSnare(sampleRate, 0.3),     // 1  Snare
		renderClap(sampleRate),           // 2  Clap
		renderRimshot(sampleRate),        // 3  Rim
		renderClosedHiHat(sampleRate),    // 4  CH
		renderOpenHiHat(sampleRate),      // 5  OH
		renderPerc(sampleRate, 500, 20),  // 6  Perc 1
		renderPerc(sampleRate, 700, 25),  // 7  Perc 2
		renderTom(sampleRate, 200),       // 8  Tom 1
		renderTom(sampleRate, 160),       // 9  Tom 2
		renderTom(sampleRate, 120),       // 10 Tom 3
		renderTom(sampleRate, 90),        // 11 Tom 4
		renderFX(sampleRate, 0),          // 12 FX 1
		renderFX(sampleRate, 1),          // 13 FX 2
		renderFX(sampleRate, 2),          // 14 FX 3
		renderFX(sampleRate, 3),          // 15 FX 4
	];
}

/**
 * Generate a piano-like sample at middle C (MIDI 60) for VFS loading.
 * Uses additive synthesis with the same partial structure as the
 * original Web Audio piano voice. 2 seconds long to support sustained use.
 */
export function generatePianoSampleVFS(sampleRate: number): Float32Array {
	const duration = 2.0;
	const length = Math.floor(sampleRate * duration);
	const data = new Float32Array(length);
	const freq = 261.63; // Middle C (C4, MIDI 60)

	// Partials: [frequency multiplier, initial gain, decay time constant]
	const partials: [number, number, number][] = [
		[1.0, 0.35, 0.8],
		[1.002, 0.2, 0.8],
		[2.0, 0.1, 0.4],
		[3.01, 0.03, 0.25],
		[4.0, 0.015, 0.15],
	];

	for (let i = 0; i < length; i++) {
		const t = i / sampleRate;
		let sample = 0;

		for (const [ratio, gain, decayRate] of partials) {
			const partialGain =
				ratio > 1.5
					? gain * Math.exp(-t / decayRate)
					: gain;
			sample += Math.sin(2 * Math.PI * freq * ratio * t) * partialGain;
		}

		// Master envelope: fast attack → decay to sustain → slow release
		const attack = Math.min(t / 0.003, 1);
		const decay = t > 0.003 ? 0.35 + 0.65 * Math.exp(-(t - 0.003) / 0.12) : 1;
		const release = t > 1.4 ? Math.exp(-(t - 1.4) / 0.15) : 1;

		// Noise transient (hammer hit)
		const noiseAmp = t < 0.015 ? 0.06 * Math.exp(-t * 200) : 0;
		const noise = (Math.random() * 2 - 1) * noiseAmp;

		data[i] = (sample * attack * decay * release + noise) * 0.8;
	}

	return data;
}

/**
 * Generate a metronome click sample for VFS loading.
 * 1kHz sine with 50ms exponential decay.
 */
export function generateClickVFS(sampleRate: number): Float32Array {
	const duration = 0.06;
	const data = new Float32Array(Math.floor(sampleRate * duration));
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const tone = Math.sin(2 * Math.PI * 1000 * t);
		const amp = Math.exp(-t * 60); // ~50ms decay
		data[i] = tone * amp * 0.3;
	}
	return data;
}

// ---------------------------------------------------------------------------
// Legacy AudioBuffer generators (used by old Web Audio engine)
// ---------------------------------------------------------------------------

function toAudioBuffer(ctx: AudioContext, data: Float32Array): AudioBuffer {
	const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
	buffer.getChannelData(0).set(data);
	return buffer;
}

/**
 * Returns an array of 16 AudioBuffers — one for each pad in the 4x4 grid.
 * @deprecated Use generateDrumKitVFS + ElementaryRenderer.loadSamplesToVFS instead.
 */
export function generateDrumKit(ctx: AudioContext): AudioBuffer[] {
	return generateDrumKitVFS(ctx.sampleRate).map((data) =>
		toAudioBuffer(ctx, data)
	);
}
