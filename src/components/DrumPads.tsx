import React, { useCallback, useRef } from "react";

export interface DrumPadsProps {
	soundbank: string;
	hint?: string;
	highlightedPads?: number[];
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
	onPadTap,
}: DrumPadsProps) {
	const [activePads, setActivePads] = React.useState<Set<number>>(new Set());
	const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
		new Map()
	);

	const handlePadDown = useCallback(
		(index: number) => {
			onPadTap(index);

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

	return (
		<div className="ea-drum-pads-container">
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
