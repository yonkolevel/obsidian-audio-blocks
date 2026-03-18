import React, { useCallback, useRef, useState } from "react";
import { Transport as KitTransport } from "elementary-audio-kit/ui";

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
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentBeat, setCurrentBeat] = useState(0);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const beatsPerBar = parseInt(timeSignature.split("/")[0], 10) || 4;

	const stopPlayback = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		setIsPlaying(false);
		setCurrentBeat(0);
	}, []);

	const startPlayback = useCallback(() => {
		setIsPlaying(true);
		setCurrentBeat(0);

		const intervalMs = (60 / tempo) * 1000;
		onPlayClick();

		const startTime = performance.now();
		let tickCount = 0;

		function tick() {
			tickCount++;
			const beat = tickCount % beatsPerBar;
			setCurrentBeat(beat);
			onPlayClick();

			const expected = startTime + tickCount * intervalMs;
			const drift = performance.now() - expected;
			const nextDelay = Math.max(0, intervalMs - drift);
			timeoutRef.current = setTimeout(tick, nextDelay);
		}
		timeoutRef.current = setTimeout(tick, intervalMs);
	}, [tempo, beatsPerBar, onPlayClick]);

	const handleToggle = useCallback(() => {
		if (isPlaying) stopPlayback();
		else startPlayback();
	}, [isPlaying, startPlayback, stopPlayback]);

	// No useEffect for cleanup — the component unmounts when Obsidian
	// destroys the block, and the timer ref is GC'd.

	return (
		<KitTransport
			tempo={tempo}
			beatsPerBar={beatsPerBar}
			isPlaying={isPlaying}
			currentBeat={currentBeat}
			onToggle={handleToggle}
			loop={loop}
		/>
	);
}
