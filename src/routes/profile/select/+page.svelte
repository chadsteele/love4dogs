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
		goto("/post/edit")
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
