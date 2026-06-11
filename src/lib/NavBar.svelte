<script>
	import {goto} from "$app/navigation"
	import {isLocalHost} from "$lib/utils"
	import ProfileList from "$lib/ProfileList.svelte"
	import HashTagCloud from "$lib/HashTagCloud.svelte"
	import {defaultHashtags} from "$lib/config"
	import {
		buildNewProfileEditPath,
		getCurrentProfileUuid,
		listStoredProfiles,
		setCurrentProfileUuid,
		deleteStoredProfileByUuid,
	} from "$lib/profileRegistry"
	import {
		Menu,
		PawPrint,
		Search,
		Settings,
		Users,
		Pencil,
		Plus,
		User,
		EyeOff,
	} from "lucide-svelte"


	const verifiedProfileUuids = new Set()

	let {
		searchTerm = $bindable(""),
		selectionMenuOpen = $bindable(false),
		showSearch = true,
		onSearchSubmit = () => {},
		onSearchInput = () => {},
		menu,
		editProfileUrl = "",
		hideCreateButton = false,
	} = $props()

	let logoLoaded = $state(true)
	let selectionMenuEl = $state(null)
	let profileMenuEl = $state(null)
	let navProfiles = $state([])
	let navCurrentUuid = $state("")
	let profileMenuOpen = $state(false)
	let deleteAllConfirming = $state(false)
	let deleteAllInProgress = $state(false)

	const navCurrentProfile = $derived(
		navProfiles.find((entry) => entry?.uuid === navCurrentUuid) || null,
	)
	const navAvatarSrc = $derived(String(navCurrentProfile?.avatarUrl || ""))

	async function refreshNavProfiles() {
		const stored = await listStoredProfiles()
		navProfiles = stored
		navCurrentUuid = await getCurrentProfileUuid()

		const now = Date.now()
		for (const profile of stored) {
			if (verifiedProfileUuids.has(profile.uuid)) {
				continue
			}
			// Give newly saved profiles 60 seconds to index on bsky before verifying
			if (profile.savedAt && now - profile.savedAt < 60000) {
				continue
			}
			(async () => {
				try {
					const res = await fetch(`/api/post-by-canonical-url?uuid=${encodeURIComponent(profile.uuid)}`)
					if (res.status === 404) {
						await deleteStoredProfileByUuid(profile.uuid)
						navProfiles = navProfiles.filter(p => p.uuid !== profile.uuid)
						if (navCurrentUuid === profile.uuid) {
							navCurrentUuid = await getCurrentProfileUuid()
						}
					} else if (res.ok) {
						verifiedProfileUuids.add(profile.uuid)
					}
				} catch (err) {
					console.error(`Failed to verify profile ${profile.uuid} in bsky:`, err)
				}
			})()
		}
	}
 
 	function goToProfileChooser() {
 		const count = navProfiles.length
 		if (!navCurrentUuid || count === 0) {
 			goto(buildNewProfileEditPath())
 			return
 		}
 		if (count === 1) {
 			goto(`/profile/edit/${encodeURIComponent(navCurrentUuid)}`)
 			return
 		}
 		profileMenuOpen = !profileMenuOpen
 		selectionMenuOpen = false
 	}
 
 	async function chooseCurrentProfile(uuid = "") {
 		const next = String(uuid || "").trim()
 		if (!next) return
 		await setCurrentProfileUuid(next)
 		navCurrentUuid = next
 		profileMenuOpen = false
 	}

	function openProfileManager() {
		profileMenuOpen = false
		goto("/profile/select")
	}

	function buildSearchPath(term = "") {
		const normalized = String(searchTerm || term || "")
			.replace(/,/g, " ")
			.trim()
			.replace(/\s+/g, " ")
		const segments = normalized
			? normalized
					.split(" ")
					.map((segment) => encodeURIComponent(segment))
					.join("/")
			: ""
		return segments ? `/search/${segments}` : "/search"
	}

	function handleSearchSubmit() {
		if (typeof window !== "undefined") {
			if (window.location.pathname.startsWith("/map")) {
				const normalized = String(searchTerm || "")
					.replace(/,/g, " ")
					.trim()
					.replace(/\s+/g, " ")
				const segments = normalized
					? normalized
							.split(" ")
							.map((segment) => encodeURIComponent(segment))
							.join("/")
					: ""
				const target = segments ? `/map/${segments}` : "/map"
				goto(target)
				onSearchSubmit()
				return
			}
			if (!window.location.pathname.startsWith("/search")) {
				goto(buildSearchPath(searchTerm))
				return
			}
		}
		onSearchSubmit()
	}

	function handleOpenAbout() {
		goto("/about")
	}

	const activeSearchTags = $derived(
		defaultHashtags.filter(tag => {
			const cleanTag = tag.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
			if (!cleanTag) return false
			const cleanSearch = searchTerm.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
			return (" " + cleanSearch + " ").includes(" " + cleanTag + " ")
		})
	)

	function toggleTagInSearch(tag) {
		const cleanTag = tag.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
		if (!cleanTag) return

		const normalizedSearch = searchTerm.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, " ").trim()
		const cleanSearch = normalizedSearch.toLowerCase()

		const paddedSearch = " " + cleanSearch + " "
		const paddedTag = " " + cleanTag + " "

		if (paddedSearch.includes(paddedTag)) {
			const startIndex = paddedSearch.indexOf(paddedTag)
			if (startIndex >= 0) {
				const before = normalizedSearch.slice(0, Math.max(0, startIndex))
				const after = normalizedSearch.slice(startIndex + cleanTag.length)
				searchTerm = (before + " " + after).replace(/\s+/g, " ").trim()
			}
		} else {
			searchTerm = (normalizedSearch + " " + tag.replace(/[^a-zA-Z0-9 ]/g, "")).replace(/\s+/g, " ").trim()
		}
		if (searchInputEl) {
			searchInputEl.focus()
		}
		onSearchInput()
	}

	$effect(() => {
		if (!selectionMenuOpen) return

		const onPointerDown = (event) => {
			if (!selectionMenuEl?.contains(event.target)) {
				selectionMenuOpen = false
			}
		}

		document.addEventListener("pointerdown", onPointerDown)
		return () => {
			document.removeEventListener("pointerdown", onPointerDown)
		}
	})

	$effect(() => {
		if (!profileMenuOpen) return

		const onPointerDown = (event) => {
			if (!profileMenuEl?.contains(event.target)) {
				profileMenuOpen = false
			}
		}

		document.addEventListener("pointerdown", onPointerDown)
		return () => {
			document.removeEventListener("pointerdown", onPointerDown)
		}
	})

	$effect(() => {
		refreshNavProfiles()
		if (typeof window === "undefined") return
		const onStorage = () => refreshNavProfiles()
		window.addEventListener("storage", onStorage)
		window.addEventListener("focus", onStorage)
		return () => {
			window.removeEventListener("storage", onStorage)
			window.removeEventListener("focus", onStorage)
		}
	})

	let isFocused = $state(false)
	let searchInputEl = $state(null)
	let blurTimeout

	function handleFocus() {
		if (blurTimeout) clearTimeout(blurTimeout)
		isFocused = true
	}

	function handleBlur() {
		blurTimeout = setTimeout(() => {
			if (typeof document !== 'undefined' && !document.activeElement?.closest('.search-container')) {
				isFocused = false
			}
		}, 200)
	}

	function focusSearchInput() {
		if (searchInputEl) {
			searchInputEl.focus()
		}
	}
