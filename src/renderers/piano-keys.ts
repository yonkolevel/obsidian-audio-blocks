/**
 * Piano keys renderer.
 *
 * Exports `mountPianoKeys()` — handles engine init, soundbank load, focus
 * management, and React rendering. Called by both the legacy `pianoKeys`
 * code block processor and the `music keys` variant.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { PianoKeys } from "../components/PianoKeys";
import { AudioEngine } from "../audio/engine";
import { FocusManager } from "../audio/focus-manager";
import { parseSimpleYaml } from "./drum-pads";

// ---------------------------------------------------------------------------
// Note name helpers
// ---------------------------------------------------------------------------

const NOTE_NAME_TO_SEMITONE: Record<string, number> = {
	C: 0, "C#": 1, Db: 1,
	D: 2, "D#": 3, Eb: 3,
	E: 4, Fb: 4,
	F: 5, "E#": 5, "F#": 6, Gb: 6,
	G: 7, "G#": 8, Ab: 8,
	A: 9, "A#": 10, Bb: 10,
	B: 11, Cb: 11,
};

/**
 * Convert a note name ("C", "C#", "Db", "C4", "F#3") or a MIDI number string
 * to a MIDI number. Defaults to octave 4 when no octave is provided.
 */
function noteNameToMidi(name: string): number | undefined {
	const trimmed = name.trim();
	if (!trimmed) return undefined;

	const asNumber = parseInt(trimmed, 10);
	if (!isNaN(asNumber) && String(asNumber) === trimmed) return asNumber;

	const match = trimmed.match(/^([A-Ga-g][#b]?)(-?\d)?$/);
	if (!match) return undefined;

	const notePart = match[1].charAt(0).toUpperCase() + match[1].slice(1);
	const octave = match[2] !== undefined ? parseInt(match[2], 10) : 4;
	const semitone = NOTE_NAME_TO_SEMITONE[notePart];
	if (semitone === undefined) return undefined;

	return (octave + 1) * 12 + semitone;
}

/**
 * Parse a comma-separated list of note names or MIDI numbers, or a
 * pre-parsed YAML array of strings/numbers.
 * Supports: `"C,E,G"`, `"C4,E4,G4"`, `"60,64,67"`, `"[C4, E4, G4]"`,
 * `["C4", "E4", "G4"]`, `[60, 64, 67]`.
 */
export function parseNoteNames(value: unknown): number[] | undefined {
	if (value === undefined || value === null) return undefined;

	if (Array.isArray(value)) {
		const notes = value
			.map((v) =>
				typeof v === "number" ? v : noteNameToMidi(String(v))
			)
			.filter((n): n is number => n !== undefined);
		return notes.length > 0 ? notes : undefined;
	}

	const str = String(value);
	if (!str) return undefined;
	const cleaned = str.replace(/[\[\]]/g, "");
	const notes = cleaned
		.split(",")
		.map((s) => noteNameToMidi(s))
		.filter((n): n is number => n !== undefined);
	return notes.length > 0 ? notes : undefined;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export interface PianoKeysMountOptions {
	/** Soundbank slug — if empty, the built-in synth is used. */
	soundbank: string;
	octaves?: number;
	hint?: string;
	highlightedNotes?: number[];
	highlightColor?: string;
	validation?: "interaction" | "chord" | "scale";
	minInteractions?: number;
	expectedChord?: number[];
	expectedScale?: number[];
}

export function mountPianoKeys(
	el: HTMLElement,
	engine: AudioEngine,
	focusManager: FocusManager,
	options: PianoKeysMountOptions
): Root {
	const soundbankSlug = options.soundbank;
	const container = el.createDiv({ cls: "ea-block-container" });
	const root = createRoot(container);

	let isLoading = true;

	const handleNoteOn = (midiNote: number) => {
		if (engine.isInitialized()) {
			if (soundbankSlug && engine.isSoundbankLoaded(soundbankSlug)) {
				engine.playSoundbankNoteWithRelease(soundbankSlug, midiNote);
				return;
			}
			if (!soundbankSlug) {
				engine.playToneWithRelease(midiNote);
				return;
			}
		}

		(async () => {
			await engine.initialize();
			if (soundbankSlug) {
				await engine.loadSoundbankForBlock(soundbankSlug);
				engine.playSoundbankNoteWithRelease(soundbankSlug, midiNote);
			} else {
				engine.playToneWithRelease(midiNote);
			}
			isLoading = false;
			render();
		})();
	};

	const handleNoteOff = (midiNote: number) => {
		engine.stopNote(midiNote);
	};

	const render = () => {
		root.render(
			createElement(PianoKeys, {
				soundbank: soundbankSlug || "default",
				octaves: options.octaves ?? 1,
				hint: options.hint,
				highlightedNotes: options.highlightedNotes,
				highlightColor: options.highlightColor,
				validation: options.validation,
				minInteractions: options.minInteractions,
				expectedChord: options.expectedChord,
				expectedScale: options.expectedScale,
				isLoading,
				onNoteOn: handleNoteOn,
				onNoteOff: handleNoteOff,
				onRequestFocus: (release: () => void) => {
					focusManager.requestFocus(() => {
						release();
						engine.stopAllNotes();
					});
				},
			})
		);
	};

	const finishLoad = () => {
		isLoading = false;
		render();
	};

	if (soundbankSlug) {
		engine
			.initialize()
			.then(() => engine.loadSoundbankForBlock(soundbankSlug))
			.then(finishLoad)
			.catch(finishLoad);
	} else {
		engine.initialize().then(finishLoad).catch(finishLoad);
	}

	render();
	return root;
}

// ---------------------------------------------------------------------------
// Legacy `pianoKeys` code block processor
// ---------------------------------------------------------------------------

export function registerPianoKeysProcessor(
	plugin: Plugin,
	engine: AudioEngine,
	focusManager: FocusManager
): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"pianoKeys",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);
			const soundbank = config.soundbank || "";

			if (!soundbank) {
				const warning = el.createDiv({ cls: "ea-validation-warning" });
				warning.textContent =
					"Warning: pianoKeys block is missing 'soundbank' property";
			}

			const validation = ((): PianoKeysMountOptions["validation"] => {
				switch (config.validation) {
					case "interaction":
					case "chord":
					case "scale":
						return config.validation;
					default:
						return undefined;
				}
			})();

			const highlightedNotes =
				parseNoteNames(config.highlightedNotes) ??
				(config.highlightedNotes
					? undefined
					: parseNoteNames(config.highlight));

			const root = mountPianoKeys(el, engine, focusManager, {
				soundbank,
				octaves: parseInt(config.octaves, 10) || 1,
				hint: config.hint,
				highlightedNotes,
				highlightColor: config.highlightColor ?? config.color,
				validation,
				minInteractions: config.minInteractions
					? parseInt(config.minInteractions, 10)
					: undefined,
				expectedChord: parseNoteNames(config.expectedChord),
				expectedScale: parseNoteNames(config.expectedScale),
			});
			roots.push(root);
		}
	);

	plugin.register(() => {
		for (const root of roots) {
			try {
				root.unmount();
			} catch {
				// Already unmounted
			}
		}
		roots.length = 0;
	});
}
