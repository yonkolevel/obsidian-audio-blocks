/**
 * AudioEngine — singleton managing the Elementary Audio DSP graph.
 *
 * Uses elementary-audio-kit for instruments (drumSampler, melodicSampler)
 * and mixer (mixTracks, masterOutput). All audio runs through a single
 * persistent graph that is re-rendered on every state change — Elementary's
 * diffing engine ensures only changed nodes trigger recomputation.
 *
 * Public API is identical to the previous Web Audio implementation.
 */

import { el, type NodeRepr_t } from "@elemaudio/core";
import {
	drumSampler,
	type DrumPadConfig,
	VoiceAllocator,
	midiToRate,
	mixTracks,
	masterOutput,
	type ChannelStrip,
} from "elementary-audio-kit";
import { ElementaryRenderer } from "./elementary-renderer";
import { SoundbankManager } from "./soundbank-manager";
import {
	generateDrumKitVFS,
	generatePianoSampleVFS,
	generateClickVFS,
} from "./synth-samples";

/** MIDI note number of the pre-generated synth piano VFS sample. */
const SYNTH_PIANO_BASE_MIDI = 60;

export class AudioEngine {
	private renderer = new ElementaryRenderer();
	private ctx: AudioContext | null = null;
	private initialized = false;
	private soundbankManager: SoundbankManager | null = null;

	// -- Built-in drum kit (16 pads) --
	private builtinDrumGates: number[] = [];
	private builtinDrumVfsKeys: string[] = [];

	// -- Soundbank one-shot pads --
	// slug → Map<sampleMidiNumber, { gate, rate }>
	private soundbankPadStates: Map<
		string,
		Map<number, { gate: number; rate: number }>
	> = new Map();
	private soundbankVfsKeys: Map<string, Map<number, string>> = new Map();

	// -- Melodic voice allocator --
	private voiceAllocator = new VoiceAllocator(8);
	private activeMelodicSlug: string | null = null;

	// -- Click --
	private clickGate = 0;

	// -- Gate reset scheduling --
	private gateResets: Map<string, ReturnType<typeof setTimeout>> = new Map();

	// ===================================================================
	// Public API (signatures identical to previous Web Audio engine)
	// ===================================================================

