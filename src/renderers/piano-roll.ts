/**
 * Registers the `pianoRoll` fenced code block processor with Obsidian.
 *
 * When Obsidian encounters a code block like:
 *
 * ```pianoRoll
 * trackID: 0
 * validation: playback
 * hint: Listen to the basic 4/4 pattern
 * playground: assets/kick-pattern.mcplayground
 * ```
 *
 * This processor parses the YAML config, optionally loads a .mcplayground
 * file, and mounts a React PianoRoll component into the rendered markdown.
 *
 * The `playground` path is resolved relative to the vault root. The
 * .mcplayground file is a ZIP archive containing `bundle/song.json` with
 * track and MIDI note data.
 */

import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { PianoRoll } from "../components/PianoRoll";
import { readPlayground, PlaygroundData, NoteData } from "../playground/reader";
import { savePlayground } from "../playground/writer";
import { AudioEngine } from "../audio/engine";
import * as path from "path";

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

export function registerPianoRollProcessor(
	plugin: Plugin,
	engine: AudioEngine
): void {
	const roots: Root[] = [];

	// Exclusive playback: only one piano roll plays at a time
	let stopCurrentPlayback: (() => void) | null = null;
	const requestExclusivePlayback = (stopFn: () => void) => {
		if (stopCurrentPlayback) stopCurrentPlayback();
		stopCurrentPlayback = stopFn;
	};

	plugin.registerMarkdownCodeBlockProcessor(
		"pianoRoll",
		async (
			source: string,
			el: HTMLElement,
			ctx: MarkdownPostProcessorContext
		) => {
			const config = parseSimpleYaml(source);

			// Validation: warn if trackID is missing
			if (!config.trackID) {
				const warningBar = el.createDiv({
					cls: "ea-validation-warning",
				});
				warningBar.textContent =
					"Warning: pianoRoll block is missing 'trackID' property";
			}

			const trackID = parseInt(config.trackID, 10) || 0;
			const validation =
				config.validation === "interaction"
					? ("interaction" as const)
					: ("playback" as const);

			// Resolve playground path: explicit YAML field, or inherit from
			// the nearest preceding <!-- step: ..., playground: ... --> comment
			const playgroundField =
				config.playground ??
				findPlaygroundFromStepComment(plugin, el, ctx);

			let playgroundData: PlaygroundData | undefined;
			let resolvedPlaygroundPath: string | undefined;

			if (playgroundField) {
				try {
					resolvedPlaygroundPath = resolvePlaygroundPath(
						plugin,
						playgroundField,
						ctx.sourcePath
					);
					playgroundData = await readPlayground(
						resolvedPlaygroundPath
					);
				} catch (err) {
					const warningBar = el.createDiv({
						cls: "ea-validation-warning",
					});
					const message =
						err instanceof Error ? err.message : String(err);
					warningBar.textContent = `Could not load playground: ${message}`;
					console.error(
						"PianoRoll: failed to load playground",
						playgroundField,
						err
					);
				}
			}

			// Determine soundbank slug from the target track
			const track = playgroundData?.tracks.find(
				(t) => t.id === trackID
			);
			const soundbankSlug = track?.soundbankSlug || "";
			const isDrum = track ? track.type === "drum" : true;

			// Eagerly load the soundbank if present
			if (soundbankSlug) {
				engine
					.initialize()
					.then(() =>
						engine.loadSoundbankForBlock(soundbankSlug)
					)
					.catch(() => {
						/* fallback to synth */
					});
			}

			// Save callback: writes edits back to the .mcplayground file
			const handleSave = resolvedPlaygroundPath
				? async (_trackID: number, notes: NoteData[]) => {
						await savePlayground(
							resolvedPlaygroundPath!,
							_trackID,
							notes
						);
					}
				: undefined;

			// Play callback: plays audio feedback when a note is triggered
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
					// Melodic: convert beat duration to seconds
					const bpm = playgroundData?.tempo ?? 120;
					const durationSec = durationBeats
						? (durationBeats / bpm) * 60 + 0.3 // sustain + release tail
						: 1.2;
					engine.playTone(noteNumber, durationSec);
				}
			};

			// Metronome click callback
			const handleMetronomeClick = async () => {
				await engine.initialize();
				engine.playClick();
			};

			// Init callback: ensures engine + soundbank are ready (must run in user gesture)
			const handlePlaybackStart = async () => {
				await engine.initialize();
				if (soundbankSlug) {
					await engine.loadSoundbankForBlock(soundbankSlug);
				}
			};

			// Build note names from soundbank config (resolves "Note 24" → "Kick")
			const noteNames = soundbankSlug
				? engine.getNoteNamesForSoundbank(soundbankSlug)
				: undefined;

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			root.render(
				createElement(PianoRoll, {
					trackID,
					validation,
					hint: config.hint,
					minInteractions: config.minInteractions
						? parseInt(config.minInteractions, 10)
						: undefined,
					defaultMetronomeOn: config.metronomeEnabled === "true",
					playgroundData,
					playgroundPath: resolvedPlaygroundPath,
					onSave: handleSave,
					onNotePlay: handleNotePlay,
					onPlaybackStart: handlePlaybackStart,
					onRequestExclusivePlayback: requestExclusivePlayback,
					onMetronomeClick: handleMetronomeClick,
					noteNames,
				})
			);
		}
	);

	// Clean up all React roots when the plugin is unloaded
	plugin.register(() => {
		for (const root of roots) {
			try {
				root.unmount();
			} catch {
				// Root may already be unmounted if the markdown view was closed
			}
		}
		roots.length = 0;
	});
}

