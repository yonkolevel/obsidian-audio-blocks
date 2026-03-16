/**
 * PlaygroundReader — reads `.mcplayground` ZIP archives and parses `bundle/song.json`.
 *
 * `.mcplayground` files are ZIP archives produced by the Midicircuit app.
 * Inside each archive, `bundle/song.json` contains the full song structure
 * including tracks, clips, and MIDI note data.
 *
 * This module uses `jszip` for unzipping and Node.js `fs` for reading from
 * disk (Obsidian runs in Electron so Node APIs are available).
 */

import JSZip from "jszip";
import * as fs from "fs";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlaygroundData {
	tempo: number;
	isLoopEnabled: boolean;
	tracks: TrackData[];
}

export interface TrackData {
	id: number;
	type: string;
	title: string;
	soundbankSlug: string;
	clips: ClipData[];
}

export interface ClipData {
	lengthInBars: number;
	notes: NoteData[];
}

export interface NoteData {
	noteNumber: number;
	velocity: number;
	position: number; // in beats
	duration: number; // in beats
}

// ---------------------------------------------------------------------------
// GM Drum Map — maps MIDI note numbers to human-readable drum names
// ---------------------------------------------------------------------------

export const GM_DRUM_MAP: Record<number, string> = {
	35: "Acoustic Bass Drum",
	36: "Kick",
	37: "Rimshot",
	38: "Snare",
	39: "Clap",
	40: "Electric Snare",
	41: "Low Floor Tom",
	42: "Hi-Hat Closed",
	43: "High Floor Tom",
	44: "Pedal Hi-Hat",
	45: "Low Tom",
	46: "Hi-Hat Open",
	47: "Mid Tom",
	48: "Hi-Mid Tom",
	49: "Crash",
	50: "High Tom",
	51: "Ride",
	52: "Chinese Cymbal",
	53: "Ride Bell",
	54: "Tambourine",
	55: "Splash Cymbal",
	56: "Cowbell",
	57: "Crash 2",
	58: "Vibraslap",
	59: "Ride 2",
	60: "Hi Bongo",
	61: "Low Bongo",
	62: "Mute Hi Conga",
	63: "Open Hi Conga",
	64: "Low Conga",
	65: "High Timbale",
	66: "Low Timbale",
	67: "High Agogo",
	68: "Low Agogo",
	69: "Cabasa",
	70: "Maracas",
	75: "Claves",
	76: "Hi Woodblock",
	77: "Low Woodblock",
};

/**
 * Get a human-readable name for a MIDI note number.
 *
 * For drum tracks, uses the GM drum map. Falls back to the note number
 * if no mapping exists. For melodic tracks, returns standard note names
 * (e.g., "C4", "D#5").
 */
export function drumNoteName(noteNumber: number): string {
	return GM_DRUM_MAP[noteNumber] || `Note ${noteNumber}`;
}

/**
 * Convert a MIDI note number to a standard note name like "C4" or "F#3".
 */
export function melodicNoteName(noteNumber: number): string {
	const NOTE_NAMES = [
		"C",
		"C#",
		"D",
		"D#",
		"E",
		"F",
		"F#",
		"G",
		"G#",
		"A",
		"A#",
		"B",
	];
	const octave = Math.floor(noteNumber / 12) - 1;
	const name = NOTE_NAMES[noteNumber % 12];
	return `${name}${octave}`;
}

// ---------------------------------------------------------------------------
// Raw JSON types (what song.json actually contains)
// ---------------------------------------------------------------------------

interface RawSongJSON {
	id: string;
	tempo: number;
	isLoopEnabled: boolean;
	tracks: RawTrack[];
	sections: { id: number; name: string }[];
}

interface RawTrack {
	id: number;
	type: string;
	title: string;
	soundBank?: { slug: string; name: string };
	volume: number;
	clips: RawClip[];
}

interface RawClip {
	id: number;
	lengthInBars: number;
	trackID: number;
	sectionID: number;
	midiNoteData: RawMidiNote[];
}

interface RawMidiNote {
	noteNumber: number;
	velocity: number;
	channel: number;
	duration: number;
	position: number;
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Read and parse a `.mcplayground` file from the given absolute file path.
 *
 * @param filePath Absolute path to the `.mcplayground` file on disk.
 * @returns Parsed PlaygroundData, or throws an error if the file can't be read.
 */
export async function readPlayground(
	filePath: string
): Promise<PlaygroundData> {
	// Read the ZIP archive from disk using Node.js fs
	const buffer = fs.readFileSync(filePath);
	const zip = await JSZip.loadAsync(buffer);

	// Extract bundle/song.json
	const songFile = zip.file("bundle/song.json");
	if (!songFile) {
		throw new Error(
			`No bundle/song.json found in playground: ${filePath}`
		);
	}

	const songJsonStr = await songFile.async("string");
	const raw: RawSongJSON = JSON.parse(songJsonStr);

	// Map to our public types
	return {
		tempo: raw.tempo,
		isLoopEnabled: raw.isLoopEnabled,
		tracks: raw.tracks.map((t) => ({
			id: t.id,
			type: t.type,
			title: t.title,
			soundbankSlug: t.soundBank?.slug || "",
			clips: t.clips.map((c) => ({
				lengthInBars: c.lengthInBars,
				notes: c.midiNoteData.map((n) => ({
					noteNumber: n.noteNumber,
					velocity: n.velocity,
					position: n.position,
					duration: n.duration,
				})),
			})),
		})),
	};
}
