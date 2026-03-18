/**
 * ElementaryRenderer — wraps WebRenderer from @elemaudio/web-renderer v4.
 *
 * Handles AudioWorklet initialization, VFS sample loading, and graph rendering.
 * One instance per plugin lifetime.
 */

import WebRenderer from "@elemaudio/web-renderer";
import { el, type NodeRepr_t } from "@elemaudio/core";

export class ElementaryRenderer {
	private core: WebRenderer | null = null;
	private workletNode: AudioWorkletNode | null = null;
	private ready = false;

	/**
	 * Create the WebRenderer, initialize the AudioWorklet, connect to
	 * destination, and render silence to prime the graph.
	 */
	async initialize(ctx: AudioContext): Promise<void> {
		if (this.ready) return;

		this.core = new WebRenderer();

		const node = await this.core.initialize(ctx, {
			numberOfInputs: 0,
			numberOfOutputs: 1,
			outputChannelCount: [2],
		});

		node.connect(ctx.destination);
		this.workletNode = node;
		this.ready = true;

		// Render silence to prime the graph
		this.core.render(el.const({ value: 0 }), el.const({ value: 0 }));
	}

	/**
	 * Render a stereo Elementary graph. Elementary's diffing engine
	 * ensures only changed nodes trigger recomputation.
	 */
	render(left: NodeRepr_t, right: NodeRepr_t): void {
		if (!this.core || !this.ready) return;
		this.core.render(left, right);
	}

	/**
	 * Load samples into the Virtual File System.
	 * Keys become the `path` parameter in `el.sample()`.
	 */
	loadSamplesToVFS(samples: Record<string, Float32Array>): void {
		if (!this.core) return;
		this.core.updateVirtualFileSystem(samples);
	}

	isReady(): boolean {
		return this.ready;
	}

	dispose(): void {
		if (this.workletNode) {
			this.workletNode.disconnect();
		}
		this.core = null;
		this.workletNode = null;
		this.ready = false;
	}
}
