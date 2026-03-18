import React, { useCallback, useState } from "react";
import { DrumPads as KitDrumPads } from "elementary-audio-kit/ui";

export interface DrumPadsProps {
	soundbank: string;
	hint?: string;
	highlightedPads?: number[];
	validation?: "playback" | "interaction";
	minInteractions?: number;
	isLoading?: boolean;
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
	onPadTap,
	onRequestFocus,
}: DrumPadsProps) {
	const [interactionCount, setInteractionCount] = useState(0);

	const handlePadTrigger = useCallback(
		(index: number) => {
			onPadTap(index);
			setInteractionCount((c) => c + 1);
		},
		[onPadTap]
	);

	const isComplete =
		validation === "interaction" &&
		minInteractions !== undefined &&
		interactionCount >= minInteractions;

	return (
		<div className={`ea-drum-pads-container${isLoading ? " ea-loading" : ""}`}>
			<div className="ea-drum-pads-header">
				{isLoading && (
					<span className="ea-loading-text">Loading sounds...</span>
				)}
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
			</div>

			<KitDrumPads
				onPadTrigger={handlePadTrigger}
				highlightedPads={highlightedPads}
				defaultKeyboardEnabled={false}
			/>

			{hint && <p className="ea-drum-pads-hint">{hint}</p>}
			<p className="ea-drum-pads-soundbank">Soundbank: {soundbank}</p>
		</div>
	);
}
