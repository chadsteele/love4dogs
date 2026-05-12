export const defaultHashtags = [
    'wanted',
    'flight buddy',
    'NGO',
    'shelter',
    'urgent',
    'foster',
    'adopt',
    'dogwalker',
    'petsitter',
    'volunteer',
    'found',
    'lost',
    'rescued',
    'help',
    'share',
    'veterinary',
    'clinic',
    'donate',
    'fundraiser',
    'event',
    'training',
    'behavior',
];


export const postTypes = [
	{
		"value": "post",
		"label": "🔵 Post"
	},
	{
		"value": "wanted",
		"label": "❤️‍🔥 Wanted"
	},
	{
		"value": "id",
        "label": "👤 Personal",
        type: "identity"
	},
	{
		"value": "biz",
		"label": "🟢 Business",
        type: "identity"
	},
	{
		"value": "ngo",
		"label": "💚 Non-profit NGO",
        type: "identity"
	}
]

export function isKnownPostType(value) {
    const typeValue = String(value || "").trim()
    if (!typeValue) return false
    return postTypes.some((type) => String(type?.value || "") === typeValue)
}

export function isIdentityPostType(text) {
    const typeValue = String(text || "").trim()
    if (!typeValue) return false
    return postTypes.some(
        (type) => type.type === "identity" && String(type.value || "") === typeValue,
    )
}
