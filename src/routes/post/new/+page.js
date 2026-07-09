import { redirect } from '@sveltejs/kit'
import { generateProfileUuid } from '$lib/profileRegistry'

export function load() {
	const uuid = encodeURIComponent(generateProfileUuid())
	throw redirect(307, `/post/edit/${uuid}`)
}
