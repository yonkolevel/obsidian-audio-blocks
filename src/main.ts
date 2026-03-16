import { Plugin, Notice, PluginSettingTab, App, Setting } from "obsidian";
import { AudioEngine } from "./audio/engine";
import { SoundbankManager } from "./audio/soundbank-manager";
import { registerDrumPadsProcessor } from "./renderers/drum-pads";
import { registerPianoKeysProcessor } from "./renderers/piano-keys";
import { registerTransportProcessor } from "./renderers/transport";
import { registerCalloutProcessor } from "./renderers/callout";
import { registerAudioPlayerProcessor } from "./renderers/audio-player";
import { registerQuestionProcessor } from "./renderers/question";
import { registerPianoRollProcessor } from "./renderers/piano-roll";

/**
 * Known interactive block types handled by this plugin.
 * Used to detect unknown block types and show a warning.
 */
const KNOWN_BLOCK_TYPES = [
	"drumPads",
	"pianoKeys",
	"pianoRoll",
	"transport",
	"callout",
	"audio",
	"question",
];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface ElementaryAudioSettings {
	soundbanksPath: string;
}

const DEFAULT_SETTINGS: ElementaryAudioSettings = {
	soundbanksPath:
		"/Users/ricardoabreu/Development/midicircuit-macos/Sounds/Default SoundBanks",
};

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Minimal YAML parser for flat key-value frontmatter.
 * Strips the leading/trailing `---` delimiters and parses key: value pairs.
 */
