<script>
	let {
		profilePic = "",
		backgroundPic = "",
		title = "",
		name = "",
		url = "",
	} = $props()

	const headerTitle = $derived(String(title || name || "").trim())

	function asUrl(value) {
		return typeof value === "string" ? value : ""
	}

	function handleClick() {
		if (url) {
			window.location.href = url
		}
	}
</script>

<button
	type="button"
	class="profile-post-header"
	disabled={!url}
	onclick={handleClick}
>
	<img
		class="hero-bg"
		src={asUrl(backgroundPic) || "/background.jpg"}
		alt="Profile background"
	/>

	{#if asUrl(profilePic)}
		<img class="avatar" src={asUrl(profilePic)} alt="Profile" />
	{/if}

	{#if headerTitle}
		<div class="title-row" class:no-avatar={!asUrl(profilePic)}>
			<h3 class="title">{headerTitle}</h3>
		</div>
	{/if}
</button>

<style>
	.profile-post-header {
		--bg-height: clamp(140px, 22vw, 190px);
		--avatar-size: clamp(76px, 12vw, 128px);
		--avatar-left: clamp(0.65rem, 1.8vw, 0.9rem);
		--title-gap: clamp(0.55rem, 1.4vw, 0.9rem);
		position: relative;
		overflow: visible;
		border-radius: 12px;
		cursor: pointer;
		display: block;
		margin-top: 0.65rem;
		padding: 0;
		width: 100%;
		border: 0;
		background: transparent;
		text-align: left;
	}

	.profile-post-header:disabled {
		cursor: default;
	}

	.hero-bg {
		display: block;
		width: 100%;
		height: var(--bg-height);
		object-fit: cover;
		border-radius: 12px 12px 0 0;
	}

	.avatar {
		position: absolute;
		left: var(--avatar-left);
		top: calc(var(--bg-height) - (var(--avatar-size) / 2));
		z-index: 1;
		width: var(--avatar-size);
		height: var(--avatar-size);
		object-fit: cover;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.85);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}

	.title-row {
		min-height: calc(var(--avatar-size) / 2 + 0.5rem);
		padding: 0 0.85rem 0.5rem
			calc(var(--avatar-left) + var(--avatar-size) + var(--title-gap));
		display: flex;
		align-items: flex-end;
	}

	.title-row.no-avatar {
		padding-left: 0.85rem;
		min-height: auto;
	}

	.title {
		margin: 0;
		font-size: clamp(1.1rem, calc(var(--avatar-size) * 0.5), 1.6rem);
		line-height: 0.95;
		font-weight: 700;
		color: #1f1f1f;
		word-break: break-word;
	}

	@media (max-width: 600px) {
		.profile-post-header {
			--bg-height: 136px;
			--avatar-size: 88px;
			--title-gap: 0.55rem;
		}
	}

	.profile-post-header:focus-visible {
		outline: 2px solid #2d5f9a;
		outline-offset: 2px;
	}
</style>
