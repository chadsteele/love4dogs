function normalizeTimestampSource(value) {
	if (typeof value === "number") return value
	return String(value || "").trim()
}

export function parseTimestampMs(value = "", {allowBase36 = false} = {}) {
	const source = normalizeTimestampSource(value)
	if (source === "" || source === null || source === undefined) return 0

	if (typeof source === "number") {
		if (!Number.isFinite(source) || source <= 0) return 0
		return source > 1e12 ? source : source * 1000
	}

	const parsedIso = Date.parse(source)
	if (Number.isFinite(parsedIso) && parsedIso > 0) return parsedIso

	const numeric = Number(source)
	if (Number.isFinite(numeric) && numeric > 0) {
		return numeric > 1e12 ? numeric : numeric * 1000
	}

	if (allowBase36) {
		const base36 = Number.parseInt(source, 36)
		if (Number.isFinite(base36) && base36 > 0) return base36
	}

	return 0
}

export function toIsoDateTime(value = "", options = {}) {
	const stampMs = parseTimestampMs(value, options)
	if (!stampMs) return ""
	try {
		return new Date(stampMs).toISOString()
	} catch {
		return ""
	}
}

export function formatLocalTime(value = Date.now(), options = {}) {
	const {fallback = "", allowBase36 = false} = options
	const stampMs = parseTimestampMs(value, {allowBase36})
	if (!stampMs) return fallback
	try {
		return new Date(stampMs).toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit",
		})
	} catch {
		return fallback
	}
}

export function formatLocalDateTime(value = "", options = {}) {
	const {fallback = "", allowBase36 = false} = options
	const stampMs = parseTimestampMs(value, {allowBase36})
	if (!stampMs) return fallback
	try {
		return new Date(stampMs).toLocaleString()
	} catch {
		return fallback
	}
}

export function formatRelativeDateTime(value = "", options = {}) {
	const {
		fallback = "",
		fallbackToInput = false,
		allowBase36 = false,
		now = Date.now(),
	} = options
	const source = normalizeTimestampSource(value)
	if (source === "" || source === null || source === undefined) return fallback

	const stampMs = parseTimestampMs(source, {allowBase36})
	if (!stampMs) return fallbackToInput ? String(source) : fallback

	try {
		const stampDate = new Date(stampMs)
		const currentDate = new Date(parseTimestampMs(now) || Date.now())
		const rtf = new Intl.RelativeTimeFormat(undefined, {
			numeric: "auto",
		})
		const timeLabel = formatLocalTime(stampMs)
		const diffMs = currentDate.getTime() - stampMs

		if (diffMs >= 0 && diffMs < 45 * 1000) return "just now"
		if (diffMs >= 0 && diffMs < 60 * 60 * 1000) {
			return rtf.format(-Math.max(1, Math.floor(diffMs / 60000)), "minute")
		}
		if (diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000) {
			return rtf.format(-Math.max(1, Math.floor(diffMs / 3600000)), "hour")
		}

		const startOfToday = new Date(
			currentDate.getFullYear(),
			currentDate.getMonth(),
			currentDate.getDate(),
		)
		const startOfStampDay = new Date(
			stampDate.getFullYear(),
			stampDate.getMonth(),
			stampDate.getDate(),
		)
		const dayDiff = Math.round(
			(startOfToday.getTime() - startOfStampDay.getTime()) / 86400000,
		)
		if (dayDiff === 0) return `today at ${timeLabel}`
		if (dayDiff === 1) return `yesterday at ${timeLabel}`

		const includeYear = stampDate.getFullYear() !== currentDate.getFullYear()
		const dateLabel = stampDate.toLocaleDateString(
			[],
			includeYear
				? {year: "numeric", month: "short", day: "numeric"}
				: {month: "short", day: "numeric"},
		)
		return `${dateLabel} at ${timeLabel}`
	} catch {
		return fallbackToInput ? String(source) : fallback
	}
}

export function formatDateTime(value = "", options = {}) {
	const {mode = "relative"} = options
	if (mode === "datetime") return formatLocalDateTime(value, options)
	if (mode === "time") return formatLocalTime(value, options)
	if (mode === "year") return String(getCalendarYear(value, options) || "")
	return formatRelativeDateTime(value, options)
}

export function createIsoTimestamp(value = Date.now()) {
	const stampMs = parseTimestampMs(value) || Date.now()
	return new Date(stampMs).toISOString()
}

export function buildCompressedTimestamp(now = Date.now()) {
	return Math.max(0, Math.floor(Number(now) || 0)).toString(36)
}

export function getCalendarYear(value = Date.now(), options = {}) {
	const stampMs = parseTimestampMs(value, options) || Date.now()
	return new Date(stampMs).getFullYear()
}

export function resolvePostTimestampMs(post = {}) {
	const candidates = [
		post?.indexedAt,
		post?.record?.createdAt,
		post?.value?.createdAt,
		post?.createdAt,
	]
	for (const candidate of candidates) {
		const ms = parseTimestampMs(candidate)
		if (ms > 0) return ms
	}
	return 0
}

export function deriveBundleCreatedAtMs(bundle = {}) {
	const posts = Array.isArray(bundle?.posts) ? bundle.posts : []
	let earliest = 0
	for (const entry of posts) {
		const ms = resolvePostTimestampMs(entry?.post || entry || {})
		if (!ms) continue
		earliest = earliest === 0 ? ms : Math.min(earliest, ms)
	}
	return earliest
}