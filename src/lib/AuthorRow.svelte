<script>
	import {User} from "lucide-svelte"
	import DateTime from "$lib/DateTime.svelte"

	let {
		avatar = null,
		name = "Anonymous",
		date = null,
		dateValue = "",
		dateMode = "relative",
		dateAllowBase36 = false,
		href = null,
		location = null,
		locationHref = null,
		hideAvatar = false,
		compact = false,
	} = $props()
</script>

<div
	class="author-row{hideAvatar ? ' no-avatar' : ''}{compact
		? ' compact'
		: ''}"
>
	{#if !hideAvatar}
		<div class="author-media">
			{#if avatar}
				<img src={avatar} alt={name} class="author-avatar" />
			{:else}
				<span class="author-icon" aria-hidden="true">
					<User size={16} />
				</span>
			{/if}
		</div>
	{/if}

	<div class="author-meta">
		{#if href && String(name || "")
				.trim()
				.toLowerCase() !== "anonymous"}
			<a class="author-info" {href}>
				<div class="author-name">{name}</div>
			</a>
		{:else}
			<div class="author-info">
				<div class="author-name">{name}</div>
			</div>
		{/if}

		{#if dateValue}
			<div class="date-time">
				<DateTime
					tag="span"
					value={dateValue}
					mode={dateMode}
					allowBase36={dateAllowBase36}
					fallback={date || ""}
					fallbackToInput={dateAllowBase36}
				/>
			</div>
		{:else if date}
			<div class="date-time">{date}</div>
		{/if}

		{#if location}
			<div class="location-actions">
				{#if locationHref}
					<a
						class="map-link"
						href={locationHref}
						target="_blank"
						rel="noreferrer"
					>
						{location}
					</a>
				{:else}
					<span class="map-link-text">{location}</span>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* ── author row ─────────────────────────────────────────────────────── */
	.author-row {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: start;
		gap: 0.9rem;
	}

	.author-row.compact {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.4rem;
	}

	.author-row.no-avatar {
		grid-template-columns: 1fr;
		margin-left: calc(
			clamp(0.65rem, 1.8vw, 0.9rem) + clamp(76px, 12vw, 128px) +
				clamp(0.55rem, 1.4vw, 0.9rem)
		);
	}

	.author-row.compact.no-avatar {
		margin-left: 0;
	}

	@media (max-width: 600px) {
		.author-row.no-avatar {
			margin-left: 0;
		}
	}

	.author-media {
		padding-top: 0.9rem;
		flex-shrink: 0;
	}

	.author-row.compact .author-media {
		padding-top: 0;
	}

	.author-info {
		display: inline-block;
		padding-top: 0.9rem;
		text-decoration: none;
		color: inherit;
	}

	.author-row.compact .author-info {
		padding-top: 0;
		display: block;
	}

	.author-row.no-avatar .author-info {
		padding-top: 0;
	}

	.author-info:hover .author-name,
	.author-info:focus-visible .author-name {
		text-decoration: underline;
	}

	.author-avatar {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid rgba(58, 91, 65, 0.24);
		box-shadow: 0 6px 18px rgba(65, 42, 20, 0.08);
		margin-left: 0.2rem;
	}

	.author-row.compact .author-avatar {
		width: 3rem;
		height: 3rem;
		border: 2px solid rgba(0, 0, 0, 0.1);
		box-shadow: none;
	}

	.author-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		box-sizing: border-box;
		border-radius: 50%;
		border: 1px solid rgba(58, 91, 65, 0.24);
		background: rgba(255, 255, 255, 0.72);
		box-shadow: 0 6px 18px rgba(65, 42, 20, 0.08);
		color: #5f665f;
		margin-left: 0.2rem;
	}

	.author-row.compact .author-icon {
		width: 3rem;
		height: 3rem;
		border: 2px solid rgba(0, 0, 0, 0.1);
		background: #e8dccf;
		color: #5d4e42;
		box-shadow: none;
	}

	.author-row.compact .author-icon :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}

	.author-meta {
		display: grid;
		gap: 0.15rem;
		min-width: 0;
	}

	.author-row.compact .author-meta {
		flex: 1;
	}

	.author-name {
		margin: 0;
		font-size: clamp(1.05rem, 2vw, 1.3rem);
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: -0.01em;
		color: #2f4336;
		display: block;
		white-space: nowrap;
	}

	.author-row.compact .author-name {
		font-size: 0.85rem;
		color: #1f1f1f;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		white-space: normal;
	}

	.date-time {
		margin: 0;
		font-size: clamp(0.8rem, 1.6vw, 0.95rem);
		color: #666;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.author-row.compact .date-time {
		font-size: 0.75rem;
		color: #999;
		margin: 0 0 0 1rem;
	}

	.location-actions {
		margin: 0;
	}

	.map-link {
		display: inline-block;
		font-size: clamp(0.8rem, 1.6vw, 0.95rem);
		color: #3a5b41;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: pre-line;
	}

	.map-link:hover {
		text-decoration: underline;
	}

	.map-link-text {
		display: inline-block;
		font-size: clamp(0.8rem, 1.6vw, 0.95rem);
		color: #3a5b41;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: pre-line;
	}

	.author-row.compact .map-link,
	.author-row.compact .map-link-text {
		font-size: 0.75rem;
	}
</style>
