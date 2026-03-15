/**
 * Registers the `drumPads` fenced code block processor with Obsidian.
 *
 * When Obsidian encounters a code block like:
 *
 * ```drumPads
 * soundbank: studio-session-kit
 * hint: Tap the pads to hear drum sounds
 * ```
 *
 * This processor parses the YAML config and mounts a React DrumPads component
 * into the rendered markdown.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { DrumPads } from "../components/DrumPads";
import { AudioEngine } from "../audio/engine";

/**
 * Minimal YAML parser for the simple key-value configs we expect.
 * Avoids pulling in js-yaml for this prototype — the configs are just
 * flat key: value pairs.
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
 * Supports formats like: [1, 2, 3] or 1, 2, 3
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

export function registerDrumPadsProcessor(
	plugin: Plugin,
	engine: AudioEngine
): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"drumPads",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);

			// Validation: warn if soundbank is missing
			if (!config.soundbank) {
				const warningBar = el.createDiv({
					cls: "ea-validation-warning",
				});
				warningBar.textContent =
					"Warning: drumPads block is missing 'soundbank' property";
			}

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			const handlePadTap = async (padIndex: number) => {
				// Lazy init on first interaction (AudioContext autoplay policy)
				await engine.initialize();
				engine.playSample(padIndex);
			};

			root.render(
				createElement(DrumPads, {
					soundbank: config.soundbank || "default",
					hint: config.hint,
					highlightedPads: parseNumberArray(config.highlightedPads),
					onPadTap: handlePadTap,
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
