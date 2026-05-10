<script>
	let {children} = $props()
</script>

<div class="bg-kenburns" aria-hidden="true"></div>
<div class="bg-overlay" aria-hidden="true"></div>

<div class="app-shell">
	<div class="construction-notice">
		🛠️ WE'RE UNDER CONSTRUCTION! 🚜👷🏽 Please pardon our mess.
	</div>
	{@render children()}
</div>
<div class="footer">
	<p class="meta">
		<span>&copy; {new Date().getFullYear()} Love4Dogs.club</span>
		<span class="sep" aria-hidden="true">•</span>
		<span>All content is community-driven and belongs to its owners.</span>
		<span class="sep" aria-hidden="true">•</span>
		<span>Contribute yours!</span>
	</p>
	<p class="tagline">Made with ❤️ by animal lovers, for animal lovers.</p>
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

	:global(body),
	:global(body *) {
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
	}

	:global(input),
	:global(textarea),
	:global(.post-text),
	:global(.post-text *) {
		-webkit-touch-callout: default;
		-webkit-user-select: text;
		user-select: text;
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

	.footer {
		position: relative;
		z-index: 2;
		margin: 0 auto 1rem;
		max-width: min(1100px, calc(100% - 2rem));
		padding: 0.9rem 1rem;
		box-sizing: border-box;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 14px;
		background: rgba(16, 20, 15, 0.78);
		backdrop-filter: blur(4px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		color: #f7f2e8;
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.footer p {
		margin: 0;
		text-align: center;
	}

	.footer .meta {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		column-gap: 0.15rem;
	}

	.footer .tagline {
		margin-top: 0.2rem;
		color: rgba(247, 242, 232, 0.9);
	}

	.footer .sep {
		display: inline-block;
		padding: 0 0.4rem;
		opacity: 0.7;
	}

	.construction-notice {
		text-align: center;
		padding: 1rem;
		box-sizing: border-box;
		font-size: clamp(1rem, 2.5vw, 1.3rem);
		color: #f7f2e8;
		background-color: #10140f;
		z-index: 3;
	}

	@keyframes ken-burns {
		0% {
			transform: scale(1.04) translate3d(-1%, -1%, 0);
		}
		100% {
			transform: scale(1.16) translate3d(1%, 1%, 0);
		}
	}

	@media (max-width: 700px) {
		.footer {
			font-size: 0.82rem;
			padding: 0.8rem;
			gap: 0.2rem;
		}

		.footer .sep {
			display: none;
		}

		.footer .meta {
			row-gap: 0.1rem;
		}
	}
</style>
