const LOCAL_TAG_KEY = "love4dogs.tag-counts"

class TagCountsStore {
	counts = $state({});

	constructor() {
		this.load();
		if (typeof window !== "undefined") {
			window.addEventListener("storage", (e) => {
				if (e.key === LOCAL_TAG_KEY) {
					this.load();
				}
			});
		}
	}

	load() {
		if (typeof window === "undefined") return;
		try {
			this.counts = JSON.parse(localStorage.getItem(LOCAL_TAG_KEY) || "{}");
		} catch {
			this.counts = {};
		}
	}

	increment(tag) {
		if (typeof window === "undefined") return;
		const normalized = tag.toLowerCase();
		const currentCount = Number(this.counts[normalized] || 0);
		this.counts[normalized] = currentCount + 1;
		try {
			localStorage.setItem(LOCAL_TAG_KEY, JSON.stringify(this.counts));
		} catch {
			// ignore
		}
	}
}

export const tagCountsStore = new TagCountsStore();
