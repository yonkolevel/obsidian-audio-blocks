import React, { useCallback, useRef } from "react";

export interface AudioPlayerProps {
	soundbank: string;
	sampleIndex: number;
	label: string;
	onPlay: () => void;
}

export function AudioPlayer({
	soundbank,
	sampleIndex,
	label,
	onPlay,
}: AudioPlayerProps) {
	const [isPlaying, setIsPlaying] = React.useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handlePlay = useCallback(() => {
		onPlay();

		// Brief visual feedback
		setIsPlaying(true);
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		timeoutRef.current = setTimeout(() => {
			setIsPlaying(false);
		}, 400);
	}, [onPlay]);

	return (
		<div className="ea-audio-player-container">
			<div className="ea-audio-player-row">
				<button
					className={[
						"ea-audio-player-btn",
						isPlaying ? "ea-audio-player-btn--playing" : "",
					]
						.filter(Boolean)
						.join(" ")}
					onPointerDown={(e) => {
						e.preventDefault();
						handlePlay();
					}}
				>
					▶
				</button>
				<div className="ea-audio-player-info">
					<span className="ea-audio-player-label">{label}</span>
					<span className="ea-audio-player-meta">
						{soundbank} — sample {sampleIndex}
					</span>
				</div>
				<div className="ea-audio-player-waveform">
					{/* Simple waveform placeholder */}
					{[3, 5, 8, 12, 10, 14, 8, 11, 6, 9, 4, 7, 3].map(
						(h, i) => (
							<span
								key={i}
								className={[
									"ea-audio-player-bar",
									isPlaying
										? "ea-audio-player-bar--active"
										: "",
								]
									.filter(Boolean)
									.join(" ")}
								style={{ height: `${h * 2}px` }}
							/>
						)
					)}
				</div>
			</div>
		</div>
	);
}
