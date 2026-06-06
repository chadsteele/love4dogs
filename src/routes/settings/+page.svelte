<script>
	import {onMount} from "svelte"
	import {goto} from "$app/navigation"
	import NavBar from "$lib/NavBar.svelte"
	import ProfileList from "$lib/ProfileList.svelte"
	import { getSetting, setSetting, removeSetting } from "$lib/db.js"
	import {
		buildNewProfileEditPath,
		deleteStoredProfileByUuid,
		getCurrentProfileUuid,
		generateProfileUuid,
		importStoredProfileFromReconstructedBundle,
		listStoredProfiles,
		readStoredProfileByUuid,
		setCurrentProfileUuid,
	} from "$lib/profileRegistry"

	const FAVORITE_SEARCH_TERMS_KEY =
		"love4dogs.settings.favorite-search-terms-v1"
	const DEFAULT_SEARCH_TERM_KEY = "love4dogs.settings.default-search-term-v1"
	const MAX_FAVORITES = 20

	const suggestedTerms = [
		"adoption",
		"foster",
		"urgent",
		"missing",
		"medical",
		"cats",
		"small dogs",
	]

	let favoriteTerms = $state([])
	let newFavoriteTerm = $state("")
	let defaultSearchTerm = $state("")
	let saveMessage = $state("")
	let recoveryPostUrl = $state("")
	let recoveryMessage = $state("")
	let recoveryError = $state("")
	let recoveryBusy = $state(false)
	let deleteTargetUuid = $state("")
	let deleteTargetName = $state("")
	let deleteError = $state("")
	let profiles = $state([])
	let currentProfileUuid = $state("")

	function normalizeTerm(value = "") {
		return String(value || "")
			.trim()
			.replace(/\s+/g, " ")
	}

	function uniqueTerms(values = []) {
		const seen = new Set()
		const next = []
		for (const value of values) {
			const normalized = normalizeTerm(value)
			if (!normalized) continue
			const key = normalized.toLowerCase()
			if (seen.has(key)) continue
			seen.add(key)
			next.push(normalized)
			if (next.length >= MAX_FAVORITES) break
		}
		return next
	}

	async function readFavoriteTerms() {
		try {
			const parsed = await getSetting(FAVORITE_SEARCH_TERMS_KEY, [])
			return uniqueTerms(Array.isArray(parsed) ? parsed : [])
		} catch {
			return []
		}
	}

	async function writeFavoriteTerms(next = []) {
		await setSetting(
			FAVORITE_SEARCH_TERMS_KEY,
			uniqueTerms(next),
		)
	}

	async function readDefaultSearchTerm() {
		const val = await getSetting(DEFAULT_SEARCH_TERM_KEY, "")
		return normalizeTerm(val || "")
	}

	async function writeDefaultSearchTerm(value = "") {
		const normalized = normalizeTerm(value)
		if (!normalized) {
			await removeSetting(DEFAULT_SEARCH_TERM_KEY)
			return
		}
		await setSetting(DEFAULT_SEARCH_TERM_KEY, normalized)
	}

	async function refreshProfiles() {
		profiles = await listStoredProfiles()
		currentProfileUuid = await getCurrentProfileUuid()
	}

	async function addFavoriteTerm(term = "") {
		const normalized = normalizeTerm(term || newFavoriteTerm)
		if (!normalized) return
		favoriteTerms = uniqueTerms([normalized, ...favoriteTerms])
		await writeFavoriteTerms(favoriteTerms)
		newFavoriteTerm = ""
		saveMessage = "Saved favorite search terms."
	}

	async function removeFavoriteTerm(term = "") {
		const normalized = normalizeTerm(term)
		if (!normalized) return
		favoriteTerms = favoriteTerms.filter(
			(entry) => entry.toLowerCase() !== normalized.toLowerCase(),
		)
		await writeFavoriteTerms(favoriteTerms)
		saveMessage = "Updated favorite search terms."
	}

	async function saveDefaultTerm() {
		defaultSearchTerm = normalizeTerm(defaultSearchTerm)
		await writeDefaultSearchTerm(defaultSearchTerm)
		saveMessage = defaultSearchTerm
			? "Saved default search term."
			: "Cleared default search term."
	}

	async function chooseProfile(uuid = "") {
		const next = String(uuid || "").trim()
		if (!next) return
		await setCurrentProfileUuid(next)
		currentProfileUuid = next
		saveMessage = "Current profile updated."
	}

	function editProfile(uuid = "") {
		const next = String(uuid || "").trim()
		if (!next) return
		goto(`/profile/edit/${encodeURIComponent(next)}`)
	}

	function requestDeleteProfile(uuid = "") {
		const targetUuid = String(uuid || "").trim()
		if (!targetUuid) return
		const profile = profiles.find((entry) => entry.uuid === targetUuid)
		deleteTargetUuid = targetUuid
		deleteTargetName =
			String(profile?.name || "").trim() || "Untitled profile"
		deleteError = ""
	}

	function cancelDeleteProfile() {
		deleteTargetUuid = ""
		deleteTargetName = ""
		deleteError = ""
	}

	async function confirmDeleteProfile() {
		const targetUuid = String(deleteTargetUuid || "").trim()
		if (!targetUuid) return
		try {
			// Delete locally immediately
			await deleteStoredProfileByUuid(targetUuid)
			await refreshProfiles()
			// Close modal immediately
			cancelDeleteProfile()

			// Fire off Bluesky deletion in background (no await)
			;(async () => {
				try {
					const uriLookupRes = await fetch(
						`/api/post-by-canonical-url?uuid=${encodeURIComponent(targetUuid)}`,
					)
					if (!uriLookupRes.ok) {
						saveMessage = `Deleted profile ${targetUuid}. Matching Bluesky post was not found.`
						return
					}
					const uriLookupJson = await uriLookupRes
						.json()
						.catch(() => ({}))
					const postUri = String(uriLookupJson?.uri || "").trim()
					if (!postUri) {
						saveMessage = `Deleted profile ${targetUuid}. Matching Bluesky post URI was unavailable.`
						return
					}

					const deleteRes = await fetch("/api/post", {
						method: "DELETE",
						headers: {"content-type": "application/json"},
						body: JSON.stringify({uris: [postUri]}),
					})
					if (!deleteRes.ok) {
						const deleteJson = await deleteRes
							.json()
							.catch(() => ({}))
						const msg =
							deleteJson?.error ||
							"Failed to delete Bluesky post."
						saveMessage = `Deleted profile ${targetUuid}. ${msg}`
						return
					}
					saveMessage = `Deleted profile ${targetUuid}.`
				} catch (error) {
					saveMessage = `Deleted profile ${targetUuid}. Error deleting Bluesky post: ${error?.message || "Unknown error."}`
				}
			})()
		} catch (error) {
			deleteError = error?.message || "Unable to delete profile."
		}
	}

	async function recoverProfileFromPost() {
		const postUrl = String(recoveryPostUrl || "").trim()
		if (!postUrl) {
			recoveryError = "Paste a Bsky post URL first."
			recoveryMessage = ""
			return
		}

		recoveryBusy = true
		recoveryError = ""
		recoveryMessage = ""
		try {
			const response = await fetch("/api/recover-profile-from-post", {
				method: "POST",
				headers: {"content-type": "application/json"},
				body: JSON.stringify({postUrl}),
			})
			const result = await response.json().catch(() => ({}))
			if (!response.ok) {
				throw new Error(result?.error || "Unable to recover profile.")
			}

			const bundle = result?.bundle
			const sourceUuid = String(
				result?.source?.uuid ||
					bundle?.combined?.primary?.uuid ||
					bundle?.primary?.uuid ||
					"",
			).trim()
			const hasStoredSourceUuid = sourceUuid
				? Boolean(await readStoredProfileByUuid(sourceUuid))
				: false
			const needsNewUuid = Boolean(
				sourceUuid &&
					(hasStoredSourceUuid ||
						profiles.some(
							(profile) => profile.uuid === sourceUuid,
						)),
			)
			const importUuid =
				needsNewUuid || !sourceUuid ? generateProfileUuid() : sourceUuid
			const rebuilt = await importStoredProfileFromReconstructedBundle(bundle, {
				uuid: importUuid,
				setCurrent: true,
			})
			if (!rebuilt) {
				throw new Error("The recovered bundle could not be imported.")
			}

			await refreshProfiles()
			recoveryPostUrl = ""
			recoveryMessage = needsNewUuid
				? `Recovered into a new local profile ${importUuid}.`
				: `Recovered profile ${importUuid}.`
		} catch (error) {
			recoveryError = error?.message || "Unable to recover profile."
		} finally {
			recoveryBusy = false
		}
	}

	onMount(async () => {
		favoriteTerms = await readFavoriteTerms()
		defaultSearchTerm = await readDefaultSearchTerm()
		await refreshProfiles()
	})
