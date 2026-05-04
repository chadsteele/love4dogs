<script>
	import {goto} from "$app/navigation"
	import {
		Menu,
		PawPrint,
		Search,
		Trash2,
		Settings,
		Users,
		AlertOctagon,
	} from "lucide-svelte"
	import {slide} from "svelte/transition"
	import HashTagCloud from "$lib/HashTagCloud.svelte"

	let {
		searchTerm = $bindable(""),
		selectedCount = 0,
		selectionMenuOpen = false,
		currentView = "feed",
		recentTags = [],
		tagCloudSignal = 0,
		bookmarkedCount = 0,
		trashedCount = 0,
		onToggleMenu = () => {},
		onSetView = () => {},
		onSelectionAction = () => {},
		onOpenAbout = () => {},
		showLocalDelete = false,
		onSearchSubmit = () => {},
		onSearchInput = () => {},
	} = $props()

	let logoLoaded = $state(true)
	let searchFocused = $state(false)
	let cloudPinnedBySignal = $state(false)
	let cloudHadSearchFocus = $state(false)
	let lastTagCloudSignal = 0
	let selectionMenuEl = $state(null)
	let searchBlurTimer = null

	$effect(() => {
		if (tagCloudSignal === lastTagCloudSignal) return
		lastTagCloudSignal = tagCloudSignal
		cloudPinnedBySignal = true
		cloudHadSearchFocus = false
	})

	$effect(() => {
		if (!selectionMenuOpen) return

		const onPointerDown = (event) => {
			if (!selectionMenuEl?.contains(event.target)) {
				onToggleMenu()
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
				onclick={onToggleMenu}
			>
				<Menu size={18} />
				{#if selectedCount > 0}
					<span class="selected-count">{selectedCount}</span>
				{/if}
			</button>
			{#if selectionMenuOpen}
				<div class="selection-menu">
					<button
						type="button"
						class:is-active={currentView === "feed"}
						onclick={() => onSetView("feed")}
					>
						<Search size={16} /> Show feed
					</button>
					{#if bookmarkedCount > 0}
						<button
							type="button"
							class:is-active={currentView === "bookmarks"}
							onclick={() => onSetView("bookmarks")}
						>
							<PawPrint size={16} /> Show favorites
						</button>
					{/if}
					{#if trashedCount > 0}
						<button
							type="button"
							class:is-active={currentView === "trash"}
							onclick={() => onSetView("trash")}
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

					{#if showLocalDelete && selectedCount > 0}
						<button
							type="button"
							onclick={() => onSelectionAction("deleteRemote")}
						>
							<AlertOctagon size={16} /> Remove permanently
						</button>
					{/if}

					<div class="menu-sep"></div>
					<button
						type="button"
						onclick={() => {
							onOpenAbout()
							onToggleMenu()
						}}
					>
						<Users size={16} />About Us</button
					>
					<button type="button" onclick={() => goto("/settings")}
						><Settings size={16} />Settings</button
					>
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
				<p class="kicker">Join us!</p>
				<h1>Love4Dogs</h1>
			</div>
		</div>
	</div>

	<form
		class="search"
		onsubmit={(event) => {
			event.preventDefault()
			onSearchSubmit()
		}}
		onfocusin={() => {
			if (searchBlurTimer) {
				clearTimeout(searchBlurTimer)
				searchBlurTimer = null
			}
			searchFocused = true
			cloudHadSearchFocus = true
		}}
		onfocusout={(event) => {
			const nextTarget = event.relatedTarget
			if (nextTarget && event.currentTarget.contains(nextTarget)) return
			const searchForm = event.currentTarget
			if (searchBlurTimer) clearTimeout(searchBlurTimer)
			searchBlurTimer = setTimeout(() => {
				if (searchForm?.contains(document.activeElement)) return
				searchFocused = false
				if (cloudHadSearchFocus) {
					cloudPinnedBySignal = false
					cloudHadSearchFocus = false
				}
				searchBlurTimer = null
			}, 0)
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

	<div class="topbar-links">
		<a class="post-route-btn" href="/post" aria-label="Create Post"
			>+ Create</a
		>
	</div>
	{#if searchFocused || cloudPinnedBySignal}
		<div class="topnav-cloud" transition:slide={{duration: 170, axis: "y"}}>
			<HashTagCloud bind:draft={searchTerm} feedTags={recentTags} />
		</div>
	{/if}
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

	.topnav-cloud {
		order: 4;
		flex-basis: 100%;
		width: 100%;
		margin-top: -0.45rem;
		padding: 0.55rem 0.65rem 0.65rem;
		max-height: 33vh;
		overflow-y: auto;
		/* border-radius: 12px;
		border: 1px solid rgba(151, 120, 71, 0.25);
		background: linear-gradient(180deg, #fffdf9 0%, #f7f0e5 100%);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55); */
	}

	.topnav-cloud :global(.tag-cloud) {
		margin-top: 0;
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

	.topbar-links {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	@media (max-width: 900px) {
		.topbar-left {
			order: 1;
		}

		.topbar-links {
			order: 2;
			width: auto;
			margin-left: auto;
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
			content: "+";
			font-size: 1.45rem;
			line-height: 1;
			font-weight: 700;
		}
	}
</style>
