<script>
	// Animated border wrapper that sizes to its rendered children.
	const DEFAULT_COLORS = [
		"#6f747c 0deg 28deg",
		"#eef2f4 28deg 52deg",
		"#a9b0b8 52deg 84deg",
		"#f8fbfc 84deg 108deg",
		"#7f8790 108deg 152deg",
		"#d8dde1 152deg 184deg",
		"#5e646c 184deg 220deg",
		"#f3f6f8 220deg 244deg",
		"#9ea5ad 244deg 288deg",
		"#ffffff 288deg 314deg",
		"#7a828b 314deg 344deg",
		"#c4cbd1 344deg 360deg",
	]

	const {children, colors = DEFAULT_COLORS} = $props()

	function buildBorderGradient(stops = DEFAULT_COLORS) {
		const gradientStops = Array.isArray(stops)
			? stops.map((entry) => String(entry || "").trim()).filter(Boolean)
			: DEFAULT_COLORS
		const normalizedStops =
			gradientStops.length > 0 ? gradientStops : DEFAULT_COLORS
		return `conic-gradient(from var(--angle), ${normalizedStops.join(", ")})`
	}
</script>

<div class="rainbow" style={`--rainbow-border: ${buildBorderGradient(colors)}`}>
	{@render children()}
</div>

<style>
	:root {
		--angle: 45deg;
		--opacity: 0.5;
	}

	*,
	*::before,
	*::after {
		box-sizing: border-box;
	}

	.rainbow {
		display: inline-block;
		max-width: 100%;
		vertical-align: top;
		border-radius: 10px;
		padding: 2rem;

		--border-size: 0.3rem;
		border: var(--border-size) solid transparent;

		/* Paint an image in the border */
		border-image: var(--rainbow-border) 1 stretch;
		background: rgb(255 255 255 / var(--opacity));
	}

	@property --opacity {
		syntax: "<number>";
		initial-value: 0.5;
		inherits: false;
	}

	@property --angle {
		syntax: "<angle>";
		initial-value: 0deg;
		inherits: false;
	}

	@keyframes opacityChange {
		to {
			--opacity: 1;
		}
	}

	@keyframes rotate {
		to {
			--angle: 360deg;
		}
	}

	.rainbow {
		animation:
			rotate 4s linear infinite,
			opacityChange 3s infinite alternate;
	}
</style>
