<script>
	let {
		open = false,
		images = [],
		activeIndex = 0,
		onClose = () => {},
		onChangeIndex = () => {},
	} = $props()

	function portal(node) {
		document.body.appendChild(node)
		return {
			destroy() {
				node.remove()
			},
		}
	}

	$effect(() => {
		if (!open || typeof window === "undefined") return

		const onKeyDown = (event) => {
			if (event.key === "Escape") {
				onClose()
			}
		}

		window.addEventListener("keydown", onKeyDown)
		return () => {
			window.removeEventListener("keydown", onKeyDown)
		}
	})
</script>

{#if open && images.length > 0}
	<div
		class="image-modal-backdrop"
		role="button"
		tabindex="0"
		aria-label="Close image viewer"
		onclick={onClose}
		onkeydown={(event) => {
			if (event.key === "Enter" || event.key === " ") {
				onClose()
			}
		}}
	>
		<div
			class="image-modal"
			role="dialog"
			aria-modal="true"
			aria-label="Post image viewer"
			tabindex="-1"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.stopPropagation()
				}
			}}
		>
			<button
				type="button"
				class="image-modal-close"
				onclick={onClose}
				aria-label="Close image viewer"
			>
				×
			</button>
			<div class="image-modal-main">
				{#each images as image, index}
					<img
						src={image}
						alt="Expanded dog post"
						loading="eager"
						class="main-image"
						class:is-active={index === activeIndex}
					/>
				{/each}
			</div>
			{#if images.length > 1}
				<div class="image-modal-thumbs">
					{#each images as image, index}
						<button
							type="button"
							class="image-modal-thumb"
							class:is-active={index === activeIndex}
							onclick={() => onChangeIndex(index)}
							aria-label={`Show image ${index + 1}`}
						>
							<img
								src={image}
								alt="Post thumbnail"
								loading="lazy"
							/>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.image-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(16, 20, 15, 0.76);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 70;
	}

	.image-modal {
		position: relative;
		width: min(980px, 100%);
		max-height: calc(100vh - 2rem);
		padding: 1rem 1rem 0.9rem;
		background: rgba(255, 250, 241, 0.98);
		border: 1px solid rgba(58, 91, 65, 0.24);
		border-radius: 16px;
		box-shadow: 0 18px 45px rgba(65, 42, 20, 0.28);
		box-sizing: border-box;
	}

	.image-modal-main {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 220px;
		max-height: calc(100vh - 9rem);
		position: relative;
		z-index: 1;
	}

	.image-modal-main .main-image {
		display: block;
		max-width: min(100%, 400px);
		max-height: calc(100vh - 9rem);
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 12px;
		opacity: 0;
		pointer-events: none;
		position: absolute;
	}

	.image-modal-main .main-image.is-active {
		opacity: 1;
		pointer-events: auto;
		position: static;
	}

	.image-modal-thumbs {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: flex-end;
		gap: 0.5rem;
		margin-top: 0.85rem;
	}

	.image-modal-thumb {
		padding: 0;
		border: 2px solid transparent;
		border-radius: 10px;
		background: transparent;
		cursor: pointer;
		overflow: hidden;
		line-height: 0;
	}

	.image-modal-thumb.is-active {
		border-color: #3b6e4f;
	}

	.image-modal-thumb img {
		display: block;
		height: 100px;
		width: auto;
		max-width: min(280px, 15vw);
		object-fit: cover;
	}

	.image-modal-close {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 3;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 1px solid rgba(58, 91, 65, 0.24);
		background: rgba(255, 255, 255, 0.92);
		cursor: pointer;
		font-size: 1.25rem;
		line-height: 1;
		color: #2f4936;
	}

	.image-modal-close:hover {
		background: rgba(243, 250, 244, 0.95);
	}
</style>