	setSoundbankManager(manager: SoundbankManager): void {
		this.soundbankManager = manager;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		this.ctx = new AudioContext();
		if (this.ctx.state === "suspended") {
			await this.ctx.resume();
		}

		await this.renderer.initialize(this.ctx);

		// Generate and load built-in samples to VFS
		const sampleRate = this.ctx.sampleRate;
		const drumKit = generateDrumKitVFS(sampleRate);
		const vfsUpdate: Record<string, Float32Array> = {};

		this.builtinDrumGates = new Array(drumKit.length).fill(0);
		this.builtinDrumVfsKeys = [];
		for (let i = 0; i < drumKit.length; i++) {
			const key = `kit/${i}`;
			vfsUpdate[key] = drumKit[i];
			this.builtinDrumVfsKeys.push(key);
		}

		vfsUpdate["synth/piano"] = generatePianoSampleVFS(sampleRate);
		vfsUpdate["synth/click"] = generateClickVFS(sampleRate);

		this.renderer.loadSamplesToVFS(vfsUpdate);
		this.initialized = true;
		this.renderGraph();
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	isSoundbankLoaded(slug: string): boolean {
		if (!this.soundbankManager) return false;
		return this.soundbankManager.getSoundbank(slug) !== null;
	}

	getAudioContext(): AudioContext | null {
		return this.ctx;
	}

	/**
	 * Play a one-shot sample for the given pad index (0-15).
	 */
	playSample(padIndex: number): void {
		if (!this.initialized) return;
		if (padIndex < 0 || padIndex >= this.builtinDrumGates.length) return;

		this.triggerOneShot(
			`kit-${padIndex}`,
			() => {
				this.builtinDrumGates[padIndex] = 1;
			},
			() => {
				this.builtinDrumGates[padIndex] = 0;
			}
		);
	}

	/**
	 * Play a soundbank sample for the given MIDI note (one-shot).
	 * Falls back to synthesized tone if no soundbank or out of range.
	 */
	playSoundbankNote(slug: string, midiNote: number): void {
		if (!this.initialized) return;

		const nearest = this.findNearestSoundbankSample(slug, midiNote);
		if (!nearest) {
			this.playTone(midiNote);
			return;
		}

		const padStates = this.soundbankPadStates.get(slug);
		if (!padStates) {
			this.playTone(midiNote);
			return;
		}

		const state = padStates.get(nearest.sampleMidi);
		if (!state) {
			this.playTone(midiNote);
			return;
		}

		this.triggerOneShot(
			`sb-${slug}-${nearest.sampleMidi}`,
			() => {
				state.gate = 1;
				state.rate = nearest.rate;
			},
			() => {
				state.gate = 0;
			}
		);
	}

	/**
	 * Lazy-load a soundbank by slug. Returns true if loaded successfully.
	 */
	async loadSoundbankForBlock(slug: string): Promise<boolean> {
		if (!this.soundbankManager || !this.ctx) return false;

		const loaded = await this.soundbankManager.loadSoundbank(
			slug,
			this.ctx
		);
		if (!loaded) return false;

		// Load samples into VFS
		const keyMap = this.soundbankManager.loadSoundbankToVFS(
			slug,
			this.renderer
		);
		if (!keyMap) return false;

		// Set up pad states for one-shot triggering
		const padStates = new Map<number, { gate: number; rate: number }>();
		for (const [midiNumber] of loaded.samples) {
			padStates.set(midiNumber, { gate: 0, rate: 1 });
		}
		this.soundbankPadStates.set(slug, padStates);
		this.soundbankVfsKeys.set(slug, keyMap);

		this.renderGraph();
		return true;
	}

	getSoundbankDefaultOctave(slug: string): number | null {
		if (!this.soundbankManager) return null;
		const config = this.soundbankManager.getConfig(slug);
		return config?.defaultOctave ?? null;
	}

	getSampleNameForNote(slug: string, midiNote: number): string | null {
		return (
			this.soundbankManager?.getSampleNameForNote(slug, midiNote) ??
			null
		);
	}

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
	 * Play a melodic tone at the given MIDI note number (fixed duration).
	 */
	playTone(midiNote: number, duration = 1.5): void {
		if (!this.initialized) return;

		this.activeMelodicSlug = null;
		this.voiceAllocator.noteOn(midiNote);
		this.renderGraph();

		setTimeout(() => {
			this.voiceAllocator.noteOff(midiNote);
			this.renderGraph();
		}, duration * 700);
	}

	/**
	 * Play a melodic tone that sustains until explicitly stopped.
	 */
	playToneWithRelease(midiNote: number): (() => void) | null {
		if (!this.initialized) return null;

		// Stop existing note at this pitch
		this.voiceAllocator.noteOff(midiNote);

		this.activeMelodicSlug = null;
		this.voiceAllocator.noteOn(midiNote);
		this.renderGraph();

		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.voiceAllocator.noteOff(midiNote);
			this.renderGraph();
		};
	}

