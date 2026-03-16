import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

esbuild
	.build({
		entryPoints: ["src/main.ts"],
		bundle: true,
		external: [
			"obsidian",
			"electron",
			"@codemirror/autocomplete",
			"@codemirror/collab",
			"@codemirror/commands",
			"@codemirror/language",
			"@codemirror/lint",
			"@codemirror/search",
			"@codemirror/state",
			"@codemirror/view",
			"@lezer/common",
			"@lezer/highlight",
			"@lezer/lr",
			"fs",
			"path",
		],
		format: "cjs",
		target: "es2018",
		logLevel: "info",
		sourcemap: prod ? false : "inline",
		treeShaking: true,
		outfile: "main.js",
		jsx: "transform",
		jsxFactory: "React.createElement",
		jsxFragment: "React.Fragment",
		define: {
			"process.env.NODE_ENV": prod ? '"production"' : '"development"',
		},
	})
	.catch(() => process.exit(1));
