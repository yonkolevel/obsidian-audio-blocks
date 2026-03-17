import React, { useCallback, useEffect, useRef, useState } from "react";

export interface DrumPadsProps {
	soundbank: string;
	hint?: string;
	highlightedPads?: number[];
	validation?: "playback" | "interaction";
	minInteractions?: number;
	onPadTap: (padIndex: number) => void;
	onRequestFocus?: (release: () => void) => void;
}

const PAD_LABELS = [
	"Kick",
	"Snare",
	"Clap",
	"Rim",
	"CH",
	"OH",
	"Perc 1",
	"Perc 2",
	"Tom 1",
	"Tom 2",
	"Tom 3",
	"Tom 4",
	"FX 1",
	"FX 2",
	"FX 3",
	"FX 4",
];

// ---------------------------------------------------------------------------
// Computer keyboard → pad index mapping (4x4 grid)
// ---------------------------------------------------------------------------

const KEYBOARD_MAP: Record<string, number> = {
	// Row 1 (top): 1 2 3 4
	"1": 0,
	"2": 1,
	"3": 2,
	"4": 3,
	// Row 2: Q W E R
	q: 4,
	w: 5,
	e: 6,
	r: 7,
	// Row 3: A S D F
	a: 8,
	s: 9,
	d: 10,
	f: 11,
	// Row 4: Z X C V
	z: 12,
	x: 13,
	c: 14,
	v: 15,
};

/** Get the keyboard shortcut label for a given pad index. */
function padKeyLabel(padIndex: number): string | undefined {
	for (const [key, index] of Object.entries(KEYBOARD_MAP)) {
		if (index === padIndex) return key.toUpperCase();
	}
	return undefined;
}

export function DrumPads({
	soundbank,
	hint,
	highlightedPads,
	validation,
	minInteractions,
	onPadTap,
	onRequestFocus,
}: DrumPadsProps) {
	const [activePads, setActivePads] = useState<Set<number>>(new Set());
	const [interactionCount, setInteractionCount] = useState(0);
	const [keyboardEnabled, setKeyboardEnabled] = useState(false);
	const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
		new Map()
	);
	const heldKeysRef = useRef<Set<string>>(new Set());

	const handlePadDown = useCallback(
		(index: number) => {
			onPadTap(index);
			setInteractionCount((c) => c + 1);

			setActivePads((prev) => {
				const next = new Set(prev);
				next.add(index);
				return next;
			});

			const existing = timeoutsRef.current.get(index);
			if (existing) clearTimeout(existing);

			const timeout = setTimeout(() => {
				setActivePads((prev) => {
					const next = new Set(prev);
					next.delete(index);
					return next;
				});
				timeoutsRef.current.delete(index);
			}, 150);

			timeoutsRef.current.set(index, timeout);
		},
		[onPadTap]
	);

	// ------------------------------------------------------------------
	// Computer keyboard handler
	// ------------------------------------------------------------------
	useEffect(() => {
		if (!keyboardEnabled) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			const key = e.key.toLowerCase();
			const padIndex = KEYBOARD_MAP[key];
			if (padIndex === undefined) return;

			// Prevent Obsidian from capturing the keypress
			e.preventDefault();
			e.stopPropagation();

			if (heldKeysRef.current.has(key)) return; // prevent key repeat
			heldKeysRef.current.add(key);

			handlePadDown(padIndex);
		};

		const handleKeyUp = (e: KeyboardEvent) => {
			const key = e.key.toLowerCase();
			heldKeysRef.current.delete(key);
		};

		document.addEventListener("keydown", handleKeyDown);
		document.addEventListener("keyup", handleKeyUp);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("keyup", handleKeyUp);
			heldKeysRef.current.clear();
		};
	}, [keyboardEnabled, handlePadDown]);

	const isComplete =
		validation === "interaction" &&
		minInteractions !== undefined &&
		interactionCount >= minInteractions;

	return (
		<div className="ea-drum-pads-container">
			<div className="ea-drum-pads-header">
				{validation === "interaction" && minInteractions !== undefined && (
					<span
						className={
							isComplete
								? "ea-drum-pads-progress-text ea-drum-pads-progress-text--done"
								: "ea-drum-pads-progress-text"
						}
					>
						{isComplete
							? "Complete!"
							: `${interactionCount} / ${minInteractions} taps`}
					</span>
				)}
				<div className="ea-drum-pads-header-right">
					<button
						className={[
							"ea-drum-pads-keyboard-toggle",
							keyboardEnabled ? "ea-drum-pads-keyboard-toggle--active" : "",
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
						title="Toggle computer keyboard input (1234 / QWER / ASDF / ZXCV = pads)"
					>
						{"\u2328"}
					</button>
				</div>
			</div>
			<div className="ea-drum-pads-grid">
				{PAD_LABELS.map((label, index) => {
					const isHighlighted = highlightedPads?.includes(index);
					const isActive = activePads.has(index);
					const kbLabel = keyboardEnabled ? padKeyLabel(index) : undefined;

					return (
						<button
							key={index}
							className={[
								"ea-drum-pad",
								isHighlighted ? "ea-drum-pad--highlighted" : "",
								isActive ? "ea-drum-pad--active" : "",
							]
								.filter(Boolean)
								.join(" ")}
							onPointerDown={(e) => {
								e.preventDefault();
								handlePadDown(index);
							}}
						>
							<span className="ea-drum-pad-label">{label}</span>
							{kbLabel && (
								<span className="ea-drum-pad-kb-hint">{kbLabel}</span>
							)}
						</button>
					);
				})}
			</div>
			{hint && <p className="ea-drum-pads-hint">{hint}</p>}
			<p className="ea-drum-pads-soundbank">Soundbank: {soundbank}</p>
		</div>
	);
}
