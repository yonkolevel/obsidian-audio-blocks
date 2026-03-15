import React from "react";

export type CalloutStyle = "tip" | "info" | "warning";

export interface CalloutProps {
	style: CalloutStyle;
	text: string;
}

const CALLOUT_CONFIG: Record<
	CalloutStyle,
	{ icon: string; colorClass: string; label: string }
> = {
	tip: { icon: "💡", colorClass: "ea-callout--tip", label: "Tip" },
	info: { icon: "ℹ️", colorClass: "ea-callout--info", label: "Info" },
	warning: {
		icon: "⚠️",
		colorClass: "ea-callout--warning",
		label: "Warning",
	},
};

export function Callout({ style, text }: CalloutProps) {
	const config = CALLOUT_CONFIG[style] || CALLOUT_CONFIG.info;

	return (
		<div className={`ea-callout ${config.colorClass}`}>
			<div className="ea-callout-header">
				<span className="ea-callout-icon">{config.icon}</span>
				<span className="ea-callout-label">{config.label}</span>
			</div>
			<p className="ea-callout-text">{text}</p>
		</div>
	);
}
