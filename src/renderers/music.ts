/**
 * Unified `music` code block renderer.
 *
 * Registers handlers for:
 *   ```music drums     → DrumPads
 *   ```music keys      → PianoKeys
 *   ```music sequence  → PianoRoll (inline notes OR playground file)
 *   ```music pattern   → PatternPlayer (step sequencer)
 *   ```music transport → Transport
 *
 * Each variant parses its config from YAML (above the `---`) and note/pattern
 * data from the body (below the `---`) per the Music Markdown spec.
 *
 * Midicircuit lessons are a superset of the base spec — they add extension
 * keys (`soundbank`, `highlightedPads`/`highlightedNotes`, `highlightColor`,
 * `validation`, `hint`, `minInteractions`, `metronomeEnabled`, `trackID`,
 * `playground`, `expectedChord`, `expectedScale`) that the renderer honors
 * when present. Extension keys win over the base spec keys when both are
 * set (e.g. `soundbank` overrides `kit`).
 *
 * `music sequence` also supports the Midicircuit convention of inheriting
 * a `.mcplayground` file path from a preceding `<!-- step: <id>,
 * playground: <path> --> ` HTML comment.
 */

import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import * as yaml from "js-yaml";
import {
	parseMusicBlock,
	parseNoteLines,
	parsePatternLines,
	deriveBars,
} from "elementary-audio-kit";
import { AudioEngine } from "../audio/engine";
import { FocusManager } from "../audio/focus-manager";
import {
	mountDrumPads,
	parseNumberArray,
} from "./drum-pads";
import { mountPianoKeys, parseNoteNames } from "./piano-keys";
import { mountPianoRoll } from "./piano-roll";
import { Transport } from "../components/Transport";
import { MusicPatternPlayer } from "../components/MusicPatternPlayer";

type Variant = "drums" | "keys" | "sequence" | "pattern" | "transport";

// ---------------------------------------------------------------------------
// Chord / scale expansion for the Midicircuit object syntax
// { root: "C", type: "major" } and { root: "C", scaleType: "major" }
// ---------------------------------------------------------------------------

const NOTE_SEMITONES: Record<string, number> = {
	C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3,
	E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8,
	Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

const CHORD_INTERVALS: Record<string, number[]> = {
	major:   [0, 4, 7],
	minor:   [0, 3, 7],
	dim:     [0, 3, 6],
	aug:     [0, 4, 8],
	dom7:    [0, 4, 7, 10],
	maj7:    [0, 4, 7, 11],
	min7:    [0, 3, 7, 10],
	sus2:    [0, 2, 7],
	sus4:    [0, 5, 7],
};

const SCALE_INTERVALS: Record<string, number[]> = {
	major:             [0, 2, 4, 5, 7, 9, 11],
	minor:             [0, 2, 3, 5, 7, 8, 10],
	"natural minor":   [0, 2, 3, 5, 7, 8, 10],
	"harmonic minor":  [0, 2, 3, 5, 7, 8, 11],
	"melodic minor":   [0, 2, 3, 5, 7, 9, 11],
	pentatonic:        [0, 2, 4, 7, 9],
	"pentatonic major":[0, 2, 4, 7, 9],
	"pentatonic minor":[0, 3, 5, 7, 10],
	blues:             [0, 3, 5, 6, 7, 10],
	dorian:            [0, 2, 3, 5, 7, 9, 10],
	phrygian:          [0, 1, 3, 5, 7, 8, 10],
	lydian:            [0, 2, 4, 6, 7, 9, 11],
	mixolydian:        [0, 2, 4, 5, 7, 9, 10],
	locrian:           [0, 1, 3, 5, 6, 8, 10],
};

function expandChordConfig(value: unknown): number[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) return undefined; // handled by parseNoteNames
	if (typeof value !== "object") return undefined;

	const obj = value as Record<string, unknown>;
	const root = asString(obj.root)?.trim();
	const type = asString(obj.type)?.toLowerCase().trim();
	if (!root || !type) return undefined;

	const semitone = NOTE_SEMITONES[root];
	const intervals = CHORD_INTERVALS[type];
	if (semitone === undefined || !intervals) return undefined;

	return intervals.map((i) => 60 + semitone + i);
}

function expandScaleConfig(value: unknown): number[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) return undefined;
	if (typeof value !== "object") return undefined;

	const obj = value as Record<string, unknown>;
	const root = asString(obj.root)?.trim();
	const scaleType = (asString(obj.scaleType) ?? asString(obj.type))
		?.toLowerCase()
		.trim();
	if (!root || !scaleType) return undefined;

	const semitone = NOTE_SEMITONES[root];
	const intervals = SCALE_INTERVALS[scaleType];
	if (semitone === undefined || !intervals) return undefined;

	return intervals.map((i) => 60 + semitone + i);
}

