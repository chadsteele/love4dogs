<script>
	import {goto} from "$app/navigation"
	import {page} from "$app/state"
	import {onMount} from "svelte"

	onMount(() => {
		const uuid = page.params?.uuid
		const slug = page.params?.["...slug"]

		if (uuid) {
			goto(`/post?uri=${encodeURIComponent("at://..." + uuid)}`)
		} else {
			goto("/post")
		}
	})
</script>

<p>Redirecting...</p>
