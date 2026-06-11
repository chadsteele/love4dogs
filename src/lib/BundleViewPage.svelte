<script>
	import { onMount } from "svelte";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import NavBar from "$lib/NavBar.svelte";
	import Linkify from "$lib/Linkify.svelte";
	import ProfilePostHeader from "$lib/ProfilePostHeader.svelte";
	import AuthorRow from "$lib/AuthorRow.svelte";
	import { deriveBundleCreatedAtMs } from "$lib/dateTime";
	import {
		CircleAlert as NoticeIcon,
		User,
		Ellipsis as SettingsIcon,
		Pencil,
		Eye,
		EyeOff,
		UserX,
		UserCheck,
		Flag,
		Key,
		Trash2,
	} from "lucide-svelte";
	import { readSearchTerm, writeSearchTerm } from "$lib/searchStore";
	import {
		getProfile,
		setProfile,
		getAllPosts,
		setPost,
		getSetting,
		setSetting,
		deletePost,
	} from "$lib/db";
	import {
		listStoredProfiles,
		getCurrentProfileUuid,
	} from "$lib/profileRegistry";
	import { isLocalHost, removeApproxPostFromCache } from "$lib/utils";
	import { formatDisplayAddress } from "$lib/addressFormat";
	import Chat from "$lib/Chat.svelte";

	// ── props ──────────────────────────────────────────────────────────────────
	let { type = "post" } = $props();
	const isProfile = $derived(type === "profile");

	// ── profile-only cache constants ───────────────────────────────────────────
	const PROFILE_VIEW_CACHE_PREFIX = "love4dogs.profile-view-cache";
	const PROFILE_VIEW_CACHE_TTL_MS = 5 * 60 * 1000;
	const SESSION_BUNDLE_CACHE_PREFIX = "love4dogs.bundle-session";

	// ── reactive state ─────────────────────────────────────────────────────────
	let currentView = $state("feed");
	let loading = $state(true);
	let error = $state("");
	let jsonData = $state(null);
	let derivedCreatedAtMs = $state(0);
	let editProfileUrl = $state("");
	let localProfiles = $state([]);
	let blockedUuids = $state([]);
	let blockedAuthors = $state([]);
	let menuOpen = $state(false);
	let menuEl = $state(null);
	let toastMessage = $state("");
	let toastType = $state("success");
	let chunkUris = $state([]);
	let searchTerm = $state("");

	function setView(view = "feed") {
		currentView = String(view || "feed");
	}

	function asUrl(value) {
		return typeof value === "string" ? value : "";
	}

	function normalizeSearchTerm(value = "") {
		return String(value || "")
			.trim()
			.replace(/\s+/g, " ");
	}

	function normalizeTagToken(value = "") {
		return String(value || "")
			.trim()
			.toLowerCase()
			.replace(/^#/, "")
			.replace(/\s+/g, " ");
	}

	function collectTagTokens(...sources) {
		const tokens = [];
		for (const source of sources) {
			if (!source) continue;
			const candidates = Array.isArray(source) ? source : [source];
			for (const candidate of candidates) {
				if (!candidate || typeof candidate !== "object") continue;
				const raw = Array.isArray(candidate?.tags)
					? candidate.tags
					: [];
				for (const entry of raw) {
					const token = normalizeTagToken(entry);
					if (token) tokens.push(token);
				}
			}
		}
		return [...new Set(tokens)];
	}

	function isProfileData(data = {}) {
		const tags = collectTagTokens(
			data,
			data?.primary,
			data?.combined?.primary,
		);
		return tags.includes("profile");
	}

	function bundleHasProfileData(bundle = {}, primary = {}) {
		const tags = collectTagTokens(
			primary,
			bundle?.combined?.primary,
			Array.isArray(bundle?.posts) ? bundle.posts : [],
		);
		return tags.includes("profile");
	}

	function getCorrectPathType(data = {}) {
		return isProfileData(data) ? "profile" : "post";
	}

	function collectDisplayTags(data = {}) {
		const raw = Array.isArray(data?.tags) ? data.tags : [];
		const seen = new Set();
		const tags = [];
		for (const entry of raw) {
			const token = normalizeTagToken(entry);
			if (!token || seen.has(token)) continue;
			seen.add(token);
			tags.push(token);
			if (tags.length >= 20) break;
		}
		return tags;
	}

	function getSearchTokens(value = "") {
		return normalizeSearchTerm(value)
			.split(" ")
			.map((entry) => normalizeTagToken(entry))
			.filter(Boolean);
	}

	function toggleSearchTag(tag = "") {
		const token = normalizeTagToken(tag);
		if (!token) return;
		const next = [...getSearchTokens(searchTerm)];
		const index = next.indexOf(token);
		if (index >= 0) {
			next.splice(index, 1);
		} else {
			next.push(token);
		}
		searchTerm = next.join(" ");
		// Note: This intentionally only updates searchTerm; it does NOT trigger a search
	}

	// ── media helpers ──────────────────────────────────────────────────────────
	function cleanMediaAlt(value = "") {
		const raw = String(value || "").trim();
		if (!raw) return "";
		if (raw.startsWith("{") || raw.startsWith("[")) return "";
		return raw;
	}

	function collectBundleMedia(bundle = {}) {
		const posts = Array.isArray(bundle?.posts) ? bundle.posts : [];
		const images = [];
		const videos = [];
		const seenImages = new Set();
		const seenVideos = new Set();
		for (const entry of posts) {
			const post = entry?.post || entry || {};
			const embedView = post?.embed;
			const mediaView =
				embedView?.$type === "app.bsky.embed.recordWithMedia#view"
					? embedView.media
					: embedView;
			if (mediaView?.$type === "app.bsky.embed.images#view") {
				for (const image of mediaView.images || []) {
					const src = String(
						image?.fullsize || image?.thumb || "",
					).trim();
					if (!src || seenImages.has(src)) continue;
					seenImages.add(src);
					images.push({ src, alt: cleanMediaAlt(image?.alt || "") });
				}
			}
			if (mediaView?.$type === "app.bsky.embed.video#view") {
				const playlist = String(mediaView?.playlist || "").trim();
				if (!playlist || seenVideos.has(playlist)) continue;
				seenVideos.add(playlist);
				videos.push({
					src: playlist,
					poster: String(mediaView?.thumbnail || "").trim(),
					alt: cleanMediaAlt(mediaView?.alt || ""),
				});
			}
		}
		return { images, videos };
	}

	function extractAuthorFromBundle(bundle = {}) {
		const posts = Array.isArray(bundle?.posts) ? bundle.posts : [];
		for (const entry of posts) {
			const post = entry?.post || entry || {};
			const author = post?.author || {};
			const authorName = String(
				author?.displayName || author?.handle || "",
			).trim();
			const authorAvatar = String(
				author?.avatar || author?.avatarUrl || "",
			).trim();
			if (authorName || authorAvatar) return { authorName, authorAvatar };
		}
		return { authorName: "", authorAvatar: "" };
	}

	function bodyHtmlContainsMedia(html = "") {
		return /<(img|video|iframe)\b/i.test(String(html || ""));
	}

	function buildMapHref(data = {}) {
		const lat = Number(data?.location?.lat);
		const lon = Number(data?.location?.lon);
		if (Number.isFinite(lat) && Number.isFinite(lon)) {
			return `https://maps.google.com/maps?q=${encodeURIComponent(`${lat},${lon}`)}&z=15`;
		}
		const fullAddress = formatDisplayAddress({
			address: data?.address,
			city: data?.city || data?.location?.city,
			state: data?.state || data?.location?.state,
			zip: data?.zip || data?.location?.zip,
			country: data?.country || data?.location?.country,
		});
		if (!fullAddress) return "";
		return `https://maps.google.com/maps?q=${encodeURIComponent(fullAddress)}&z=15`;
	}

	// ── profile-only: chunk URI helpers ───────────────────────────────────────
	function parseChunkAltPayload(alt = "") {
		const source = String(alt || "").trim();
		if (!source) return null;
		try {
			const parsed = JSON.parse(source);
			if (!parsed || typeof parsed !== "object") return null;
			if (!Number.isFinite(Number(parsed?.i))) return null;
			if (!Object.prototype.hasOwnProperty.call(parsed, "h")) return null;
			return parsed;
		} catch {
			return null;
		}
	}

	function collectChunkUrisFromPosts(posts = [], targetUuid = "") {
		const expectedUuid = String(targetUuid || "").trim();
		const uris = [];
		for (const post of Array.isArray(posts) ? posts : []) {
			const uri = String(post?.uri || "").trim();
			if (!uri || uris.includes(uri)) continue;
			const embed = post?.embed;
			const media =
				embed?.$type === "app.bsky.embed.recordWithMedia#view"
					? embed.media
					: embed;
			const images =
				media?.$type === "app.bsky.embed.images#view"
					? media.images || []
					: [];
			let isChunk = false;
			for (const image of images) {
				const payload = parseChunkAltPayload(image?.alt || "");
				if (!payload) continue;
				const payloadUuid = String(
					payload?.u || payload?.uuid || "",
				).trim();
				if (expectedUuid && payloadUuid !== expectedUuid) continue;
				isChunk = true;
				break;
			}
			if (isChunk) uris.push(uri);
		}
		return uris;
	}

	function atUriToBskyUrl(uri = "") {
		const match = String(uri || "")
			.trim()
			.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/i);
		if (!match) return "";
		return `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`;
	}

	function downloadChunkUris() {
		if (!chunkUris.length) return;
		const blob = new Blob([`${chunkUris.join("\n")}\n`], {
			type: "text/plain;charset=utf-8",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `love4dogs-chunks-${page.params?.uuid || "bundle"}.txt`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	// ── profile-only: local/session cache helpers ──────────────────────────────
	function readSessionBundle(targetUuid) {
		if (typeof sessionStorage === "undefined") return null;
		try {
			return JSON.parse(
				sessionStorage.getItem(
					`${SESSION_BUNDLE_CACHE_PREFIX}:${targetUuid}`,
				) || "null",
			);
		} catch {
			return null;
		}
	}

	function writeSessionBundle(targetUuid, bundle) {
		if (typeof sessionStorage === "undefined" || !bundle) return;
		try {
			sessionStorage.setItem(
				`${SESSION_BUNDLE_CACHE_PREFIX}:${targetUuid}`,
				JSON.stringify(bundle),
			);
		} catch {}
	}

	async function readLocalProfile(targetUuid) {
		try {
			const parsed = await getProfile(targetUuid);
			if (!parsed?.cachedAt || !parsed?.data) {
				return null;
			}
			if (Date.now() - parsed.cachedAt > PROFILE_VIEW_CACHE_TTL_MS) {
				return null;
			}
			return parsed.data;
		} catch {
			return null;
		}
	}

	async function writeLocalProfile(targetUuid, data) {
		try {
			await setProfile(targetUuid, { cachedAt: Date.now(), data });
		} catch {}
	}

	// ── derived values ─────────────────────────────────────────────────────────
	const uuid = $derived(String(page.params?.uuid || "").trim());
	const authorId = $derived(
		String(jsonData?.authorid || jsonData?.authorId || "").trim(),
	);
	const targetAuthorId = $derived(
		String(
			jsonData?.authorid || jsonData?.authorId || (isProfile ? uuid : ""),
		).trim(),
	);
	const isAuthor = $derived(
		localProfiles.some(
			(p) => p.uuid === (isProfile ? uuid : targetAuthorId),
		),
	);
	const authorSearchHref = $derived(
		authorId
			? `/search/${encodeURIComponent("uuid")}/${encodeURIComponent(authorId)}`
			: "",
	);
	const mapHref = $derived(buildMapHref(jsonData));
	const displayTags = $derived(collectDisplayTags(jsonData || {}));
	const hasTestTag = $derived(displayTags.includes("test"));
	const activeSearchTokens = $derived(new Set(getSearchTokens(searchTerm)));


	// ── data loading ───────────────────────────────────────────────────────────
	onMount(async () => {
		if (window.location.hash) {
			const targetId = window.location.hash;
			let element = null;
			try {
				element = document.querySelector(targetId);
			} catch {
				// Invalid CSS selector — skip scroll
			}

			const scrollToTarget = (el) => {
				const observer = new IntersectionObserver(
					(entries, obs) => {
						if (entries[0].isIntersecting) {
							obs.disconnect();
						} else {
							el.scrollIntoView({ behavior: "smooth" });
						}
					},
					{ threshold: 0.1 },
				);
				observer.observe(el);
			};

			if (element) {
				scrollToTarget(element);
			} else {
				// Element not yet in DOM — wait for it via MutationObserver
				const mutation = new MutationObserver(() => {
					let el = null;
					try {
						el = document.querySelector(targetId);
					} catch {
						mutation.disconnect();
						return;
					}
					if (el) {
						mutation.disconnect();
						scrollToTarget(el);
					}
				});
				mutation.observe(document.body, { childList: true, subtree: true });
			}
		}

		//---
		try {
			localProfiles = await listStoredProfiles();
			blockedUuids = await getSetting("love4dogs.blocked-uuids", []);
			blockedAuthors = await getSetting("love4dogs.blocked-authors", []);
		} catch (e) {
			console.error("Failed to load moderation settings:", e);
		}

		try {
			if (typeof window !== "undefined") {
				const pathTerms = window.location.pathname.startsWith(
					"/search/",
				)
					? window.location.pathname
							.slice("/search/".length)
							.split("/")
							.map((segment) => decodeURIComponent(segment || ""))
							.join(" ")
					: "";
				const qParam = new URLSearchParams(window.location.search).get(
					"q",
				);
				// Priority: URL terms > query param > localStorage > nothing
				if (pathTerms) {
					searchTerm = normalizeSearchTerm(pathTerms);
				} else if (qParam) {
					searchTerm = normalizeSearchTerm(qParam);
				} else {
					const savedTerm = await readSearchTerm();
					searchTerm = savedTerm || "";
				}
			}
		} catch (e) {
			console.error("Failed to read search term preference", e);
		}

		try {
			if (!uuid) throw new Error("UUID is required");
			const slug = String(page.params?.slug || "");
			const slugPath = slug ? `/${slug}` : "";

			// Check if the UUID is actually a comment with a context
			let commentContext = null;
			try {
				// 1. Check local IndexedDB first
				const cachedPosts = await getAllPosts();
				for (const p of cachedPosts) {
					if (p.posts && Array.isArray(p.posts)) {
						for (const post of p.posts) {
							if (post.imageAlts && post.imageAlts.length > 0) {
								try {
									const payload = JSON.parse(
										post.imageAlts[0],
									);
									if (
										payload &&
										payload.uuid === uuid &&
										payload.context
									) {
										commentContext = payload.context;
										break;
									}
								} catch {}
							}
						}
					}
					if (commentContext) break;
				}

				// 2. If not found locally, fetch from feed API
				if (!commentContext) {
					const res = await fetch(
						`/api/feed?query=${encodeURIComponent(uuid)}&chat=1`,
					);
					if (res.ok) {
						const data = await res.json();
						const posts = data?.posts || [];
						for (const post of posts) {
							if (post.imageAlts && post.imageAlts.length > 0) {
								try {
									const payload = JSON.parse(
										post.imageAlts[0],
									);
									if (
										payload &&
										payload.uuid === uuid &&
										payload.context
									) {
										commentContext = payload.context;
										break;
									}
								} catch {}
							}
						}
					}
				}
			} catch (e) {
				console.error("Error checking if uuid is comment:", e);
			}

			if (commentContext) {
				const currentHash =
					typeof window !== "undefined" ? window.location.hash : "";
				const targetHash = currentHash || `#${uuid}`;
				return goto(
					`/${type}/view/${encodeURIComponent(commentContext)}${slugPath}${targetHash}`,
					{
						replaceState: true,
					},
				);
			}

			if (isProfile) {
				const sessionBundle = readSessionBundle(uuid);
				if (sessionBundle) {
					const { primary, subsequent } =
						sessionBundle?.combined || {};
					jsonData = {
						...(primary || {}),
						html: Array.isArray(subsequent)
							? subsequent.join("")
							: "",
					};
					chunkUris = collectChunkUrisFromPosts(
						Array.isArray(sessionBundle?.posts)
							? sessionBundle.posts
							: [],
						uuid,
					);
					editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`;
					return;
				}
				const cached = await readLocalProfile(uuid);
				if (cached) {
					jsonData = cached;
					editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`;
					return;
				}
			}

			const response = await fetch(
				`/api/profile-bundle?uuid=${encodeURIComponent(uuid)}`,
			);
			const bundle = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(bundle?.error || "Failed to load data");
			}

			const { primary, subsequent } = bundle?.combined || {};
			const htmlChunks = Array.isArray(subsequent)
				? subsequent.join("")
				: "";

			if (isProfile) {
				derivedCreatedAtMs = deriveBundleCreatedAtMs(bundle);
				let stampValue = "";
				if (
					typeof primary?.stamp === "string" &&
					primary.stamp.trim()
				) {
					stampValue = primary.stamp.trim();
				} else if (derivedCreatedAtMs > 0) {
					stampValue = String(derivedCreatedAtMs);
				}
				jsonData = {
					...(primary || {}),
					html: htmlChunks,
					stamp: stampValue,
				};
				await writeLocalProfile(uuid, jsonData);
				writeSessionBundle(uuid, bundle);
				chunkUris = collectChunkUrisFromPosts(
					Array.isArray(bundle?.posts) ? bundle.posts : [],
					uuid,
				);
				editProfileUrl = `/profile/edit/${encodeURIComponent(uuid)}${slugPath}`;
				// Route if data doesn't have profile tag
				if (!bundleHasProfileData(bundle, jsonData)) {
					const hash =
						typeof window !== "undefined"
							? window.location.hash
							: "";
					return goto(
						`/post/view/${encodeURIComponent(uuid)}${slugPath}${hash}`,
						{
							replaceState: true,
						},
					);
				}
			} else {
				const media = collectBundleMedia(bundle);
				const author = extractAuthorFromBundle(bundle);
				derivedCreatedAtMs = deriveBundleCreatedAtMs(bundle);
				jsonData = {
					...(primary || {}),
					html: htmlChunks,
					images: media.images,
					videos: media.videos,
					authorName:
						String(primary?.authorName || "").trim() ||
						author.authorName,
					authorAvatar:
						String(primary?.authorAvatar || "").trim() ||
						author.authorAvatar,
				};
				chunkUris = collectChunkUrisFromPosts(
					Array.isArray(bundle?.posts) ? bundle.posts : [],
					uuid,
				);
				// Cache post to IndexedDB
				await setPost(jsonData.uri || uuid, jsonData);
				// Route if data has profile tag
				if (bundleHasProfileData(bundle, jsonData)) {
					const hash =
						typeof window !== "undefined"
							? window.location.hash
							: "";
					return goto(
						`/profile/view/${encodeURIComponent(uuid)}${slugPath}${hash}`,
						{
							replaceState: true,
						},
					);
				}
			}
		} catch (e) {
			// Try offline cache fallback
			try {
				if (isProfile) {
					const cached = await readLocalProfile(uuid);
					if (cached) {
						jsonData = cached;
						loading = false;
						return;
					}
				} else {
					const cachedPosts = await getAllPosts();
					const cached = cachedPosts.find(
						(p) => p.uuid === uuid || p.uri === uuid,
					);
					if (cached) {
						jsonData = cached;
						loading = false;
						return;
					}
				}
			} catch (cacheErr) {
				console.error("Cache fallback failed:", cacheErr);
			}
			error = e?.message || "Failed to load";
		} finally {
			loading = false;
		}
	});

	// Persist search term to localStorage whenever it changes
	$effect(() => {
		writeSearchTerm(searchTerm);
	});

	// Close moderation menu when clicking outside
	$effect(() => {
		if (!menuOpen) return;

		const onPointerDown = (event) => {
			if (!menuEl?.contains(event.target)) {
				menuOpen = false;
			}
		};

		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
		};
	});

	async function toggleBlockUuid() {
		try {
			if (blockedUuids.includes(uuid)) {
				blockedUuids = blockedUuids.filter((id) => id !== uuid);
				await setSetting("love4dogs.blocked-uuids", blockedUuids);
				showToast("Content unblocked.");

				// Send DM to admin-love-4-dogs.bsky.social with unblock structured JSON
				const fromUuid = await getCurrentProfileUuid();
				await fetch("/api/send-dm", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						from: fromUuid || "",
						unblock: uuid,
					}),
				});
			} else {
				blockedUuids = [...blockedUuids, uuid];
				await setSetting("love4dogs.blocked-uuids", blockedUuids);
				showToast("Content blocked.");

				// Send DM to admin-love-4-dogs.bsky.social with structured JSON
				const fromUuid = await getCurrentProfileUuid();
				await fetch("/api/send-dm", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						from: fromUuid || "",
						block: uuid,
					}),
				});
			}
		} catch (err) {
			showToast("Failed to update block list.", "error");
		}
	}

	async function toggleBlockAuthor() {
		if (!targetAuthorId) return;
		try {
			if (blockedAuthors.includes(targetAuthorId)) {
				blockedAuthors = blockedAuthors.filter(
					(id) => id !== targetAuthorId,
				);
				await setSetting("love4dogs.blocked-authors", blockedAuthors);
				showToast("Author unblocked.");

				// Send DM to admin-love-4-dogs.bsky.social with unblock structured JSON
				const fromUuid = await getCurrentProfileUuid();
				await fetch("/api/send-dm", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						from: fromUuid || "",
						unblock: targetAuthorId,
					}),
				});
			} else {
				blockedAuthors = [...blockedAuthors, targetAuthorId];
				await setSetting("love4dogs.blocked-authors", blockedAuthors);
				showToast("Author blocked.");

				// Send DM to admin-love-4-dogs.bsky.social with structured JSON
				const fromUuid = await getCurrentProfileUuid();
				await fetch("/api/send-dm", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						from: fromUuid || "",
						block: targetAuthorId,
					}),
				});
			}
		} catch (err) {
			showToast("Failed to update blocked authors list.", "error");
		}
	}

	async function claimOwnership() {
		try {
			showToast("Sending ownership claim...");
			const fromUuid = await getCurrentProfileUuid();
			const res = await fetch("/api/send-dm", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					from: fromUuid || "",
					claim: uuid,
				}),
			});
			if (res.ok) {
				showToast("Ownership claim sent to administrator.");
			} else {
				throw new Error("Failed to send claim");
			}
		} catch (err) {
			showToast("Failed to send ownership claim.", "error");
		}
	}

	function showToast(message, type = "success") {
		toastMessage = message;
		toastType = type;
		setTimeout(() => {
			if (toastMessage === message) {
				toastMessage = "";
			}
		}, 4000);
	}

	async function handleDeletePost() {
		const confirmDelete = confirm(
			"Are you sure you want to delete this post? This will permanently remove it from both the local database and Bluesky.",
		);
		if (!confirmDelete) return;

		try {
			showToast("Deleting post...");

			const urisToDelete = [...chunkUris];
			const mainUri =
				jsonData?.uri || jsonData?.rootUri || jsonData?.atUri;
			if (mainUri && !urisToDelete.includes(mainUri)) {
				urisToDelete.push(mainUri);
			}

			if (urisToDelete.length === 0) {
				showToast("No post URIs found to delete.", "error");
				return;
			}

			for (const uri of urisToDelete) {
				const formData = new FormData();
				formData.append("mode", "delete-post-uri");
				formData.append("uri", uri);
				const res = await fetch("/api/post", {
					method: "POST",
					body: formData,
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					console.warn(
						`Failed to delete post on Bluesky for URI ${uri}:`,
						data.error,
					);
				}
			}

			for (const uri of urisToDelete) {
				await deletePost(uri);
				await removeApproxPostFromCache(uri);
			}

			showToast("Post deleted successfully.");
			setTimeout(() => {
				goto("/map");
			}, 1500);
		} catch (err) {
			console.error("Delete failed:", err);
			showToast("Failed to delete post.", "error");
		}
	}
</script>

<svelte:head>
	<title>{isProfile ? "Profile" : "Post"} | Love4Dogs</title>
</svelte:head>

<main
	class="page{isProfile ? ' is-profile' : ''} {isProfile
		? 'profile-view-page'
		: 'post-view-page'}"
