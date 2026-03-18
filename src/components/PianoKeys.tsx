import React, { useCallback, useState } from "react";
import { PianoKeys as KitPianoKeys } from "elementary-audio-kit/ui";

export interface PianoKeysProps {
	soundbank: string;
	octaves: number;
	hint?: string;
	highlightedNotes?: number[];
	highlightColor?: string;
	validation?: "playback" | "interaction" | "chord" | "scale";
	minInteractions?: number;
	expectedChord?: number[];
	expectedScale?: number[];
	isLoading?: boolean;
	onNoteOn: (noteNumber: number) => void;
	onNoteOff: (noteNumber: number) => void;
	onRequestFocus?: (release: () => void) => void;
}

export function PianoKeys({
	soundbank,
	octaves,
	hint,
	highlightedNotes,
	highlightColor = "#00FF9E",
	validation,
	minInteractions,
	expectedChord,
	expectedScale,
	isLoading,
	onNoteOn,
	onNoteOff,
}: PianoKeysProps) {
	const [interactionCount, setInteractionCount] = useState(0);
	const [uniqueNotesPlayed, setUniqueNotesPlayed] = useState<Set<number>>(
		new Set()
	);

	const handleNoteOn = useCallback(
		(midiNote: number) => {
			onNoteOn(midiNote);
			setInteractionCount((c) => c + 1);

			if (validation === "chord" || validation === "scale") {
				const pitchClass = midiNote % 12;
				setUniqueNotesPlayed((prev) => {
					if (prev.has(pitchClass)) return prev;
					const next = new Set(prev);
					next.add(pitchClass);
					return next;
				});
			}
		},
		[onNoteOn, validation]
	);

	// Validation state
	const expectedNotes =
		validation === "chord"
			? expectedChord
			: validation === "scale"
				? expectedScale
				: undefined;
	const expectedPitchClasses = expectedNotes?.map((n) => n % 12);
	const matchedCount = expectedPitchClasses
		? expectedPitchClasses.filter((pc) => uniqueNotesPlayed.has(pc)).length
		: 0;

	const isComplete =
		(validation === "interaction" &&
			minInteractions !== undefined &&
			interactionCount >= minInteractions) ||
		((validation === "chord" || validation === "scale") &&
			expectedPitchClasses !== undefined &&
			matchedCount >= expectedPitchClasses.length);

	return (
		<div
			className={`ea-piano-container${isLoading ? " ea-loading" : ""}`}
		>
			<div className="ea-piano-header">
				{isLoading && (
					<span className="ea-loading-text">Loading sounds...</span>
				)}
				{validation === "interaction" &&
					minInteractions !== undefined && (
						<span
							className={
								isComplete
									? "ea-piano-progress-text ea-piano-progress-text--done"
									: "ea-piano-progress-text"
							}
						>
							{isComplete
								? "Complete!"
								: `${interactionCount} / ${minInteractions} notes`}
						</span>
					)}
				{(validation === "chord" || validation === "scale") &&
					expectedPitchClasses !== undefined && (
						<span
							className={
								isComplete
									? "ea-piano-progress-text ea-piano-progress-text--done"
									: "ea-piano-progress-text"
							}
						>
							{isComplete
								? "Complete!"
								: `${matchedCount} / ${expectedPitchClasses.length} notes found`}
						</span>
					)}
			</div>

			<KitPianoKeys
				octaves={octaves}
				onNoteOn={handleNoteOn}
				onNoteOff={onNoteOff}
				highlightedNotes={highlightedNotes}
				highlightColor={highlightColor}
				defaultKeyboardEnabled={false}
			/>

			{hint && <p className="ea-piano-hint">{hint}</p>}
			<p className="ea-piano-soundbank">Soundbank: {soundbank}</p>
		</div>
	);
}
