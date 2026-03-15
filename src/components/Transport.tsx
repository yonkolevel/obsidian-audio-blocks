import React, { useCallback, useEffect, useRef } from "react";

export interface TransportProps {
	tempo: number;
	timeSignature: string;
	loop: boolean;
	onPlayClick: () => void;
}

export function Transport({
	tempo,
	timeSignature,
	loop,
	onPlayClick,
}: TransportProps) {
	const [isPlaying, setIsPlaying] = React.useState(false);
	const [currentBeat, setCurrentBeat] = React.useState(0);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Parse beats per bar from time signature (e.g. "4/4" -> 4)
	const beatsPerBar = parseInt(timeSignature.split("/")[0], 10) || 4;

	const stopPlayback = useCallback(() => {
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		setIsPlaying(false);
		setCurrentBeat(0);
	}, []);

	const startPlayback = useCallback(() => {
		setIsPlaying(true);
		setCurrentBeat(0);

		// Interval in ms between beats
		const intervalMs = (60 / tempo) * 1000;

		// Play the first click immediately
		onPlayClick();

		let beat = 0;
		intervalRef.current = setInterval(() => {
			beat = (beat + 1) % beatsPerBar;
			setCurrentBeat(beat);
			onPlayClick();
		}, intervalMs);
	}, [tempo, beatsPerBar, onPlayClick]);

	const handleToggle = useCallback(() => {
		if (isPlaying) {
			stopPlayback();
		} else {
			startPlayback();
		}
	}, [isPlaying, startPlayback, stopPlayback]);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
		};
	}, []);

	// Build beat indicator dots
	const dots: React.ReactElement[] = [];
	for (let i = 0; i < beatsPerBar; i++) {
		dots.push(
			<span
				key={i}
				className={[
					"ea-transport-dot",
					isPlaying && currentBeat === i
						? "ea-transport-dot--active"
						: "",
				]
					.filter(Boolean)
					.join(" ")}
			/>
		);
	}

	return (
		<div className="ea-transport-container">
			<div className="ea-transport-bar">
				<button
					className={[
						"ea-transport-play-btn",
						isPlaying ? "ea-transport-play-btn--playing" : "",
					]
						.filter(Boolean)
						.join(" ")}
					onPointerDown={(e) => {
						e.preventDefault();
						handleToggle();
					}}
				>
					{isPlaying ? "■" : "▶"}
				</button>
				<div className="ea-transport-info">
					<span className="ea-transport-tempo">{tempo} BPM</span>
					<span className="ea-transport-timesig">
						{timeSignature}
					</span>
				</div>
				<div className="ea-transport-dots">{dots}</div>
				{loop && <span className="ea-transport-loop">⟳</span>}
			</div>
		</div>
	);
}
