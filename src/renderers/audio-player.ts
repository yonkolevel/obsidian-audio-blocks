/**
 * Registers the `audio` fenced code block processor with Obsidian.
 *
 * When Obsidian encounters a code block like:
 *
 * ```audio
 * soundbank: argon-8-rhode-keys
 * sampleIndex: 0
 * label: Listen to the Rhodes sound
 * ```
 *
 * This processor parses the config and mounts a React AudioPlayer component
 * into the rendered markdown.
 *
 * If a soundbank is specified and available, the real .wav sample is played.
 * Otherwise a synthesized tone is used as a fallback.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { AudioPlayer } from "../components/AudioPlayer";
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

export function registerAudioPlayerProcessor(
	plugin: Plugin,
	engine: AudioEngine
): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"audio",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);
			const soundbankSlug = config.soundbank || "";

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			const sampleIndex = parseInt(config.sampleIndex, 10) || 0;

			// Eagerly start loading the soundbank
			if (soundbankSlug) {
				engine
					.initialize()
					.then(() => engine.loadSoundbankForBlock(soundbankSlug))
					.catch(() => {
						/* fallback to synth */
					});
			}

			const handlePlay = async () => {
				await engine.initialize();

				if (soundbankSlug) {
					await engine.loadSoundbankForBlock(soundbankSlug);

					// Compute MIDI note from defaultOctave + sampleIndex
					const defaultOctave =
						engine.getSoundbankDefaultOctave(soundbankSlug) ?? 60;
					const midiNote = defaultOctave + sampleIndex;

					engine.playSoundbankNote(soundbankSlug, midiNote);
				} else {
					// Fallback: play a synthesized tone
					engine.playTone(60 + sampleIndex, 0.5);
				}
			};

			root.render(
				createElement(AudioPlayer, {
					soundbank: soundbankSlug || "default",
					sampleIndex,
					label: config.label || "Play sound",
					onPlay: handlePlay,
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
