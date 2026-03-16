import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
	PlaygroundData,
	TrackData,
	ClipData,
	NoteData,
	drumNoteName,
	melodicNoteName,
} from "../playground/reader";

export interface PianoRollProps {
	trackID: number;
	validation: "playback" | "interaction";
	hint?: string;
	minInteractions?: number;
	/** When provided, renders real MIDI data instead of placeholders. */
	playgroundData?: PlaygroundData;
}

/** Row definitions for the drum-context placeholder grid. */
const PLACEHOLDER_DRUM_ROWS = ["Kick", "Snare", "Hi-Hat", "Ride"];

/** Total columns in the placeholder 16th-note grid (1 bar). */
const PLACEHOLDER_COLUMNS = 16;

/**
 * Pre-filled note pattern to make the placeholder look realistic.
 * Each entry is [rowIndex, columnIndex].
 */
const PREFILLED_NOTES: [number, number][] = [
	// Kick: 4-on-the-floor
	[0, 0],
	[0, 4],
	[0, 8],
	[0, 12],
	// Snare: beats 2 and 4
	[1, 4],
	[1, 12],
	// Hi-Hat: every other 16th
	[2, 0],
	[2, 2],
	[2, 4],
	[2, 6],
	[2, 8],
	[2, 10],
	[2, 12],
	[2, 14],
	// Ride: off-beats
	[3, 2],
	[3, 6],
	[3, 10],
	[3, 14],
];

function noteKey(row: number, col: number): string {
	return `${row}-${col}`;
}

const prefilledSet = new Set(PREFILLED_NOTES.map(([r, c]) => noteKey(r, c)));

// ---------------------------------------------------------------------------
// Helpers for playground data rendering
// ---------------------------------------------------------------------------

interface RowInfo {
	noteNumber: number;
	label: string;
}

interface GridNote {
	/** Row index in the sorted rows array. */
	rowIndex: number;
	/** Column start (in 16th-note grid subdivisions). */
	colStart: number;
	/** Width in grid cells (duration in 16th-note subdivisions). */
	colSpan: number;
}

/**
 * Build the row definitions and placed notes from a track's clip data.
 */
