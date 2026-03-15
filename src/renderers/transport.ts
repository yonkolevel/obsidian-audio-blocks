/**
 * Registers the `transport` fenced code block processor with Obsidian.
 *
 * When Obsidian encounters a code block like:
 *
 * ```transport
 * tempo: 120
 * timeSignature: 4/4
 * loop: true
 * ```
 *
 * This processor parses the config and mounts a React Transport component
 * into the rendered markdown.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { Transport } from "../components/Transport";
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

export function registerTransportProcessor(
	plugin: Plugin,
	engine: AudioEngine
): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"transport",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			const handlePlayClick = async () => {
				await engine.initialize();
				engine.playClick();
			};

			root.render(
				createElement(Transport, {
					tempo: parseInt(config.tempo, 10) || 120,
					timeSignature: config.timeSignature || "4/4",
					loop: config.loop === "true",
					onPlayClick: handlePlayClick,
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
