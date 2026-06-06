import { redirect } from '@sveltejs/kit'
import { buildNewProfileEditPath } from '$lib/profileRegistry'

export function load() {
	throw redirect(307, buildNewProfileEditPath())
}