function parseFrontmatter(
	content: string
): { frontmatter: Record<string, string>; body: string } | null {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
	if (!match) return null;

	const fmBlock = match[1];
	const body = match[2];
	const frontmatter: Record<string, string> = {};

	for (const line of fmBlock.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colonIndex = trimmed.indexOf(":");
		if (colonIndex === -1) continue;
		const key = trimmed.slice(0, colonIndex).trim();
		const value = trimmed.slice(colonIndex + 1).trim();
		frontmatter[key] = value;
	}

	return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class ElementaryAudioPlugin extends Plugin {
	audioEngine: AudioEngine = new AudioEngine();
	soundbankManager: SoundbankManager | null = null;
	settings: ElementaryAudioSettings = DEFAULT_SETTINGS;

	async onload() {
		console.log("Elementary Audio: loading plugin");

		// Load persisted settings
		await this.loadSettings();

		// Create and wire SoundbankManager
		this.soundbankManager = new SoundbankManager(
			this.settings.soundbanksPath
		);
		this.audioEngine.setSoundbankManager(this.soundbankManager);

		// Kick off soundbank discovery in background
		this.soundbankManager.discoverSoundbanks().catch((err) => {
			console.warn("Elementary Audio: soundbank discovery failed:", err);
		});

		// Register settings tab
		this.addSettingTab(new ElementaryAudioSettingTab(this.app, this));

		// Register interactive block processors
		registerDrumPadsProcessor(this, this.audioEngine);
		registerPianoKeysProcessor(this, this.audioEngine);
		registerTransportProcessor(this, this.audioEngine);
		registerCalloutProcessor(this);
		registerAudioPlayerProcessor(this, this.audioEngine);
		registerQuestionProcessor(this);
		registerPianoRollProcessor(this, this.audioEngine);

		// Register unknown block type handler for circuit block types
		// that might be misspelled or not yet implemented
		this.registerUnknownBlockHandler();

		// Register commands
		this.registerExportCommand();
		this.registerValidateCommand();
	}

	onunload() {
		console.log("Elementary Audio: unloading plugin");
		this.audioEngine.dispose();
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);

		// Update SoundbankManager path and re-discover
		if (this.soundbankManager) {
			this.soundbankManager.setSoundbanksPath(
				this.settings.soundbanksPath
			);
			this.soundbankManager.discoverSoundbanks().catch((err) => {
				console.warn(
					"Elementary Audio: soundbank re-discovery failed:",
					err
				);
			});
		}
	}

	/**
	 * Registers a catch-all code block processor for common misspellings
	 * or future block types. If a block type looks like it was intended
	 * for this plugin but isn't recognized, show a warning.
	 *
	 * We register processors for plausible block names that aren't in
	 * KNOWN_BLOCK_TYPES. Since Obsidian doesn't have a wildcard processor,
	 * we register for common potential names.
	 */
	private registerUnknownBlockHandler(): void {
		// Common misspellings and future block types to catch
		const potentialBlockTypes = [
			"drumpads",
			"drum-pads",
			"drumpad",
			"pianokeys",
			"piano-keys",
			"piano",
			"sequencer",
			"mixer",
			"effects",
			"sampler",
			"synth",
			"metronome",
			"waveform",
			"slider",
			"knob",
			"fader",
		];

		for (const blockType of potentialBlockTypes) {
			if (KNOWN_BLOCK_TYPES.includes(blockType)) continue;

			this.registerMarkdownCodeBlockProcessor(
				blockType,
				(_source: string, el: HTMLElement) => {
					const container = el.createDiv({
						cls: "ea-block-container",
					});
					const warning = container.createDiv({
						cls: "ea-validation-warning",
					});
					warning.textContent = `Unknown block type: ${blockType}`;
				}
			);
		}
	}

	/**
	 * Export Circuit command — placeholder that reads the current file's
	 * frontmatter and shows lesson info via Notice. The real parser
	 * integration will come later.
	 */
	private registerExportCommand(): void {
		this.addCommand({
			id: "export-circuit",
			name: "Export Circuit",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No file open");
					return;
				}

				const content = await this.app.vault.read(file);
				const parsed = parseFrontmatter(content);

				if (!parsed || !parsed.frontmatter.id) {
					new Notice(
						"This file does not have valid lesson frontmatter (missing id)"
					);
					return;
				}

				const fm = parsed.frontmatter;
				const title = fm.title || "(untitled)";
				const id = fm.id;

				// Count chapters by looking for # Learn:, # Practice:, # Challenge: headings
				const chapterPattern =
					/^#\s+(Learn|Practice|Challenge):/gm;
				const chapters = parsed.body.match(chapterPattern);
				const chapterCount = chapters ? chapters.length : 0;

				new Notice(
					`Lesson: ${title}\nID: ${id}\nChapters: ${chapterCount}`
				);
				new Notice(
					"Export: run CLI manually for now\nnpx tsx src/export.ts <circuit-folder> <output>"
				);
			},
		});
	}

	/**
	 * Validate Lesson command — checks the current file for required
	 * lesson structure and reports issues via Notice.
	 */
	private registerValidateCommand(): void {
		this.addCommand({
			id: "validate-lesson",
			name: "Validate Lesson",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No file open");
					return;
				}

				const content = await this.app.vault.read(file);
				const issues: string[] = [];

				// Check frontmatter
				const parsed = parseFrontmatter(content);
				if (!parsed) {
					issues.push(
						"Missing frontmatter (expected --- delimiters)"
					);
				} else {
					if (!parsed.frontmatter.id) {
						issues.push("Missing 'id' in frontmatter");
					}
					if (parsed.frontmatter.type !== "lesson") {
						issues.push(
							"Missing or incorrect 'type' in frontmatter (expected: lesson)"
						);
					}

					// Check for at least one chapter heading
					const chapterPattern =
						/^#\s+(Learn|Practice|Challenge):/gm;
					const chapters = parsed.body.match(chapterPattern);
					if (!chapters || chapters.length === 0) {
						issues.push(
							"No chapters found (expected at least one '# Learn:', '# Practice:', or '# Challenge:' heading)"
						);
					}
				}

				if (issues.length === 0) {
					new Notice("Lesson validation passed!");
				} else {
					new Notice(
						`Validation issues (${issues.length}):\n${issues.map((i) => "- " + i).join("\n")}`
					);
				}
			},
		});
	}
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

class ElementaryAudioSettingTab extends PluginSettingTab {
	plugin: ElementaryAudioPlugin;

	constructor(app: App, plugin: ElementaryAudioPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Elementary Audio Settings" });

		new Setting(containerEl)
			.setName("Soundbanks path")
			.setDesc(
				"Absolute path to the Default SoundBanks folder. " +
					"Each subfolder should contain a config.json and .wav files."
			)
			.addText((text) =>
				text
					.setPlaceholder("/path/to/Default SoundBanks")
					.setValue(this.plugin.settings.soundbanksPath)
					.onChange(async (value) => {
						this.plugin.settings.soundbanksPath = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