	/**
	 * Play a soundbank sample that sustains until explicitly stopped.
	 * Falls back to playToneWithRelease if no soundbank or out of range.
	 */
	playSoundbankNoteWithRelease(
		slug: string,
		midiNote: number
	): (() => void) | null {
		if (!this.initialized) return null;

		const vfsKeys = this.soundbankVfsKeys.get(slug);
		if (!vfsKeys) {
			return this.playToneWithRelease(midiNote);
		}

		const nearest = this.findNearestSoundbankSample(slug, midiNote);
		if (!nearest) {
			return this.playToneWithRelease(midiNote);
		}

		// Stop existing note at this pitch
		this.voiceAllocator.noteOff(midiNote);

		this.activeMelodicSlug = slug;
		this.voiceAllocator.noteOn(midiNote);
		this.renderGraph();

		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.voiceAllocator.noteOff(midiNote);
			this.renderGraph();
		};
	}

	stopNote(midiNote: number): void {
		this.voiceAllocator.noteOff(midiNote);
		this.renderGraph();
	}

	stopAllNotes(): void {
		const voices = this.voiceAllocator.getVoices();
		for (const voice of voices) {
			if (voice.gate > 0) {
				this.voiceAllocator.noteOff(voice.note);
			}
		}
		this.renderGraph();
	}

	playClick(): void {
		if (!this.initialized) return;
		this.triggerOneShot(
			"click",
			() => {
				this.clickGate = 1;
			},
			() => {
				this.clickGate = 0;
			}
		);
	}

	dispose(): void {
		this.stopAllNotes();
		for (const timer of this.gateResets.values()) {
			clearTimeout(timer);
		}
		this.gateResets.clear();
		this.renderer.dispose();
		if (this.ctx) {
			this.ctx.close();
		}
		this.ctx = null;
		this.initialized = false;
	}

	// ===================================================================
	// Private — one-shot trigger mechanism
	// ===================================================================

	/**
	 * Trigger a one-shot sound by toggling a gate high then scheduling
	 * a reset to low. Handles rapid re-triggering by forcing a gate-low
	 * render, waiting one audio callback (~5ms), then re-triggering.
	 */
	private triggerOneShot(
		id: string,
		activate: () => void,
		deactivate: () => void
	): void {
		const existing = this.gateResets.get(id);

		if (existing) {
			// Gate is still high from a recent trigger — reset first
			clearTimeout(existing);
			this.gateResets.delete(id);
			deactivate();
			this.renderGraph();

			// Wait for the audio thread to see gate=0 before re-triggering
			setTimeout(() => {
				activate();
				this.renderGraph();
				this.scheduleGateReset(id, deactivate);
			}, 5);
		} else {
			activate();
			this.renderGraph();
			this.scheduleGateReset(id, deactivate);
		}
	}

	private scheduleGateReset(
		id: string,
		deactivate: () => void
	): void {
		this.gateResets.set(
			id,
			setTimeout(() => {
				this.gateResets.delete(id);
				deactivate();
				this.renderGraph();
			}, 50)
		);
	}

	// ===================================================================
	// Private — nearest sample lookup
	// ===================================================================

	private findNearestSoundbankSample(
		slug: string,
		midiNote: number
	): { sampleMidi: number; rate: number } | null {
		if (!this.soundbankManager) return null;

		const match = this.soundbankManager.findNearestSample(slug, midiNote);
		if (!match) return null;

		const semitoneDiff = midiNote - match.rootNote;
		if (Math.abs(semitoneDiff) > 12) return null;

		return {
			sampleMidi: match.rootNote,
			rate: Math.pow(2, semitoneDiff / 12),
		};
	}

	// ===================================================================
	// Private — graph building and rendering
	// ===================================================================

	private renderGraph(): void {
		if (!this.renderer.isReady()) return;

		const tracks: ChannelStrip[] = [];

		// 1. Built-in drum kit
		const kitPads = this.buildBuiltinDrumPads();
		if (kitPads.length > 0) {
			const { signal } = drumSampler({ trackId: "kit", pads: kitPads });
			tracks.push({ trackId: "kit", signal, volume: 0.8 });
		}

		// 2. Soundbank one-shot pads (custom nodes with per-pad rate)
		for (const [slug, padStates] of this.soundbankPadStates) {
			const signal = this.buildSoundbankOneShotNodes(slug, padStates);
			tracks.push({ trackId: `sb-${slug}`, signal, volume: 0.8 });
		}

		// 3. Click
		tracks.push({
			trackId: "click",
			signal: el.sample(
				{
					path: "synth/click",
					mode: "trigger",
					key: "click-sample",
				},
				el.const({ key: "click-gate", value: this.clickGate }),
				1
			),
			volume: 0.3,
		});

		// 4. Melodic voices
		const melodicSignal = this.buildMelodicVoices();
		tracks.push({ trackId: "melodic", signal: melodicSignal, volume: 0.7 });

		// Mix and master
		const mix = mixTracks(tracks);
		const output = masterOutput(mix, 1.5, 0.5);
		this.renderer.render(output.left, output.right);
	}

	private buildBuiltinDrumPads(): DrumPadConfig[] {
		return this.builtinDrumVfsKeys.map((vfsKey, i) => ({
			vfsKey,
			midiNumber: i,
			gate: this.builtinDrumGates[i] ?? 0,
		}));
	}

	/**
	 * Build one-shot sample nodes for a soundbank with per-pad rate
	 * (for pitch-shifted playback). Can't use drumSampler() here
	 * because it hardcodes rate=1.
	 */
	private buildSoundbankOneShotNodes(
		slug: string,
		padStates: Map<number, { gate: number; rate: number }>
	): NodeRepr_t {
		const vfsKeys = this.soundbankVfsKeys.get(slug);
		if (!vfsKeys) return el.const({ value: 0 });

		const signals: NodeRepr_t[] = [];

		for (const [midiNumber, state] of padStates) {
			const vfsKey = vfsKeys.get(midiNumber);
			if (!vfsKey) continue;

			const gate = el.const({
				key: `sb-${slug}-${midiNumber}-gate`,
				value: state.gate,
			});
			const rate = el.const({
				key: `sb-${slug}-${midiNumber}-rate`,
				value: state.rate,
			});

			signals.push(
				el.sample(
					{
						path: vfsKey,
						mode: "trigger",
						key: `sb-${slug}-${midiNumber}-sample`,
					},
					gate,
					rate
				)
			);
		}

		if (signals.length === 0) return el.const({ value: 0 });

		let mix: NodeRepr_t = signals[0]!;
		for (let i = 1; i < signals.length; i++) {
			mix = el.add(mix, signals[i]!);
		}
		return mix;
	}

	/**
	 * Build polyphonic melodic voice nodes. Each voice gets the nearest
	 * VFS sample for its note and a pitch-shifting rate.
	 */
	private buildMelodicVoices(): NodeRepr_t {
		const voices = this.voiceAllocator.getVoices();

		const signals: NodeRepr_t[] = voices.map((voice) => {
			if (voice.note === 0) {
				return el.const({
					key: `mel:v${voice.key}:silent`,
					value: 0,
				});
			}

			const { vfsKey, baseMidi } = this.getVfsKeyForMelodicNote(
				voice.note
			);
			const rate = midiToRate(voice.note, baseMidi);

			const gate = el.const({
				key: `mel:v${voice.key}:gate`,
				value: voice.gate,
			});
			const rateNode = el.const({
				key: `mel:v${voice.key}:rate`,
				value: rate,
			});

			// ADSR envelope to avoid clicks on note-off.
			// 3ms attack, 100ms decay to 35% sustain, 150ms release.
			const env = el.adsr(0.003, 0.1, 0.35, 0.15, gate);

			return el.mul(
				el.sample(
					{
						path: vfsKey,
						mode: "trigger",
						key: `mel:v${voice.key}:sample`,
					},
					gate,
					rateNode
				),
				env
			);
		});

		let mix: NodeRepr_t = signals[0]!;
		for (let i = 1; i < signals.length; i++) {
			mix = el.add(mix, signals[i]!);
		}
		return mix;
	}

	/**
	 * Resolve a MIDI note to a VFS key and base MIDI number.
	 * Uses the active soundbank if available, falls back to synth piano.
	 */
	private getVfsKeyForMelodicNote(midiNote: number): {
		vfsKey: string;
		baseMidi: number;
	} {
		if (this.activeMelodicSlug) {
			const vfsKeys = this.soundbankVfsKeys.get(
				this.activeMelodicSlug
			);
			if (vfsKeys) {
				let bestKey = "";
				let bestMidi = SYNTH_PIANO_BASE_MIDI;
				let bestDist = Infinity;

				for (const [sampleMidi, vfsKey] of vfsKeys) {
					const dist = Math.abs(midiNote - sampleMidi);
					if (dist < bestDist) {
						bestDist = dist;
						bestKey = vfsKey;
						bestMidi = sampleMidi;
					}
				}

				if (bestKey && bestDist <= 12) {
					return { vfsKey: bestKey, baseMidi: bestMidi };
				}
			}
		}

		return { vfsKey: "synth/piano", baseMidi: SYNTH_PIANO_BASE_MIDI };
	}
}