function buildGridFromClip(
	track: TrackData,
	clip: ClipData
): { rows: RowInfo[]; notes: GridNote[]; totalColumns: number } {
	const isDrum = track.type === "drum";

	// Collect unique note numbers and sort ascending
	const noteNumbers = Array.from(
		new Set(clip.notes.map((n) => n.noteNumber))
	).sort((a, b) => a - b);

	const rows: RowInfo[] = noteNumbers.map((nn) => ({
		noteNumber: nn,
		label: isDrum ? drumNoteName(nn) : melodicNoteName(nn),
	}));

	// Build a lookup: noteNumber -> rowIndex
	const noteToRow = new Map<number, number>();
	rows.forEach((r, idx) => noteToRow.set(r.noteNumber, idx));

	// Total columns = bars * 4 beats * 4 subdivisions (16th notes)
	const totalColumns = clip.lengthInBars * 16;

	// Map each MIDI note to grid coordinates
	// position is in beats; multiply by 4 to get 16th-note grid columns
	const notes: GridNote[] = clip.notes.map((n) => ({
		rowIndex: noteToRow.get(n.noteNumber) ?? 0,
		colStart: Math.round(n.position * 4),
		colSpan: Math.max(1, Math.round(n.duration * 4)),
	}));

	return { rows, notes, totalColumns };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PianoRoll({
	trackID,
	validation,
	hint,
	minInteractions,
	playgroundData,
}: PianoRollProps) {
	const [isPlaying, setIsPlaying] = React.useState(false);
	const [currentCol, setCurrentCol] = React.useState(-1);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Resolve track and clip from playground data
	const track = playgroundData?.tracks.find((t) => t.id === trackID);
	const clip = track?.clips[0]; // Use the first clip

	// Build grid data from playground data (memoized)
	const gridData = useMemo(() => {
		if (track && clip) {
			return buildGridFromClip(track, clip);
		}
		return null;
	}, [track, clip]);

	// Determine rendering parameters
	const isPlaygroundMode = gridData !== null;
	const rows = isPlaygroundMode ? gridData.rows : PLACEHOLDER_DRUM_ROWS;
	const totalColumns = isPlaygroundMode
		? gridData.totalColumns
		: PLACEHOLDER_COLUMNS;

	// BPM: use playground tempo or fallback to 120
	const tempo = playgroundData?.tempo ?? 120;

	// Build a set of "note cells" for quick lookup in playground mode.
	// Each entry is "rowIndex-colIndex" for cells that have a note starting there.
	// Also build a map of note spans for multi-cell notes.
	const { noteSet, noteSpanMap } = useMemo(() => {
		const set = new Set<string>();
		const spanMap = new Map<string, number>(); // key -> colSpan

		if (isPlaygroundMode && gridData) {
			for (const gn of gridData.notes) {
				// Mark the starting cell
				const key = noteKey(gn.rowIndex, gn.colStart);
				set.add(key);
				spanMap.set(key, gn.colSpan);

				// Mark continuation cells
				for (let c = 1; c < gn.colSpan; c++) {
					const col = gn.colStart + c;
					if (col < totalColumns) {
						set.add(noteKey(gn.rowIndex, col));
					}
				}
			}
		}

		return { noteSet: set, noteSpanMap: spanMap };
	}, [isPlaygroundMode, gridData, totalColumns]);

	const stopPlayback = useCallback(() => {
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		setIsPlaying(false);
		setCurrentCol(-1);
	}, []);

	const startPlayback = useCallback(() => {
		setIsPlaying(true);
		setCurrentCol(0);

		// Walk through columns at the appropriate tempo.
		// Each column is a 16th note: interval = (60 / BPM) / 4 * 1000 ms
		const intervalMs = (60 / tempo / 4) * 1000;
		let col = 0;

		intervalRef.current = setInterval(() => {
			col = (col + 1) % totalColumns;
			setCurrentCol(col);
		}, intervalMs);
	}, [tempo, totalColumns]);

	const handleToggle = useCallback(() => {
		if (isPlaying) {
			stopPlayback();
		} else {
			startPlayback();
		}
	}, [isPlaying, startPlayback, stopPlayback]);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
		};
	}, []);

	const badgeLabel = validation === "playback" ? "Listen" : "Play along";
	const badgeClass =
		validation === "playback"
			? "ea-piano-roll-badge--listen"
			: "ea-piano-roll-badge--interact";

	// Header: show track title from playground data, or fallback
	const trackLabel = track
		? `${track.title}${track.soundbankSlug ? ` \u2014 ${track.soundbankSlug}` : ""}`
		: `Track ${trackID}`;

	// Tempo label
	const tempoLabel = `${tempo} BPM`;

	return (
		<div className="ea-piano-roll-container">
			{/* Header: play button + badge + track info */}
			<div className="ea-piano-roll-header">
				<button
					className={[
						"ea-piano-roll-play-btn",
						isPlaying ? "ea-piano-roll-play-btn--playing" : "",
					]
						.filter(Boolean)
						.join(" ")}
					onPointerDown={(e) => {
						e.preventDefault();
						handleToggle();
					}}
				>
					{isPlaying ? "\u25A0" : "\u25B6"}
				</button>
				<span className={`ea-piano-roll-badge ${badgeClass}`}>
					{badgeLabel}
				</span>
				{isPlaygroundMode && (
					<span className="ea-piano-roll-tempo">
						{tempoLabel}
					</span>
				)}
				<span className="ea-piano-roll-track">{trackLabel}</span>
			</div>

			{/* Grid area */}
			<div className="ea-piano-roll-grid-wrapper">
				{/* Label column */}
				<div className="ea-piano-roll-labels">
					{(rows as (RowInfo | string)[]).map(
						(row, rowIdx) => (
							<div key={rowIdx} className="ea-piano-roll-label">
								{typeof row === "string" ? row : row.label}
							</div>
						)
					)}
				</div>

				{/* Note grid */}
				<div className="ea-piano-roll-grid">
					{(rows as (RowInfo | string)[]).map(
						(_row, rowIdx) => (
							<div key={rowIdx} className="ea-piano-roll-row">
								{Array.from(
									{ length: totalColumns },
									(_, colIdx) => {
										const key = noteKey(rowIdx, colIdx);
										const hasNote = isPlaygroundMode
											? noteSet.has(key)
											: prefilledSet.has(key);
										const isPlayhead =
											isPlaying &&
											colIdx === currentCol;
										const isBeatLine = colIdx % 4 === 0;

										return (
											<div
												key={colIdx}
												className={[
													"ea-piano-roll-cell",
													hasNote
														? "ea-piano-roll-cell--note"
														: "",
													isPlayhead
														? "ea-piano-roll-cell--playhead"
														: "",
													isBeatLine
														? "ea-piano-roll-cell--beat"
														: "",
												]
													.filter(Boolean)
													.join(" ")}
											/>
										);
									}
								)}
							</div>
						)
					)}
				</div>
			</div>

			{/* Hint text */}
			{hint && <p className="ea-piano-roll-hint">{hint}</p>}
			{validation === "interaction" &&
				minInteractions !== undefined && (
					<p className="ea-piano-roll-meta">
						Min. interactions: {minInteractions}
					</p>
				)}
		</div>
	);
}