</script>

<svelte:head>
	<title>Settings | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar hideCreateButton={true} />

	<section class="panel">
		<h2>Settings</h2>
		<p class="help">
			Set your defaults once and keep your workflow faster.
		</p>
		{#if saveMessage}
			<p class="saved">{saveMessage}</p>
		{/if}
	</section>

	<section class="panel">
		<h3>Favorite Search Terms</h3>
		<p class="help">Save common searches and reuse them quickly.</p>
		<form
			onsubmit={(event) => {
				event.preventDefault()
				addFavoriteTerm()
			}}
			class="row"
		>
			<input
				type="text"
				bind:value={newFavoriteTerm}
				oninput={(e) => {
					const target = e.currentTarget
					const rawValue = target.value
					const filtered = rawValue.replace(/[^a-zA-Z0-9 ]/g, "")
					if (rawValue !== filtered) {
						const start = target.selectionStart
						const end = target.selectionEnd
						let removedBeforeCursor = 0
						for (let i = 0; i < start; i++) {
							if (/[^a-zA-Z0-9 ]/.test(rawValue[i])) {
								removedBeforeCursor++
							}
						}
						newFavoriteTerm = filtered
						target.value = filtered
						target.setSelectionRange(
							start - removedBeforeCursor,
							end - removedBeforeCursor,
						)
					} else {
						newFavoriteTerm = filtered
					}
				}}
				placeholder="Add a search term (for example: adoption)"
			/>
			<button type="submit">Add</button>
		</form>

		<div class="chips">
			{#each suggestedTerms as term}
				<button
					type="button"
					class="chip ghost"
					onclick={() => addFavoriteTerm(term)}
				>
					+ {term}
				</button>
			{/each}
		</div>

		{#if favoriteTerms.length === 0}
			<p class="empty">No favorites yet.</p>
		{:else}
			<ul class="list">
				{#each favoriteTerms as term}
					<li>
						<span>{term}</span>
						<div class="actions">
							<button
								type="button"
								class="chip"
								onclick={() => {
									defaultSearchTerm = term
									saveDefaultTerm()
								}}>Set default</button
							>
							<button
								type="button"
								class="chip warn"
								onclick={() => removeFavoriteTerm(term)}
							>
								Remove
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="panel">
		<h3>Default Search Term</h3>
		<p class="help">
			Applied automatically when opening the feed and the search box is
			empty.
		</p>
		<div class="row">
			<input
				type="text"
				bind:value={defaultSearchTerm}
				oninput={(e) => {
					const target = e.currentTarget
					const rawValue = target.value
					const filtered = rawValue.replace(/[^a-zA-Z0-9 ]/g, "")
					if (rawValue !== filtered) {
						const start = target.selectionStart
						const end = target.selectionEnd
						let removedBeforeCursor = 0
						for (let i = 0; i < start; i++) {
							if (/[^a-zA-Z0-9 ]/.test(rawValue[i])) {
								removedBeforeCursor++
							}
						}
						defaultSearchTerm = filtered
						target.value = filtered
						target.setSelectionRange(
							start - removedBeforeCursor,
							end - removedBeforeCursor,
						)
					} else {
						defaultSearchTerm = filtered
					}
				}}
				placeholder="Default search term"
			/>
			<button type="button" onclick={saveDefaultTerm}>Save</button>
		</div>
	</section>

	<section class="panel">
		<h3>Profiles</h3>
		<p class="help">Switch current profile or jump to edit/create.</p>
		{#if profiles.length === 0}
			<p class="empty">No profiles found.</p>
			<button
				type="button"
				onclick={() => goto(buildNewProfileEditPath())}
			>
				>Create Profile</button
			>
		{:else}
			<ProfileList
				{profiles}
				currentUuid={currentProfileUuid}
				mode="manager"
				onChoose={chooseProfile}
				onEdit={editProfile}
				onDelete={requestDeleteProfile}
			/>
			<div class="row">
				<button
					type="button"
					onclick={() => goto(buildNewProfileEditPath())}
				>
					Create New Profile</button
				>
			</div>
			<form
				class="row recovery-row"
				onsubmit={(event) => {
					event.preventDefault()
					recoverProfileFromPost()
				}}
			>
				<input
					type="url"
					bind:value={recoveryPostUrl}
					placeholder="Paste a Bsky post URL to recover the profile"
				/>
				<button type="submit" disabled={recoveryBusy}>
					{recoveryBusy ? "Recovering..." : "Recover Profile"}
				</button>
			</form>
			{#if recoveryMessage}
				<p class="saved">{recoveryMessage}</p>
			{/if}
			{#if recoveryError}
				<p class="error">{recoveryError}</p>
			{/if}
		{/if}
	</section>

	<section class="panel">
		<h3>Suggested Next Settings</h3>
		<ul class="suggestions">
			<li>Default feed sort (latest vs top)</li>
			<li>Auto-open last active view (feed/history/bookmarks)</li>
			<li>Default map zoom and radius</li>
			<li>Compact cards mode for dense browsing</li>
		</ul>
	</section>

	{#if deleteTargetUuid}
		<div
			class="modal-overlay"
			role="presentation"
			onclick={cancelDeleteProfile}
		>
			<div
				class="modal-panel"
				role="dialog"
				aria-modal="true"
				tabindex="-1"
				onclick={(event) => event.stopPropagation()}
				onkeydown={(event) => {
					if (event.key === "Escape") cancelDeleteProfile()
				}}
			>
				<h3>Delete Profile Permanently?</h3>
				<p class="help">
					You are deleting <strong>{deleteTargetName}</strong>. This
					permanently deletes the profile post on Bluesky and removes
					this profile from local storage. This cannot be undone.
				</p>
				{#if deleteError}
					<p class="error">{deleteError}</p>
				{/if}
				<div class="modal-actions">
					<button
						type="button"
						class="chip"
						onclick={cancelDeleteProfile}
					>
						Cancel
					</button>
					<button
						type="button"
						class="chip warn"
						onclick={confirmDeleteProfile}
					>
						Delete Permanently
					</button>
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	.page {
		max-width: 980px;
		margin: 0 auto;
		padding: 1rem;
		display: grid;
		gap: 0.85rem;
	}

	.panel {
		background: rgba(255, 250, 241, 0.92);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 0.9rem;
	}

	h2,
	h3 {
		margin: 0;
	}

	.help {
		margin: 0.35rem 0 0.75rem;
		color: #5f665f;
		font-size: 0.9rem;
	}

	.saved {
		margin: 0.45rem 0 0;
		color: #24633f;
		font-size: 0.9rem;
	}

	.error {
		margin: 0.45rem 0 0;
		color: #8e2f21;
		font-size: 0.9rem;
	}

	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	input {
		flex: 1;
		min-width: 220px;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		padding: 0.55rem 0.65rem;
		font: inherit;
	}

	button,
	.chip {
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.4rem 0.75rem;
		font: inherit;
		cursor: pointer;
	}

	.ghost {
		background: #f8f3ea;
	}

	.recovery-row {
		margin-top: 0.75rem;
	}

	.warn {
		border-color: #b53a2b;
		color: #8e2f21;
	}

	.chips {
		display: flex;
		gap: 0.45rem;
		flex-wrap: wrap;
		margin: 0.65rem 0;
	}

	.list,
	.suggestions {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.55rem;
	}

	.list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		border: 1px solid #e2d4c5;
		border-radius: 12px;
		padding: 0.55rem 0.65rem;
	}

	.empty {
		margin: 0.35rem 0 0.7rem;
		color: #6d5f51;
	}

	.suggestions li {
		list-style: disc;
		margin-left: 1.1rem;
	}

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(20, 20, 18, 0.48);
		display: grid;
		place-items: center;
		padding: 1rem;
		z-index: 2000;
	}

	.modal-panel {
		width: min(560px, 100%);
		background: #fffaf1;
		border: 1px solid #d7c8b6;
		border-radius: 14px;
		padding: 1rem;
		display: grid;
		gap: 0.75rem;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	@media (max-width: 760px) {
		.list li {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
