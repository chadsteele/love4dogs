const PROFILE_TAG = "profile"

function normalizeString(value = "") {
	return String(value || "").trim()
}

function normalizeOptionalString(value = "") {
	const normalized = normalizeString(value)
	return normalized || ""
}

function normalizeNumber(value, fallback = 0) {
	const next = Number(value)
	return Number.isFinite(next) ? next : fallback
}

function normalizeNullableNumber(value) {
	const next = Number(value)
	return Number.isFinite(next) ? next : null
}

function normalizeAddressPart(value = "") {
	return String(value || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
}

function normalizeTags(tags = []) {
	const out = []
	for (const raw of Array.isArray(tags) ? tags : []) {
		const value = normalizeString(raw).toLowerCase()
		if (!value || out.includes(value)) continue
		out.push(value)
	}
	return out.slice(0, 50)
}

function normalizeObject(value, fallback = null) {
	return value && typeof value === "object" ? value : fallback
}

function normalizeMediaEntry(entry = {}) {
	if (!entry || typeof entry !== "object") return null
	return {
		kind: normalizeString(entry.kind || "image") || "image",
		alt: normalizeOptionalString(entry.alt),
		blob: entry.blob || null,
		url: normalizeOptionalString(entry.url),
		bskyUrl: normalizeOptionalString(entry.bskyUrl),
		sourceUrl: normalizeOptionalString(entry.sourceUrl),
		sourceName: normalizeOptionalString(entry.sourceName),
		file: entry.file || null,
		isOfflineMedia: Boolean(entry.isOfflineMedia),
		offlineId: normalizeOptionalString(entry.offlineId),
	}
}

function normalizeMediaList(list = []) {
	return (Array.isArray(list) ? list : [])
		.map((entry) => normalizeMediaEntry(entry))
		.filter(Boolean)
}

export function hasProfileTag(tags = []) {
	return normalizeTags(tags).includes(PROFILE_TAG)
}

export class BaseEntity {
	constructor(value = {}, { type = "" } = {}) {
		this.type = normalizeString(type || value?.type)
		this.uuid = normalizeString(value?.uuid || value?.id)
		this.authorid = normalizeString(
			value?.authorid || value?.authorId || value?.id || value?.uuid,
		)
		this.tags = normalizeTags(value?.tags)
		this.location = Location.from(value?.location || value?.confirmedLocation)
	}

	toBaseJSON() {
		return {
			type: this.type,
			uuid: this.uuid,
			authorid: this.authorid,
			tags: this.tags,
			location: this.location ? this.location.toJSON() : null,
		}
	}

	isProfile() {
		return this.type === "profile" || hasProfileTag(this.tags)
	}
}

export class Author extends BaseEntity {
	constructor(value = {}, { type = "author" } = {}) {
		super(value, { type })
		this.did = normalizeString(value?.did)
		this.handle = normalizeString(value?.handle)
		this.displayName = normalizeString(
			value?.displayName || value?.authorName || value?.name,
		)
		this.avatar = normalizeString(
			value?.avatar || value?.authorAvatar || value?.profilePic,
		)
	}

	get id() {
		return this.authorid || this.uuid || ""
	}

	hasIdentity() {
		return Boolean(this.id || this.did || this.handle)
	}

	getDisplayLabel() {
		return this.displayName || this.handle || this.did || this.id || ""
	}

	getValidationErrors({ requireIdentity = false } = {}) {
		const errors = []
		if (requireIdentity && !this.hasIdentity()) {
			errors.push("Author must have an id, did, or handle.")
		}
		return errors
	}

	isValid(options = {}) {
		return this.getValidationErrors(options).length === 0
	}

	assertIntegrity(options = {}) {
		const errors = this.getValidationErrors(options)
		if (errors.length) {
			throw new Error(errors.join(" "))
		}
		return this
	}

	toJSON() {
		return {
			...this.toBaseJSON(),
			id: this.id,
			did: this.did,
			handle: this.handle,
			displayName: this.displayName,
			avatar: this.avatar,
		}
	}

	static from(value = {}) {
		return value instanceof Author ? value : new Author(value)
	}
}

export class Location {
	constructor(value = {}) {
		this.lat = normalizeNullableNumber(value?.lat)
		this.lon = normalizeNullableNumber(value?.lon)
		this.approximate = normalizeString(value?.approximate)
		this.exact = normalizeString(value?.exact)
		this.hashPath = normalizeString(value?.hashPath)
		this.formattedAddress = normalizeString(
			value?.formattedAddress || value?.address,
		)
		this.houseNumber = normalizeString(value?.houseNumber)
		this.road = normalizeString(value?.road)
		this.neighbourhood = normalizeString(value?.neighbourhood)
		this.suburb = normalizeString(value?.suburb)
		this.city = normalizeString(value?.city)
		this.state = normalizeString(value?.state)
		this.country = normalizeString(value?.country)
		this.zip = normalizeString(value?.zip || value?.postcode)
	}

	static isValidCoordinate(value) {
		const next = Number(value)
		return Number.isFinite(next)
	}

	hasCoordinates() {
		return (
			Location.isValidCoordinate(this.lat) &&
			Location.isValidCoordinate(this.lon)
		)
	}

	hasRequiredAddressParts() {
		return [this.state, this.country, this.zip].every(Boolean)
	}

	getRequiredAddressParts() {
		return [this.city, this.state, this.country, this.zip]
			.map((value) => normalizeAddressPart(value))
			.filter(Boolean)
	}

	buildCompleteAddress() {
		const line1 = [this.houseNumber, this.road]
			.map((value) => normalizeString(value))
			.filter(Boolean)
			.join(" ")
		const line2 = [this.neighbourhood, this.suburb]
			.map((value) => normalizeString(value))
			.filter(Boolean)
			.join(", ")
		const structured = [
			line1,
			line2,
			this.city,
			this.state,
			this.country,
			this.zip,
		]
			.map((value) => normalizeString(value))
			.filter(Boolean)
			.join(", ")

		return normalizeString(this.formattedAddress || structured)
	}

	matchesAddress(addressText = "") {
		if (!this.hasRequiredAddressParts()) return false
		const normalizedAddress = normalizeAddressPart(addressText)
		if (!normalizedAddress) return false
		return this.getRequiredAddressParts().every((part) =>
			normalizedAddress.includes(part),
		)
	}

	getValidationErrors({
		requireCoordinates = false,
		requireAddressParts = false,
	} = {}) {
		const errors = []
		if (requireCoordinates && !this.hasCoordinates()) {
			errors.push("Location must include valid lat/lon coordinates.")
		}
		if (requireAddressParts && !this.hasRequiredAddressParts()) {
			errors.push("Location must include state, country, and zip.")
		}
		return errors
	}

	isValid(options = {}) {
		return this.getValidationErrors(options).length === 0
	}

	assertIntegrity(options = {}) {
		const errors = this.getValidationErrors(options)
		if (errors.length) {
			throw new Error(errors.join(" "))
		}
		return this
	}

	toJSON() {
		return {
			lat: this.lat,
			lon: this.lon,
			approximate: this.approximate,
			exact: this.exact,
			hashPath: this.hashPath,
			formattedAddress: this.formattedAddress,
			houseNumber: this.houseNumber,
			road: this.road,
			neighbourhood: this.neighbourhood,
			suburb: this.suburb,
			city: this.city,
			state: this.state,
			country: this.country,
			zip: this.zip,
		}
	}

	static from(value = null) {
		if (!value || typeof value !== "object") return null
		return value instanceof Location ? value : new Location(value)
	}
}

export class CommentStars {
	constructor(value = {}) {
		this.comments = Array.isArray(value?.comments) ? value.comments : []
		this.replyCount = normalizeNumber(value?.replyCount, 0)
		this.repostCount = normalizeNumber(value?.repostCount, 0)
		this.likeCount = normalizeNumber(value?.likeCount, 0)
		this.stars = normalizeNumber(
			value?.stars ?? value?.starCount ?? value?.likeCount,
			0,
		)
	}

	toJSON() {
		return {
			comments: this.comments,
			replyCount: this.replyCount,
			repostCount: this.repostCount,
			likeCount: this.likeCount,
			stars: this.stars,
		}
	}

	static from(value = {}) {
		return value instanceof CommentStars ? value : new CommentStars(value)
	}
}

export class Bsky {
	constructor(value = {}) {
		const post = normalizeObject(value?.post, value) || {}
		this.uri = normalizeString(post?.uri)
		this.cid = normalizeString(post?.cid)
		this.record = {
			text: normalizeString(post?.record?.text),
			facets: Array.isArray(post?.record?.facets) ? post.record.facets : [],
			tags: normalizeTags(post?.record?.tags),
			createdAt: post?.record?.createdAt || null,
		}
		this.embed = post?.embed || null
		this.author = Author.from(post?.author || value?.author || {})
		this.replyCount = normalizeNumber(post?.replyCount, 0)
		this.repostCount = normalizeNumber(post?.repostCount, 0)
		this.likeCount = normalizeNumber(post?.likeCount, 0)
	}

	get mediaView() {
		return this.embed?.$type === "app.bsky.embed.recordWithMedia#view"
			? this.embed.media
			: this.embed
	}

	get imageViews() {
		return this.mediaView?.$type === "app.bsky.embed.images#view"
			? this.mediaView.images || []
			: []
	}

	get videoView() {
		return this.mediaView?.$type === "app.bsky.embed.video#view"
			? this.mediaView
			: null
	}

	toJSON() {
		return {
			uri: this.uri,
			cid: this.cid,
			record: this.record,
			embed: this.embed,
			author: this.author.toJSON(),
			replyCount: this.replyCount,
			repostCount: this.repostCount,
			likeCount: this.likeCount,
		}
	}

	static from(value = {}) {
		return value instanceof Bsky ? value : new Bsky(value)
	}
}


export class Post extends BaseEntity {
	constructor(value = {}) {
		super(value, { type: "post" })
		this.uri = normalizeString(value?.uri)
		this.displayKey = normalizeString(value?.displayKey || this.uri)
		this.cid = normalizeString(value?.cid)
		this.text = normalizeString(value?.text)
		this.author = Author.from(value?.author || {})
		this.facets = Array.isArray(value?.facets) ? value.facets : []
		this.createdAt = value?.createdAt || null
		this.images = (Array.isArray(value?.images) ? value.images : []).map((item) => normalizeString(item)).filter(Boolean)
		this.imageAlts = (Array.isArray(value?.imageAlts) ? value.imageAlts : []).map((item) => String(item || "")).filter(Boolean)
		this.video = normalizeObject(value?.video, null)
		this.record = {
			tags: normalizeTags(value?.record?.tags || this.tags),
			createdAt: value?.record?.createdAt || this.createdAt || null,
		}
		this.approximate = normalizeString(value?.approximate || this.location?.approximate)
		this.exact = normalizeString(value?.exact || this.location?.exact)
		this.lat = normalizeNullableNumber(value?.lat ?? this.location?.lat)
		this.lon = normalizeNullableNumber(value?.lon ?? this.location?.lon)
		this.engagement = CommentStars.from(value?.engagement || value)
		this.comments = this.engagement.comments
		this.replyCount = this.engagement.replyCount
		this.repostCount = this.engagement.repostCount
		this.likeCount = this.engagement.likeCount
		this.stars = this.engagement.stars
	}

	toJSON() {
		return {
			...this.toBaseJSON(),
			uri: this.uri,
			displayKey: this.displayKey,
			cid: this.cid,
			text: this.text,
			author: this.author.toJSON(),
			facets: this.facets,
			createdAt: this.createdAt,
			images: this.images,
			imageAlts: this.imageAlts,
			video: this.video,
			tags: this.tags,
			record: this.record,
			location: this.location ? this.location.toJSON() : null,
			approximate: this.approximate,
			exact: this.exact,
			lat: this.lat,
			lon: this.lon,
			comments: this.comments,
			replyCount: this.replyCount,
			repostCount: this.repostCount,
			likeCount: this.likeCount,
			stars: this.stars,
		}
	}

	static from(value = {}) {
		return value instanceof Post ? value : new Post(value)
	}
}

export class Profile extends Author {
	constructor(value = {}) {
		super(value, { type: "profile" })
		this.email = normalizeString(value?.email)
		this.pin = normalizeString(value?.pin)
		this.profileName = normalizeString(value?.profileName || value?.name)
		this.profileDescription = normalizeString(
			value?.profileDescription || value?.description,
		)
		this.contentHtml = String(value?.contentHtml || value?.html || "")
		this.profileUploadedMedia = normalizeMediaList(value?.profileUploadedMedia)
		this.backgroundUploadedMedia = normalizeMediaList(value?.backgroundUploadedMedia)
		this.editorMediaList = normalizeMediaList(value?.editorMediaList)
		this.locationConfirmed = Boolean(value?.locationConfirmed)
		this.confirmedAddress = normalizeString(
			value?.confirmedAddress || value?.addressText || value?.address,
		)
		this.confirmedLocation = this.location
	}

	toStoredProfile() {
		return {
			...this.toBaseJSON(),
			name: this.profileName,
			avatar: this.avatar,
			email: this.email,
			pin: this.pin,
			profileName: this.profileName,
			profileDescription: this.profileDescription,
			contentHtml: this.contentHtml,
			profileUploadedMedia: this.profileUploadedMedia,
			backgroundUploadedMedia: this.backgroundUploadedMedia,
			editorMediaList: this.editorMediaList,
			locationConfirmed: this.locationConfirmed,
			confirmedAddress: this.confirmedAddress,
			addressText: this.confirmedAddress,
			confirmedLocation: this.confirmedLocation
				? this.confirmedLocation.toJSON()
				: null,
		}
	}

	toRegistryEntry(savedAt = Date.now()) {
		const firstImage = this.profileUploadedMedia.find((entry) => entry && typeof entry === "object")
		const avatarUrl = normalizeString(firstImage?.bskyUrl || firstImage?.url || this.avatar)
		return {
			uuid: this.uuid,
			name: this.profileName,
			avatarUrl,
			savedAt: normalizeNumber(savedAt, Date.now()),
		}
	}

	static from(value = {}) {
		return value instanceof Profile ? value : new Profile(value)
	}
}

export class Chunk {
	constructor(value = {}) {
		this.uuid = normalizeString(value?.uuid)
		this.index = normalizeNumber(value?.index, 0)
		this.total = normalizeNumber(value?.total, 0)
		this.bundleFragment = String(
			value?.bundleFragment || value?.htmlFragment || "",
		)
		this.postBody = String(value?.postBody || "")
		this.forceCompression = Boolean(value?.forceCompression)
	}

	toJSON() {
		return {
			uuid: this.uuid,
			index: this.index,
			total: this.total,
			bundleFragment: this.bundleFragment,
			postBody: this.postBody,
			forceCompression: this.forceCompression,
		}
	}

	static from(value = {}) {
		return value instanceof Chunk ? value : new Chunk(value)
	}
}

export class BskyManifest {
	constructor(value = {}) {
		this.uuid = normalizeString(value?.uuid)
		this.type = normalizeString(value?.type) || (hasProfileTag(value?.tags) ? "profile" : "post")
		this.author = Author.from(
			value?.author || {
				id: value?.authorid || value?.authorId,
				displayName: value?.authorName,
				avatar: value?.authorAvatar,
			},
		)
		this.stamp = normalizeString(value?.stamp)
		this.email = normalizeString(value?.email)
		this.birthdate = normalizeString(value?.birthdate)
		this.profileImage = normalizeString(value?.profileImage)
		this.profilePic = normalizeString(value?.profilePic || this.profileImage)
		this.backgroundPic = normalizeString(value?.backgroundPic)
		this.name = normalizeString(value?.name || value?.title)
		this.description = normalizeString(value?.description)
		this.tags = normalizeTags(value?.tags)
		this.address = normalizeString(value?.address || value?.confirmedAddress)
		this.city = normalizeString(value?.city)
		this.state = normalizeString(value?.state)
		this.zip = normalizeString(value?.zip)
		this.country = normalizeString(value?.country)
		this.location = Location.from(value?.location)
		this.postUrl = normalizeString(value?.postUrl)
		this.chunks = (Array.isArray(value?.chunks) ? value.chunks : [])
			.map((entry) => Chunk.from(entry))
	}

	isProfile() {
		return this.type === "profile" || hasProfileTag(this.tags)
	}

	toJSON({ includeCompatAliases = true } = {}) {
		const next = {
			type: this.type,
			uuid: this.uuid,
			authorid: this.author.id,
			authorName: this.author.displayName,
			authorAvatar: this.author.avatar,
			stamp: this.stamp,
			email: this.email,
			birthdate: this.birthdate || null,
			profileImage: this.profileImage || null,
			profilePic: this.profilePic || null,
			backgroundPic: this.backgroundPic || null,
			name: this.name,
			description: this.description,
			tags: this.tags,
			address: this.address,
			city: this.city,
			state: this.state,
			zip: this.zip,
			country: this.country,
			location: this.location ? this.location.toJSON() : null,
			postUrl: this.postUrl || "",
			chunks: this.chunks.map((entry) => entry.toJSON()),
		}

		if (includeCompatAliases) {
			next.title = this.name
		}

		return next
	}

	static from(value = {}) {
		return value instanceof BskyManifest ? value : new BskyManifest(value)
	}
}

export class DbCacheEntry {
	constructor(key = "", value = null, options = {}) {
		this.key = normalizeString(key)
		this.value = value
		this.cachedAt = normalizeNumber(
			options?.cachedAt || value?._testCachedAt || value?.cachedAt,
			Date.now(),
		)
	}

	toJSON() {
		if (!this.value || typeof this.value !== "object") return this.value
		return {
			...this.value,
			cachedAt: this.cachedAt,
		}
	}
	static from(key = "", value = null, options = {}) {
		return new DbCacheEntry(key, value, options)
	}
}

export class DbCacheStore {
	constructor({ storeName = "", maxEntries = Infinity } = {}) {
		this.storeName = normalizeString(storeName)
		this.maxEntries = maxEntries
	}

	pruneMemoryStore(memoryStore) {
		if (!(memoryStore instanceof Map) || memoryStore.size <= this.maxEntries) {
			return
		}
		const entries = [...memoryStore.entries()].sort(
			(a, b) => normalizeNumber(a[1]?.cachedAt, 0) - normalizeNumber(b[1]?.cachedAt, 0),
		)
		const deleteCount = entries.length - this.maxEntries
		for (let i = 0; i < deleteCount; i += 1) {
			memoryStore.delete(entries[i][0])
		}
	}
	static from(config = {}) {
		return new DbCacheStore(config)
	}
}

export function normalizeSchemaTags(tags = []) {
	return normalizeTags(tags)
}

export function isProfileSchemaRecord(value = {}) {
	return hasProfileTag(value?.tags)
}

export { PROFILE_TAG }