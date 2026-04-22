import React, { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";

/**
 * Default 16-pad layout used by the Midicircuit app. Matches the
 * canonical native/web render: FX × 4, Tom × 4, CH/OH/Perc × 4, and the
 * classic kit row (Kick/Snare/Clap/Rim) on the bottom.
 */
const DEFAULT_LABELS_16 = [
	"FX 1", "FX 2", "FX 3", "FX 4",
	"Tom 1", "Tom 2", "Tom 3", "Tom 4",
	"CH", "OH", "Perc 1", "Perc 2",
	"Kick", "Snare", "Clap", "Rim",
];

const KEYBOARD_MAP: Record<string, number> = {
	"1": 0, "2": 1, "3": 2, "4": 3,
	q: 4, w: 5, e: 6, r: 7,
	a: 8, s: 9, d: 10, f: 11,
	z: 12, x: 13, c: 14, v: 15,
};

const REVERSE_KEYBOARD_MAP = new Map<number, string>(
	Object.entries(KEYBOARD_MAP).map(([key, index]) => [index, key.toUpperCase()])
);

const FLASH_MS = 150;

export interface DrumPadsProps {
	soundbank: string;
	hint?: string;
	highlightedPads?: number[];
	validation?: "playback" | "interaction";
	minInteractions?: number;
	isLoading?: boolean;
	/** Per-pad labels — if omitted, falls back to the 16-pad GM layout. */
	labels?: string[];
	onPadTap: (padIndex: number) => void;
	onRequestFocus?: (release: () => void) => void;
}

export function DrumPads({
	soundbank,
	hint,
	highlightedPads,
	validation,
	minInteractions,
	isLoading,
	labels,
	onPadTap,
	onRequestFocus,
}: DrumPadsProps) {
	const [interactionCount, setInteractionCount] = useState(0);
	const [activePad, setActivePad] = useState<number | null>(null);
	const [keyboardEnabled, setKeyboardEnabled] = useState(false);
	const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const releaseFocusRef = useRef<(() => void) | null>(null);

	const padLabels = labels ?? DEFAULT_LABELS_16;
	const padCount = padLabels.length;
	const highlightSet = new Set(highlightedPads ?? []);

	const handlePadTap = useCallback(
		(index: number) => {
			onPadTap(index);
			setInteractionCount((c) => c + 1);

			setActivePad(index);
			if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
			flashTimeoutRef.current = setTimeout(
				() => setActivePad(null),
				FLASH_MS
			);
		},
		[onPadTap]
	);

	// Keyboard input — only attached when keyboardEnabled is true. Uses a
	// ref-tracked focus release so the focus manager can revoke keyboard
	// control when the user clicks outside any interactive block.
	useEffect(() => {
		if (!keyboardEnabled) return;

		const release = () => setKeyboardEnabled(false);
		releaseFocusRef.current = release;
		onRequestFocus?.(release);

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.repeat) return;
			const index = KEYBOARD_MAP[e.key.toLowerCase()];
			if (index === undefined || index >= padCount) return;
			e.preventDefault();
			handlePadTap(index);
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			releaseFocusRef.current = null;
		};
	}, [keyboardEnabled, padCount, handlePadTap, onRequestFocus]);

	const isComplete =
		validation === "interaction" &&
		minInteractions !== undefined &&
		interactionCount >= minInteractions;

	return (
		<div
			className={`ea-drum-pads-container${isLoading ? " ea-loading" : ""}`}
		>
			<div className="ea-drum-pads-header">
				<div className="ea-drum-pads-header-left">
					{isLoading && (
						<span className="ea-loading-text">
							Loading sounds...
						</span>
					)}
					{validation === "interaction" &&
						minInteractions !== undefined && (
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
				</div>

				<div className="ea-drum-pads-header-right">
					<button
						className={`ea-drum-pads-keyboard-toggle${
							keyboardEnabled
								? " ea-drum-pads-keyboard-toggle--active"
								: ""
						}`}
						onPointerDown={(e) => {
							e.preventDefault();
							setKeyboardEnabled((v) => !v);
						}}
						title="Toggle keyboard input"
						aria-label="Toggle keyboard input"
					>
						<Keyboard size={14} />
					</button>
				</div>
			</div>

			<div className="ea-drum-pads-grid">
				{padLabels.map((label, index) => {
					const isHighlighted = highlightSet.has(index);
					const isActive = activePad === index;
					const kbLabel = keyboardEnabled
						? REVERSE_KEYBOARD_MAP.get(index)
						: undefined;

					const classes = ["ea-drum-pad"];
					if (isHighlighted) classes.push("ea-drum-pad--highlighted");
					if (isActive) classes.push("ea-drum-pad--active");

					return (
						<button
							key={index}
							className={classes.join(" ")}
							onPointerDown={(e) => {
								e.preventDefault();
								handlePadTap(index);
							}}
						>
							<span className="ea-drum-pad-label">{label}</span>
							{kbLabel && (
								<span className="ea-drum-pad-kb-hint">
									{kbLabel}
								</span>
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