>
	<NavBar
		bind:searchTerm
		{currentView}
		{editProfileUrl}
		onSetView={setView}
	/>

	{#if loading || (!error && !jsonData)}
		<section
			class="panel hero loading-skeleton"
			aria-busy="true"
			aria-label="Loading {isProfile ? 'profile' : 'post'}"
		>
			{#if isProfile}
				<div class="skeleton-cover"></div>
			{/if}
			<div class="hero-body">
				<div class="skeleton-row">
					<div class="skeleton skeleton-avatar"></div>
					<div class="skeleton-stack">
						<div
							class="skeleton skeleton-line skeleton-line-lg"
						></div>
						<div
							class="skeleton skeleton-line skeleton-line-sm"
						></div>
					</div>
				</div>
				{#if !isProfile}
					<div class="skeleton skeleton-pill"></div>
				{/if}
				<div class="skeleton skeleton-line skeleton-line-xl"></div>
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				{#if !isProfile}
					<div class="skeleton skeleton-media"></div>
				{/if}
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				<div class="skeleton skeleton-line skeleton-line-wide"></div>
				<!-- Profile-specific skeletons can remain conditional if needed -->
				{#if isProfile}
					<div class="skeleton skeleton-chunk-header"></div>
					<div
						class="skeleton skeleton-line skeleton-line-wide"
					></div>
				{/if}
			</div>
		</section>
	{:else if error}
		<p class="error">{error}</p>
	{:else if jsonData}
		<section class="panel hero">
			<!-- Gear icon menu in the upper right corner -->
			<div class="moderation-menu-wrap" bind:this={menuEl}>
				<button
					type="button"
					class="gear-btn"
					aria-label="Moderation menu"
					onclick={() => (menuOpen = !menuOpen)}
				>
					<SettingsIcon size={20} />
				</button>
				{#if menuOpen}
					<div class="moderation-dropdown">
						{#if isAuthor}
							<button
								type="button"
								onclick={() => {
									menuOpen = false;
									if (isProfile) {
										goto(
											`/profile/edit/${encodeURIComponent(uuid)}`,
										);
									} else {
										goto(
											`/post/edit/${encodeURIComponent(uuid)}`,
										);
									}
								}}
							>
								<Pencil size={16} />
								Edit
							</button>
						{/if}
						<button
							type="button"
							onclick={async () => {
								menuOpen = false;
								await toggleBlockUuid();
							}}
						>
							{#if blockedUuids.includes(uuid)}
								<Eye size={16} />
								Unblock
							{:else}
								<EyeOff size={16} />
								Block
							{/if}
						</button>
						{#if targetAuthorId}
							<button
								type="button"
								onclick={async () => {
									menuOpen = false;
									await toggleBlockAuthor();
								}}
							>
								{#if blockedAuthors.includes(targetAuthorId)}
									<UserCheck size={16} />
									Unblock author
								{:else}
									<UserX size={16} />
									Block author
								{/if}
							</button>
						{/if}
						<button
							type="button"
							onclick={() => {
								menuOpen = false;
								goto(`/report/${encodeURIComponent(uuid)}`);
							}}
						>
							<Flag size={16} />
							Report
						</button>
						<button
							type="button"
							onclick={async () => {
								menuOpen = false;
								await claimOwnership();
							}}
						>
							<Key size={16} />
							Claim ownership
						</button>
						{#if !isProfile && (isAuthor || isLocalHost())}
							<button
								type="button"
								onclick={async () => {
									menuOpen = false;
									await handleDeletePost();
								}}
							>
								<Trash2 size={16} />
								Delete
							</button>
						{/if}
					</div>
				{/if}
			</div>

			{#if isProfile}
				<ProfilePostHeader
					profilePic={asUrl(jsonData?.profilePic)}
					backgroundPic={asUrl(jsonData?.backgroundPic)}
					url={asUrl(jsonData?.canonicalurl)}
				/>
			{/if}

			<div class="hero-body">
				{#if displayTags.length > 0}
					<div class="tag-pills" aria-label="Description tags">
						{#each displayTags as tag}
							<button
								type="button"
								class="tag-pill{activeSearchTokens.has(tag)
									? ' is-active'
									: ''}"
								aria-pressed={activeSearchTokens.has(tag)}
								onclick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									toggleSearchTag(tag);
								}}
							>
								#{tag}
							</button>
						{/each}
					</div>
				{/if}
				<AuthorRow
					avatar={!isProfile ? jsonData?.authorAvatar : null}
					name={(isProfile
						? jsonData?.name ||
							jsonData?.title ||
							jsonData?.authorName
						: jsonData?.authorName) || "Anonymous"}
					dateValue={jsonData?.stamp ||
						(derivedCreatedAtMs > 0
							? String(derivedCreatedAtMs)
							: "")}
					dateAllowBase36={true}
					href={isProfile
						? asUrl(jsonData?.canonicalurl) || undefined
						: authorSearchHref || undefined}
					location={mapHref && jsonData
						? formatDisplayAddress({
								address: jsonData.address,
								city: jsonData.city || jsonData.location?.city,
								state:
									jsonData.state || jsonData.location?.state,
								zip: jsonData.zip || jsonData.location?.zip,
								country:
									jsonData.country ||
									jsonData.location?.country,
							})
						: null}
					locationHref={mapHref || null}
					hideAvatar={isProfile}
				/>
				{#if hasTestTag}
					<div class="test-post-notice" role="note">
						<NoticeIcon size={16} aria-hidden="true" />
						<span
							>Notice: this is not a real post. It is for
							demonstration only.</span
						>
					</div>
				{/if}
				{#if !isProfile && jsonData?.name}
					<h2 class="hero-name">{jsonData.name}</h2>
				{/if}

				{#if jsonData?.description}
					<div class="hero-description">
						<Linkify>{jsonData.description}</Linkify>
					</div>
				{/if}

				{#if !isProfile && !bodyHtmlContainsMedia(jsonData?.html) && (jsonData?.images?.length || jsonData?.videos?.length)}
					<section class="media-gallery" aria-label="Post media">
						{#each jsonData?.images || [] as image}
							<figure class="media-card">
								<img
									src={image.src}
									alt={image.alt || "Post image"}
									loading="lazy"
								/>
								{#if image.alt}
									<figcaption>{image.alt}</figcaption>
								{/if}
							</figure>
						{/each}
						{#each jsonData?.videos || [] as video}
							<figure class="media-card">
								<video
									controls
									playsinline
									preload="metadata"
									poster={video.poster || undefined}
								>
									<source src={video.src} />
								</video>
								{#if video.alt}
									<figcaption>{video.alt}</figcaption>
								{/if}
							</figure>
						{/each}
					</section>
				{/if}

				<div class="content-html">
					{@html jsonData?.html || ""}
				</div>
			</div>
		</section>

		<Chat context={uuid} />
	{/if}

	{#if toastMessage}
		<div class="custom-toast {toastType}">
			{toastMessage}
		</div>
	{/if}
</main>

<style>
	.page {
		max-width: 1080px;
		margin: 0 auto;
		padding: 1rem;
		display: grid;
		gap: 0.8rem;
		min-width: 0;
	}

	.panel {
		background: rgba(255, 250, 241, 0.9);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 0.9rem;
		box-shadow: 0 8px 20px rgba(65, 42, 20, 0.1);
		min-width: 0;
		overflow-x: hidden;
	}

	.hero {
		position: relative;
		overflow: visible;
		padding: 0;
		border: 0;
		border-radius: 16px;
		box-shadow: 0 8px 20px rgba(65, 42, 20, 0.1);
	}

	.moderation-menu-wrap {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 100;
	}

	.gear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		border: 1px solid rgba(48, 80, 54, 0.2);
		background: rgba(255, 255, 255, 0.9);
		color: #3b6e4f;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		transition: all 0.2s ease;
	}

	.gear-btn:hover {
		background: #fff;
		transform: rotate(45deg);
		color: #2b533a;
	}

	.moderation-dropdown {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 180px;
		background: #ffffff;
		border: 1px solid #d7c8b6;
		border-radius: 12px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
		padding: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		z-index: 101;
	}

	.moderation-dropdown button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.55rem 0.75rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: #4a3e3d;
		font-size: 0.9rem;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		box-sizing: border-box;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.moderation-dropdown button:hover {
		background: #f3ece1;
		color: #1a1615;
	}

	/* Toast Notification */
	.custom-toast {
		position: fixed;
		bottom: 2rem;
		right: 2rem;
		background: #3b6e4f;
		color: #ffffff;
		padding: 0.75rem 1.25rem;
		border-radius: 10px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
		z-index: 2000;
		font-weight: 600;
		font-size: 0.95rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.custom-toast.error {
		background: #8e2f21;
	}

	.hero-body {
		padding: 0 1rem 1rem;
	}

	/* ── post-only: location ──────────────────────────────────────────────── */

	/* Location styles are now handled by AuthorRow component */

	/* ── shared: name + description ───────────────────────────────────────── */
	.hero-name {
		margin: 0;
		padding: 1rem 0 0.7rem;
		font-size: clamp(1.35rem, 2.5vw, 1.95rem);
		line-height: 1.15;
		color: #2b271f;
		word-break: break-word;
	}

	.hero-description {
		margin: 0;
		padding: 1rem;
		font-size: 1rem;
		color: #51463a;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.tag-pills {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.5rem 0 0.45rem;
	}

	.tag-pill {
		border: 1px solid rgba(59, 110, 79, 0.3);
		background: rgba(59, 110, 79, 0.1);
		color: #305741;
		border-radius: 999px;
		padding: 0.22rem 0.65rem;
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.2;
		cursor: pointer;
	}

	.tag-pill:hover,
	.tag-pill:focus-visible {
		border-color: #305741;
		background: rgba(59, 110, 79, 0.18);
	}

	.tag-pill.is-active {
		background: #305741;
		border-color: #305741;
		color: #fffaf1;
	}

	.test-post-notice {
		margin: 0.45rem 0 0.65rem;
		padding: 0.6rem 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border-radius: 10px;
		border: 1px solid rgba(186, 122, 35, 0.45);
		background: rgba(255, 220, 160, 0.35);
		color: #6b4515;
		font-size: 0.9rem;
		line-height: 1.3;
		font-weight: 600;
	}

	/* ── post-only: media gallery ─────────────────────────────────────────── */
	.media-gallery {
		display: grid;
		gap: 1rem;
		padding: 0.25rem 0 1rem;
	}

	.media-card {
		margin: 0;
	}

	.media-card img,
	.media-card video {
		display: block;
		width: 100%;
		max-width: min(100%, 720px);
		height: auto;
		margin: 0 auto;
		border-radius: 14px;
		box-shadow: 0 12px 28px rgba(65, 42, 20, 0.18);
		background: #fff;
	}

	.media-card figcaption {
		margin-top: 0.4rem;
		text-align: center;
		font-size: 0.85rem;
		color: #5f665f;
	}

	/* ── shared: content HTML ─────────────────────────────────────────────── */
	.content-html {
		padding: 1rem;
		margin-top: 0;
		line-height: 1.55;
		word-break: break-word;
	}

	/* ── shared: error ────────────────────────────────────────────────────── */
	.error {
		padding: 0.5rem 0;
		color: #8e2f21;
	}

	/* ── skeleton ─────────────────────────────────────────────────────────── */
	.loading-skeleton {
		min-height: 360px;
		overflow: hidden;
	}

	.skeleton-cover {
		width: 100%;
		height: 220px;
		background: linear-gradient(
			90deg,
			#e8e1d7 25%,
			#f6efe6 37%,
			#e8e1d7 63%
		);
		background-size: 400% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}

	.skeleton-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	.skeleton-stack {
		display: grid;
		gap: 0.35rem;
		flex: 1;
	}

	.skeleton {
		position: relative;
		overflow: hidden;
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			#e8e1d7 25%,
			#f6efe6 37%,
			#e8e1d7 63%
		);
		background-size: 400% 100%;
		animation: skeleton-shimmer 1.4s ease-in-out infinite;
	}

	.skeleton::after {
		content: "";
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent,
			rgba(255, 255, 255, 0.35),
			transparent
		);
		transform: translateX(-100%);
		animation: skeleton-sweep 1.4s ease-in-out infinite;
	}

	.skeleton-avatar {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		flex: 0 0 60px;
		border: 4px solid rgba(255, 250, 241, 0.9);
	}

	.skeleton-line {
		height: 12px;
		border-radius: 999px;
	}

	.skeleton-line-sm {
		width: 100%;
	}

	.skeleton-line-lg {
		width: 100%;
	}

	.skeleton-line-xl {
		width: 100%;
		height: 20px;
		margin-top: 0.8rem;
	}

	.skeleton-line-wide {
		width: 100%;
	}

	.skeleton-pill {
		width: 88px;
		height: 22px;
		margin-top: 0.55rem;
	}

	.skeleton-media {
		width: min(100%, 720px);
		aspect-ratio: 16 / 9;
		border-radius: 14px;
		margin: 0.8rem 0 0.2rem;
	}

	.skeleton-chunk-header {
		width: 140px;
		height: 18px;
		margin-top: 1.1rem;
	}

	@keyframes skeleton-shimmer {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: 0 0;
		}
	}

	@keyframes skeleton-sweep {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(100%);
		}
	}

	@media (max-width: 768px) {
		.hero-body {
			padding: 0 0.8rem 0.8rem;
		}
	}
</style>
