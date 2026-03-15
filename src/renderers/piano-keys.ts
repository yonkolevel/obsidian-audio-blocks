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

export function registerPianoKeysProcessor(
	plugin: Plugin,
	engine: AudioEngine
): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"pianoKeys",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);

			// Validation: warn if soundbank is missing
			if (!config.soundbank) {
				const warningBar = el.createDiv({
					cls: "ea-validation-warning",
				});
				warningBar.textContent =
					"Warning: pianoKeys block is missing 'soundbank' property";
			}

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			const handleNoteOn = async (midiNote: number) => {
				await engine.initialize();
				engine.playTone(midiNote);
			};

			const handleNoteOff = (_midiNote: number) => {
				// For the prototype, tones self-decay — nothing to do here.
			};

			root.render(
				createElement(PianoKeys, {
					soundbank: config.soundbank || "default",
					octaves: parseInt(config.octaves, 10) || 1,
					hint: config.hint,
					highlightedNotes: parseNumberArray(config.highlightedNotes),
					highlightColor: config.highlightColor,
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
