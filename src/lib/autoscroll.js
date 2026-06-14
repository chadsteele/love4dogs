/**
 * Programmatically scrolls to a target with support for manual scroll cancellation
 * and dynamic tracking of layout shifts (e.g., lazy loading).
 * 
 * @param {string|Element|number|Function} target - Target selector, DOM Element, Y coordinate,
 *                                                 or a special string ('top', 'bottom').
 * @param {Object} options - Options for the scroll behavior.
 * @param {number} [options.offset=0] - Y offset to apply to the target scroll position.
 * @param {Window|Element} [options.container=window] - Scroll container (window or scrollable element).
 * @param {number} [options.speed=8] - Speed constant for frame-rate independent interpolation.
 * @param {number} [options.maxDuration=3000] - Maximum run time in ms before automatically stopping.
 * @param {Function} [options.onCancel] - Callback when scroll is cancelled by user interaction.
 * @param {Function} [options.onComplete] - Callback when scroll successfully reaches target.
 * @returns {Function} - Function to manually cancel this scroll.
 */
export function scrollToTarget(target, options = {}) {
	const {
		offset = 0,
		container = window,
		speed = 8,
		maxDuration = 3000,
		onCancel = () => {},
		onComplete = () => {}
	} = options;

	let cancelled = false;
	let lastProgrammaticY = null;
	let startTime = null;
	let lastTime = null;
	let animationFrameId = null;

	// Direct scroll getters/setters
	const getScrollY = () => {
		if (container === window) {
			return window.scrollY ?? window.pageYOffset ?? document.documentElement.scrollTop;
		}
		return container.scrollTop;
	};

	const setScrollY = (y) => {
		if (container === window) {
			window.scrollTo(window.scrollX, y);
		} else {
			container.scrollTop = y;
		}
	};

	const getScrollHeight = () => {
		if (container === window) {
			return Math.max(
				document.body.scrollHeight,
				document.documentElement.scrollHeight
			);
		}
		return container.scrollHeight;
	};

	const getClientHeight = () => {
		if (container === window) {
			return window.innerHeight;
		}
		return container.clientHeight;
	};

	const getMaxScrollY = () => {
		return Math.max(0, getScrollHeight() - getClientHeight());
	};

	// Helper to calculate target coordinate at any moment
	const getTargetY = () => {
		if (target === "top") {
			return 0;
		}
		if (target === "bottom") {
			return getMaxScrollY();
		}
		if (typeof target === "number") {
			return target + offset;
		}
		
		let element = null;
		if (typeof target === "string") {
			element = document.querySelector(target);
		} else if (target instanceof Element) {
			element = target;
		} else if (typeof target === "function") {
			element = target();
		}

		if (!element) {
			return null; // Not found yet
		}

		// Calculate absolute position relative to the scroll container
		if (container === window) {
			const rect = element.getBoundingClientRect();
			return rect.top + window.scrollY + offset;
		} else {
			const rect = element.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			return rect.top - containerRect.top + container.scrollTop + offset;
		}
	};

	// Interaction cancellation handler
	const scrollKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Space", "Home", "End"];
	const handleInteraction = (e) => {
		if (e.type === "keydown" && !scrollKeys.includes(e.key)) {
			return;
		}
		cancelScroll(true);
	};

	// Scroll listener to detect external/user-driven scroll deviations
	const handleScrollEvent = () => {
		const currentY = getScrollY();
		if (lastProgrammaticY !== null && Math.abs(currentY - lastProgrammaticY) > 2.5) {
			cancelScroll(true);
		}
	};

	// Bind event listeners
	const eventTarget = container === window ? document : container;
	
	// Add passive event listeners to avoid blocking main thread
	eventTarget.addEventListener("wheel", handleInteraction, { passive: true });
	eventTarget.addEventListener("touchmove", handleInteraction, { passive: true });
	eventTarget.addEventListener("keydown", handleInteraction, { passive: true });
	container.addEventListener("scroll", handleScrollEvent, { passive: true });

	const cleanup = () => {
		eventTarget.removeEventListener("wheel", handleInteraction);
		eventTarget.removeEventListener("touchmove", handleInteraction);
		eventTarget.removeEventListener("keydown", handleInteraction);
		container.removeEventListener("scroll", handleScrollEvent);
		if (animationFrameId) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
	};

	const cancelScroll = (byUser = false) => {
		if (cancelled) return;
		cancelled = true;
		cleanup();
		if (byUser) {
			onCancel();
		}
	};

	// Main animation loop
	const tick = (now) => {
		if (cancelled) return;

		if (startTime === null) {
			startTime = now;
			lastTime = now;
			lastProgrammaticY = getScrollY();
		}

		const elapsed = now - startTime;
		const deltaTime = now - lastTime;
		lastTime = now;

		// Check overall timeout
		if (elapsed > maxDuration) {
			cancelScroll(false);
			onComplete();
			return;
		}

		const targetY = getTargetY();

		if (targetY === null) {
			// Target element is not (yet) in the DOM, keep retrying
			animationFrameId = requestAnimationFrame(tick);
			return;
		}

		// Clamp targetY to actual scrollable bounds (which might change as body expands/shrinks)
		const maxScroll = getMaxScrollY();
		const clampedTargetY = Math.min(Math.max(0, targetY), maxScroll);

		const currentY = getScrollY();
		const distance = clampedTargetY - currentY;

		// If we are close enough, snap to target and finish
		if (Math.abs(distance) < 0.8) {
			setScrollY(clampedTargetY);
			cancelScroll(false);
			onComplete();
			return;
		}

		// Interpolate position frame-rate independently
		const factor = 1 - Math.exp(-speed * (deltaTime / 1000));
		const nextY = currentY + distance * factor;

		setScrollY(nextY);
		lastProgrammaticY = getScrollY();

		animationFrameId = requestAnimationFrame(tick);
	};

	animationFrameId = requestAnimationFrame(tick);

	return () => cancelScroll(false);
}
