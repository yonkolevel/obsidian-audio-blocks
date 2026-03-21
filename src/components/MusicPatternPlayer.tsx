import React, { useCallback, useState } from "react";
import {
	PatternPlayer,
	type PatternPlayerRow,
} from "elementary-audio-kit/ui";

export interface MusicPatternPlayerProps {
	rows: PatternPlayerRow[];
	defaultTempo?: number;
	editable?: boolean;
	onRowTrigger?: (rowIndex: number) => void;
}

export function MusicPatternPlayer({
	rows: initialRows,
	defaultTempo = 120,
	editable = false,
	onRowTrigger,
}: MusicPatternPlayerProps) {
	const [rows, setRows] = useState(initialRows);

	const handleRowsChange = useCallback((updated: PatternPlayerRow[]) => {
		setRows(updated);
	}, []);

	return (
		<PatternPlayer
			rows={rows}
			defaultTempo={defaultTempo}
			editable={editable}
			onRowTrigger={onRowTrigger}
			onRowsChange={editable ? handleRowsChange : undefined}
		/>
	);
}
