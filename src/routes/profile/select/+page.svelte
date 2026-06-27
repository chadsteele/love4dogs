<script>
	import {onMount} from "svelte"
	import {goto} from "$app/navigation"
	import NavBar from "$lib/NavBar.svelte"
	import ProfileList from "$lib/ProfileList.svelte"
	import {
		buildNewProfileEditPath,
		getCurrentProfileUuid,
		listStoredProfiles,
		setCurrentProfileUuid,
		deleteStoredProfileByUuid,
	} from "$lib/profileRegistry"

	let profiles = $state([])
	let currentUuid = $state("")

	async function refreshProfiles() {
		profiles = await listStoredProfiles()
		currentUuid = await getCurrentProfileUuid()
	}

	async function chooseProfile(uuid = "") {
		const next = String(uuid || "").trim()
		if (!next) return
		await setCurrentProfileUuid(next)
		currentUuid = next
	
		goto(
							`/profile/view/${encodeURIComponent(next)}`,
							{
								replaceState: true,
							},
						);
	}

	async function deleteProfile(uuid = "") {
		const targetUuid = String(uuid || "").trim()
		if (!targetUuid) return
		if (confirm("Are you sure you want to delete this profile?")) {
			await deleteStoredProfileByUuid(targetUuid)
			await refreshProfiles()
		}
	}

	onMount(async () => {
		await refreshProfiles()
	})
</script>

<svelte:head>
	<title>Select Profile | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar />

	<section class="panel">
		<div class="panel-header">
			<h2>Select Current Profile</h2>
			<div class="header-actions">
				<a href="/search/profile" class="search-profile-btn">Find Lost Profile</a>
				<a href="/profile/new" class="new-profile-btn">+ New</a>
			</div>
		</div>
		<p class="help">
			Choose which profile is current. New posts will use this profile.
		</p>

		{#if profiles.length === 0}
			<div class="empty-state">
				<p>No saved profiles yet.</p>
				<button
					type="button"
					class="action"
					onclick={() => goto(buildNewProfileEditPath())}
				>
					Create your first profile
				</button>
			</div>
		{:else}
			<ProfileList
				{profiles}
				{currentUuid}
				mode="picker"
				onChoose={chooseProfile}
				onDelete={deleteProfile}
				allowDelete={true}
			/>
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

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.search-profile-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #fff;
		border: 1px solid #bdad9e;
		color: #5c4e40;
		font-weight: 600;
		text-decoration: none;
		border-radius: 999px;
		padding: 0.45rem 1rem;
		font-size: 0.88rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.search-profile-btn:hover {
		background: #f7f2eb;
		border-color: #a39587;
		color: #3b3026;
	}

	.new-profile-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #3b6e4f;
		border: 1px solid #305741;
		color: #fff;
		font-weight: 600;
		text-decoration: none;
		border-radius: 999px;
		padding: 0.45rem 1rem;
		font-size: 0.88rem;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.new-profile-btn:hover {
		background: #305741;
	}

	h2 {
		margin: 0;
	}

	.help {
		margin: 0.4rem 0 1rem;
		color: #6d5f51;
	}

	.empty-state {
		padding: 0.8rem;
		border-radius: 12px;
		background: #f7f2eb;
	}

	.action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-top: 0.45rem;
		padding: 0.45rem 0.75rem;
		border: 0;
		border-radius: 999px;
		background: #3b6e4f;
		color: #fff;
		text-decoration: none;
		font: inherit;
		cursor: pointer;
	}
</style>
