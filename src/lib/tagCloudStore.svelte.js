const LOCAL_STATE_KEY = "love4dogs.tag-cloud-state"

class TagCloudStore {
	state = $state("normal") // "normal" (scroll), "stacked", "hidden"

	constructor() {
		this.load()
		if (typeof window !== "undefined") {
			window.addEventListener("storage", (e) => {
				if (e.key === LOCAL_STATE_KEY) {
					this.load()
				}
			})
		}
	}

	load() {
		if (typeof window === "undefined") return
		try {
			const saved = localStorage.getItem(LOCAL_STATE_KEY)
			if (saved === "normal" || saved === "stacked" || saved === "hidden") {
				this.state = saved
			} else {
				this.state = "normal"
			}
		} catch {
			this.state = "normal"
		}
	}

	toggle() {
		if (typeof window === "undefined") return
		if (this.state === "normal") {
			this.state = "stacked"
		} else if (this.state === "stacked") {
			this.state = "hidden"
		} else {
			this.state = "normal"
		}
		try {
			localStorage.setItem(LOCAL_STATE_KEY, this.state)
		} catch {
			// ignore
		}
	}
}

export const tagCloudStore = new TagCloudStore()
