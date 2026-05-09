<script>
	const {children, currentView = ""} = $props()
</script>

{#if currentView === "admin" && typeof children === "function"}
	{@render children()}
{/if}
