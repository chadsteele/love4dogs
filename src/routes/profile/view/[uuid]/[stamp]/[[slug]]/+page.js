export function load({ params }) {
	const { uuid, stamp } = params
	return {
		uuid,
		stamp,
	}
}
