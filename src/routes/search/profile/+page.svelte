<script>
	import { goto } from "$app/navigation"
	import NavBar from "$lib/NavBar.svelte"
	import { importStoredProfileFromReconstructedBundle } from "$lib/profileRegistry"
	import { CircleAlert, CheckCircle2 } from "lucide-svelte"

	let postUrl = $state("")
	let loading = $state(false)
	let errorMsg = $state("")
	let successProfile = $state(null)

	async function handleRecover(e) {
		e.preventDefault()
		const url = String(postUrl || "").trim()
		if (!url) {
			errorMsg = "Please enter a Bluesky post URL."
			return
		}

		loading = true
		errorMsg = ""
		successProfile = null

		try {
			const res = await fetch("/api/recover-profile-from-post", {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ postUrl: url }),
			})

			const json = await res.json()
			if (!res.ok) {
				throw new Error(json.error || "Failed to recover profile.")
			}

			const imported = await importStoredProfileFromReconstructedBundle(json.bundle, {
				setCurrent: true,
			})

			if (!imported) {
				throw new Error("Unable to reconstruct profile bundle.")
			}

			successProfile = {
				uuid: imported.uuid,
				name: imported.registryEntry?.name || "Untitled Profile",
				avatarUrl: imported.registryEntry?.avatarUrl || "",
			}
		} catch (err) {
			errorMsg = err.message || "An unexpected error occurred."
		} finally {
			loading = false
		}
	}
</script>

<svelte:head>
	<title>Recover Profile | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar />

	<section class="panel">
		<div class="panel-header">
			<h2>Find & Recover Lost Profile</h2>
		</div>
		<p class="help">
			If you lost your profile locally but it is published on Bluesky, enter the URL of any post in your profile thread below to recover it.
		</p>

		{#if successProfile}
			<div class="success-card">
				<CheckCircle2 size={32} class="success-icon" />
				<h3>Profile Successfully Recovered!</h3>
				
				<div class="profile-preview">
					{#if successProfile.avatarUrl}
						<img src={successProfile.avatarUrl} alt={successProfile.name} />
					{:else}
						<div class="avatar-fallback">P</div>
					{/if}
					<div class="meta">
						<strong>{successProfile.name}</strong>
						<small>UUID: {successProfile.uuid}</small>
					</div>
				</div>

				<div class="actions">
					<button
						type="button"
						class="btn-primary"
						onclick={() => goto(`/profile/edit/${successProfile.uuid}`)}
					>
						Edit Profile
					</button>
					<button
						type="button"
						class="btn-secondary"
						onclick={() => goto("/profile/select")}
					>
						Select Profile
					</button>
				</div>
			</div>
		{:else}
			<form onsubmit={handleRecover} class="recover-form">
				<div class="form-group">
					<label for="post-url">Bluesky Post URL</label>
					<input
						id="post-url"
						type="url"
						placeholder="https://bsky.app/profile/username.bsky.social/post/..."
						bind:value={postUrl}
						disabled={loading}
						required
					/>
				</div>

				{#if errorMsg}
					<div class="error-banner">
						<CircleAlert size={20} />
						<span>{errorMsg}</span>
					</div>
				{/if}

				<button type="submit" class="submit-btn" disabled={loading}>
					{#if loading}
						<span class="spinner"></span> Recovering...
					{:else}
						Recover Profile
					{/if}
				</button>
			</form>
		{/if}
	</section>
</main>

<style>
	.page {
		max-width: 760px;
		margin: 0 auto;
		padding: 1.1rem;
	}

	.panel {
		background: #fff;
		border: 1px solid #dfd3c4;
		border-radius: 16px;
		padding: 1.75rem;
		box-shadow: 0 10px 25px rgba(96, 71, 49, 0.08);
	}

	h2 {
		margin: 0 0 0.5rem;
		color: #3b3026;
		font-family: 'Outfit', system-ui, sans-serif;
	}

	.help {
		margin: 0 0 1.5rem;
		color: #6d5f51;
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.recover-form {
		display: grid;
		gap: 1.25rem;
	}

	.form-group {
		display: grid;
		gap: 0.45rem;
	}

	.form-group label {
		font-weight: 600;
		color: #5c4e40;
		font-size: 0.9rem;
	}

	.form-group input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem 1rem;
		border: 1px solid #d7c8b6;
		border-radius: 10px;
		font-size: 0.95rem;
		background: #fffdfb;
		color: #3b3026;
		outline: none;
		transition: all 0.15s ease;
	}

	.form-group input:focus {
		border-color: #3b6e4f;
		background: #fff;
		box-shadow: 0 0 0 3px rgba(59, 110, 79, 0.15);
	}

	.submit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: #3b6e4f;
		border: 1px solid #305741;
		color: #fff;
		font-weight: 600;
		border-radius: 10px;
		padding: 0.75rem 1.5rem;
		font-size: 0.98rem;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.submit-btn:hover:not(:disabled) {
		background: #305741;
	}

	.submit-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: #fdf2f2;
		border: 1px solid #f8b4b4;
		border-radius: 10px;
		padding: 0.75rem 1rem;
		color: #9b1c1c;
		font-size: 0.9rem;
	}

	.error-banner :global(svg) {
		flex-shrink: 0;
	}

	.success-card {
		display: grid;
		gap: 1.25rem;
		justify-items: center;
		text-align: center;
		padding: 1.5rem;
		background: #f4faf6;
		border: 1px solid #def7ec;
		border-radius: 12px;
	}

	.success-icon {
		color: #0e9f6e;
	}

	.success-card h3 {
		margin: 0;
		color: #03543f;
		font-size: 1.25rem;
	}

	.profile-preview {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: #fff;
		border: 1px solid #def7ec;
		border-radius: 12px;
		padding: 0.75rem 1.25rem;
		width: 100%;
		max-width: 400px;
		text-align: left;
		box-sizing: border-box;
	}

	.profile-preview img,
	.avatar-fallback {
		width: 48px;
		height: 48px;
		border-radius: 50%;
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

	.meta strong {
		color: #3b3026;
		font-size: 1rem;
	}

	.meta small {
		color: #857666;
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		width: 100%;
		justify-content: center;
	}

	.btn-primary {
		background: #3b6e4f;
		border: 1px solid #305741;
		color: #fff;
		font-weight: 600;
		border-radius: 999px;
		padding: 0.5rem 1.25rem;
		cursor: pointer;
		font-size: 0.9rem;
		transition: background 0.15s ease;
	}

	.btn-primary:hover {
		background: #305741;
	}

	.btn-secondary {
		background: #fff;
		border: 1px solid #bdad9e;
		color: #5c4e40;
		font-weight: 600;
		border-radius: 999px;
		padding: 0.5rem 1.25rem;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.15s ease;
	}

	.btn-secondary:hover {
		background: #f7f2eb;
		border-color: #a39587;
		color: #3b3026;
	}

	.spinner {
		display: inline-block;
		width: 1rem;
		height: 1rem;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-radius: 50%;
		border-top-color: #fff;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
