export function load({params}) {
	const uuid = String(params?.uuid || "").trim()
	const slug = String(params?.slug || "").trim()

	return {
		uuid,
		slug,
	}
}
