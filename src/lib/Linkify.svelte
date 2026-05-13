<script>
	const {children} = $props()
	let sourceEl = $state(null)
	let sourceText = $state("")

	function syncSourceText() {
		sourceText = sourceEl?.textContent || ""
	}

	// Function to convert URLs, emails, and phone numbers into clickable links
	const linkify = (text) => {
		if (!text) return ""
		const source = String(text)

		// Skip wrapping if already inside an anchor tag
		if (/<a\b[^>]*>(.*?)<\/a>/i.test(source)) {
			return source.replace(/\r\n|\r|\n/g, "<br />")
		}

		const urlPattern =
			/\b(https?:\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*))/gi
		const emailPattern =
			/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
		const phonePattern =
			/(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:(?:\(?\d{1,4}\)?[\s.-]?)?(?:\d[\s.-]?){6,14}\d|\d{8}|\d{4}[\s.-]\d{4})(?!\w)/g

		return source
			.replace(
				urlPattern,
				'<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
			)
			.replace(emailPattern, '<a href="mailto:$&">$&</a>')
			.replace(phonePattern, '<a href="tel:$&">$&</a>')
			.replace(/\r\n|\r|\n/g, "<br />")
	}

	$effect(() => {
		if (typeof window === "undefined") return
		if (!sourceEl) {
			sourceText = ""
			return
		}

		syncSourceText()
		const observer = new MutationObserver(() => {
			syncSourceText()
		})

		observer.observe(sourceEl, {
			childList: true,
			subtree: true,
			characterData: true,
		})

		return () => {
			observer.disconnect()
		}
	})
</script>

<div class="linkify-source" aria-hidden="true" bind:this={sourceEl}>
	{@render children?.()}
</div>
<div>{@html linkify(sourceText)}</div>

<style>
	.linkify-source {
		display: none;
	}
</style>
