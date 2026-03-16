/**
 * PlaygroundWriter -- writes updated MIDI note data back to `.mcplayground` ZIP archives.
 *
 * Reads the existing ZIP, updates the target track's first clip `midiNoteData`
 * in `bundle/song.json`, and writes the ZIP back to disk.
 *
 * Uses `jszip` for ZIP manipulation and Node.js `fs` for disk I/O
 * (Obsidian runs in Electron so Node APIs are available).
 */

import JSZip from "jszip";
import * as fs from "fs";
import { NoteData } from "./reader";

/**
 * Save updated notes back to a `.mcplayground` file.
 *
 * @param filePath Absolute path to the `.mcplayground` file on disk.
 * @param trackID The track ID whose first clip will be updated.
 * @param notes The new note array to write into the clip's midiNoteData.
 */
export async function savePlayground(
	filePath: string,
	trackID: number,
	notes: NoteData[]
): Promise<void> {
	const buffer = fs.readFileSync(filePath);
	const zip = await JSZip.loadAsync(buffer);

	const songJsonFile = zip.file("bundle/song.json");
	if (!songJsonFile) {
		throw new Error(
			`No bundle/song.json found in playground: ${filePath}`
		);
	}

	const songJson = JSON.parse(await songJsonFile.async("string"));

	// Find the track and update its first clip's midiNoteData
	const track = songJson.tracks.find((t: { id: number }) => t.id === trackID);
	if (!track || !track.clips || !track.clips[0]) {
		throw new Error(
			`Track ${trackID} not found or has no clips in: ${filePath}`
		);
	}

	track.clips[0].midiNoteData = notes.map((n) => ({
		noteNumber: n.noteNumber,
		velocity: n.velocity,
		channel: 0,
		duration: n.duration,
		position: n.position,
	}));

	// Write the updated song.json back into the ZIP
	zip.file("bundle/song.json", JSON.stringify(songJson, null, 2));

	// Generate the ZIP and write to disk
	const output = await zip.generateAsync({ type: "nodebuffer" });
	fs.writeFileSync(filePath, output);
}
