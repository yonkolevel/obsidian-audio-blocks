/**
 * Registers the `question` fenced code block processor with Obsidian.
 *
 * When Obsidian encounters a code block like:
 *
 * ```question
 * id: q1
 * type: multipleChoice
 * question: How many beats are in a 4/4 measure?
 * options:
 *   - "3"
 *   - "4"
 *   - "6"
 * correctAnswer: "4"
 * explanation: 4/4 time signature means 4 beats per measure.
 * ```
 *
 * This processor parses the YAML config using js-yaml (since the config
 * contains nested YAML lists) and mounts a React Question component
 * into the rendered markdown.
 */

import { Plugin } from "obsidian";
import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { Question, QuestionType } from "../components/Question";
import yaml from "js-yaml";

const VALID_TYPES: QuestionType[] = ["multipleChoice", "trueFalse"];

export function registerQuestionProcessor(plugin: Plugin): void {
	const roots: Root[] = [];

	plugin.registerMarkdownCodeBlockProcessor(
		"question",
		(source: string, el: HTMLElement) => {
			const config = yaml.load(source) as Record<string, unknown>;

			if (!config || typeof config !== "object") {
				renderWarning(el, "Invalid question block: could not parse YAML");
				return;
			}

			const id = String(config.id || "unknown");
			const type = VALID_TYPES.includes(config.type as QuestionType)
				? (config.type as QuestionType)
				: "multipleChoice";
			const question = String(config.question || "");

			// Parse options — for trueFalse, provide default options
			let options: string[];
			if (type === "trueFalse") {
				options = ["True", "False"];
			} else if (Array.isArray(config.options)) {
				options = config.options.map((o: unknown) => String(o));
			} else {
				renderWarning(el, "Question block missing 'options' list");
				return;
			}

			const correctAnswer = String(config.correctAnswer || "");
			const explanation = config.explanation
				? String(config.explanation)
				: undefined;

			if (!question) {
				renderWarning(el, "Question block missing 'question' field");
				return;
			}

			const container = el.createDiv({ cls: "ea-block-container" });
			const root = createRoot(container);
			roots.push(root);

			root.render(
				createElement(Question, {
					id,
					type,
					question,
					options,
					correctAnswer,
					explanation,
				})
			);
		}
	);

	plugin.register(() => {
		for (const root of roots) {
			try {
				root.unmount();
			} catch {
				// Root may already be unmounted
			}
		}
		roots.length = 0;
	});
}

/**
 * Render a yellow warning bar inside the given element.
 */
function renderWarning(el: HTMLElement, message: string): void {
	const container = el.createDiv({ cls: "ea-block-container" });
	const warning = container.createDiv({ cls: "ea-validation-warning" });
	warning.textContent = message;
}