/**
 * Look for a `<!-- step: ..., playground: ... -->` comment above this code
 * block in the source markdown. Returns the playground path if found.
 */
function findPlaygroundFromStepComment(
	plugin: Plugin,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext
): string | undefined {
	const sectionInfo = ctx.getSectionInfo(el);
	if (!sectionInfo) return undefined;

	const { text, lineStart } = sectionInfo;
	const lines = text.split("\n");

	// Scan upward from the code block's opening line
	for (let i = lineStart - 1; i >= 0; i--) {
		const line = lines[i]?.trim();
		if (!line) continue;

		// Match <!-- step: ..., playground: ... -->
		const match = line.match(
			/<!--\s*step:.*?playground:\s*([^\s,>]+)/
		);
		if (match) return match[1];

		// Stop scanning if we hit a heading or another code block
		if (line.startsWith("#") || line.startsWith("```")) break;
	}

	return undefined;
}

/**
 * Resolve the playground path to an absolute filesystem path.
 *
 * The `playground` field in the YAML block can be:
 * - A path relative to the current note's directory (e.g., "assets/kick.mcplayground")
 * - A path relative to the vault root (e.g., "/Lessons/assets/kick.mcplayground")
 *
 * We first try resolving relative to the current note's folder, then
 * fall back to resolving relative to the vault root.
 */
function resolvePlaygroundPath(
	plugin: Plugin,
	playgroundField: string,
	sourcePath: string
): string {
	// Get the vault's base path on disk (Electron only -- works in Obsidian desktop)
	const adapter = plugin.app.vault.adapter as { getBasePath?: () => string };
	if (!adapter.getBasePath) {
		throw new Error(
			"Cannot resolve playground path: vault adapter does not support getBasePath (mobile not supported)"
		);
	}
	const vaultBase = adapter.getBasePath();

	// If the path starts with /, treat it as vault-root-relative
	if (playgroundField.startsWith("/")) {
		return path.join(vaultBase, playgroundField);
	}

	// Otherwise, resolve relative to the current note's directory
	const noteDir = path.dirname(sourcePath);
	return path.join(vaultBase, noteDir, playgroundField);
}
