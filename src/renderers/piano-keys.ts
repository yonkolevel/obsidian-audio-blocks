/**
 * Registers the `pianoKeys` fenced code block processor with Obsidian.
 *
 * When Obsidian encounters a code block like:
 *
 * ```pianoKeys
 * soundbank: argon-8-rhode-keys
 * octaves: 1
 * hint: Play some notes
 * ```
 *
 * This processor parses the YAML config and mounts a React PianoKeys component
 * into the rendered markdown.
 *
 * If a soundbank is specified and available, real .wav samples are loaded
 * and played for each key. Otherwise a synthesized triangle-wave tone is
 * used as a fallback.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { PianoKeys } from "../components/PianoKeys";
import { AudioEngine } from "../audio/engine";

/**
 * Minimal YAML parser for flat key-value configs.
 */
function parseSimpleYaml(source: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of source.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colonIndex = trimmed.indexOf(":");
		if (colonIndex === -1) continue;
		const key = trimmed.slice(0, colonIndex).trim();
		const value = trimmed.slice(colonIndex + 1).trim();
		result[key] = value;
	}
	return result;
}

/**
 * Parse a YAML array-like value into a number array.
 * Supports formats like: [60, 64, 67] or 60, 64, 67
 */
function parseNumberArray(value: string | undefined): number[] | undefined {
	if (!value) return undefined;
	const cleaned = value.replace(/[\[\]]/g, "");
	const nums = cleaned
		.split(",")
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => !isNaN(n));
	return nums.length > 0 ? nums : undefined;
}

/**
 * Map from note name to semitone offset within an octave (0–11).
 */
const NOTE_NAME_TO_SEMITONE: Record<string, number> = {
	"C": 0, "C#": 1, "Db": 1,
	"D": 2, "D#": 3, "Eb": 3,
	"E": 4, "Fb": 4,
	"F": 5, "E#": 5, "F#": 6, "Gb": 6,
	"G": 7, "G#": 8, "Ab": 8,
	"A": 9, "A#": 10, "Bb": 10,
	"B": 11, "Cb": 11,
};

/**
 * Convert a note name (e.g. "C", "C#", "Db", "C4", "F#3") to a MIDI number.
 * If no octave is specified, defaults to octave 4 (C4 = 60).
 * If the value is already a number string, returns it directly.
 */
function noteNameToMidi(name: string): number | undefined {
	const trimmed = name.trim();
	if (!trimmed) return undefined;

	// Try as a raw MIDI number first
	const asNumber = parseInt(trimmed, 10);
	if (!isNaN(asNumber) && String(asNumber) === trimmed) {
		return asNumber;
	}

	// Match note name with optional octave: e.g. "C#4", "Db", "G"
	const match = trimmed.match(/^([A-Ga-g][#b]?)(\d)?$/);
	if (!match) return undefined;

	const notePart = match[1].charAt(0).toUpperCase() + match[1].slice(1);
	const octave = match[2] !== undefined ? parseInt(match[2], 10) : 4;

	const semitone = NOTE_NAME_TO_SEMITONE[notePart];
	if (semitone === undefined) return undefined;

	// MIDI: C4 = 60, so octave 4 starts at 60. Formula: (octave + 1) * 12 + semitone
	return (octave + 1) * 12 + semitone;
}

/**
 * Parse a comma-separated list of note names or MIDI numbers into a MIDI number array.
 * Supports: "C,E,G" or "C4,E4,G4" or "60,64,67" or mixed.
 */
function parseNoteNames(value: string | undefined): number[] | undefined {
	if (!value) return undefined;
	const cleaned = value.replace(/[\[\]]/g, "");
	const notes = cleaned
		.split(",")
		.map((s) => noteNameToMidi(s))
		.filter((n): n is number => n !== undefined);
	return notes.length > 0 ? notes : undefined;
}

export function registerPianoKeysProcessor(
	plugin: Plugin,
	engine: AudioEngine
): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"pianoKeys",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);
			const soundbankSlug = config.soundbank || "";

			// Validation: warn if soundbank is missing
			if (!soundbankSlug) {
				const warningBar = el.createDiv({
					cls: "ea-validation-warning",
				});
				warningBar.textContent =
					"Warning: pianoKeys block is missing 'soundbank' property";
			}

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			// Eagerly start loading the soundbank
			if (soundbankSlug) {
				engine
					.initialize()
					.then(() => engine.loadSoundbankForBlock(soundbankSlug))
					.catch(() => {
						/* fallback to synth */
					});
			}

			const handleNoteOn = async (midiNote: number) => {
				await engine.initialize();

				if (soundbankSlug) {
					await engine.loadSoundbankForBlock(soundbankSlug);
					engine.playSoundbankNote(soundbankSlug, midiNote);
				} else {
					engine.playTone(midiNote);
				}
			};

			const handleNoteOff = (_midiNote: number) => {
				// For the prototype, tones self-decay — nothing to do here.
			};

			// Parse validation mode
			const validationMode = ((): "interaction" | "chord" | "scale" | undefined => {
				switch (config.validation) {
					case "interaction": return "interaction";
					case "chord": return "chord";
					case "scale": return "scale";
					default: return undefined;
				}
			})();

			root.render(
				createElement(PianoKeys, {
					soundbank: soundbankSlug || "default",
					octaves: parseInt(config.octaves, 10) || 1,
					hint: config.hint,
					highlightedNotes: parseNumberArray(config.highlightedNotes),
					highlightColor: config.highlightColor,
					validation: validationMode,
					minInteractions: config.minInteractions
						? parseInt(config.minInteractions, 10)
						: undefined,
					expectedChord: parseNoteNames(config.expectedChord),
					expectedScale: parseNoteNames(config.expectedScale),
					onNoteOn: handleNoteOn,
					onNoteOff: handleNoteOff,
				})
			);
		}
	);

	plugin.register(() => {
		for (const root of roots) {
			try {
				root.unmount();
			} catch {
				// Root may already be unmounted
			}
		}
		roots.length = 0;
	});
}
