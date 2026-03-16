import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const buildOptions = {
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
};

if (prod) {
	esbuild.build(buildOptions).catch(() => process.exit(1));
} else {
	const ctx = await esbuild.context({
		...buildOptions,
		plugins: [
			{
				name: "rebuild-notify",
				setup(build) {
					build.onEnd((result) => {
						const errors = result.errors.length;
						const warnings = result.warnings.length;
						if (errors > 0) {
							console.log(
								`[watch] Build finished with ${errors} error(s)`
							);
						} else {
							console.log(
								`[watch] Build succeeded${warnings > 0 ? ` with ${warnings} warning(s)` : ""}`
							);
						}
					});
				},
			},
		],
	});
	await ctx.watch();
	console.log("Watching for changes...");
}
