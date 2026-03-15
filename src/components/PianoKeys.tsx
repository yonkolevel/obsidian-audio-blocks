import React, { useCallback, useRef } from "react";

export interface PianoKeysProps {
	soundbank: string;
	octaves: number;
	hint?: string;
	highlightedNotes?: number[];
	highlightColor?: string;
	onNoteOn: (noteNumber: number) => void;
	onNoteOff: (noteNumber: number) => void;
}

/**
 * Maps a position within one octave to note info.
 * White keys: C=0, D=1, E=2, F=3, G=4, A=5, B=6
 * Black keys overlay between certain white keys.
 */
interface KeyDef {
	note: string;
	isBlack: boolean;
	/** Semitone offset within the octave (C=0, C#=1, ..., B=11) */
	semitone: number;
}

const OCTAVE_KEYS: KeyDef[] = [
	{ note: "C", isBlack: false, semitone: 0 },
	{ note: "C#", isBlack: true, semitone: 1 },
	{ note: "D", isBlack: false, semitone: 2 },
	{ note: "D#", isBlack: true, semitone: 3 },
	{ note: "E", isBlack: false, semitone: 4 },
	{ note: "F", isBlack: false, semitone: 5 },
	{ note: "F#", isBlack: true, semitone: 6 },
	{ note: "G", isBlack: false, semitone: 7 },
	{ note: "G#", isBlack: true, semitone: 8 },
	{ note: "A", isBlack: false, semitone: 9 },
	{ note: "A#", isBlack: true, semitone: 10 },
	{ note: "B", isBlack: false, semitone: 11 },
];

/** Number of white keys in one octave */
const WHITE_KEYS_PER_OCTAVE = 7;

/**
 * Position of each black key as a fraction of white key width,
 * measured from the left edge of the octave.
 * C# sits between C and D, D# between D and E, etc.
 */
const BLACK_KEY_POSITIONS: Record<number, number> = {
	1: 0.75, // C# — between key 0 (C) and key 1 (D)
	3: 1.75, // D# — between key 1 (D) and key 2 (E)
	6: 3.75, // F# — between key 3 (F) and key 4 (G)
	8: 4.75, // G# — between key 4 (G) and key 5 (A)
	10: 5.75, // A# — between key 5 (A) and key 6 (B)
};

export function PianoKeys({
	soundbank,
	octaves,
	hint,
	highlightedNotes,
	highlightColor = "#00FF9E",
	onNoteOn,
	onNoteOff,
}: PianoKeysProps) {
	const [activeNotes, setActiveNotes] = React.useState<Set<number>>(
		new Set()
	);
	const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
		new Map()
	);

	// Starting MIDI note — middle C (C4) = 60
	const startNote = 60;
	const totalWhiteKeys = WHITE_KEYS_PER_OCTAVE * octaves;

	const handleNoteOn = useCallback(
		(midiNote: number) => {
			onNoteOn(midiNote);
			setActiveNotes((prev) => {
				const next = new Set(prev);
				next.add(midiNote);
				return next;
			});

			// Clear existing timeout
			const existing = timeoutsRef.current.get(midiNote);
			if (existing) clearTimeout(existing);

			const timeout = setTimeout(() => {
				setActiveNotes((prev) => {
					const next = new Set(prev);
					next.delete(midiNote);
					return next;
				});
				timeoutsRef.current.delete(midiNote);
			}, 300);
			timeoutsRef.current.set(midiNote, timeout);
		},
		[onNoteOn]
	);

	// Build key elements
	const whiteKeys: React.ReactElement[] = [];
	const blackKeys: React.ReactElement[] = [];

	for (let oct = 0; oct < octaves; oct++) {
		for (const keyDef of OCTAVE_KEYS) {
			const midiNote = startNote + oct * 12 + keyDef.semitone;
			const isActive = activeNotes.has(midiNote);
			const isHighlighted = highlightedNotes?.includes(midiNote);

			if (!keyDef.isBlack) {
				// White key
				const whiteIndex = whiteKeys.length;
				whiteKeys.push(
					<button
						key={midiNote}
						className={[
							"ea-piano-white-key",
							isActive ? "ea-piano-key--active" : "",
							isHighlighted ? "ea-piano-key--highlighted" : "",
						]
							.filter(Boolean)
							.join(" ")}
						style={
							isHighlighted
								? ({
										"--highlight-color": highlightColor,
									} as React.CSSProperties)
								: undefined
						}
						onPointerDown={(e) => {
							e.preventDefault();
							handleNoteOn(midiNote);
						}}
						onPointerUp={() => onNoteOff(midiNote)}
						onPointerLeave={() => onNoteOff(midiNote)}
					>
						{oct === 0 && keyDef.semitone === 0 && (
							<span className="ea-piano-key-label">C4</span>
						)}
					</button>
				);
			} else {
				// Black key — position relative to the octave
				const pos = BLACK_KEY_POSITIONS[keyDef.semitone];
				if (pos === undefined) continue;
				const leftPercent =
					((oct * WHITE_KEYS_PER_OCTAVE + pos) / totalWhiteKeys) *
					100;

				blackKeys.push(
					<button
						key={midiNote}
						className={[
							"ea-piano-black-key",
							isActive ? "ea-piano-key--active" : "",
							isHighlighted ? "ea-piano-key--highlighted" : "",
						]
							.filter(Boolean)
							.join(" ")}
						style={
							{
								left: `${leftPercent}%`,
								width: `${(0.55 / totalWhiteKeys) * 100}%`,
								...(isHighlighted
									? {
											"--highlight-color": highlightColor,
										}
									: {}),
							} as React.CSSProperties
						}
						onPointerDown={(e) => {
							e.preventDefault();
							handleNoteOn(midiNote);
						}}
						onPointerUp={() => onNoteOff(midiNote)}
						onPointerLeave={() => onNoteOff(midiNote)}
					/>
				);
			}
		}
	}

	return (
		<div className="ea-piano-container">
			<div className="ea-piano-keyboard">
				<div className="ea-piano-white-keys">{whiteKeys}</div>
				<div className="ea-piano-black-keys">{blackKeys}</div>
			</div>
			{hint && <p className="ea-piano-hint">{hint}</p>}
			<p className="ea-piano-soundbank">Soundbank: {soundbank}</p>
		</div>
	);
}
