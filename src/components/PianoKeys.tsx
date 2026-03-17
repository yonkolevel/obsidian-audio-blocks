import React, { useCallback, useEffect, useRef, useState } from "react";

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
	onNoteOn: (noteNumber: number) => void;
	onNoteOff: (noteNumber: number) => void;
	/** Called when this block activates keyboard mode. */
	onRequestFocus?: (release: () => void) => void;
}

interface KeyDef {
	note: string;
	isBlack: boolean;
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

const WHITE_KEYS_PER_OCTAVE = 7;

const BLACK_KEY_POSITIONS: Record<number, number> = {
	1: 0.75,
	3: 1.75,
	6: 3.75,
	8: 4.75,
	10: 5.75,
};

// ---------------------------------------------------------------------------
// Computer keyboard → semitone offset mapping
// Bottom row = white keys, top row = black keys
// ---------------------------------------------------------------------------

const KEYBOARD_MAP: Record<string, number> = {
	// White keys: A S D F G H J K L ; '
	a: 0,   // C
	s: 2,   // D
	d: 4,   // E
	f: 5,   // F
	g: 7,   // G
	h: 9,   // A
	j: 11,  // B
	k: 12,  // C+1
	l: 14,  // D+1
	";": 16, // E+1
	"'": 17, // F+1
	// Black keys: W E T Y U O P
	w: 1,   // C#
	e: 3,   // D#
	t: 6,   // F#
	y: 8,   // G#
	u: 10,  // A#
	o: 13,  // C#+1
	p: 15,  // D#+1
};

/** Get the keyboard shortcut label for a given semitone offset. */
function keyLabel(semitoneOffset: number): string | undefined {
	for (const [key, offset] of Object.entries(KEYBOARD_MAP)) {
		if (offset === semitoneOffset) {
			if (key === ";") return ";";
			if (key === "'") return "'";
			return key.toUpperCase();
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
	onNoteOn,
	onNoteOff,
	onRequestFocus,
}: PianoKeysProps) {
	const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
	const [interactionCount, setInteractionCount] = useState(0);
	const [uniqueNotesPlayed, setUniqueNotesPlayed] = useState<Set<number>>(new Set());
	const [keyboardEnabled, setKeyboardEnabled] = useState(false);
	const [keyboardOctave, setKeyboardOctave] = useState(4); // C4 = MIDI 60
	const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
	const heldKeysRef = useRef<Set<string>>(new Set());
	const containerRef = useRef<HTMLDivElement>(null);

	const startNote = 60;
	const totalWhiteKeys = WHITE_KEYS_PER_OCTAVE * octaves;

	const handleNoteOn = useCallback(
		(midiNote: number) => {
			onNoteOn(midiNote);
			setInteractionCount((c) => c + 1);
			setActiveNotes((prev) => {
				const next = new Set(prev);
				next.add(midiNote);
				return next;
			});

			// Track unique pitch classes for chord/scale validation
			if (validation === "chord" || validation === "scale") {
				const pitchClass = midiNote % 12;
				setUniqueNotesPlayed((prev) => {
					if (prev.has(pitchClass)) return prev;
					const next = new Set(prev);
					next.add(pitchClass);
					return next;
				});
			}

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
		[onNoteOn, validation]
	);

	// ------------------------------------------------------------------
	// Computer keyboard handler
	// ------------------------------------------------------------------
	useEffect(() => {
		if (!keyboardEnabled) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			const key = e.key.toLowerCase();

			// Octave shift
			if (key === "z" || key === "x") {
				e.preventDefault();
				e.stopPropagation();
				if (key === "z") setKeyboardOctave((o) => Math.max(1, o - 1));
				else setKeyboardOctave((o) => Math.min(7, o + 1));
				return;
			}

			const offset = KEYBOARD_MAP[key];
			if (offset === undefined) return;

			// Prevent Obsidian from capturing the keypress
			e.preventDefault();
			e.stopPropagation();

			if (heldKeysRef.current.has(key)) return; // prevent key repeat
			heldKeysRef.current.add(key);

			const midiNote = keyboardOctave * 12 + 12 + offset;
			handleNoteOn(midiNote);
		};

		const handleKeyUp = (e: KeyboardEvent) => {
			const key = e.key.toLowerCase();
			heldKeysRef.current.delete(key);

			const offset = KEYBOARD_MAP[key];
			if (offset === undefined) return;
			const midiNote = keyboardOctave * 12 + 12 + offset;
			onNoteOff(midiNote);
		};

		document.addEventListener("keydown", handleKeyDown);
		document.addEventListener("keyup", handleKeyUp);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("keyup", handleKeyUp);
			heldKeysRef.current.clear();
		};
	}, [keyboardEnabled, keyboardOctave, handleNoteOn, onNoteOff]);

	// ------------------------------------------------------------------
	// Build key elements
	// ------------------------------------------------------------------
	const whiteKeys: React.ReactElement[] = [];
	const blackKeys: React.ReactElement[] = [];

	for (let oct = 0; oct < octaves; oct++) {
		for (const keyDef of OCTAVE_KEYS) {
			const midiNote = startNote + oct * 12 + keyDef.semitone;
			const isActive = activeNotes.has(midiNote);
			const isHighlighted = highlightedNotes?.includes(midiNote);

			// Compute keyboard shortcut label for this key
			const semitoneFromKeyboardBase = midiNote - (keyboardOctave * 12 + 12);
			const kbLabel =
				keyboardEnabled && semitoneFromKeyboardBase >= 0 && semitoneFromKeyboardBase <= 17
					? keyLabel(semitoneFromKeyboardBase)
					: undefined;

			if (!keyDef.isBlack) {
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
								? ({ "--highlight-color": highlightColor } as React.CSSProperties)
								: undefined
						}
						onPointerDown={(e) => {
							e.preventDefault();
							handleNoteOn(midiNote);
						}}
						onPointerUp={() => onNoteOff(midiNote)}
						onPointerLeave={() => onNoteOff(midiNote)}
					>
						<span className="ea-piano-key-label">
							{kbLabel && (
								<span className="ea-piano-kb-hint">{kbLabel}</span>
							)}
							{oct === 0 && keyDef.semitone === 0 && !kbLabel && "C4"}
						</span>
					</button>
				);
			} else {
				const pos = BLACK_KEY_POSITIONS[keyDef.semitone];
				if (pos === undefined) continue;
				const leftPercent =
					((oct * WHITE_KEYS_PER_OCTAVE + pos) / totalWhiteKeys) * 100;

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
								...(isHighlighted ? { "--highlight-color": highlightColor } : {}),
							} as React.CSSProperties
						}
						onPointerDown={(e) => {
							e.preventDefault();
							handleNoteOn(midiNote);
						}}
						onPointerUp={() => onNoteOff(midiNote)}
						onPointerLeave={() => onNoteOff(midiNote)}
					>
						{kbLabel && <span className="ea-piano-kb-hint ea-piano-kb-hint--black">{kbLabel}</span>}
					</button>
				);
			}
		}
	}

	// Determine expected pitch classes for chord/scale validation
	const expectedNotes = validation === "chord" ? expectedChord : validation === "scale" ? expectedScale : undefined;
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
		<div className="ea-piano-container" ref={containerRef}>
			<div className="ea-piano-header">
				{validation === "interaction" && minInteractions !== undefined && (
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
				{(validation === "chord" || validation === "scale") && expectedPitchClasses !== undefined && (
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
				<div className="ea-piano-header-right">
					{keyboardEnabled && (
						<span className="ea-piano-octave-label">
							C{keyboardOctave}
							<button
								className="ea-piano-octave-btn"
								onPointerDown={(e) => {
									e.preventDefault();
									setKeyboardOctave((o) => Math.max(1, o - 1));
								}}
							>
								Z
							</button>
							<button
								className="ea-piano-octave-btn"
								onPointerDown={(e) => {
									e.preventDefault();
									setKeyboardOctave((o) => Math.min(7, o + 1));
								}}
							>
								X
							</button>
						</span>
					)}
					<button
						className={[
							"ea-piano-keyboard-toggle",
							keyboardEnabled ? "ea-piano-keyboard-toggle--active" : "",
						]
							.filter(Boolean)
							.join(" ")}
						onPointerDown={(e) => {
							e.preventDefault();
							setKeyboardEnabled((prev) => {
								const next = !prev;
								if (next && onRequestFocus) {
									onRequestFocus(() => setKeyboardEnabled(false));
								}
								return next;
							});
						}}
						title="Toggle computer keyboard input (ASDF = notes, Z/X = octave)"
					>
						{"\u2328"}
					</button>
				</div>
			</div>
			<div className="ea-piano-keyboard">
				<div className="ea-piano-white-keys">{whiteKeys}</div>
				<div className="ea-piano-black-keys">{blackKeys}</div>
			</div>
			{hint && <p className="ea-piano-hint">{hint}</p>}
			<p className="ea-piano-soundbank">Soundbank: {soundbank}</p>
		</div>
	);
}
