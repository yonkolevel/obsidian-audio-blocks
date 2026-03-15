/**
 * Programmatic drum sound synthesis.
 *
 * Each generator creates an AudioBuffer containing a short percussive sound.
 * These are used as the built-in sample set so the prototype works without
 * shipping any .wav files.
 */

export interface SampleGenerator {
	(ctx: AudioContext): AudioBuffer;
}

// ---------------------------------------------------------------------------
// Individual drum generators
// ---------------------------------------------------------------------------

function generateKick(ctx: AudioContext, pitchMul = 1): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.35;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const freq = 150 * pitchMul * Math.exp(-t * 20);
		const amp = Math.exp(-t * 8);
		data[i] = Math.sin(2 * Math.PI * freq * t) * amp * 0.9;
	}
	return buffer;
}

function generateSnare(ctx: AudioContext, toneMix = 0.3): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.2;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const noise = Math.random() * 2 - 1;
		const tone = Math.sin(2 * Math.PI * 200 * t);
		const amp = Math.exp(-t * 15);
		data[i] = (noise * (1 - toneMix) + tone * toneMix) * amp * 0.8;
	}
	return buffer;
}

function generateClap(ctx: AudioContext): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.15;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const noise = Math.random() * 2 - 1;
		// Multiple short bursts to simulate clap
		const burst =
			(t < 0.01 ? 1 : 0) +
			(t > 0.015 && t < 0.025 ? 0.8 : 0) +
			(t > 0.03 && t < 0.04 ? 0.6 : 0) +
			(t > 0.04 ? Math.exp(-(t - 0.04) * 30) : 0);
		data[i] = noise * burst * 0.7;
	}
	return buffer;
}

function generateRimshot(ctx: AudioContext): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.08;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const tone = Math.sin(2 * Math.PI * 800 * t);
		const amp = Math.exp(-t * 50);
		data[i] = tone * amp * 0.6;
	}
	return buffer;
}

function generateClosedHiHat(ctx: AudioContext): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.06;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const noise = Math.random() * 2 - 1;
		const amp = Math.exp(-t * 60);
		data[i] = noise * amp * 0.4;
	}
	return buffer;
}

function generateOpenHiHat(ctx: AudioContext): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.3;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const noise = Math.random() * 2 - 1;
		const amp = Math.exp(-t * 10);
		data[i] = noise * amp * 0.35;
	}
	return buffer;
}

function generatePerc(ctx: AudioContext, freq: number, decay: number): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.25;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const tone = Math.sin(2 * Math.PI * freq * t);
		const noise = Math.random() * 2 - 1;
		const amp = Math.exp(-t * decay);
		data[i] = (tone * 0.6 + noise * 0.4) * amp * 0.5;
	}
	return buffer;
}

function generateTom(ctx: AudioContext, freq: number): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.3;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		const f = freq * Math.exp(-t * 8);
		const amp = Math.exp(-t * 10);
		data[i] = Math.sin(2 * Math.PI * f * t) * amp * 0.7;
	}
	return buffer;
}

function generateFX(ctx: AudioContext, variant: number): AudioBuffer {
	const sampleRate = ctx.sampleRate;
	const duration = 0.4;
	const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
	const data = buffer.getChannelData(0);
	const baseFreq = 300 + variant * 100;
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		// Frequency sweep up or down depending on variant
		const sweep = variant % 2 === 0 ? 1 + t * 5 : Math.exp(-t * 3);
		const tone = Math.sin(2 * Math.PI * baseFreq * sweep * t);
		const amp = Math.exp(-t * 6);
		data[i] = tone * amp * 0.4;
	}
	return buffer;
}

// ---------------------------------------------------------------------------
// Build the full 16-pad sample set
// ---------------------------------------------------------------------------

/**
 * Returns an array of 16 AudioBuffers — one for each pad in the 4x4 grid.
 * Order matches PAD_LABELS in DrumPads.tsx:
 *   Kick, Snare, Clap, Rim,
 *   CH, OH, Perc1, Perc2,
 *   Tom1, Tom2, Tom3, Tom4,
 *   FX1, FX2, FX3, FX4
 */
export function generateDrumKit(ctx: AudioContext): AudioBuffer[] {
	return [
		generateKick(ctx, 1),        // 0  Kick
		generateSnare(ctx, 0.3),     // 1  Snare
		generateClap(ctx),           // 2  Clap
		generateRimshot(ctx),        // 3  Rim
		generateClosedHiHat(ctx),    // 4  CH
		generateOpenHiHat(ctx),      // 5  OH
		generatePerc(ctx, 500, 20),  // 6  Perc 1
		generatePerc(ctx, 700, 25),  // 7  Perc 2
		generateTom(ctx, 200),       // 8  Tom 1
		generateTom(ctx, 160),       // 9  Tom 2
		generateTom(ctx, 120),       // 10 Tom 3
		generateTom(ctx, 90),        // 11 Tom 4
		generateFX(ctx, 0),          // 12 FX 1
		generateFX(ctx, 1),          // 13 FX 2
		generateFX(ctx, 2),          // 14 FX 3
		generateFX(ctx, 3),          // 15 FX 4
	];
}