const VALID_VARIANTS: ReadonlySet<string> = new Set([
	"drums",
	"keys",
	"sequence",
	"pattern",
	"transport",
]);

export function registerMusicProcessor(
	plugin: Plugin,
	engine: AudioEngine,
	focusManager: FocusManager
): void {
	const roots: Root[] = [];

	// Register each variant both as "music <variant>" (full info-string match,
	// which is how Obsidian actually dispatches code block processors) and keep
	// a "music" fallback that reads the variant itself for editors that DO split
	// on the first token.
	const handle = (
		variant: Variant,
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	) => {
		const { bodyLines } = parseMusicBlock(source);
		const config = parseConfigYaml(source);

		switch (variant) {
			case "drums":
				roots.push(renderDrums(el, config, engine, focusManager));
				break;
			case "keys":
				roots.push(renderKeys(el, config, engine, focusManager));
				break;
			case "sequence":
				roots.push(renderSequence(el, plugin, ctx, config, bodyLines, engine));
				break;
			case "pattern":
				roots.push(renderPattern(el, config, bodyLines, engine));
				break;
			case "transport":
				roots.push(renderTransport(el, config, engine));
				break;
		}
	};

	// Per-variant registrations — "music drums", "music sequence", etc.
	// Obsidian matches registerMarkdownCodeBlockProcessor on the full info
	// string, so ```music drums routes here directly.
	for (const variant of VALID_VARIANTS) {
		plugin.registerMarkdownCodeBlockProcessor(
			`music ${variant}`,
			(source, el, ctx) => handle(variant as Variant, source, el, ctx)
		);
	}

	// "music" fallback — for any editor that strips the variant suffix before
	// dispatching. Reads the variant from the fence line via getSectionInfo.
	plugin.registerMarkdownCodeBlockProcessor(
		"music",
		(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const variant = readVariantFromFence(el, ctx);

			if (!variant || !VALID_VARIANTS.has(variant)) {
				const warning = el.createDiv({ cls: "ea-validation-warning" });
				warning.textContent = variant
					? `Unknown music block variant: "${variant}". Expected: drums, keys, sequence, pattern, transport.`
					: "music block missing variant — use ```music drums, ```music keys, etc.";
				return;
			}

			handle(variant as Variant, source, el, ctx);
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

/**
 * Extract the variant token from the fenced code block's opening line.
 * For a fence like `\`\`\`music drums`, returns `"drums"`. Uses
 * `ctx.getSectionInfo(el)` to read the source text at the block's line.
 */
function readVariantFromFence(
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext
): string | undefined {
	const info = ctx.getSectionInfo(el);
	if (!info) return undefined;

	const line = info.text.split("\n")[info.lineStart] ?? "";
	const match = line.match(/^\s*(?:`{3,}|~{3,})\s*music\s+(\S+)/);
	return match?.[1]?.toLowerCase();
}

/**
 * Parse the config portion of a `music` block (everything above the `---`
 * body separator) with js-yaml so we get real YAML semantics: multi-line
 * arrays, numbers, booleans. Falls back to an empty object on parse errors.
 */
function parseConfigYaml(source: string): Record<string, unknown> {
	const lines = source.split("\n");
	const sepIndex = lines.findIndex((l) => l.trim() === "---");
	const configText =
		sepIndex === -1
			? source
			: lines.slice(0, sepIndex).join("\n");

	try {
		const parsed = yaml.load(configText);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch (err) {
		console.warn("music: YAML config parse failed, using empty config", err);
	}
	return {};
}

/** Read a config value as a string, coercing numbers/booleans. */
function asString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	return String(value);
}

/** Read a config value as a number, or undefined if not present/parseable. */
function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && !isNaN(value)) return value;
	if (typeof value === "string") {
		const n = parseInt(value, 10);
		return isNaN(n) ? undefined : n;
	}
	return undefined;
}

/** Read a config value as a boolean — accepts true/false, "true"/"false". */
function asBoolean(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") return value === "true";
	return false;
}

// ---------------------------------------------------------------------------
// drums
// ---------------------------------------------------------------------------

function renderDrums(
	el: HTMLElement,
	config: Record<string, unknown>,
	engine: AudioEngine,
	focusManager: FocusManager
): Root {
	// Midicircuit extensions override base spec keys: `soundbank` > `kit`,
	// `highlightedPads` > `highlight`.
	const soundbank =
		asString(config.soundbank) ?? asString(config.kit) ?? "";
	const highlightedPads =
		parseNumberArray(config.highlightedPads) ??
		parseNumberArray(config.highlight);

	return mountDrumPads(el, engine, focusManager, {
		soundbank,
		hint: asString(config.hint),
		highlightedPads,
		validation:
			config.validation === "interaction" ? "interaction" : undefined,
		minInteractions: asNumber(config.minInteractions),
	});
}

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

function renderKeys(
	el: HTMLElement,
	config: Record<string, unknown>,
	engine: AudioEngine,
	focusManager: FocusManager
): Root {
	// Midicircuit extensions: `soundbank` > `sound`, `highlightedNotes` >
	// `highlight`, `highlightColor` > `color`.
	const soundbank =
		asString(config.soundbank) ?? asString(config.sound) ?? "";
	const highlightedNotes =
		parseNoteNames(config.highlightedNotes) ??
		parseNoteNames(config.highlight);
	const highlightColor =
		asString(config.highlightColor) ?? asString(config.color);
	const validation = ((): "interaction" | "chord" | "scale" | undefined => {
		switch (config.validation) {
			case "interaction":
			case "chord":
			case "scale":
				return config.validation;
			default:
				return undefined;
		}
	})();

	const expectedChord =
		parseNoteNames(config.expectedChord) ??
		expandChordConfig(config.expectedChord);
	const expectedScale =
		parseNoteNames(config.expectedScale) ??
		expandScaleConfig(config.expectedScale);

	return mountPianoKeys(el, engine, focusManager, {
		soundbank,
		octaves: asNumber(config.octaves) ?? 2,
		hint: asString(config.hint),
		highlightedNotes,
		highlightColor,
		validation,
		minInteractions: asNumber(config.minInteractions),
		expectedChord,
		expectedScale,
		showNoteNames: asBoolean(config.showNoteNames),
	});
}

// ---------------------------------------------------------------------------
// sequence
// ---------------------------------------------------------------------------

function renderSequence(
	el: HTMLElement,
	plugin: Plugin,
	ctx: MarkdownPostProcessorContext,
	config: Record<string, unknown>,
	bodyLines: string[],
	engine: AudioEngine
): Root {
	const trackID = asNumber(config.trackID) ?? 0;
	const validation =
		config.validation === "interaction" ? "interaction" : "playback";

	// Midicircuit extension: `playground: assets/foo.mcplayground` or inherit
	// from a preceding `<!-- step: ..., playground: ... -->` comment. When
	// inline note data is present, that wins and playground loading is
	// skipped.
	const explicitPlayground = asString(config.playground);
	const inlineNotes = parseNoteLines(bodyLines);
	const hasInline = inlineNotes.length > 0;

	const playgroundField: string | null | undefined = hasInline
		? null
		: explicitPlayground;

	// Inline notes are the base-spec path — build synthetic PlaygroundData.
	const tempo = asNumber(config.tempo) ?? 120;
	const bars = asNumber(config.bars) ?? deriveBars(inlineNotes);
	const soundbankSlug =
		asString(config.soundbank) ?? asString(config.sound);
	const isDrum = config.type === "drum" || config.kit !== undefined;

	return mountPianoRoll(el, plugin, ctx, engine, {
		trackID,
		validation,
		hint: asString(config.hint),
		minInteractions: asNumber(config.minInteractions),
		metronomeEnabled:
			asBoolean(config.metronomeEnabled) || asBoolean(config.metronome),
		playgroundField,
		inline: hasInline
			? {
					notes: inlineNotes,
					tempo,
					bars,
					soundbankSlug,
					title: asString(config.name),
					isDrum,
				}
			: undefined,
	});
}

// ---------------------------------------------------------------------------
// pattern
// ---------------------------------------------------------------------------

function renderPattern(
	el: HTMLElement,
	config: Record<string, unknown>,
	bodyLines: string[],
	engine: AudioEngine
): Root {
	const patternRows = parsePatternLines(bodyLines);
	const tempo = asNumber(config.tempo) ?? 120;
	const editable = asBoolean(config.editable);

	const handleRowTrigger = async (rowIndex: number) => {
		await engine.initialize();
		engine.playSample(rowIndex % 16);
	};

	const container = el.createDiv({ cls: "ea-block-container" });
	const root = createRoot(container);

	root.render(
		createElement(MusicPatternPlayer, {
			rows: patternRows.map((r) => ({ label: r.label, steps: r.steps })),
			defaultTempo: tempo,
			editable,
			onRowTrigger: handleRowTrigger,
		})
	);

	return root;
}

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

function renderTransport(
	el: HTMLElement,
	config: Record<string, unknown>,
	engine: AudioEngine
): Root {
	const tempo = asNumber(config.tempo) ?? 120;
	const timeSignature = asString(config.time) ?? "4/4";
	const loop = config.loop !== false && config.loop !== "false";

	const handlePlayClick = async () => {
		await engine.initialize();
		engine.playClick();
	};

	const container = el.createDiv({ cls: "ea-block-container" });
	const root = createRoot(container);

	root.render(
		createElement(Transport, {
			tempo,
			timeSignature,
			loop,
			onPlayClick: handlePlayClick,
		})
	);

	return root;
}
