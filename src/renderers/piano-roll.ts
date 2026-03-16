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
import { readPlayground, PlaygroundData } from "../playground/reader";
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

export function registerPianoRollProcessor(plugin: Plugin): void {
	const roots: Root[] = [];

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

			// Attempt to load playground data if a playground path is specified
			let playgroundData: PlaygroundData | undefined;

			if (config.playground) {
				try {
					const playgroundPath = resolvePlaygroundPath(
						plugin,
						config.playground,
						ctx.sourcePath
					);
					playgroundData = await readPlayground(playgroundPath);
				} catch (err) {
					const warningBar = el.createDiv({
						cls: "ea-validation-warning",
					});
					const message =
						err instanceof Error ? err.message : String(err);
					warningBar.textContent = `Could not load playground: ${message}`;
					console.error(
						"PianoRoll: failed to load playground",
						config.playground,
						err
					);
				}
			}

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
					playgroundData,
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
	// Get the vault's base path on disk (Electron only — works in Obsidian desktop)
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
