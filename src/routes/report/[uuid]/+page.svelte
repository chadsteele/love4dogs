<script>
	import {page} from "$app/state"
	import {goto} from "$app/navigation"
	import NavBar from "$lib/NavBar.svelte"
	import {CircleAlert, CheckCircle} from "lucide-svelte"

	const uuid = $derived(String(page.params?.uuid || "").trim())

	let selectedReason = $state("")
	let complaintDetails = $state("")
	let busy = $state(false)
	let success = $state(false)
	let errorMsg = $state("")

	async function handleSubmit(event) {
		event.preventDefault()
		if (!selectedReason) {
			errorMsg = "Please select a reason for your complaint."
			return
		}
		
		busy = true
		errorMsg = ""
		
		try {
			const messageText = `Report for post/profile: ${uuid}\nReason: ${selectedReason}\nDetails: ${complaintDetails}`
			const res = await fetch("/api/send-dm", {
				method: "POST",
				headers: {
					"content-type": "application/json"
				},
				body: JSON.stringify({ message: messageText })
			})
			
			const data = await res.json().catch(() => ({}))
			if (!res.ok) {
				throw new Error(data.error || "Failed to submit report")
			}
			
			success = true
		} catch (err) {
			errorMsg = err.message || "An unexpected error occurred."
		} finally {
			busy = false
		}
	}

	function handleBack() {
		// Try to navigate back to history or fall back to home
		if (typeof window !== "undefined" && window.history.length > 1) {
			window.history.back()
		} else {
			goto("/search")
		}
	}
</script>

<svelte:head>
	<title>Report Content | Love4Dogs</title>
</svelte:head>

<main class="page">
	<NavBar showSearch={false} />

	<section class="panel">
		{#if success}
			<div class="success-state">
				<CheckCircle size={48} class="success-icon" />
				<h2>Report Submitted</h2>
				<p>Thank you. Your report has been submitted to the administrator for review.</p>
				<button type="button" class="back-btn font-weight-bold" onclick={handleBack}>
					Go Back
				</button>
			</div>
		{:else}
			<h2>Report Content</h2>
			<p class="help">
				Please select a reason for reporting this post/profile (UUID: {uuid}) and provide any details to help the admin team investigate.
			</p>

			{#if errorMsg}
				<div class="error-banner">
					<CircleAlert size={16} />
					<span>{errorMsg}</span>
				</div>
			{/if}

			<form onsubmit={handleSubmit} class="report-form">
				<div class="form-group">
					<label for="reason">Reason for Report <span class="required">*</span></label>
					<select id="reason" bind:value={selectedReason} disabled={busy} required>
						<option value="" disabled>-- Select a reason --</option>
						<option value="Spam">Spam</option>
						<option value="Harassment">Harassment / Abuse</option>
						<option value="Inappropriate">Inappropriate Content</option>
						<option value="Copyright">Intellectual Property Violation</option>
						<option value="Other">Other</option>
					</select>
				</div>

				<div class="form-group">
					<label for="details">Additional Details</label>
					<textarea
						id="details"
						bind:value={complaintDetails}
						disabled={busy}
						placeholder="Explain why this content should be reviewed..."
						rows="5"
					></textarea>
				</div>

				<div class="actions">
					<button type="button" class="cancel-btn" onclick={handleBack} disabled={busy}>
						Cancel
					</button>
					<button type="submit" class="submit-btn" disabled={busy}>
						{busy ? "Submitting..." : "Submit Report"}
					</button>
				</div>
			</form>
		{/if}
	</section>
</main>

<style>
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.1rem;
	}

	.panel {
		background: rgba(255, 250, 241, 0.95);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 10px 30px rgba(65, 42, 20, 0.12);
	}

	h2 {
		margin: 0 0 0.5rem;
		color: #2b271f;
	}

	.help {
		margin: 0 0 1.25rem;
		color: #5f665f;
		font-size: 0.92rem;
		line-height: 1.4;
	}

	.required {
		color: #8e2f21;
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: #fdf2f2;
		border: 1px solid #f8b4b4;
		border-radius: 8px;
		padding: 0.75rem;
		margin-bottom: 1.25rem;
		color: #8e2f21;
		font-size: 0.88rem;
	}

	.error-banner :global(svg) {
		flex-shrink: 0;
	}

	.report-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.form-group label {
		font-size: 0.9rem;
		font-weight: 600;
		color: #3b4a38;
	}

	select, textarea {
		border: 1px solid #d7c8b6;
		border-radius: 10px;
		padding: 0.65rem;
		font: inherit;
		background: #fff;
		box-sizing: border-box;
		outline: none;
	}

	select:focus, textarea:focus {
		border-color: #3b6e4f;
	}

	textarea {
		resize: vertical;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.cancel-btn {
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.55rem 1.25rem;
		font: inherit;
		cursor: pointer;
		font-weight: 600;
	}

	.cancel-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.submit-btn {
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		border-radius: 999px;
		padding: 0.55rem 1.5rem;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.submit-btn:hover {
		background: #305741;
	}

	.submit-btn:disabled {
		background: #dcd7ce;
		border-color: #c5beaf;
		color: #9f9686;
		cursor: not-allowed;
	}

	.success-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 1rem 0;
	}

	.success-state :global(.success-icon) {
		color: #3b6e4f;
		margin-bottom: 1rem;
	}

	.success-state p {
		color: #5f665f;
		margin: 0.5rem 0 1.5rem;
		font-size: 0.95rem;
	}

	.back-btn {
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		border-radius: 999px;
		padding: 0.6rem 2rem;
		font: inherit;
		cursor: pointer;
	}

	.back-btn:hover {
		background: #305741;
	}
</style>
