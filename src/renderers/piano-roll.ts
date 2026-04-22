/**
 * Piano roll renderer.
 *
 * Exports `mountPianoRoll()` — handles playground loading (from explicit
 * `playground:` field or inherited from a preceding `<!-- step: ... -->`
 * comment), inline-note fallback (from `music sequence` bodies), engine
 * wiring, soundbank loading, and React rendering.
 *
 * Called by both the legacy `pianoRoll` code block processor and the
 * `music sequence` variant.
 */

import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { PianoRoll } from "../components/PianoRoll";
import {
	readPlayground,
	PlaygroundData,
	NoteData,
} from "../playground/reader";
import { savePlayground } from "../playground/writer";
import { AudioEngine } from "../audio/engine";
import { parseSimpleYaml } from "./drum-pads";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PianoRollMountOptions {
	trackID: number;
	validation: "playback" | "interaction";
	hint?: string;
	minInteractions?: number;
	metronomeEnabled?: boolean;
	/**
	 * Explicit playground path from YAML, or undefined to fall back to the
	 * preceding step comment. Set to `null` to skip playground resolution
	 * entirely (used when inline notes are provided instead).
	 */
	playgroundField?: string | null;
	/**
	 * Inline notes + synthetic playground metadata. When set and no
	 * `.mcplayground` file is resolved, these notes render directly.
	 */
	inline?: {
		notes: NoteData[];
		tempo: number;
		bars: number;
		soundbankSlug?: string;
		title?: string;
		isDrum?: boolean;
	};
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export function mountPianoRoll(
	el: HTMLElement,
	plugin: Plugin,
	ctx: MarkdownPostProcessorContext,
	engine: AudioEngine,
	options: PianoRollMountOptions
): Root {
	const container = el.createDiv({ cls: "ea-block-container" });
	const root = createRoot(container);

	const playgroundField =
		options.playgroundField === null
			? undefined
			: (options.playgroundField ??
				findPlaygroundFromStepComment(el, ctx));

	const render = (
		playgroundData: PlaygroundData | undefined,
		resolvedPath: string | undefined
	) => {
		const track = playgroundData?.tracks.find(
			(t) => t.id === options.trackID
		);
		const soundbankSlug = track?.soundbankSlug || "";
		const isDrum = track ? track.type === "drum" : !!options.inline?.isDrum;

		if (soundbankSlug) {
			engine
				.initialize()
				.then(() => engine.loadSoundbankForBlock(soundbankSlug))
				.catch(() => {
					// Fall through to synth
				});
		}

		const handleSave = resolvedPath
			? async (_trackID: number, notes: NoteData[]) => {
					await savePlayground(resolvedPath, _trackID, notes);
				}
			: undefined;

		const handleNotePlay = async (
			noteNumber: number,
			durationBeats?: number
		) => {
			await engine.initialize();
			if (soundbankSlug) {
				await engine.loadSoundbankForBlock(soundbankSlug);
				engine.playSoundbankNote(soundbankSlug, noteNumber);
			} else if (isDrum) {
				engine.playClick();
			} else {
				const bpm = playgroundData?.tempo ?? 120;
				const durationSec = durationBeats
					? (durationBeats / bpm) * 60 + 0.3
					: 1.2;
				engine.playTone(noteNumber, durationSec);
			}
		};

		const handleMetronomeClick = async () => {
			await engine.initialize();
			engine.playClick();
		};

		const handlePlaybackStart = async () => {
			await engine.initialize();
			if (soundbankSlug) {
				await engine.loadSoundbankForBlock(soundbankSlug);
			}
		};

		const noteNames = soundbankSlug
			? engine.getNoteNamesForSoundbank(soundbankSlug)
			: undefined;

		root.render(
			createElement(PianoRoll, {
				trackID: options.trackID,
				validation: options.validation,
				hint: options.hint,
				minInteractions: options.minInteractions,
				defaultMetronomeOn: options.metronomeEnabled,
				playgroundData,
				playgroundPath: resolvedPath,
				onSave: handleSave,
				onNotePlay: handleNotePlay,
				onPlaybackStart: handlePlaybackStart,
				onRequestExclusivePlayback: globalExclusivePlayback,
				onMetronomeClick: handleMetronomeClick,
				noteNames,
			})
		);
	};

	if (playgroundField) {
		(async () => {
			try {
				const resolvedPath = resolvePlaygroundPath(
					plugin,
					playgroundField,
					ctx.sourcePath
				);
				const data = await readPlayground(resolvedPath);
				render(data, resolvedPath);
			} catch (err) {
				const warning = el.createDiv({ cls: "ea-validation-warning" });
				warning.textContent = `Could not load playground: ${
					err instanceof Error ? err.message : String(err)
				}`;
				console.error(
					"PianoRoll: failed to load playground",
					playgroundField,
					err
				);
				renderFromInline();
			}
		})();
	} else {
		renderFromInline();
	}

	function renderFromInline() {
		if (!options.inline || options.inline.notes.length === 0) {
			render(undefined, undefined);
			return;
		}

		// Build synthetic PlaygroundData so the PianoRoll component treats
		// inline notes the same as loaded clip data.
		const { notes, tempo, bars, soundbankSlug, title, isDrum } =
			options.inline;
		const synthetic: PlaygroundData = {
			tempo,
			isLoopEnabled: true,
			tracks: [
				{
					id: options.trackID,
					type: isDrum ? "drum" : "melodic",
					title: title ?? "Sequence",
					soundbankSlug: soundbankSlug ?? "",
					clips: [
						{
							lengthInBars: bars,
							notes,
						},
					],
				},
			],
		};
		render(synthetic, undefined);
	}

	return root;
}

// ---------------------------------------------------------------------------
// Shared exclusive-playback gate
// ---------------------------------------------------------------------------

let stopCurrentPlayback: (() => void) | null = null;
function globalExclusivePlayback(stopFn: () => void) {
	if (stopCurrentPlayback) stopCurrentPlayback();
	stopCurrentPlayback = stopFn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk upward from the code block to find a
 * `<!-- step: ..., playground: ... -->` comment. Returns the playground
 * path if found.
 *
 * Stops at headings (`#`, `##`, ...) since step comments belong to a
 * single step within a chapter. Intervening code blocks (e.g. a `callout`
 * above the `music sequence`) are walked through — earlier implementations
 * broke on `\`\`\``, which caused the step comment to be missed whenever a
 * step contained more than one block.
 */
export function findPlaygroundFromStepComment(
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext
): string | undefined {
	const sectionInfo = ctx.getSectionInfo(el);
	if (!sectionInfo) return undefined;

	const { text, lineStart } = sectionInfo;
	const lines = text.split("\n");

	for (let i = lineStart - 1; i >= 0; i--) {
		const line = lines[i]?.trim();
		if (!line) continue;

		const match = line.match(/<!--\s*step:.*?playground:\s*([^\s,>]+)/);
		if (match) return match[1];

		if (/^#{1,6}\s/.test(line)) break;
	}

	return undefined;
}

/**
 * Resolve the playground path to an absolute filesystem path.
 *
 * Absolute-looking paths ("/Lessons/...") are resolved against the vault
 * root; everything else is resolved relative to the current note's folder.
 * Desktop only — the vault adapter must expose `getBasePath()`.
 */
export function resolvePlaygroundPath(
	plugin: Plugin,
	playgroundField: string,
	sourcePath: string
): string {
	const adapter = plugin.app.vault.adapter as {
		getBasePath?: () => string;
	};
	if (!adapter.getBasePath) {
		throw new Error(
			"Cannot resolve playground path: vault adapter does not support getBasePath (mobile not supported)"
		);
	}
	const vaultBase = adapter.getBasePath();

	if (playgroundField.startsWith("/")) {
		return path.join(vaultBase, playgroundField);
	}

	const noteDir = path.dirname(sourcePath);
	return path.join(vaultBase, noteDir, playgroundField);
}

// ---------------------------------------------------------------------------
// Legacy `pianoRoll` code block processor
// ---------------------------------------------------------------------------

export function registerPianoRollProcessor(
	plugin: Plugin,
	engine: AudioEngine
): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"pianoRoll",
		(
			source: string,
			el: HTMLElement,
			ctx: MarkdownPostProcessorContext
		) => {
			const config = parseSimpleYaml(source);

			if (!config.trackID) {
				const warning = el.createDiv({
					cls: "ea-validation-warning",
				});
				warning.textContent =
					"Warning: pianoRoll block is missing 'trackID' property";
			}

			const trackID = parseInt(config.trackID, 10) || 0;
			const validation =
				config.validation === "interaction"
					? "interaction"
					: "playback";

			const root = mountPianoRoll(el, plugin, ctx, engine, {
				trackID,
				validation,
				hint: config.hint,
				minInteractions: config.minInteractions
					? parseInt(config.minInteractions, 10)
					: undefined,
				metronomeEnabled: config.metronomeEnabled === "true",
				playgroundField: config.playground,
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
