<script>
	import favicon from "$lib/assets/favicon.svg"

	let {children} = $props()
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="bg-kenburns" aria-hidden="true"></div>
<div class="bg-overlay" aria-hidden="true"></div>

<div class="app-shell">
	{@render children()}
</div>

<style>
	:global(html),
	:global(body) {
		min-height: 100%;
	}

	:global(body) {
		margin: 0;
		font-family: "Avenir Next", "Trebuchet MS", sans-serif;
		background: #10140f;
	}

	.bg-kenburns {
		position: fixed;
		inset: -8%;
		background-image: url("/background.jpg");
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		animation: ken-burns 40s ease-in-out infinite alternate;
		transform-origin: center;
		will-change: transform;
		z-index: 0;
		pointer-events: none;
	}

	.bg-overlay {
		position: fixed;
		inset: 0;
		background: linear-gradient(
			to bottom,
			rgba(19, 23, 18, 0.35),
			rgba(34, 24, 15, 0.38)
		);
		z-index: 1;
		pointer-events: none;
	}

	.app-shell {
		position: relative;
		z-index: 2;
	}

	@keyframes ken-burns {
		0% {
			transform: scale(1.04) translate3d(-1%, -1%, 0);
		}
		100% {
			transform: scale(1.16) translate3d(1%, 1%, 0);
		}
	}
</style>
