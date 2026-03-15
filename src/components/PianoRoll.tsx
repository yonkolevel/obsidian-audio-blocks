import React, { useCallback, useEffect, useRef } from "react";

export interface PianoRollProps {
	trackID: number;
	validation: "playback" | "interaction";
	hint?: string;
	minInteractions?: number;
}

/** Row definitions for the drum-context placeholder grid. */
const DRUM_ROWS = ["Kick", "Snare", "Hi-Hat", "Ride"];

/** Total columns in the 16th-note grid (1 bar). */
const COLUMNS = 16;

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

export function PianoRoll({
	trackID,
	validation,
	hint,
	minInteractions,
}: PianoRollProps) {
	const [isPlaying, setIsPlaying] = React.useState(false);
	const [currentCol, setCurrentCol] = React.useState(-1);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

		// Walk through 16 columns at ~120 BPM, one column per 16th note
		// 120 BPM = 500ms per beat, 125ms per 16th
		const intervalMs = 125;
		let col = 0;

		intervalRef.current = setInterval(() => {
			col = (col + 1) % COLUMNS;
			setCurrentCol(col);
		}, intervalMs);
	}, []);

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

	return (
		<div className="ea-piano-roll-container">
			{/* Header: play button + badge */}
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
				<span className="ea-piano-roll-track">
					Track {trackID}
				</span>
			</div>

			{/* Grid area */}
			<div className="ea-piano-roll-grid-wrapper">
				{/* Label column */}
				<div className="ea-piano-roll-labels">
					{DRUM_ROWS.map((name, rowIdx) => (
						<div key={rowIdx} className="ea-piano-roll-label">
							{name}
						</div>
					))}
				</div>

				{/* Note grid */}
				<div className="ea-piano-roll-grid">
					{DRUM_ROWS.map((_name, rowIdx) => (
						<div key={rowIdx} className="ea-piano-roll-row">
							{Array.from({ length: COLUMNS }, (_, colIdx) => {
								const hasNote = prefilledSet.has(
									noteKey(rowIdx, colIdx)
								);
								const isPlayhead =
									isPlaying && colIdx === currentCol;
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
							})}
						</div>
					))}
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
