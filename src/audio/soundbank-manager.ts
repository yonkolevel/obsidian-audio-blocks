/**
 * SoundbankManager — discovers and loads soundbank sample files from disk.
 *
 * Soundbanks are folders containing a `config.json` and `.wav` sample files.
 * The manager scans the configured soundbanks directory, reads each config,
 * and lazily loads samples into AudioBuffers on demand.
 *
 * Runs in Electron's Node.js context so we have full `fs` access.
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SoundbankSampleConfig {
	midiNumber: number;
	minRange?: number;
	maxRange?: number;
	fileName?: string;
	urls: {
		wav: string;
		m4a?: string;
		ogg?: string;
	};
}

export interface SoundbankConfig {
	instrumentSlug: string;
	name: string;
	category: string;
	defaultOctave: number;
	samples: SoundbankSampleConfig[];
	/** The folder path on disk (set at discovery time). */
	folderPath: string;
}

export interface LoadedSoundbank {
	config: SoundbankConfig;
	/** Map from MIDI note number to decoded AudioBuffer. */
	samples: Map<number, AudioBuffer>;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SoundbankManager {
	private soundbanksPath: string;

	/** slug -> config (populated by discoverSoundbanks) */
	private registry: Map<string, SoundbankConfig> = new Map();

	/** slug -> loaded samples */
	private loaded: Map<string, LoadedSoundbank> = new Map();

	private discovered = false;

	constructor(soundbanksPath: string) {
		this.soundbanksPath = soundbanksPath;
	}

	/** Update the root path (e.g. when the user changes the setting). */
	setSoundbanksPath(newPath: string): void {
		if (newPath !== this.soundbanksPath) {
			this.soundbanksPath = newPath;
			this.registry.clear();
			this.loaded.clear();
			this.discovered = false;
		}
	}

	// ------------------------------------------------------------------
	// Discovery
	// ------------------------------------------------------------------

	/**
	 * Scan the soundbanks directory and read every config.json.
	 * Returns a map of slug -> SoundbankConfig.
	 */
	async discoverSoundbanks(): Promise<Map<string, SoundbankConfig>> {
		if (this.discovered) return this.registry;

		this.registry.clear();

		if (!this.soundbanksPath || !fs.existsSync(this.soundbanksPath)) {
			console.warn(
				"SoundbankManager: soundbanks path does not exist:",
				this.soundbanksPath
			);
			return this.registry;
		}

		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(this.soundbanksPath, {
				withFileTypes: true,
			});
		} catch (err) {
			console.warn(
				"SoundbankManager: could not read soundbanks directory:",
				err
			);
			return this.registry;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const folderPath = path.join(this.soundbanksPath, entry.name);
			const configPath = path.join(folderPath, "config.json");

			if (!fs.existsSync(configPath)) continue;

			try {
				const raw = fs.readFileSync(configPath, "utf-8");
				const parsed = JSON.parse(raw) as Omit<
					SoundbankConfig,
					"folderPath"
				>;
				const config: SoundbankConfig = {
					...parsed,
					folderPath,
				};
				this.registry.set(config.instrumentSlug, config);
			} catch (err) {
				console.warn(
					`SoundbankManager: failed to parse config in "${entry.name}":`,
					err
				);
			}
		}

		this.discovered = true;
		console.log(
			`SoundbankManager: discovered ${this.registry.size} soundbanks`
		);
		return this.registry;
	}

	// ------------------------------------------------------------------
	// Loading
	// ------------------------------------------------------------------

	/**
	 * Load all samples for the given soundbank slug into AudioBuffers.
	 * The result is cached — subsequent calls return the same LoadedSoundbank.
	 */
	async loadSoundbank(
		slug: string,
		audioCtx: AudioContext
	): Promise<LoadedSoundbank | null> {
		// Return cached if available
		const cached = this.loaded.get(slug);
		if (cached) return cached;

		// Ensure discovery has run
		await this.discoverSoundbanks();

		const config = this.registry.get(slug);
		if (!config) {
			console.warn(
				`SoundbankManager: unknown soundbank slug "${slug}"`
			);
			return null;
		}

		const samplesMap = new Map<number, AudioBuffer>();

		for (const sample of config.samples) {
			const wavName = sample.urls.wav;
			if (!wavName) continue;

			const wavPath = path.join(config.folderPath, `${wavName}.wav`);

			if (!fs.existsSync(wavPath)) {
				console.warn(
					`SoundbankManager: wav file not found: ${wavPath}`
				);
				continue;
			}

			try {
				const fileBuffer = fs.readFileSync(wavPath);
				// Convert Node Buffer to ArrayBuffer
				const arrayBuffer = fileBuffer.buffer.slice(
					fileBuffer.byteOffset,
					fileBuffer.byteOffset + fileBuffer.byteLength
				);
				const audioBuffer =
					await audioCtx.decodeAudioData(arrayBuffer);
				samplesMap.set(sample.midiNumber, audioBuffer);
			} catch (err) {
				console.warn(
					`SoundbankManager: failed to decode "${wavPath}":`,
					err
				);
			}
		}

		const loadedSoundbank: LoadedSoundbank = {
			config,
			samples: samplesMap,
		};

		this.loaded.set(slug, loadedSoundbank);
		console.log(
			`SoundbankManager: loaded ${samplesMap.size} samples for "${slug}"`
		);
		return loadedSoundbank;
	}

	// ------------------------------------------------------------------
	// Accessors
	// ------------------------------------------------------------------

	/**
	 * Get a previously loaded soundbank (returns null if not yet loaded).
	 */
	getSoundbank(slug: string): LoadedSoundbank | null {
		return this.loaded.get(slug) ?? null;
	}

	/**
	 * Get the config for a discovered soundbank (returns undefined if not found).
	 */
	getConfig(slug: string): SoundbankConfig | undefined {
		return this.registry.get(slug);
	}

	/**
	 * Find the AudioBuffer for a given MIDI note in a loaded soundbank.
	 * Uses range matching: if the note falls within a sample's minRange..maxRange,
	 * that sample is returned. Falls back to exact midiNumber match.
	 */
	findSampleForNote(
		slug: string,
		midiNote: number
	): AudioBuffer | null {
		const loaded = this.loaded.get(slug);
		if (!loaded) return null;

		// Direct hit
		const direct = loaded.samples.get(midiNote);
		if (direct) return direct;

		// Range-based lookup
		for (const sampleCfg of loaded.config.samples) {
			const min = sampleCfg.minRange ?? sampleCfg.midiNumber;
			const max = sampleCfg.maxRange ?? sampleCfg.midiNumber;
			if (midiNote >= min && midiNote <= max) {
				const buf = loaded.samples.get(sampleCfg.midiNumber);
				if (buf) return buf;
			}
		}

		return null;
	}
}
