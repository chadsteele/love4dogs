<script>
	import {onMount} from "svelte"
	import {goto} from "$app/navigation"
	import NavBar from "$lib/NavBar.svelte"
	import {
		getCurrentProfileUuid,
		listStoredProfiles,
		setCurrentProfileUuid,
	} from "$lib/profileRegistry"

	let profiles = $state([])
	let currentUuid = $state("")

	function refreshProfiles() {
		profiles = listStoredProfiles()
		currentUuid = getCurrentProfileUuid()
	}

	function chooseProfile(uuid = "") {
		const next = String(uuid || "").trim()
		if (!next) return
		setCurrentProfileUuid(next)
		currentUuid = next
		goto("/post")
	}

	onMount(() => {
		refreshProfiles()
	})
</script>

<svelte:head>
	<title>Select Profile | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar />

	<section class="panel">
		<h2>Select Current Profile</h2>
		<p class="help">
			Choose which profile is current. New posts will use this profile.
		</p>

		{#if profiles.length === 0}
			<div class="empty-state">
				<p>No saved profiles yet.</p>
				<a class="action" href="/profile/edit"
					>Create your first profile</a
				>
			</div>
		{:else}
			<ul class="profile-list">
				{#each profiles as profile}
					<li class:current={profile.uuid === currentUuid}>
						<button
							type="button"
							class="profile-row"
							onclick={() => chooseProfile(profile.uuid)}
						>
							{#if profile.avatarUrl}
								<img
									src={profile.avatarUrl}
									alt={profile.name || "Profile"}
								/>
							{:else}
								<div class="avatar-fallback">P</div>
							{/if}
							<div class="meta">
								<strong
									>{profile.name ||
										"Untitled profile"}</strong
								>
								<small>{profile.uuid}</small>
							</div>
							{#if profile.uuid === currentUuid}
								<span class="badge">Current</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	.page {
		max-width: 980px;
		margin: 0 auto;
		padding: 1.1rem;
	}

	.panel {
		background: #fff;
		border: 1px solid #dfd3c4;
		border-radius: 16px;
		padding: 1rem;
	}

	h2 {
		margin: 0;
	}

	.help {
		margin: 0.4rem 0 1rem;
		color: #6d5f51;
	}

	.profile-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.65rem;
	}

	.profile-row {
		width: 100%;
		display: grid;
		grid-template-columns: 44px 1fr auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.6rem;
		border-radius: 12px;
		border: 1px solid #d8cdbf;
		background: #fff;
		cursor: pointer;
		text-align: left;
	}

	.current .profile-row {
		border-color: #3b6e4f;
		background: #f2f8f4;
	}

	img,
	.avatar-fallback {
		width: 44px;
		height: 44px;
		border-radius: 999px;
		object-fit: cover;
	}

	.avatar-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #e7dbcd;
		color: #6c5542;
		font-weight: 700;
	}

	.meta {
		display: grid;
		gap: 0.2rem;
	}

	.meta small {
		color: #857666;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.badge {
		font-size: 0.82rem;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
		background: #3b6e4f;
		color: #fff;
	}

	.empty-state {
		padding: 0.8rem;
		border-radius: 12px;
		background: #f7f2eb;
	}

	.action {
		display: inline-block;
		margin-top: 0.45rem;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		background: #3b6e4f;
		color: #fff;
		text-decoration: none;
	}
</style>
