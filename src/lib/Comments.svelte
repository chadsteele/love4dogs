<script>
	import { MessageCircle } from "lucide-svelte";
	import { goto } from "$app/navigation";

	let { count = 0, cardViewHref } = $props();

	function handleClick(e) {
		e.stopPropagation();
		e.preventDefault();
		if (cardViewHref) {
			goto(`${cardViewHref}#new-comment`);
		}
	}
</script>

<a
	class="stat comments"
	href={`${cardViewHref}#new-comment`}
	onclick={handleClick}
>
	<MessageCircle size={13} /> {count? `x ${count}` : ""}
</a>

<style>
	.comments {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: #6b7280;
		text-decoration: none;
		cursor: pointer;
		transition: color 0.15s ease;
	}

	.comments:hover {
		color: #1a4a7a;
	}
</style>
