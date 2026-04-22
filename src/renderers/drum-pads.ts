/**
 * Drum pads renderer.
 *
 * Exports `mountDrumPads()` — handles engine init, soundbank load, focus
 * management, and React rendering. Called by both the legacy `drumPads`
 * code block processor and the `music drums` variant.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { DrumPads } from "../components/DrumPads";
import { AudioEngine } from "../audio/engine";
import { FocusManager } from "../audio/focus-manager";

// ---------------------------------------------------------------------------
// Parsing helpers (exported for reuse by music.ts)
// ---------------------------------------------------------------------------

export function parseSimpleYaml(source: string): Record<string, string> {
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

export function parseNumberArray(
	value: unknown
): number[] | undefined {
	if (value === undefined || value === null) return undefined;

	if (Array.isArray(value)) {
		const nums = value
			.map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
			.filter((n) => !isNaN(n));
		return nums.length > 0 ? nums : undefined;
	}

	const str = String(value);
	if (!str) return undefined;
	const cleaned = str.replace(/[\[\]]/g, "");
	const nums = cleaned
		.split(",")
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => !isNaN(n));
	return nums.length > 0 ? nums : undefined;
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export interface DrumPadsMountOptions {
	/** Soundbank slug — if empty, the built-in synth kit is used. */
	soundbank: string;
	hint?: string;
	highlightedPads?: number[];
	validation?: "interaction" | "playback";
	minInteractions?: number;
}

/**
 * Mount a DrumPads React tree into `el`. Returns the Root so the caller
 * can track it for cleanup.
 */
export function mountDrumPads(
	el: HTMLElement,
	engine: AudioEngine,
	focusManager: FocusManager,
	options: DrumPadsMountOptions
): Root {
	const soundbankSlug = options.soundbank;
	const container = el.createDiv({ cls: "ea-block-container" });
	const root = createRoot(container);

	let isLoading = true;

	const buildLabels = (): string[] | undefined => {
		if (!soundbankSlug) return undefined;
		if (!engine.isSoundbankLoaded(soundbankSlug)) return undefined;

		const defaultOctave =
			engine.getSoundbankDefaultOctave(soundbankSlug) ?? 24;
		const names = engine.getNoteNamesForSoundbank(soundbankSlug);
		if (names.size === 0) return undefined;

		// Map each pad index to the soundbank sample name at the corresponding
		// MIDI note. Pads without a matching sample keep the generic default.
		const GENERIC = [
			"FX 1", "FX 2", "FX 3", "FX 4",
			"Tom 1", "Tom 2", "Tom 3", "Tom 4",
			"CH", "OH", "Perc 1", "Perc 2",
			"Kick", "Snare", "Clap", "Rim",
		];
		return GENERIC.map(
			(fallback, i) => names.get(defaultOctave + i) ?? fallback
		);
	};

	const handlePadTap = (padIndex: number) => {
		if (engine.isInitialized()) {
			if (soundbankSlug && engine.isSoundbankLoaded(soundbankSlug)) {
				const defaultOctave =
					engine.getSoundbankDefaultOctave(soundbankSlug) ?? 24;
				engine.playSoundbankNote(
					soundbankSlug,
					defaultOctave + padIndex
				);
				return;
			}
			if (!soundbankSlug) {
				engine.playSample(padIndex);
				return;
			}
		}

		(async () => {
			await engine.initialize();
			if (soundbankSlug) {
				await engine.loadSoundbankForBlock(soundbankSlug);
				const defaultOctave =
					engine.getSoundbankDefaultOctave(soundbankSlug) ?? 24;
				engine.playSoundbankNote(
					soundbankSlug,
					defaultOctave + padIndex
				);
			} else {
				engine.playSample(padIndex);
			}
			isLoading = false;
			render();
		})();
	};

	const render = () => {
		root.render(
			createElement(DrumPads, {
				soundbank: soundbankSlug || "default",
				hint: options.hint,
				highlightedPads: options.highlightedPads,
				validation:
					options.validation === "interaction"
						? "interaction"
						: undefined,
				minInteractions: options.minInteractions,
				isLoading,
				labels: buildLabels(),
				onPadTap: handlePadTap,
				onRequestFocus: (release: () => void) => {
					focusManager.requestFocus(() => {
						release();
						engine.stopAllNotes();
					});
				},
			})
		);
	};

	const finishLoad = () => {
		isLoading = false;
		render();
	};

	if (soundbankSlug) {
		engine
			.initialize()
			.then(() => engine.loadSoundbankForBlock(soundbankSlug))
			.then(finishLoad)
			.catch(finishLoad);
	} else {
		engine.initialize().then(finishLoad).catch(finishLoad);
	}

	render();
	return root;
}

// ---------------------------------------------------------------------------
// Legacy `drumPads` code block processor
// ---------------------------------------------------------------------------

export function registerDrumPadsProcessor(
	plugin: Plugin,
	engine: AudioEngine,
	focusManager: FocusManager
): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"drumPads",
		(source: string, el: HTMLElement) => {
			const config = parseSimpleYaml(source);
			const soundbank = config.soundbank || "";

			if (!soundbank) {
				const warning = el.createDiv({ cls: "ea-validation-warning" });
				warning.textContent =
					"Warning: drumPads block is missing 'soundbank' property";
			}

			const root = mountDrumPads(el, engine, focusManager, {
				soundbank,
				hint: config.hint,
				highlightedPads: parseNumberArray(config.highlightedPads),
				validation:
					config.validation === "interaction"
						? "interaction"
						: undefined,
				minInteractions: config.minInteractions
					? parseInt(config.minInteractions, 10)
					: undefined,
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
