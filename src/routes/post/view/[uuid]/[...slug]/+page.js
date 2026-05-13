export function load({params}) {
	const uuid = String(params?.uuid || "").trim()

	return {
		uuid,
	}
}