</script>

<nav class="topbar">
	<div class="topbar-left">
		<div class="selection-menu-wrap" bind:this={selectionMenuEl}>
			<button
				class="selection-menu-btn"
				type="button"
				onclick={() => (selectionMenuOpen = !selectionMenuOpen)}
			>
				<Menu size={18} />
			</button>
			{#if selectionMenuOpen}
				<div class="selection-menu">
					{#if menu}
						{@render menu()}
					{:else}
						<button
							type="button"
							onclick={() => {
								goto(buildSearchPath(searchTerm))
								selectionMenuOpen = false
							}}
						>
							<Search size={16} /> Show feed
						</button>
						<button
							type="button"
							onclick={() => {
								goto("/search/blocked")
								selectionMenuOpen = false
							}}
						>
							<EyeOff size={16} /> Show blocked
						</button>
						<div class="menu-sep"></div>
						<button
							type="button"
							onclick={() => {
								handleOpenAbout()
								selectionMenuOpen = false
							}}
						>
							<Users size={16} />About Us</button
						>
						<button type="button" onclick={() => goto("/settings")}
							><Settings size={16} />Settings</button
						>
					{/if}
				</div>
			{/if}
		</div>

		<div
			class="brand"
			role="link"
			tabindex="0"
			onclick={() => goto("/about")}
			onkeydown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault()
					goto("/about")
				}
			}}
		>
			<div class="logo-wrap">
				{#if logoLoaded}
					<img
						class="logo"
						src="/dog-logo.jpg"
						alt="Love4Dogs logo"
						onerror={() => (logoLoaded = false)}
					/>
				{:else}
					<span class="logo-fallback"><PawPrint size={20} /></span>
				{/if}
			</div>
			<div>
				<p class="kicker wide-screen-only">
					Join us! All animals are welcome!
				</p>
				<h1>Love4Dogs, <span class="title-rest"> Cats, etc.</span></h1>
			</div>
		</div>
	</div>

	{#if showSearch}
		<div class="search-container" class:focused={isFocused}>
			<form
				class="search"
				onclick={focusSearchInput}
				onsubmit={(event) => {
					event.preventDefault()
					handleSearchSubmit()
				}}
			>
				<Search size={16} />
				{#if !isFocused}
					<span class="search-placeholder-label">Search</span>
				{/if}
				<input
					bind:this={searchInputEl}
					type="search"
					bind:value={searchTerm}
					onfocus={handleFocus}
					onblur={handleBlur}
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
							searchTerm = filtered
							target.value = filtered
							target.setSelectionRange(
								start - removedBeforeCursor,
								end - removedBeforeCursor,
							)
						} else {
							searchTerm = filtered
						}
						onSearchInput(e)
					}}
					onsearch={onSearchInput}
					placeholder="Search"
				/>
				<button type="submit">Search</button>
			</form>
			<div class="hashtag-cloud-wrapper" class:open={isFocused}>
				<HashTagCloud activeTags={activeSearchTags} onToggle={toggleTagInSearch} />
			</div>
		</div>
	{/if}

	<div class="topbar-links">
		{#if editProfileUrl}
			<a
				class="edit-profile-btn"
				href={editProfileUrl}
				aria-label="Edit Profile"
			>
				<Pencil size={16} /> &nbsp; Edit
			</a>
		{:else if !hideCreateButton}
			<a
				class="post-route-btn"
				href={navCurrentUuid ? "/post/edit" : "/profile/edit"}
				onclick={async (e) => {
					e.preventDefault()
					const current = await getCurrentProfileUuid()
					if (current) {
						goto("/post/edit")
					} else {
						goto("/profile/edit")
					}
				}}
				aria-label="Create Post"
			>
				<Plus size={16} /> &nbsp; Create
			</a>
		{/if}
		<div class="profile-menu-wrap" bind:this={profileMenuEl}>
			<button
				type="button"
				class="profile-avatar-btn"
				onclick={goToProfileChooser}
				aria-label="Choose current profile"
				title="Choose current profile"
			>
				{#if navAvatarSrc}
					<img src={navAvatarSrc} alt="Current profile" />
				{:else}
					<User size={18} />
				{/if}
			</button>
			{#if profileMenuOpen}
				<div class="profile-menu">
					<div class="profile-menu-actions">
						<button type="button" onclick={openProfileManager}>
							Manage 
						</button>
						<button
							type="button"
							onclick={async () => {
								profileMenuOpen = false
								const current = await getCurrentProfileUuid()
								if (current) {
									goto("/post/edit")
								} else {
									goto("/profile/edit")
								}
							}}
						>
							Create 
						</button>
						
					</div>
					<ProfileList
						profiles={navProfiles}
						currentUuid={navCurrentUuid}
						mode="picker"
						onChoose={chooseCurrentProfile}
					/>
					
				</div>
			{/if}
		</div>
	</div>
</nav>

<style>
	.topbar {
		position: sticky;
		top: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
		align-items: center;
		padding: 0.8rem 1rem;
		margin: -1rem 0 1rem;
		width: 100vw;
		width: 100dvw;
		margin-left: calc(50% - 50vw);
		margin-left: calc(50% - 50dvw);
		margin-right: calc(50% - 50vw);
		margin-right: calc(50% - 50dvw);
		background: rgba(246, 240, 230, 0.84);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(96, 71, 49, 0.18);
		border-radius: 0;
		border-left: none;
		border-right: none;
		z-index: 1010;
		box-sizing: border-box;
	}

	@media (max-width: 700px) {
		:global(.page) {
			padding:0 !important;
		}
		.topbar{
			margin:0;
			margin-bottom:1rem;
			width:100%;
			border:0;
			border-radius:12px;
			padding:0;
		}
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		cursor: pointer;
	}

	.topbar-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.selection-menu-wrap {
		position: relative;
	}

	.selection-menu-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 40px;
		width: 40px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
		position: relative;
	}

	.selection-menu {
		position: absolute;
		top: calc(100% + 0.45rem);
		left: 0;
		min-width: 186px;
		background: #fff;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
		padding: 0.4rem;
		z-index: 30;
	}

	.profile-menu-wrap {
		position: relative;
	}

	.profile-menu {
		position: absolute;
		top: calc(100% + 0.45rem);
		right: 0;
		width: min(460px, 94vw);
		max-height: min(70vh, 540px);
		overflow: auto;
		background: #fff;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
		padding: 0.5rem;
		z-index: 40;
	}

	.profile-menu-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.45rem;
		margin-top: 0.5rem;
		margin-bottom: 0.5rem;
	
	}

	.profile-menu-actions button {
		border: 1px solid #d7c8b6;
		background: #fff;
		border-radius: 9px;
		padding: 0.42rem 0.5rem;
		font: inherit;
		cursor: pointer;
	}

	.profile-menu-actions button:hover {
		background: #f3ece1;
	}

	.selection-menu button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.55rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		text-align: left;
		cursor: pointer;
		font: inherit;
	}

	.selection-menu button:hover {
		background: #f3ece1;
	}

	.menu-sep {
		height: 1px;
		background: #e6ddcf;
		margin: 0.35rem 0;
	}

	.logo-wrap {
		position: relative;
		width: 54px;
		height: 54px;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid #8f633f;
		box-shadow: 0 8px 20px rgba(31, 44, 30, 0.25);
		background: #ca8f56;
	}

	.logo {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.logo-fallback {
		position: absolute;
		inset: 0;
		margin: auto;
		color: #f7f2e8;
	}

	.kicker {
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.7rem;
		color: #6f5b47;
	}

	h1 {
		margin: 0.15rem 0 0;
		font-size: 1.35rem;
	}

	.search-container {
		display: flex;
		flex-direction: column;
		width: 100px;
		min-width: 0;
		flex: 0 0 100px;
		max-width: 100%;
		margin-left: auto;
		box-sizing: border-box;
		transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
		            flex 0.35s cubic-bezier(0.4, 0, 0.2, 1),
		            min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.search-container.focused {
		width: min(100%, 470px);
		min-width: min(375px, 100%);
		flex: 1 1 375px;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.85rem;
		border-radius: 999px;
		background: #3b6e4f;
		border: 1px solid #305741;
		color: #fff;
		width: 100%;
		box-sizing: border-box;
		cursor: pointer;
		justify-content: center;
		transition: background 0.35s cubic-bezier(0.4, 0, 0.2, 1),
		            border-color 0.35s cubic-bezier(0.4, 0, 0.2, 1),
		            color 0.35s cubic-bezier(0.4, 0, 0.2, 1),
		            padding 0.35s cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}
	.search-container.focused .search {
		background: #fffdf8;
		border-color: rgba(48, 80, 54, 0.2);
		color: #3b5e47;
		cursor: default;
		justify-content: flex-start;
		padding: 0.4rem 0.55rem;
		box-shadow: none;
	}

	.search-placeholder-label {
		font-weight: 600;
		font-size: 0.88rem;
		user-select: none;
		white-space: nowrap;
	}

	.search input {
		border: none;
		outline: none;
		background: transparent;
		flex: 1;
		font-size: 0.95rem;
		color: inherit;
		transition: width 0.35s ease, opacity 0.2s ease, padding 0.35s ease;
	}
	.search-container:not(.focused) .search input {
		width: 0;
		max-width: 0;
		opacity: 0;
		padding: 0;
		margin: 0;
		pointer-events: none;
	}

	.search :global(svg) {
		color: currentColor;
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}
	.search:hover :global(svg) {
		transform: scale(1.1);
	}

	.search input::placeholder {
		color: #8fa396;
		opacity: 0.8;
		transition: opacity 0.25s ease;
	}
	.search-container:not(.focused) .search input::placeholder {
		opacity: 0.5;
	}

	.search button {
		border: none;
		background: #436f4f;
		color: #fff;
		padding: 0.5rem 0.95rem;
		border-radius: 999px;
		font-weight: 600;
		cursor: pointer;
		opacity: 0;
		visibility: hidden;
		width: 0;
		padding: 0;
		margin: 0;
		overflow: hidden;
		pointer-events: none;
		transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
		            transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
		            width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
		            padding 0.25s cubic-bezier(0.4, 0, 0.2, 1),
		            margin 0.25s cubic-bezier(0.4, 0, 0.2, 1),
		            visibility 0.25s;
		transform: scale(0.8);
		flex-shrink: 0;
	}
	.search-container.focused .search button {
		opacity: 1;
		visibility: visible;
		width: auto;
		padding: 0.5rem 0.95rem;
		pointer-events: auto;
		transform: scale(1);
	}

	.hashtag-cloud-wrapper {
		max-height: 0;
		opacity: 0;
		transform: translateY(-8px);
		overflow: hidden;
		transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
		            opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
		            transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
		            margin-top 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		margin-top: 0;
		pointer-events: none;
	}
	.hashtag-cloud-wrapper.open {
		max-height: 300px;
		opacity: 1;
		transform: translateY(0);
		margin-top: 0.45rem;
		pointer-events: auto;
	}

	.post-route-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 40px;
		padding: 0 1rem;
		border-radius: 999px;
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		font-weight: 600;
		text-decoration: none;
	}

	.edit-profile-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 40px;
		padding: 0 1rem;
		border-radius: 999px;
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		font-weight: 600;
		text-decoration: none;
	}

	.topbar-links {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.profile-avatar-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		padding: 0;
		border-radius: 999px;
		border: 1px solid #305741;
		background: #fff;
		color: #305741;
		overflow: hidden;
		cursor: pointer;
	}

	.profile-avatar-btn img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.wide-screen-only {
		display: revert;
	}

	@media (max-width: 600px) {
		.wide-screen-only {
			display: none;
		}
	}

	@media (max-width: 960px) {
		.topbar {
			display: grid;
			grid-template-columns: 1fr auto;
			align-items: center;
			gap: 0.75rem 0.5rem;
			width: 100%;
			margin-left: 0;
			margin-right: 0;
			padding: 0.8rem 0.5rem;
		}

		.title-rest {
			display: block;
		}

		.topbar-left {
			grid-row: 1;
			grid-column: 1;
			order: unset;
		}

		.topbar-links {
			grid-row: 1;
			grid-column: 2;
			position: static;
			width: auto;
			display: flex;
			align-items: center;
			gap: 0.6rem;
		}

		.search-container {
			grid-row: 2;
			grid-column: 1 / span 2;
			width: 100%;
			min-width: 0;
			flex-basis: auto;
		}

		.post-route-btn {
			width: 40px;
			height: 40px;
			padding: 0;
			font-size: 0;
		}

		.post-route-btn::before {
			/* content: "+"; */
			font-size: 1.45rem;
			line-height: 1;
			font-weight: 700;
		}

		.edit-profile-btn {
			width: 40px;
			height: 40px;
			padding: 0;
			font-size: 0;
		}

		.edit-profile-btn::before {
			content: "✎";
			font-size: 1.2rem;
			line-height: 1;
		}
	}

	@media (max-width: 480px) {
		.logo-wrap {
			width: 42px;
			height: 42px;
		}

		h1 {
			font-size: 1.15rem;
		}

		.selection-menu-btn,
		.profile-avatar-btn,
		.post-route-btn,
		.edit-profile-btn {
			width: 36px;
			height: 36px;
		}
	}
</style>
