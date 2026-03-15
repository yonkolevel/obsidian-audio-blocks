import React, { useCallback } from "react";

export type QuestionType = "multipleChoice" | "trueFalse";

export interface QuestionProps {
	id: string;
	type: QuestionType;
	question: string;
	options: string[];
	correctAnswer: string;
	explanation?: string;
}

export function Question({
	id,
	type,
	question,
	options,
	correctAnswer,
	explanation,
}: QuestionProps) {
	const [selectedOption, setSelectedOption] = React.useState<string | null>(
		null
	);
	const [answered, setAnswered] = React.useState(false);

	const handleSelect = useCallback(
		(option: string) => {
			if (answered) return;
			setSelectedOption(option);
			setAnswered(true);
		},
		[answered]
	);

	const isCorrect = selectedOption === correctAnswer;

	return (
		<div className="ea-question-container">
			<p className="ea-question-text">{question}</p>
			<div className="ea-question-options">
				{options.map((option, index) => {
					let stateClass = "";
					if (answered) {
						if (option === correctAnswer) {
							stateClass = "ea-question-option--correct";
						} else if (option === selectedOption) {
							stateClass = "ea-question-option--wrong";
						} else {
							stateClass = "ea-question-option--dimmed";
						}
					}

					return (
						<button
							key={`${id}-opt-${index}`}
							className={[
								"ea-question-option",
								stateClass,
							]
								.filter(Boolean)
								.join(" ")}
							onClick={() => handleSelect(option)}
							disabled={answered}
						>
							<span className="ea-question-option-indicator">
								{answered && option === correctAnswer
									? "\u2713"
									: answered && option === selectedOption
										? "\u2717"
										: String.fromCharCode(65 + index)}
							</span>
							<span className="ea-question-option-text">
								{option}
							</span>
						</button>
					);
				})}
			</div>
			{answered && explanation && (
				<div
					className={`ea-question-explanation ${isCorrect ? "ea-question-explanation--correct" : "ea-question-explanation--wrong"}`}
				>
					<span className="ea-question-explanation-label">
						{isCorrect ? "Correct!" : "Not quite."}
					</span>
					<span className="ea-question-explanation-text">
						{explanation}
					</span>
				</div>
			)}
		</div>
	);
}
