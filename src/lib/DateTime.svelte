<script>
	import {formatDateTime, toIsoDateTime} from "$lib/dateTime"

	let {
		value = "",
		mode = "relative",
		fallback = "",
		fallbackToInput = false,
		allowBase36 = false,
		tag = "time",
		class: className = "",
	} = $props()

	const formattedValue = $derived(
		formatDateTime(value, {
			mode,
			fallback,
			fallbackToInput,
			allowBase36,
		}),
	)
	const isoDateTime = $derived(
		tag === "time" ? toIsoDateTime(value, {allowBase36}) : "",
	)
</script>

{#if formattedValue}
	<svelte:element
		this={tag}
		class={className || undefined}
		datetime={tag === "time" ? isoDateTime || undefined : undefined}
	>
		{formattedValue}
	</svelte:element>
{/if}