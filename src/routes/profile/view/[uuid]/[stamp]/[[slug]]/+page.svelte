<script>
	import {onMount} from "svelte"
	import {ArrowLeft} from "lucide-svelte"
	import NavBar from "$lib/NavBar.svelte"
	import {buildLocationBlock} from "$lib/utils"

	const PROFILE_STORAGE_KEY = "love4dogs.profile-v2"

	let {uuid = "", stamp = ""} = $props()

	let profile = $state(null)
	let currentUserUuid = $state("")
	let loading = $state(true)
	let error = $state("")
	let storageReady = $state(false)

	onMount(() => {
		if (typeof localStorage === "undefined") return

		try {
			const storedJson = localStorage.getItem(PROFILE_STORAGE_KEY)
			const stored = storedJson ? JSON.parse(storedJson) : {}

			// Get current user's UUID (from active profile)
			currentUserUuid = stored?.uuid || ""

			// For now, we're loading the same profile. In the future, could fetch from server
			if (stored && stored.uuid === uuid) {
				profile = stored
			} else {
				error = "Profile not found"
			}
		} catch (e) {
			console.error("[profile/view] error loading profile:", e)
			error = "Failed to load profile"
		}

		loading = false
		storageReady = true
	})

	const isOwner = $derived(currentUserUuid === uuid)

	function buildLocationDisplay() {
		if (!profile?.confirmedLocation) return null
		return buildLocationBlock(profile.confirmedLocation)
	}
</script>

<svelte:head>
	<title>Profile View</title>
</svelte:head>

<main class="profile-view-page">
	<NavBar />

	<div class="profile-view-container">
		<button class="back-button" onclick={() => window.history.back()}>
			<ArrowLeft size={18} />
			Back
		</button>

		{#if loading}
			<p class="loading">Loading profile...</p>
		{:else if error}
			<p class="error">{error}</p>
		{:else if profile}
			<div class="profile-grid">
				<!-- Left: Profile Content -->
				<article class="profile-panel">
					<!-- Profile Header -->
					<div class="profile-header">
						{#if profile.profileUploadedMedia?.length > 0}
							<div class="profile-image">
								<img
									src={profile.profileUploadedMedia[0]
										?.bskyUrl || ""}
									alt="Profile"
									loading="lazy"
								/>
							</div>
						{/if}

						<div class="profile-info">
							<h1>{profile.profileName || "Unnamed Profile"}</h1>
							<p class="description">
								{profile.profileDescription || ""}
							</p>
							{#if buildLocationDisplay()}
								<p class="location">
									📍 {buildLocationDisplay()}
								</p>
							{/if}
						</div>
					</div>

					<!-- Profile Content -->
					{#if profile.contentHtml}
						<div class="profile-content">
							{@html profile.contentHtml}
						</div>
					{/if}

					<!-- Edit Button (if owner) -->
					{#if isOwner}
						<div class="profile-actions">
							<a href="/profile" class="edit-button">
								Edit Profile
							</a>
						</div>
					{/if}
				</article>

				<!-- Right: Map -->
				{#if profile.confirmedLocation}
					<aside class="map-panel">
						<div class="map-container">
							<iframe
								title="Profile location map"
								width="100%"
								height="100%"
								frameborder="0"
								src="https://www.openstreetmap.org/export/embed.html?bbox={profile
									.confirmedLocation.lon - 0.01},{profile
									.confirmedLocation.lat - 0.01},{profile
									.confirmedLocation.lon + 0.01},{profile
									.confirmedLocation.lat +
									0.01}&layer=mapnik&marker={profile
									.confirmedLocation.lat},{profile
									.confirmedLocation.lon}"
								style="border:0"
								allowfullscreen=""
								loading="lazy"
								referrerpolicy="no-referrer-when-downgrade"
							></iframe>
						</div>
					</aside>
				{/if}
			</div>
		{/if}
	</div>
</main>

<style>
	:global(body) {
		background: #faf9f6;
	}

	.profile-view-page {
		min-height: 100dvh;
		padding-bottom: 4rem;
	}

	.profile-view-container {
		max-width: 1120px;
		margin: 0 auto;
		padding: 1rem;
	}

	.back-button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.8rem;
		font-size: 0.9rem;
		color: #305741;
		background: transparent;
		border: 1px solid rgba(48, 87, 65, 0.3);
		border-radius: 6px;
		cursor: pointer;
		margin-bottom: 1rem;
	}

	.back-button:hover {
		background: rgba(48, 87, 65, 0.1);
		border-color: #305741;
	}

	.loading,
	.error {
		text-align: center;
		padding: 2rem;
		font-size: 1rem;
		color: #5f665f;
	}

	.error {
		color: #8e2f21;
	}

	.profile-grid {
		display: grid;
		grid-template-columns: 1fr 350px;
		gap: 1.5rem;
	}

	.profile-panel {
		background: rgba(255, 250, 241, 0.88);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
	}

	.profile-header {
		margin-bottom: 1.5rem;
	}

	.profile-image {
		margin-bottom: 1rem;
		max-width: 200px;
	}

	.profile-image img {
		width: 100%;
		height: auto;
		border-radius: 12px;
		display: block;
	}

	.profile-info h1 {
		font-size: 1.8rem;
		margin: 0 0 0.5rem;
		color: #1a1a1a;
	}

	.description {
		font-size: 1rem;
		color: #3b4a38;
		margin: 0 0 0.75rem;
		line-height: 1.55;
	}

	.location {
		font-size: 0.95rem;
		color: #5f665f;
		margin: 0;
	}

	.profile-content {
		margin: 1.5rem 0;
		font-size: 1rem;
		color: #1a1a1a;
		line-height: 1.6;
	}

	.profile-content :global(img),
	.profile-content :global(video) {
		max-width: 100%;
		height: auto;
		border-radius: 10px;
		margin: 1rem 0;
		display: block;
	}

	.profile-actions {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid rgba(58, 91, 65, 0.1);
	}

	.edit-button {
		display: inline-block;
		padding: 0.7rem 1.2rem;
		background: #3b6e4f;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: background 0.2s ease;
	}

	.edit-button:hover {
		background: #2f5740;
	}

	.map-panel {
		background: rgba(255, 250, 241, 0.88);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 10px 26px rgba(65, 42, 20, 0.12);
		position: sticky;
		top: 1rem;
		height: fit-content;
	}

	.map-container {
		width: 100%;
		height: 400px;
		overflow: hidden;
	}

	.map-container iframe {
		width: 100%;
		height: 100%;
	}

	@media (max-width: 900px) {
		.profile-grid {
			grid-template-columns: 1fr;
		}

		.map-panel {
			position: static;
		}

		.map-container {
			height: 300px;
		}
	}
</style>
