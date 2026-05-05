<script>
	import {onMount} from "svelte"

	const EMOJIS =
		"🐶🐱🐴🐵🦇🪸🐙🐋🐬🦈🐢🐊🐍🦋🐝❤️🐸🦉🦜🐟🐡🦏🐘🦁🐯🐼🐨🦘🦌🦊🦔🦥🦍🦧"
	// How long each half of the crossfade takes (fade-out, then fade-in)
	const FADE_MS = 1000
	// How long to wait before starting the next slot's transition.
	// Shorter than FADE_MS*2 so multiple transitions can overlap.
	const STAGGER_MS = 200

	let {emojis = EMOJIS, count = 10, pinned = ["🐶", "🐱", "🐵"]} = $props()

	// Each slot keeps two persistent layers (a/b). We only write to the hidden layer,
	// then flip visibility to crossfade without unmount/mount blink.
	// Shape: { a: string, b: string, showA: boolean, crossfading: boolean }
	let slots = $state([])
	let pinnedIdx = 0
	let transitionHistory = []

	function toEmojiList(input) {
		if (Array.isArray(input)) {
			return [
				...new Set(
					input.map((item) => String(item || "")).filter(Boolean),
				),
			]
		}
		const asString = String(input || "")
		if (!asString.trim()) return []
		if (asString.includes(" ")) {
			return [...new Set(asString.split(/\s+/).filter(Boolean))]
		}
		if (typeof Intl !== "undefined" && Intl.Segmenter) {
			const segmenter = new Intl.Segmenter(undefined, {
				granularity: "grapheme",
			})
			return [
				...new Set(
					Array.from(
						segmenter.segment(asString),
						(p) => p.segment,
					).filter(Boolean),
				),
			]
		}
		return [...new Set(Array.from(asString).filter(Boolean))]
	}

	function shuffle(values) {
		const copy = [...values]
		for (let i = copy.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1))
			;[copy[i], copy[j]] = [copy[j], copy[i]]
		}
		return copy
	}

	function buildInitialSlots(pool, pinnedAvailable, maxCount) {
		const first = pinnedAvailable[0] ?? pool[0]
		const rest = shuffle(
			pool.filter((a) => !pinnedAvailable.includes(a)),
		).slice(0, maxCount - 1)
		return [first, ...rest].map((emoji) => ({
			a: emoji,
			b: emoji,
			showA: true,
			crossfading: false,
		}))
	}

	function visibleEmoji(slot) {
		return slot.showA ? slot.a : slot.b
	}

	function pickNextEmoji(slotIndex, pool, pinnedAvailable) {
		if (slotIndex === 0) {
			if (pinnedAvailable.length === 0) return null
			pinnedIdx = (pinnedIdx + 1) % pinnedAvailable.length
			return pinnedAvailable[pinnedIdx]
		}
		const current = visibleEmoji(slots[slotIndex])
		const used = new Set(slots.map((s) => visibleEmoji(s)))
		const candidates = shuffle(
			pool.filter(
				(a) =>
					!pinnedAvailable.includes(a) &&
					!used.has(a) &&
					a !== current,
			),
		)
		return candidates[0] ?? null
	}

	function transitionSlot(slotIndex) {
		const pool = toEmojiList(emojis)
		const pinnedAvailable = [...new Set(pinned)].filter((a) =>
			pool.includes(a),
		)
		const incoming = pickNextEmoji(slotIndex, pool, pinnedAvailable)

		const slot = slots[slotIndex]
		if (!incoming || incoming === visibleEmoji(slot)) return

		// Write the incoming emoji only into the hidden layer.
		const prepared = slot.showA
			? {a: slot.a, b: incoming, showA: slot.showA, crossfading: false}
			: {a: incoming, b: slot.b, showA: slot.showA, crossfading: false}
		slots[slotIndex] = prepared

		// Next frame: flip which layer is visible, so opacities crossfade concurrently.
		requestAnimationFrame(() => {
			slots[slotIndex] = {
				...prepared,
				showA: !prepared.showA,
				crossfading: true,
			}

			setTimeout(() => {
				const latest = slots[slotIndex]
				slots[slotIndex] = {
					...latest,
					crossfading: false,
				}
			}, FADE_MS)
		})

		const historyLimit = Math.max(1, Math.floor(slots.length / 2))
		transitionHistory = [...transitionHistory, slotIndex].slice(
			-historyLimit,
		)
	}

	function pickRandomIdleSlot() {
		const idle = []
		for (let i = 0; i < slots.length; i += 1) {
			if (!slots[i].crossfading) idle.push(i)
		}
		if (idle.length === 0) return -1

		const historyLimit = Math.max(1, Math.floor(slots.length / 2))
		const recentSet = new Set(transitionHistory.slice(-historyLimit))
		const eligible = idle.filter((slot) => !recentSet.has(slot))
		const source = eligible.length > 0 ? eligible : idle
		return source[Math.floor(Math.random() * source.length)]
	}

	$effect(() => {
		const pool = toEmojiList(emojis)
		const maxCount = Math.min(Math.max(1, Number(count) || 10), pool.length)
		if (maxCount === 0) {
			slots = []
			return
		}
		const pinnedAvailable = [...new Set(pinned)].filter((a) =>
			pool.includes(a),
		)
		pinnedIdx = 0
		transitionHistory = []
		slots = buildInitialSlots(pool, pinnedAvailable, maxCount)
	})

	onMount(() => {
		const timer = setInterval(() => {
			const slot = pickRandomIdleSlot()
			if (slot >= 0) transitionSlot(slot)
		}, STAGGER_MS)

		return () => clearInterval(timer)
	})
</script>

<div
	class="emojis-row"
	role="list"
	aria-label="Featured emojis"
	style={`--fade-ms: ${FADE_MS}ms`}
>
	{#each slots as slot, i}
		<span class="emoji-item" role="listitem">
			<span
				class="emoji-layer a"
				class:shown={slot.showA}
				class:hidden={!slot.showA}
				class:animate={slot.crossfading}>{slot.a}</span
			>
			<span
				class="emoji-layer b"
				class:shown={!slot.showA}
				class:hidden={slot.showA}
				class:animate={slot.crossfading}>{slot.b}</span
			>
		</span>
	{/each}
</div>

<style>
	.emojis-row {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		margin: 0 0 0.9rem;
		gap: 5px;
	}

	.emoji-item {
		flex: 0 0 auto;
		position: relative;
		display: inline-grid;
		place-items: center;
		text-align: center;
		font-size: clamp(1rem, 2.6vw, 1.5rem);
		line-height: 1;
	}

	.emoji-layer {
		grid-area: 1 / 1;
		opacity: 0;
	}

	.emoji-layer.animate {
		transition: opacity var(--fade-ms, 380ms) ease-in-out;
	}

	.emoji-layer.shown {
		opacity: 1;
	}

	.emoji-layer.hidden {
		opacity: 0;
	}
</style>
