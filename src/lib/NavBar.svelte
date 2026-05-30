<script>
	import {goto} from "$app/navigation"
	import {isLocalHost} from "$lib/utils"
	import ProfileList from "$lib/ProfileList.svelte"
	import {
		buildNewProfileEditPath,
		getCurrentProfileUuid,
		listStoredProfiles,
		setCurrentProfileUuid,
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
	} from "lucide-svelte"

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

	function refreshNavProfiles() {
		navProfiles = listStoredProfiles()
		navCurrentUuid = getCurrentProfileUuid()
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

	function chooseCurrentProfile(uuid = "") {
		const next = String(uuid || "").trim()
		if (!next) return
		setCurrentProfileUuid(next)
		navCurrentUuid = next
		profileMenuOpen = false
	}

	function openProfileManager() {
		profileMenuOpen = false
		goto("/profile/select")
	}

	function buildSearchPath(term = "") {
		const normalized = String(searchTerm || term || "")
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
		if (
			typeof window !== "undefined" &&
			!window.location.pathname.startsWith("/search")
		) {
			goto(buildSearchPath(searchTerm))
			return
		}
		onSearchSubmit()
	}

	function handleOpenAbout() {
		goto("/about")
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
		<form
			class="search"
			onsubmit={(event) => {
				event.preventDefault()
				handleSearchSubmit()
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
		{#if editProfileUrl}
			<a
				class="edit-profile-btn"
				href={editProfileUrl}
				aria-label="Edit Profile"
			>
				<Pencil size={16} /> &nbsp; Edit
			</a>
		{:else if !hideCreateButton}
			<a class="post-route-btn" href="/post" aria-label="Create Post">
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
					<ProfileList
						profiles={navProfiles}
						currentUuid={navCurrentUuid}
						mode="picker"
						onChoose={chooseCurrentProfile}
					/>
					<div class="profile-menu-actions">
						<button type="button" onclick={openProfileManager}>
							Manage profiles
						</button>
						<button
							type="button"
							onclick={() => {
								profileMenuOpen = false
								goto(buildNewProfileEditPath())
							}}
						>
							Create profile
						</button>
					</div>
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
		padding-top: 0.5rem;
		border-top: 1px solid #e6ddcf;
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
</style>
