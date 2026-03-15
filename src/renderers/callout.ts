/**
 * Registers the `callout` fenced code block processor with Obsidian.
 *
 * When Obsidian encounters a code block like:
 *
 * ```callout
 * style: tip
 * text: Use headphones for the best experience.
 * ```
 *
 * This processor parses the config and mounts a React Callout component
 * into the rendered markdown.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { Callout, CalloutStyle } from "../components/Callout";

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

const VALID_STYLES: CalloutStyle[] = ["tip", "info", "warning"];

export function registerCalloutProcessor(plugin: Plugin): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"callout",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			const style = VALID_STYLES.includes(config.style as CalloutStyle)
				? (config.style as CalloutStyle)
				: "info";

			root.render(
				createElement(Callout, {
					style,
					text: config.text || "",
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
