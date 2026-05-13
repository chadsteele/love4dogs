<script>
	let {
		profiles = [],
		currentUuid = "",
		mode = "picker", // "picker" | "manager"
		onChoose = () => {},
		onEdit = () => {},
		onDelete = () => {},
	} = $props()

	function formatCreatedAt(value) {
		const timestamp = Number(value || 0)
		if (!Number.isFinite(timestamp) || timestamp <= 0) return "unknown"
		return new Date(timestamp).toLocaleString()
	}
</script>

<ul class="profile-list">
	{#each profiles as profile}
		<li class:current={profile.uuid === currentUuid}>
			{#if mode === "picker"}
				<button
					type="button"
					class="profile-row"
					onclick={() => onChoose(profile.uuid)}
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
						<strong>{profile.name || "Untitled profile"}</strong>

						<small class="created-at"
							>created {formatCreatedAt(profile.savedAt)}</small
						>
					</div>
					{#if profile.uuid === currentUuid}
						<span class="badge">Current</span>
					{/if}
				</button>
			{:else}
				<div class="profile-main">
					{#if profile.avatarUrl}
						<img
							src={profile.avatarUrl}
							alt={profile.name || "Profile"}
						/>
					{:else}
						<span class="avatar-fallback">P</span>
					{/if}
					<div class="meta">
						<strong>{profile.name || "Untitled profile"}</strong>

						<small class="created-at"
							>created {formatCreatedAt(profile.savedAt)}</small
						>
					</div>
				</div>
				<div class="actions">
					{#if profile.uuid !== currentUuid}
						<button
							type="button"
							class="chip"
							onclick={() => onChoose(profile.uuid)}
						>
							Set current
						</button>
					{:else}
						<span class="chip current-badge">Current</span>
					{/if}
					<button
						type="button"
						class="chip"
						onclick={() => onEdit(profile.uuid)}
					>
						Edit
					</button>
					<button
						type="button"
						class="chip chip-danger"
						onclick={() => onDelete(profile.uuid)}
					>
						Delete
					</button>
				</div>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.profile-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.65rem;
	}

	.profile-list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		border: 1px solid #e2d4c5;
		border-radius: 12px;
		padding: 0.55rem 0.65rem;
	}

	.profile-list li.current {
		border-color: #3b6e4f;
		background: #f3f8f4;
	}

	.profile-row {
		width: 100%;
		display: grid;
		grid-template-columns: 44px 1fr auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.25rem;
		border-radius: 12px;
		border: 0;
		background: transparent;
		cursor: pointer;
		text-align: left;
	}

	.profile-main {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
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

	small {
		display: block;
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

	.actions {
		display: flex;
		gap: 0.45rem;
		align-items: center;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.chip {
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.4rem 0.75rem;
		font: inherit;
		cursor: pointer;
	}

	.current-badge {
		border-color: #3b6e4f;
		background: #3b6e4f;
		color: #fff;
	}

	.chip-danger {
		border-color: #b53a2b;
		color: #8e2f21;
	}

	@media (max-width: 760px) {
		.profile-list li {
			flex-direction: column;
			align-items: flex-start;
		}

		.actions {
			justify-content: flex-start;
		}
	}
</style>
