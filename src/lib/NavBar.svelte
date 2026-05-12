<script>
	import {onMount} from "svelte"
	import {goto} from "$app/navigation"
	import {isLocalHost} from "$lib/utils"
	import {
		getCurrentProfileUuid,
		listStoredProfiles,
		setCurrentProfileUuid,
	} from "$lib/profileRegistry"
	import {
		Menu,
		History,
		PawPrint,
		Search,
		Trash2,
		Settings,
		Users,
		AlertOctagon,
		Shield,
		Pencil,
		Check,
		UserCircle2,
	} from "lucide-svelte"

	let {
		searchTerm = $bindable(""),
		selectedCount = 0,
		selectionMenuOpen = $bindable(false),
		currentView = "feed",
		historyCount = 0,
		bookmarkedCount = 0,
		trashedCount = 0,
		onSetView = () => {},
		onSelectionAction = () => {},
		onOpenAbout = () => {},
		showSearch = false,
		onSearchSubmit = () => {},
		onSearchInput = () => {},
		menu,
		editProfileUrl = "",
		hideCreateButton = false,
	} = $props()

	let logoLoaded = $state(true)
	let selectionMenuEl = $state(null)
	let profileMenuEl = $state(null)
	let profileMenuOpen = $state(false)
	let storedProfiles = $state([])
	let currentProfileUuid = $state("")

	function refreshStoredProfiles() {
		storedProfiles = listStoredProfiles()
		currentProfileUuid = getCurrentProfileUuid()
	}

	function profileName(entry = {}) {
		const cleanedName = String(entry?.name || "").trim()
		if (cleanedName) return cleanedName
		return `Profile ${String(entry?.uuid || "").slice(0, 8)}`
	}

	const currentProfile = $derived.by(() => {
		if (!storedProfiles.length) return null
		return (
			storedProfiles.find((entry) => entry.uuid === currentProfileUuid) ||
			storedProfiles[0]
		)
	})

	function openProfileEditor(uuid = "") {
		const target = String(uuid || "").trim()
		if (!target) return
		goto(`/post/edit/${encodeURIComponent(target)}`)
	}

	function handleProfileButton() {
		if (!currentProfile) {
			goto("/post/edit")
			return
		}
		if (storedProfiles.length <= 1) {
			openProfileEditor(currentProfile.uuid)
			return
		}
		profileMenuOpen = !profileMenuOpen
	}

	function handleSwitchProfile(uuid = "") {
		const target = String(uuid || "").trim()
		if (!target) return
		setCurrentProfileUuid(target)
		currentProfileUuid = target
		profileMenuOpen = false
	}

	onMount(() => {
		refreshStoredProfiles()
		const onStorage = () => {
			refreshStoredProfiles()
		}
		window.addEventListener("storage", onStorage)
		return () => {
			window.removeEventListener("storage", onStorage)
		}
	})

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
				{#if selectedCount > 0}
					<span class="selected-count">{selectedCount}</span>
				{/if}
			</button>
			{#if selectionMenuOpen}
				<div class="selection-menu">
					{#if menu}
						{@render menu()}
					{:else}
						{#if isLocalHost() && currentView !== "admin"}
							<button
								type="button"
								class:is-active={currentView === "admin"}
								onclick={() => {
									onSetView("admin")
									selectionMenuOpen = false
								}}
							>
								<Shield size={16} /> Admin
							</button>
						{/if}
						<button
							type="button"
							class:is-active={currentView === "feed"}
							onclick={() => {
								onSetView("feed")
								selectionMenuOpen = false
							}}
						>
							<Search size={16} /> Show feed
						</button>
						{#if historyCount > 0}
							<button
								type="button"
								class:is-active={currentView === "history"}
								onclick={() => {
									onSetView("history")
									selectionMenuOpen = false
								}}
							>
								<History size={16} /> Show history
							</button>
						{/if}
						{#if bookmarkedCount > 0}
							<button
								type="button"
								class:is-active={currentView === "bookmarks"}
								onclick={() => {
									onSetView("bookmarks")
									selectionMenuOpen = false
								}}
							>
								<PawPrint size={16} /> Show favorites
							</button>
						{/if}
						{#if trashedCount > 0}
							<button
								type="button"
								class:is-active={currentView === "trash"}
								onclick={() => {
									onSetView("trash")
									selectionMenuOpen = false
								}}
							>
								<Trash2 size={16} /> Show trash
							</button>
						{/if}

						{#if selectedCount > 0}
							<div class="menu-sep"></div>
						{/if}

						{#if selectedCount > 0 && currentView === "feed"}
							<button
								type="button"
								onclick={() => onSelectionAction("bookmark")}
							>
								<PawPrint size={16} /> Favorite selected
							</button>
							<button
								type="button"
								onclick={() => onSelectionAction("trash")}
							>
								<Trash2 size={16} /> Delete selected
							</button>
						{/if}

						{#if selectedCount > 0 && currentView === "trash"}
							<button
								type="button"
								onclick={() => onSelectionAction("restore")}
							>
								<Trash2 size={16} /> Restore selected
							</button>
						{/if}

						{#if selectedCount > 0 && currentView === "bookmarks"}
							<button
								type="button"
								onclick={() => onSelectionAction("unbookmark")}
							>
								<PawPrint size={16} /> Remove favorite
							</button>
						{/if}

						{#if isLocalHost() && selectedCount > 0}
							<button
								type="button"
								onclick={() =>
									onSelectionAction("deleteRemote")}
							>
								<AlertOctagon size={16} /> Remove permanently
							</button>
						{/if}

						<div class="menu-sep"></div>
						<button
							type="button"
							onclick={() => {
								onOpenAbout()
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

		<div class="brand">
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
		<form
			class="search"
			onsubmit={(event) => {
				event.preventDefault()
				onSearchSubmit()
			}}
		>
			<Search size={18} />
			<input
				type="search"
				bind:value={searchTerm}
				oninput={onSearchInput}
				onsearch={onSearchInput}
				placeholder="Search"
			/>
			<button type="submit">Search</button>
		</form>
	{/if}

	<div class="topbar-links">
		<div class="profile-menu-wrap" bind:this={profileMenuEl}>
			<button
				type="button"
				class="profile-avatar-btn"
				onclick={handleProfileButton}
				aria-label="Profile"
				title={!currentProfile
					? "Create your first profile"
					: storedProfiles.length > 1
						? "Switch or edit profiles"
						: "Edit profile"}
			>
				{#if currentProfile?.profilePic}
					<img
						src={currentProfile.profilePic}
						alt={profileName(currentProfile)}
					/>
				{:else}
					<UserCircle2 size={22} />
				{/if}
			</button>

			{#if profileMenuOpen && storedProfiles.length > 1}
				<div class="profile-menu">
					{#each storedProfiles as profile (profile.uuid)}
						<div class="profile-menu-row">
							<button
								type="button"
								class="profile-switch-btn"
								onclick={() =>
									handleSwitchProfile(profile.uuid)}
							>
								{#if profile.profilePic}
									<img
										class="profile-thumb"
										src={profile.profilePic}
										alt={profileName(profile)}
									/>
								{:else}
									<UserCircle2 size={18} />
								{/if}
								<span>{profileName(profile)}</span>
								{#if profile.uuid === currentProfileUuid}
									<Check size={14} />
								{/if}
							</button>
							<button
								type="button"
								class="profile-edit-btn"
								onclick={() => {
									profileMenuOpen = false
									openProfileEditor(profile.uuid)
								}}
							>
								<Pencil size={14} />
							</button>
						</div>
					{/each}
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
		z-index: 10;
		box-sizing: border-box;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.topbar-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.selection-menu-wrap {
		position: relative;
	}

	.profile-menu-wrap {
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

	.selection-menu button.is-active {
		background: #e9f0ea;
		font-weight: 600;
	}

	.selection-menu button:hover {
		background: #f3ece1;
	}

	.menu-sep {
		height: 1px;
		background: #e6ddcf;
		margin: 0.35rem 0;
	}

	.selected-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.24);
		font-size: 0.8rem;
		position: absolute;
		top: -5px;
		right: -6px;
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

	.search {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.55rem;
		border-radius: 999px;
		background: #fffdf8;
		border: 1px solid rgba(48, 80, 54, 0.2);
		width: min(100%, 470px);
		min-width: min(375px, 100%);
		flex: 1 1 375px;
		max-width: 100%;
		box-sizing: border-box;
	}

	.search input {
		border: none;
		outline: none;
		background: transparent;
		flex: 1;
		font-size: 0.95rem;
	}

	.search button {
		border: none;
		background: #436f4f;
		color: #fff;
		padding: 0.5rem 0.95rem;
		border-radius: 999px;
		font-weight: 600;
		cursor: pointer;
	}

	.profile-avatar-btn {
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
		cursor: pointer;
		overflow: hidden;
	}

	.profile-avatar-btn img {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
		border: none;
	}

	.profile-menu {
		position: absolute;
		top: calc(100% + 0.45rem);
		right: 0;
		min-width: 240px;
		background: #fff;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
		padding: 0.4rem;
		z-index: 30;
	}

	.profile-menu-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.35rem;
		align-items: center;
		padding: 0.2rem 0;
	}

	.profile-switch-btn {
		width: 100%;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.5rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font: inherit;
	}

	.profile-switch-btn:hover {
		background: #f3ece1;
	}

	.profile-thumb {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		object-fit: cover;
	}

	.profile-edit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: 1px solid #d7c8b6;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
	}

	.profile-edit-btn:hover {
		background: #f3ece1;
	}

	.topbar-links {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.wide-screen-only {
		display: revert;
	}

	@media (max-width: 600px) {
		.wide-screen-only {
			display: none;
		}
	}

	@media (max-width: 900px) {
		.title-rest {
			display: block;
		}

		.topbar-left {
			order: 1;
		}

		.topbar-links {
			position: absolute;
			top: 0.8rem;
			right: 1rem;
			width: auto;
			align-items: center;
			gap: 0.85rem;
		}

		.search {
			order: 3;
			width: 100%;
			min-width: min(375px, 100%);
			flex-basis: 100%;
		}

		.profile-menu {
			right: -0.5rem;
			min-width: min(88vw, 260px);
		}
	}
</style>
