<script>
	let {actions = []} = $props()

	function triggerAction(event, action) {
		event.preventDefault()
		action?.result?.()
	}
</script>

<div class="pell-actionbar editor-toolbar" role="toolbar" aria-label="Editor toolbar">
	{#each actions as action (action?.name || action?.title || action?.icon)}
		<button
			type="button"
			class="pell-button"
			data-action={action?.name || ""}
			title={action?.title || action?.name || "Editor action"}
			aria-label={action?.title || action?.name || "Editor action"}
			onmousedown={(event) => event.preventDefault()}
			onclick={(event) => triggerAction(event, action)}
		>
			{@html action?.icon || ""}
		</button>
	{/each}
</div>
