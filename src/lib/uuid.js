import { customAlphabet } from 'nanoid';

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generates a lowercase alphanumeric ID of the specified length.
 * Defaults to 8 characters.
 * @type {(size?: number) => string}
 */
export const generateUuid = customAlphabet(alphabet, 8);
