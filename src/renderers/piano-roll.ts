/**
 * Registers the `pianoRoll` fenced code block processor with Obsidian.
 *
 * When Obsidian encounters a code block like:
 *
 * ```pianoRoll
 * trackID: 0
 * validation: playback
 * hint: Listen to the basic 4/4 pattern
 * ```
 *
 * This processor parses the YAML config and mounts a React PianoRoll component
 * into the rendered markdown.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { PianoRoll } from "../components/PianoRoll";

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

export function registerPianoRollProcessor(plugin: Plugin): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"pianoRoll",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);

			// Validation: warn if trackID is missing
			if (!config.trackID) {
				const warningBar = el.createDiv({
					cls: "ea-validation-warning",
				});
				warningBar.textContent =
					"Warning: pianoRoll block is missing 'trackID' property";
			}

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			const validation =
				config.validation === "interaction"
					? "interaction"
					: "playback";

			root.render(
				createElement(PianoRoll, {
					trackID: parseInt(config.trackID, 10) || 0,
					validation,
					hint: config.hint,
					minInteractions: config.minInteractions
						? parseInt(config.minInteractions, 10)
						: undefined,
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
