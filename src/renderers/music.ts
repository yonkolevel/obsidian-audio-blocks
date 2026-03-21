/**
 * Unified `music` code block renderer.
 *
 * Registers handlers for:
 *   ```music drums     → DrumPads
 *   ```music keys      → PianoKeys
 *   ```music sequence  → PianoRoll (with inline note data)
 *   ```music pattern   → PatternPlayer (step sequencer)
 *   ```music transport → Transport
 *
 * Each variant parses its config from YAML and content from note/pattern data.
 * The base spec is generic — Midicircuit extensions are layered on top.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import {
	parseMusicBlock,
	parseNoteLines,
	parsePatternLines,
	parseNoteList,
	parseNumberList,
	deriveRows,
	deriveBars,
	noteNameToMidi,
} from "elementary-audio-kit";
import { AudioEngine } from "../audio/engine";
import { FocusManager } from "../audio/focus-manager";

// Components
import { DrumPads } from "../components/DrumPads";
import { PianoKeys } from "../components/PianoKeys";
import { PianoRoll } from "../components/PianoRoll";
import { Transport } from "../components/Transport";
import { MusicPatternPlayer } from "../components/MusicPatternPlayer";

type Variant = "drums" | "keys" | "sequence" | "pattern" | "transport";

const VARIANTS: Variant[] = ["drums", "keys", "sequence", "pattern", "transport"];

export function registerMusicProcessor(
	plugin: Plugin,
	engine: AudioEngine,
	focusManager: FocusManager
): void {
	const roots: Root[] = [];

	// Exclusive playback: only one block plays at a time
	let stopCurrentPlayback: (() => void) | null = null;
	const requestExclusivePlayback = (stopFn: () => void) => {
		if (stopCurrentPlayback) stopCurrentPlayback();
		stopCurrentPlayback = stopFn;
	};

	for (const variant of VARIANTS) {
		plugin.registerMarkdownCodeBlockProcessor(
			`music ${variant}`,
			async (source: string, el: HTMLElement) => {
				const { config, bodyLines } = parseMusicBlock(source);
				const container = el.createDiv({ cls: "ea-block-container" });
				const root = createRoot(container);
				roots.push(root);

				switch (variant) {
					case "drums":
						renderDrums(root, config, engine, focusManager);
						break;
					case "keys":
						renderKeys(root, config, engine, focusManager);
						break;
					case "sequence":
						renderSequence(
							root,
							config,
							bodyLines,
							engine,
							requestExclusivePlayback
						);
						break;
					case "pattern":
						renderPattern(root, config, bodyLines, engine);
						break;
					case "transport":
						renderTransport(root, config, engine);
						break;
				}
			}
		);
	}

	// Cleanup
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

// ---------------------------------------------------------------------------
// Variant renderers
// ---------------------------------------------------------------------------

function renderDrums(
	root: Root,
	config: Record<string, string>,
	engine: AudioEngine,
	focusManager: FocusManager
) {
	const pads = parseInt(config.pads, 10) || 16;
	const highlight = config.highlight
		? parseNumberList(config.highlight)
		: undefined;

	let isLoading = false;

	const handlePadTap = (padIndex: number) => {
		if (engine.isInitialized()) {
			engine.playSample(padIndex);
		} else {
			(async () => {
				await engine.initialize();
				engine.playSample(padIndex);
				render();
			})();
		}
	};

	const render = () => {
		root.render(
			createElement(DrumPads, {
				soundbank: config.kit ?? "synth",
				highlightedPads: highlight,
				onPadTap: handlePadTap,
				onRequestFocus: (release: () => void) =>
					focusManager.requestFocus(release),
				isLoading,
			})
		);
	};

	render();
}

function renderKeys(
	root: Root,
	config: Record<string, string>,
	engine: AudioEngine,
	focusManager: FocusManager
) {
	const octaves = parseInt(config.octaves, 10) || 2;
	const highlightedNotes = config.highlight
		? parseNoteList(config.highlight)
		: undefined;
	const highlightColor = config.color || "#00FF9E";

	// Track active release functions
	const activeReleases = new Map<number, () => void>();

	const handleNoteOn = async (midiNote: number) => {
		await engine.initialize();
		const release = engine.playToneWithRelease(midiNote);
		if (release) activeReleases.set(midiNote, release);
	};

	const handleNoteOff = (midiNote: number) => {
		const release = activeReleases.get(midiNote);
		if (release) {
			release();
			activeReleases.delete(midiNote);
		}
	};

	root.render(
		createElement(PianoKeys, {
			soundbank: config.sound ?? "synth",
			octaves,
			highlightedNotes,
			highlightColor,
			onNoteOn: handleNoteOn,
			onNoteOff: handleNoteOff,
			onRequestFocus: (release: () => void) =>
				focusManager.requestFocus(release),
		})
	);
}

function renderSequence(
	root: Root,
	config: Record<string, string>,
	bodyLines: string[],
	engine: AudioEngine,
	requestExclusivePlayback: (stopFn: () => void) => void
) {
	const notes = parseNoteLines(bodyLines);
	const rows = deriveRows(notes);
	const bars = parseInt(config.bars, 10) || deriveBars(notes);
	const tempo = parseInt(config.tempo, 10) || 120;
	const editable = config.editable === "true";
	const metronome = config.metronome === "true";

	const handleNotePlay = async (
		noteNumber: number,
		durationBeats?: number
	) => {
		await engine.initialize();
		const bpm = tempo;
		const durationSec = durationBeats
			? (durationBeats / bpm) * 60 + 0.3
			: 1.2;
		engine.playTone(noteNumber, durationSec);
	};

	const handleMetronomeClick = async () => {
		await engine.initialize();
		engine.playClick();
	};

	const handlePlaybackStart = async () => {
		await engine.initialize();
	};

	// Use the NoteData type from the kit's PianoRoll
	const pianoRollNotes = notes.map((n) => ({
		noteNumber: n.noteNumber,
		velocity: n.velocity,
		position: n.position,
		duration: n.duration,
	}));

	const pianoRollRows = rows.map((r) => ({
		noteNumber: r.noteNumber,
		label: r.label,
	}));

	root.render(
		createElement(PianoRoll, {
			trackID: 0,
			validation: "playback" as const,
			playgroundData: {
				tempo,
				tracks: [
					{
						id: 0,
						title: config.name ?? "Sequence",
						type: "melodic" as const,
						soundbankSlug: "",
						clips: [
							{
								id: 0,
								lengthInBars: bars,
								notes: pianoRollNotes,
							},
						],
					},
				],
			},
			onNotePlay: handleNotePlay,
			onPlaybackStart: handlePlaybackStart,
			onRequestExclusivePlayback: requestExclusivePlayback,
			onMetronomeClick: handleMetronomeClick,
			defaultMetronomeOn: metronome,
		})
	);
}

function renderPattern(
	root: Root,
	config: Record<string, string>,
	bodyLines: string[],
	engine: AudioEngine
) {
	const patternRows = parsePatternLines(bodyLines);
	const tempo = parseInt(config.tempo, 10) || 120;
	const editable = config.editable === "true";

	// Simple synth sounds per row label
	const handleRowTrigger = async (rowIndex: number) => {
		await engine.initialize();
		// Use built-in drum kit pads mapped by row index
		engine.playSample(rowIndex % 16);
	};

	const playerRows = patternRows.map((r) => ({
		label: r.label,
		steps: r.steps,
	}));

	root.render(
		createElement(MusicPatternPlayer, {
			rows: playerRows,
			defaultTempo: tempo,
			editable,
			onRowTrigger: handleRowTrigger,
		})
	);
}

function renderTransport(
	root: Root,
	config: Record<string, string>,
	engine: AudioEngine
) {
	const tempo = parseInt(config.tempo, 10) || 120;
	const timeSignature = config.time ?? "4/4";
	const loop = config.loop !== "false";

	const handlePlayClick = async () => {
		await engine.initialize();
		engine.playClick();
	};

	root.render(
		createElement(Transport, {
			tempo,
			timeSignature,
			loop,
			onPlayClick: handlePlayClick,
		})
	);
}
