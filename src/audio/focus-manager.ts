/**
 * FocusManager — ensures only one interactive block captures keyboard input
 * at a time. When a block requests focus, all others are deactivated.
 *
 * Also stops all audio when focus is released (e.g. clicking away).
 */

export type FocusReleaseFn = () => void;

export class FocusManager {
	private activeRelease: FocusReleaseFn | null = null;

	/**
	 * Request exclusive keyboard focus for an interactive block.
	 * Returns a release function the block should call when it deactivates.
	 *
	 * @param releaseCurrent - function to deactivate the requesting block
	 *   (called when ANOTHER block takes focus, or when global release triggers)
	 */
	requestFocus(releaseCurrent: FocusReleaseFn): void {
		// Deactivate whoever had focus before
		if (this.activeRelease) {
			this.activeRelease();
		}
		this.activeRelease = releaseCurrent;
	}

	/**
	 * Release focus without giving it to another block.
	 * Called when clicking outside all interactive blocks.
	 */
	releaseFocus(): void {
		if (this.activeRelease) {
			this.activeRelease();
			this.activeRelease = null;
		}
	}
}
