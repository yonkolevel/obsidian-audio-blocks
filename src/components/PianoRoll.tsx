import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	PlaygroundData,
	TrackData,
	ClipData,
	NoteData,
	drumNoteName,
	melodicNoteName,
} from "../playground/reader";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PianoRollProps {
	trackID: number;
	validation: "playback" | "interaction";
	hint?: string;
	minInteractions?: number;
	playgroundData?: PlaygroundData;
	playgroundPath?: string;
	onSave?: (trackID: number, notes: NoteData[]) => Promise<void>;
	onNotePlay?: (noteNumber: number, durationBeats?: number) => void;
	onPlaybackStart?: () => Promise<void>;
	onRequestExclusivePlayback?: (stopFn: () => void) => void;
	onMetronomeClick?: () => void;
	noteNames?: Map<number, string>;
	defaultMetronomeOn?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CELL_W = 28; // px per 16th-note column
const CELL_H = 28; // px per row
const DRAG_THRESHOLD = 3; // px before drag starts
const RESIZE_HANDLE_W = 8; // px width of right-edge resize handle
const MIN_NOTE_DURATION = 0.25; // 1 sixteenth note

/** Default drum rows shown when there is no playground data. */
const DEFAULT_DRUM_ROWS: RowInfo[] = [
	{ noteNumber: 36, label: "Kick" },
	{ noteNumber: 38, label: "Snare" },
	{ noteNumber: 42, label: "Hi-Hat Closed" },
	{ noteNumber: 51, label: "Ride" },
];

const PLACEHOLDER_COLUMNS = 16;

const PREFILLED_NOTES: NoteData[] = [
	// Kick: 4-on-the-floor
	{ noteNumber: 36, velocity: 110, position: 0, duration: 0.25 },
	{ noteNumber: 36, velocity: 110, position: 1, duration: 0.25 },
	{ noteNumber: 36, velocity: 110, position: 2, duration: 0.25 },
	{ noteNumber: 36, velocity: 110, position: 3, duration: 0.25 },
	// Snare: beats 2 and 4
	{ noteNumber: 38, velocity: 110, position: 1, duration: 0.25 },
	{ noteNumber: 38, velocity: 110, position: 3, duration: 0.25 },
	// Hi-Hat: every other 16th
	{ noteNumber: 42, velocity: 100, position: 0, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 0.5, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 1, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 1.5, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 2, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 2.5, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 3, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 3.5, duration: 0.25 },
	// Ride: off-beats
	{ noteNumber: 51, velocity: 100, position: 0.5, duration: 0.25 },
	{ noteNumber: 51, velocity: 100, position: 1.5, duration: 0.25 },
	{ noteNumber: 51, velocity: 100, position: 2.5, duration: 0.25 },
	{ noteNumber: 51, velocity: 100, position: 3.5, duration: 0.25 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RowInfo {
	noteNumber: number;
	label: string;
}

function resolveNoteLabel(
	nn: number,
	isDrum: boolean,
	noteNames?: Map<number, string>
): string {
	return noteNames?.get(nn) ?? (isDrum ? drumNoteName(nn) : melodicNoteName(nn));
}

function buildRows(
	notes: NoteData[],
	isDrum: boolean,
	noteNames?: Map<number, string>
): RowInfo[] {
	const noteNumbers = new Set(notes.map((n) => n.noteNumber));
	const sorted = Array.from(noteNumbers).sort((a, b) => a - b);
	return sorted.map((nn) => ({
		noteNumber: nn,
		label: resolveNoteLabel(nn, isDrum, noteNames),
	}));
}

/** Snap a beat value to the nearest 16th note. */
function snap16(value: number): number {
	return Math.round(value * 4) / 4;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PianoRoll({
	trackID,
	validation,
	hint,
	minInteractions,
	defaultMetronomeOn,
	playgroundData,
	playgroundPath,
	onSave,
	onNotePlay,
	onPlaybackStart,
	onRequestExclusivePlayback,
	onMetronomeClick,
	noteNames,
}: PianoRollProps) {
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentCol, setCurrentCol] = useState(-1);
	const [metronomeOn, setMetronomeOn] = useState(defaultMetronomeOn ?? false);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Edit state
	const [editableNotes, setEditableNotes] = useState<NoteData[] | null>(null);
	const [isDirty, setIsDirty] = useState(false);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Drag state
	const [dragState, setDragState] = useState<{
		noteIdx: number;
		mode: "move" | "resize";
		startX: number;
		startY: number;
		origPosition: number;
		origDuration: number;
		origNoteNumber: number;
		deltaBeats: number;
		deltaRows: number;
		committed: boolean; // has pointer moved past threshold?
	} | null>(null);

	// Resolve track and clip
	const track = playgroundData?.tracks.find((t) => t.id === trackID);
	const clip = track?.clips[0];
	const isDrum = track ? track.type === "drum" : true;
	const isEditable = !!playgroundPath && !!onSave;
	const hasPlaygroundData = !!(track && clip);

	// Total columns (in 16th notes)
	const totalColumns = clip ? clip.lengthInBars * 16 : PLACEHOLDER_COLUMNS;
	const totalBeats = totalColumns / 4;

	// Initialize editable notes from clip data
	useEffect(() => {
		if (clip) {
			setEditableNotes([...clip.notes]);
			setIsDirty(false);
		}
	}, [clip]);

	// The active note set
	const activeNotes = useMemo(() => {
		if (!hasPlaygroundData) return PREFILLED_NOTES;
		return isEditable && editableNotes !== null ? editableNotes : clip?.notes ?? [];
	}, [hasPlaygroundData, isEditable, editableNotes, clip]);

	// Build rows from notes
	const rows = useMemo(
		() => (hasPlaygroundData ? buildRows(activeNotes, isDrum, noteNames) : DEFAULT_DRUM_ROWS),
		[hasPlaygroundData, activeNotes, isDrum, noteNames]
	);

	// Row index lookup: noteNumber → rowIndex
	const noteToRow = useMemo(() => {
		const map = new Map<number, number>();
		rows.forEach((r, i) => map.set(r.noteNumber, i));
		return map;
	}, [rows]);

	const [tempo, setTempo] = useState(playgroundData?.tempo ?? 120);
	const gridW = totalColumns * CELL_W;
	const gridH = rows.length * CELL_H;

	// ------------------------------------------------------------------
	// Auto-save
	// ------------------------------------------------------------------
	const performSave = useCallback(async () => {
		if (!onSave || !editableNotes) return;
		setSaveState("saving");
		try {
			await onSave(trackID, editableNotes);
			setIsDirty(false);
			setSaveState("saved");
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
			saveTimeoutRef.current = setTimeout(() => setSaveState("idle"), 1500);
		} catch (err) {
			console.error("PianoRoll: save failed", err);
			setSaveState("idle");
		}
	}, [onSave, editableNotes, trackID]);

	useEffect(() => {
		if (!isDirty || !isEditable) return;
		if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
		autoSaveTimeoutRef.current = setTimeout(() => performSave(), 500);
		return () => {
			if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
		};
	}, [isDirty, isEditable, performSave]);

	// ------------------------------------------------------------------
	// Grid click: create note on empty area
	// ------------------------------------------------------------------
	const gridRef = useRef<HTMLDivElement>(null);

	const handleGridClick = useCallback(
		(e: React.PointerEvent) => {
			if (!isEditable || dragState?.committed) return;
			const rect = gridRef.current?.getBoundingClientRect();
			if (!rect) return;
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			const colIdx = Math.floor(x / CELL_W);
			const rowIdx = Math.floor(y / CELL_H);
			if (rowIdx < 0 || rowIdx >= rows.length) return;
			if (colIdx < 0 || colIdx >= totalColumns) return;

			const row = rows[rowIdx];
			const position = colIdx / 4;
			const duration = 0.25;

			// Check if a note already exists at this position
			const existing = activeNotes.findIndex(
				(n) =>
					n.noteNumber === row.noteNumber &&
					position >= n.position &&
					position < n.position + n.duration
			);
			if (existing >= 0) return; // Clicking a note is handled by note pointer events

			if (onNotePlay) onNotePlay(row.noteNumber);
			setEditableNotes((prev) => [
				...(prev ?? []),
				{ noteNumber: row.noteNumber, velocity: 110, position, duration },
			]);
			setIsDirty(true);
		},
		[isEditable, rows, totalColumns, activeNotes, onNotePlay, dragState]
	);

	// ------------------------------------------------------------------
	// Note click: delete
	// ------------------------------------------------------------------
	const handleNoteClick = useCallback(
		(noteIdx: number) => {
			if (!isEditable) return;
			setEditableNotes((prev) => (prev ?? []).filter((_, i) => i !== noteIdx));
			setIsDirty(true);
		},
		[isEditable]
	);

	// ------------------------------------------------------------------
	// Note drag: move / resize
	// ------------------------------------------------------------------
	const handleNotePointerDown = useCallback(
		(e: React.PointerEvent, noteIdx: number, mode: "move" | "resize") => {
			if (!isEditable) return;
			e.preventDefault();
			e.stopPropagation();
			const note = activeNotes[noteIdx];
			if (!note) return;

			setDragState({
				noteIdx,
				mode,
				startX: e.clientX,
				startY: e.clientY,
				origPosition: note.position,
				origDuration: note.duration,
				origNoteNumber: note.noteNumber,
				deltaBeats: 0,
				deltaRows: 0,
				committed: false,
			});

			(e.target as HTMLElement).setPointerCapture(e.pointerId);
		},
		[isEditable, activeNotes]
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!dragState) return;
			const dx = e.clientX - dragState.startX;
			const dy = e.clientY - dragState.startY;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const committed = dragState.committed || dist > DRAG_THRESHOLD;
			const deltaBeats = snap16(dx / CELL_W / 4);
			const deltaRows = Math.round(dy / CELL_H);

			setDragState((prev) =>
				prev ? { ...prev, deltaBeats, deltaRows, committed } : null
			);
		},
		[dragState]
	);

	const handlePointerUp = useCallback(
		(e: React.PointerEvent) => {
			if (!dragState) return;
			(e.target as HTMLElement).releasePointerCapture(e.pointerId);

			if (!dragState.committed) {
				// Was a click, not a drag — delete the note
				handleNoteClick(dragState.noteIdx);
				setDragState(null);
				return;
			}

			// Commit the drag
			setEditableNotes((prev) => {
				if (!prev) return prev;
				const updated = [...prev];
				const note = { ...updated[dragState.noteIdx] };

				if (dragState.mode === "move") {
					let newPos = snap16(dragState.origPosition + dragState.deltaBeats);
					newPos = Math.max(0, Math.min(newPos, totalBeats - note.duration));

					// Calculate new note number from row shift
					const origRow = noteToRow.get(dragState.origNoteNumber) ?? 0;
					let newRow = origRow + dragState.deltaRows;
					newRow = Math.max(0, Math.min(newRow, rows.length - 1));
					note.noteNumber = rows[newRow].noteNumber;
					note.position = newPos;
				} else {
					// resize
					let newDur = snap16(dragState.origDuration + dragState.deltaBeats);
					newDur = Math.max(MIN_NOTE_DURATION, newDur);
					// Don't extend past end
					newDur = Math.min(newDur, totalBeats - note.position);
					note.duration = newDur;
				}

				updated[dragState.noteIdx] = note;
				return updated;
			});
			setIsDirty(true);
			setDragState(null);
		},
		[dragState, handleNoteClick, totalBeats, noteToRow, rows]
	);

	// ------------------------------------------------------------------
	// Playback
	// ------------------------------------------------------------------
	const activeNotesRef = useRef(activeNotes);
	activeNotesRef.current = activeNotes;
	const onNotePlayRef = useRef(onNotePlay);
	onNotePlayRef.current = onNotePlay;
	const metronomeOnRef = useRef(metronomeOn);
	metronomeOnRef.current = metronomeOn;
	const onMetronomeClickRef = useRef(onMetronomeClick);
	onMetronomeClickRef.current = onMetronomeClick;

	const playNotesAtColumn = useCallback((col: number) => {
		if (metronomeOnRef.current && col % 4 === 0 && onMetronomeClickRef.current) {
			onMetronomeClickRef.current();
		}
		const play = onNotePlayRef.current;
		if (!play) return;
		const notes = activeNotesRef.current;
		for (const n of notes) {
			const noteCol = Math.round(n.position * 4);
			if (noteCol === col) play(n.noteNumber, n.duration);
		}
	}, []);

	const stopPlayback = useCallback(() => {
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		setIsPlaying(false);
		setCurrentCol(-1);
	}, []);

	const startPlayback = useCallback(async () => {
		if (onRequestExclusivePlayback) onRequestExclusivePlayback(stopPlayback);
		if (onPlaybackStart) await onPlaybackStart();

		setIsPlaying(true);
		setCurrentCol(0);
		playNotesAtColumn(0);

		const intervalMs = (60 / tempo / 4) * 1000;
		let col = 0;
		intervalRef.current = setInterval(() => {
			col = (col + 1) % totalColumns;
			setCurrentCol(col);
			playNotesAtColumn(col);
		}, intervalMs);
	}, [tempo, totalColumns, playNotesAtColumn, onPlaybackStart, onRequestExclusivePlayback, stopPlayback]);

	const handleToggle = useCallback(() => {
		if (isPlaying) stopPlayback();
		else startPlayback();
	}, [isPlaying, startPlayback, stopPlayback]);

	// Restart playback when tempo changes mid-play
	useEffect(() => {
		if (!isPlaying || !intervalRef.current) return;
		clearInterval(intervalRef.current);
		const intervalMs = (60 / tempo / 4) * 1000;
		let col = currentCol;
		intervalRef.current = setInterval(() => {
			col = (col + 1) % totalColumns;
			setCurrentCol(col);
			playNotesAtColumn(col);
		}, intervalMs);
	}, [tempo]);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
			if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
		};
	}, []);

	// ------------------------------------------------------------------
	// Render helpers
	// ------------------------------------------------------------------
	const badgeLabel = validation === "playback" ? "Listen" : "Play along";
	const badgeClass =
		validation === "playback" ? "ea-piano-roll-badge--listen" : "ea-piano-roll-badge--interact";
	const trackLabel = track
		? `${track.title}${track.soundbankSlug ? ` \u2014 ${track.soundbankSlug}` : ""}`
		: `Track ${trackID}`;

	/** Compute visual position for a note, applying drag offset if active. */
	function noteStyle(note: NoteData, noteIdx: number): React.CSSProperties {
		const rowIdx = noteToRow.get(note.noteNumber) ?? 0;
		let left = note.position * 4 * CELL_W;
		let top = rowIdx * CELL_H;
		let width = note.duration * 4 * CELL_W;

		if (dragState && dragState.noteIdx === noteIdx && dragState.committed) {
			if (dragState.mode === "move") {
				left = (dragState.origPosition + dragState.deltaBeats) * 4 * CELL_W;
				const origRow = noteToRow.get(dragState.origNoteNumber) ?? 0;
				top = (origRow + dragState.deltaRows) * CELL_H;
			} else {
				width = (dragState.origDuration + dragState.deltaBeats) * 4 * CELL_W;
				width = Math.max(CELL_W, width);
			}
		}

		return {
			position: "absolute",
			left: `${left}px`,
			top: `${top + 2}px`,
			width: `${width - 2}px`,
			height: `${CELL_H - 4}px`,
		};
	}

	// Build beat lines array
	const beatLines = useMemo(() => {
		const lines: number[] = [];
		for (let i = 0; i <= totalColumns; i++) {
			if (i % 4 === 0) lines.push(i);
		}
		return lines;
	}, [totalColumns]);

	return (
		<div className="ea-piano-roll-container">
			{/* Header */}
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
				<span className={`ea-piano-roll-badge ${badgeClass}`}>{badgeLabel}</span>
				<div className="ea-piano-roll-tempo-controls">
					<button
						className="ea-piano-roll-tempo-btn"
						onPointerDown={(e) => {
							e.preventDefault();
							setTempo((t) => Math.max(20, t - 5));
						}}
					>
						-
					</button>
					<span className="ea-piano-roll-tempo">{tempo} BPM</span>
					<button
						className="ea-piano-roll-tempo-btn"
						onPointerDown={(e) => {
							e.preventDefault();
							setTempo((t) => Math.min(300, t + 5));
						}}
					>
						+
					</button>
				</div>
				<button
					className={[
						"ea-piano-roll-metronome-btn",
						metronomeOn ? "ea-piano-roll-metronome-btn--active" : "",
					]
						.filter(Boolean)
						.join(" ")}
					onPointerDown={(e) => {
						e.preventDefault();
						setMetronomeOn((v) => !v);
					}}
					title="Toggle metronome"
				>
					{metronomeOn ? "\u{1F514}" : "\u{1F515}"}
				</button>

				{isEditable && (
					<div className="ea-piano-roll-save-area">
						{isDirty && <span className="ea-piano-roll-dirty-dot" />}
						{isDirty && saveState === "idle" && (
							<button
								className="ea-piano-roll-save-btn"
								onPointerDown={(e) => {
									e.preventDefault();
									performSave();
								}}
							>
								Save
							</button>
						)}
						{saveState === "saving" && (
							<span className="ea-piano-roll-save-status ea-piano-roll-save-status--saving">
								Saving...
							</span>
						)}
						{saveState === "saved" && (
							<span className="ea-piano-roll-save-status ea-piano-roll-save-status--saved">
								Saved
							</span>
						)}
					</div>
				)}
				<span className="ea-piano-roll-track">{trackLabel}</span>
			</div>

			{/* Grid area */}
			<div className="ea-piano-roll-grid-wrapper">
				{/* Row labels */}
				<div className="ea-piano-roll-labels">
					{rows.map((row, i) => (
						<div
							key={i}
							className="ea-piano-roll-label"
							style={{ height: `${CELL_H}px` }}
						>
							{row.label}
						</div>
					))}
				</div>

				{/* Scrollable grid */}
				<div className="ea-piano-roll-scroll">
					<div
						ref={gridRef}
						className="ea-piano-roll-grid"
						style={{ width: `${gridW}px`, height: `${gridH}px` }}
						onPointerDown={isEditable ? handleGridClick : undefined}
						onPointerMove={dragState ? handlePointerMove : undefined}
						onPointerUp={dragState ? handlePointerUp : undefined}
					>
						{/* Row backgrounds */}
						{rows.map((_, i) => (
							<div
								key={`row-${i}`}
								className="ea-piano-roll-row-bg"
								style={{
									top: `${i * CELL_H}px`,
									width: `${gridW}px`,
									height: `${CELL_H}px`,
								}}
							/>
						))}

						{/* Beat lines */}
						{beatLines.map((col) => (
							<div
								key={`beat-${col}`}
								className="ea-piano-roll-beat-line"
								style={{ left: `${col * CELL_W}px`, height: `${gridH}px` }}
							/>
						))}

						{/* Playhead */}
						{isPlaying && currentCol >= 0 && (
							<div
								className="ea-piano-roll-playhead"
								style={{
									left: `${currentCol * CELL_W}px`,
									height: `${gridH}px`,
								}}
							/>
						)}

						{/* Notes */}
						{activeNotes.map((note, idx) => {
							const isDragging =
								dragState?.noteIdx === idx && dragState.committed;
							return (
								<div
									key={idx}
									className={[
										"ea-piano-roll-note",
										isDragging ? "ea-piano-roll-note--dragging" : "",
										isEditable ? "ea-piano-roll-note--editable" : "",
									]
										.filter(Boolean)
										.join(" ")}
									style={noteStyle(note, idx)}
									onPointerDown={
										isEditable
											? (e) => handleNotePointerDown(e, idx, "move")
											: undefined
									}
								>
									{/* Resize handle on right edge */}
									{isEditable && (
										<div
											className="ea-piano-roll-resize-handle"
											onPointerDown={
												isEditable
													? (e) =>
															handleNotePointerDown(
																e,
																idx,
																"resize"
															)
													: undefined
											}
										/>
									)}
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{hint && <p className="ea-piano-roll-hint">{hint}</p>}
			{validation === "interaction" && minInteractions !== undefined && (
				<p className="ea-piano-roll-meta">Min. interactions: {minInteractions}</p>
			)}
		</div>
	);
}
