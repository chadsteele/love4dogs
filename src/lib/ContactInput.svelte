<script>
	import {Eye, EyeOff, CircleAlert, ShieldCheck} from "lucide-svelte"
	import {
		CONTACT_LOCK_PREFIX,
		decryptContact,
		encryptContact,
		isContactEncrypted,
		normalizeContactInput,
	} from "$lib/utils"

	let {
		value = $bindable(),
		error = $bindable(),
		disabled = false,
		placeholder = "Optional: you@email.com, +phone, @username.bsky.social, or other contact info",
		maxlength = 200,
		showNotice = true,
	} = $props()

	function handleEncrypt() {
		if (!isContactEncrypted(value)) {
			const normalized = normalizeContactInput(value.trim())
			value = CONTACT_LOCK_PREFIX + encryptContact(normalized)
		} else {
			value = decryptContact(value.slice(CONTACT_LOCK_PREFIX.length))
		}
	}

	function handleInput() {
		if (isContactEncrypted(value)) return
		value = normalizeContactInput(value)
	}
</script>

<label>
	<span>Private</span>
	<div class="contact-row">
		<input
			class="contact-input"
			type="text"
			bind:value
			placeholder={placeholder}
			{maxlength}
			readonly={isContactEncrypted(value)}
			oninput={handleInput}
			{disabled}
		/>

		<button
			class="lock-btn"
			type="button"
			disabled={!value.trim()}
			title={isContactEncrypted(value)
				? "Decrypt contact info"
				: "Encrypt contact info"}
			onclick={handleEncrypt}
		>
			{#if isContactEncrypted(value)}
				<EyeOff size={16} />
			{:else}
				<Eye size={16} />
			{/if}
		</button>
	</div>
</label>

{#if showNotice && value.trim().length > 0}
	<div
		class="contact-notice"
		class:contact-notice--encrypted={isContactEncrypted(
			value,
		)}
	>
		{#if isContactEncrypted(value)}
			<ShieldCheck size={14} />
			<span
				>Contact info is encrypted/compressed and only visible
				on our platform, but security is not guaranteed. <br
				/>We do not spam, but we can't guarantee complete
				privacy.</span
			>
		{:else}
			<CircleAlert size={14} />
			<span
				>Contact info will be <strong>public</strong> on all
				platforms.
				<br />We do not spam, but we can't guarantee complete
				privacy.</span
			>
		{/if}
	</div>
{/if}

{#if error}
	<p class="field-error">{error}</p>
{/if}

<style>
	label {
		display: grid;
		gap: 0.3rem;
		margin-bottom: 0.55rem;
	}
	.contact-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.45rem;
		padding: 0.45rem 0.6rem 0.45rem 0.75rem;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		background: #fffdf8;
	}
	.contact-input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		font: inherit;
		font-size: 0.95rem;
		color: inherit;
	}
	.contact-input[readonly] {
		color: #5a4f42;
		font-family: monospace;
		font-size: 0.85rem;
	}
	.lock-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: 0px solid #d0c3b0;
		background: transparent;
		color: #7a6d5e;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.lock-btn:disabled {
		opacity: 0.3;
		cursor: default;
		pointer-events: none;
	}
	.lock-btn:hover {
		background: #f0e9df;
		border-color: #b09880;
		color: #4a3f34;
	}

	.contact-notice {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin-top: 0.35rem;
		padding: 0.45rem 0.65rem;
		border-radius: 8px;
		font-size: 0.82rem;
		line-height: 1.4;
		background: #fff4e5;
		color: #7a4a1a;
		border: 1px solid #f0d5a8;
	}
	.contact-notice--encrypted {
		background: #eaf4ee;
		color: #2a5c3a;
		border-color: #b5d9c0;
	}
	.contact-notice :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
	}
	.field-error {
		margin: -0.2rem 0 0.4rem;
		font-size: 0.84rem;
		color: #8e2f21;
	}
</style>
