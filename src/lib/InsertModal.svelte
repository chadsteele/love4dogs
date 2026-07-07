<script>
	let {
		open = false,
		tab = $bindable("button"),
		buttonLabel = $bindable("Open link"),
		buttonUrl = $bindable(""),
		iframeUrl = $bindable(""),
		embedCode = $bindable(""),
		error = $bindable(""),
		previewHtml = "",
		onclose = () => {},
		oninsert = () => {},
	} = $props()

	function selectTab(nextTab) {
		tab = nextTab
		error = ""
	}
</script>

{#if open}
	<div class="insert-modal-backdrop">
		<div class="insert-modal" role="dialog" aria-modal="true" aria-label="Insert content">
			<div class="insert-modal-header">
				<h3>Insert</h3>
			</div>

			<div class="insert-modal-tabs" role="tablist" aria-label="Insert type">
				<button
					type="button"
					role="tab"
					class:active={tab === "button"}
					onclick={() => selectTab("button")}
				>
					Button
				</button>
				<button
					type="button"
					role="tab"
					class:active={tab === "iframe"}
					onclick={() => selectTab("iframe")}
				>
					Iframe
				</button>
				<button
					type="button"
					role="tab"
					class:active={tab === "embed"}
					onclick={() => selectTab("embed")}
				>
					Embed Code
				</button>
			</div>

			{#if tab === "button"}
				<div class="insert-modal-fields">
					<label>
						<span>Label</span>
						<input type="text" bind:value={buttonLabel} placeholder="Open link" />
					</label>
					<label>
						<span>URL</span>
						<input type="url" bind:value={buttonUrl} placeholder="https://example.com" />
					</label>
				</div>
			{:else if tab === "iframe"}
				<div class="insert-modal-fields">
					<label>
						<span>URL</span>
						<input type="url" bind:value={iframeUrl} placeholder="https://example.com/embed" />
					</label>
				</div>
			{:else}
				<div class="insert-modal-fields">
					<label>
						<span>Embed Code</span>
						<textarea bind:value={embedCode} rows="7" placeholder="Paste iframe/embed HTML here"></textarea>
					</label>
				</div>
			{/if}

			{#if error}
				<p class="insert-modal-error">{error}</p>
			{/if}

			<div class="insert-preview-wrap">
				<div class="insert-preview-title">Preview</div>
				<div class="insert-preview-body">
					<div class="insert-preview-content content-html editor-wrap">{@html previewHtml}</div>
				</div>
			</div>

			<div class="insert-modal-actions">
				<button type="button" class="secondary" onclick={onclose}>Cancel</button>
				<button type="button" class="primary" onclick={oninsert}>Insert</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.insert-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(17, 24, 39, 0.58);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 2000;
	}

	.insert-modal {
		width: min(760px, 100%);
		max-height: 90dvh;
		overflow: auto;
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
		padding: 1rem;
	}

	.insert-modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		margin-bottom: 0.75rem;
	}

	.insert-modal-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		color: #2d3a2b;
	}

	.insert-modal-tabs {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.8rem;
		flex-wrap: wrap;
	}

	.insert-modal-tabs button {
		border: 1px solid #d7c8b6;
		background: #f8f5ef;
		border-radius: 999px;
		padding: 0.35rem 0.75rem;
		font-size: 0.86rem;
		font-weight: 600;
		cursor: pointer;
		color: #3b4a38;
	}

	.insert-modal-tabs button.active {
		background: #3f6b44;
		border-color: #3f6b44;
		color: #fff;
	}

	.insert-modal-fields {
		display: grid;
		gap: 0.7rem;
		margin-bottom: 0.75rem;
	}

	.insert-modal-fields label {
		display: grid;
		gap: 0.25rem;
		font-size: 0.84rem;
		font-weight: 600;
		color: #394a33;
	}

	.insert-modal-fields input,
	.insert-modal-fields textarea {
		width: 100%;
		border: 1px solid #d7c8b6;
		border-radius: 8px;
		padding: 0.55rem 0.65rem;
		font: inherit;
		font-size: 0.9rem;
		box-sizing: border-box;
	}

	.insert-modal-error {
		margin: 0 0 0.7rem;
		color: #b42318;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.insert-preview-wrap {
		border: 1px solid #e2d7c8;
		border-radius: 10px;
		background: #faf8f3;
		margin-bottom: 0.85rem;
	}

	.insert-preview-title {
		padding: 0.45rem 0.65rem;
		font-size: 0.82rem;
		font-weight: 700;
		color: #4a5d44;
		border-bottom: 1px solid #e2d7c8;
	}

	.insert-preview-body {
		padding: 0.75rem;
	}

	.insert-preview-body :global(.insert-preview-content) {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
	}

	.insert-preview-body :global(.insert-preview-content iframe) {
		width: 100%;
		min-height: 220px;
		max-width: 100%;
	}

	.insert-preview-body :global(.insert-preview-placeholder) {
		margin: 0;
		font-size: 0.85rem;
		color: #61725f;
	}

	.insert-modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.insert-modal-actions button {
		border-radius: 8px;
		padding: 0.45rem 0.8rem;
		font-size: 0.86rem;
		font-weight: 700;
		cursor: pointer;
	}

	.insert-modal-actions button.secondary {
		background: #fff;
		border: 1px solid #d7c8b6;
		color: #3b4a38;
	}

	.insert-modal-actions button.primary {
		background: #3f6b44;
		border: 1px solid #3f6b44;
		color: #fff;
	}
</style>