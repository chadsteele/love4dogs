<script>
	let {profilePic = "", backgroundPic = "", canonicalUrl = ""} = $props()

	function asUrl(value) {
		return typeof value === "string" ? value : ""
	}

	function handleClick() {
		if (canonicalUrl) {
			window.location.href = canonicalUrl
		}
	}
</script>

<div
	class="profile-post-header"
	role="link"
	tabindex="0"
	onclick={handleClick}
	onkeydown={(e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			handleClick()
		}
	}}
>
	<img
		class="hero-bg"
		src={asUrl(backgroundPic) || "/background.jpg"}
		alt="Profile background"
	/>

	{#if asUrl(profilePic)}
		<img class="avatar" src={asUrl(profilePic)} alt="Profile" />
	{/if}
</div>

<style>
	.profile-post-header {
		position: relative;
		overflow: hidden;
		border-radius: 12px;
		cursor: pointer;
		display: block;
		margin-top: 0.65rem;
	}

	.hero-bg {
		display: block;
		width: 100%;
		height: 180px;
		object-fit: cover;
	}

	.avatar {
		position: absolute;
		left: 0.8rem;
		top: calc(180px - 4rem);
		z-index: 1;
		width: 8rem;
		height: 8rem;
		object-fit: cover;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.85);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}

	@media (max-width: 600px) {
		.hero-bg {
			height: 140px;
		}

		.avatar {
			top: calc(140px - 3.2rem);
			width: 6.4rem;
			height: 6.4rem;
		}
	}
</style>
