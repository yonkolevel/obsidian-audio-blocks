import React, { useCallback, useRef } from "react";

export interface DrumPadsProps {
	soundbank: string;
	hint?: string;
	highlightedPads?: number[];
	validation?: "playback" | "interaction";
	minInteractions?: number;
	onPadTap: (padIndex: number) => void;
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

export function DrumPads({
	soundbank,
	hint,
	highlightedPads,
	validation,
	minInteractions,
	onPadTap,
}: DrumPadsProps) {
	const [activePads, setActivePads] = React.useState<Set<number>>(new Set());
	const [interactionCount, setInteractionCount] = React.useState(0);
	const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
		new Map()
	);

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

	const isComplete =
		validation === "interaction" &&
		minInteractions !== undefined &&
		interactionCount >= minInteractions;

	return (
		<div className="ea-drum-pads-container">
			{validation === "interaction" && minInteractions !== undefined && (
				<div className="ea-drum-pads-progress">
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
				</div>
			)}
			<div className="ea-drum-pads-grid">
				{PAD_LABELS.map((label, index) => {
					const isHighlighted = highlightedPads?.includes(index);
					const isActive = activePads.has(index);

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
						</button>
					);
				})}
			</div>
			{hint && <p className="ea-drum-pads-hint">{hint}</p>}
			<p className="ea-drum-pads-soundbank">Soundbank: {soundbank}</p>
		</div>
	);
}
