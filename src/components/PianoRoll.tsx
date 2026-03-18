import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	PianoRoll as KitPianoRoll,
	type NoteData,
	type RowConfig,
} from "elementary-audio-kit/ui";
import {
	PlaygroundData,
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
	/** Play a single note (click-to-preview, not during transport playback). */
	onNotePlay?: (noteNumber: number, durationBeats?: number) => void;
	onPlaybackStart?: () => Promise<void>;
	onRequestExclusivePlayback?: (stopFn: () => void) => void;
	onMetronomeClick?: () => void;
	noteNames?: Map<number, string>;
	defaultMetronomeOn?: boolean;

	// Transport-driven playback callbacks (wired to engine by renderer)
	onTransportStart?: (config: {
		notes: NoteData[];
		soundbankSlug: string | null;
		isDrum: boolean;
		bpm: number;
		totalSteps: number;
		metronomeOn: boolean;
	}) => void;
	onTransportStop?: () => void;
	onTransportNotesUpdate?: (notes: NoteData[]) => void;
	onTransportTempoChange?: (bpm: number) => void;
	onTransportMetronomeChange?: (on: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_DRUM_ROWS: RowConfig[] = [
	{ noteNumber: 36, label: "Kick" },
	{ noteNumber: 38, label: "Snare" },
	{ noteNumber: 42, label: "Hi-Hat Closed" },
	{ noteNumber: 51, label: "Ride" },
];

const PREFILLED_NOTES: NoteData[] = [
	{ noteNumber: 36, velocity: 110, position: 0, duration: 0.25 },
	{ noteNumber: 36, velocity: 110, position: 1, duration: 0.25 },
	{ noteNumber: 36, velocity: 110, position: 2, duration: 0.25 },
	{ noteNumber: 36, velocity: 110, position: 3, duration: 0.25 },
	{ noteNumber: 38, velocity: 110, position: 1, duration: 0.25 },
	{ noteNumber: 38, velocity: 110, position: 3, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 0, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 0.5, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 1, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 1.5, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 2, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 2.5, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 3, duration: 0.25 },
	{ noteNumber: 42, velocity: 100, position: 3.5, duration: 0.25 },
	{ noteNumber: 51, velocity: 100, position: 0.5, duration: 0.25 },
	{ noteNumber: 51, velocity: 100, position: 1.5, duration: 0.25 },
	{ noteNumber: 51, velocity: 100, position: 2.5, duration: 0.25 },
	{ noteNumber: 51, velocity: 100, position: 3.5, duration: 0.25 },
];

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
): RowConfig[] {
	const noteNumbers = new Set(notes.map((n) => n.noteNumber));
	const sorted = Array.from(noteNumbers).sort((a, b) => a - b);
	return sorted.map((nn) => ({
		noteNumber: nn,
		label: resolveNoteLabel(nn, isDrum, noteNames),
	}));
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
	onTransportStart,
	onTransportStop,
	onTransportNotesUpdate,
	onTransportTempoChange,
	onTransportMetronomeChange,
}: PianoRollProps) {
	// Resolve track and clip from playground data
	const track = playgroundData?.tracks.find((t) => t.id === trackID);
	const clip = track?.clips[0];
	const isDrum = track ? track.type === "drum" : true;
	const isEditable = !!playgroundPath && !!onSave;
	const hasPlaygroundData = !!(track && clip);
	const soundbankSlug = track?.soundbankSlug || null;

	const useTransport = !!onTransportStart;

	// Edit state
	const [editableNotes, setEditableNotes] = useState<NoteData[] | null>(null);
	const [isDirty, setIsDirty] = useState(false);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
	// Ref for synchronous gating — React state updates are async and cause
	// a timing gap where both transport AND JS onNotePlay fire simultaneously.
	const transportActiveRef = useRef(false);
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

	// Build rows
	const rows = useMemo(
		() => (hasPlaygroundData ? buildRows(activeNotes, isDrum, noteNames) : DEFAULT_DRUM_ROWS),
		[hasPlaygroundData, activeNotes, isDrum, noteNames]
	);

	const lengthInBars = clip ? clip.lengthInBars : 1;
	const totalSteps = lengthInBars * 16;
	const defaultTempo = playgroundData?.tempo ?? 120;

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

	// Clean up on unmount
	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
			if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
			if (transportActiveRef.current) onTransportStop?.();
		};
	}, []);

	// ------------------------------------------------------------------
	// Callbacks
	// ------------------------------------------------------------------
	const handleNotesChange = useCallback(
		(notes: NoteData[]) => {
			setEditableNotes(notes);
			setIsDirty(true);
			// Live-update transport if playing
			if (transportActiveRef.current) onTransportNotesUpdate?.(notes);
		},
		[onTransportNotesUpdate]
	);

	// Gate onNotePlay synchronously — ref is checked inside the callback
	// so the kit's useClockTimer never fires notes while transport is active.
	const handleNotePlay = useCallback(
		(noteNumber: number, durationBeats?: number) => {
			if (transportActiveRef.current) return;
			onNotePlay?.(noteNumber, durationBeats);
		},
		[onNotePlay]
	);

	const handleMetronomeTick = useCallback(() => {
		if (transportActiveRef.current) return;
		onMetronomeClick?.();
	}, [onMetronomeClick]);

	const handlePlaybackStart = useCallback(async () => {
		if (onRequestExclusivePlayback) {
			onRequestExclusivePlayback(() => {
				transportActiveRef.current = false;
				onTransportStop?.();
			});
		}
		if (onPlaybackStart) await onPlaybackStart();

		// Set ref BEFORE starting transport — synchronous, no timing gap
		if (useTransport) {
			transportActiveRef.current = true;
			onTransportStart!({
				notes: activeNotes,
				soundbankSlug,
				isDrum,
				bpm: defaultTempo,
				totalSteps,
				metronomeOn: defaultMetronomeOn ?? false,
			});
		}
	}, [
		onPlaybackStart, onRequestExclusivePlayback, useTransport,
		onTransportStart, onTransportStop, activeNotes, soundbankSlug,
		isDrum, defaultTempo, totalSteps, defaultMetronomeOn,
	]);

	const handlePlaybackStop = useCallback(() => {
		if (transportActiveRef.current) {
			transportActiveRef.current = false;
			onTransportStop?.();
		}
	}, [onTransportStop]);

	// ------------------------------------------------------------------
	// Render
	// ------------------------------------------------------------------
	const badgeLabel = validation === "playback" ? "Listen" : "Play along";
	const badgeClass =
		validation === "playback" ? "ea-piano-roll-badge--listen" : "ea-piano-roll-badge--interact";
	const trackLabel = track
		? `${track.title}${track.soundbankSlug ? ` \u2014 ${track.soundbankSlug}` : ""}`
		: `Track ${trackID}`;

	return (
		<div className="ea-piano-roll-container">
			{/* Obsidian-specific header chrome */}
			<div className="ea-piano-roll-header" style={{ marginBottom: 8 }}>
				<span className={`ea-piano-roll-badge ${badgeClass}`}>{badgeLabel}</span>

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

			{/* Kit PianoRoll — handleNotePlay/handleMetronomeTick gate via ref */}
			<KitPianoRoll
				notes={activeNotes}
				rows={rows}
				lengthInBars={lengthInBars}
				editable={isEditable}
				defaultTempo={defaultTempo}
				defaultMetronomeOn={defaultMetronomeOn ?? false}
				onNotesChange={isEditable ? handleNotesChange : undefined}
				onNotePlay={handleNotePlay}
				onPlaybackStart={handlePlaybackStart}
				onPlaybackStop={handlePlaybackStop}
				onMetronomeTick={handleMetronomeTick}
			/>

			{hint && <p className="ea-piano-roll-hint">{hint}</p>}
			{validation === "interaction" && minInteractions !== undefined && (
				<p className="ea-piano-roll-meta">Min. interactions: {minInteractions}</p>
			)}
		</div>
	);
}
