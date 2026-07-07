function normalizePart(value = "") {
	return String(value || "").trim();
}

function splitBeforeToken(input, token, useLastIndex = false) {
	if (!token) return input;
	const pos = useLastIndex ? input.lastIndexOf(token) : input.indexOf(token);
	if (pos <= 0) return input;

	const before = input.slice(0, pos);
	const after = input.slice(pos);

	if (before.endsWith(", ")) return before.slice(0, -2) + "\n" + after;
	if (before.endsWith(",")) return before.slice(0, -1) + "\n" + after;
	return before + "\n" + after;
}

function buildMultilineFromParts(parts, city, zip) {
	let out = "";
	for (let i = 0; i < parts.length; i++) {
		if (i > 0) {
			if (parts[i] === zip || parts[i] === city) {
				out += "\n";
			} else if (!out.endsWith("\n")) {
				out += ", ";
			}
		}
		out += parts[i];
	}
	return out;
}

export function formatDisplayAddress({ address = "", city = "", state = "", zip = "", country = "" }) {
	const addr = normalizePart(address);
	const c = normalizePart(city);
	const s = normalizePart(state);
	const z = normalizePart(zip);
	const cntry = normalizePart(country);

	if (!addr) {
		const locality = [c, s, z].filter(Boolean).join(", ");
		return [locality, cntry].filter(Boolean).join(", ");
	}

	const addrLower = addr.toLowerCase();
	const hasCity = Boolean(c && addrLower.includes(c.toLowerCase()));
	const hasState = Boolean(s && addrLower.includes(s.toLowerCase()));
	const hasZip = Boolean(z && addrLower.includes(z.toLowerCase()));
	const hasCountry = Boolean(cntry && addrLower.includes(cntry.toLowerCase()));

	const parts = [addr];
	if (c && !hasCity) parts.push(c);
	if (s && !hasState) parts.push(s);

	let zipIndexInParts = -1;
	if (z && !hasZip) {
		zipIndexInParts = parts.length;
		parts.push(z);
	}

	if (cntry && !hasCountry) parts.push(cntry);

	let joined = parts.join(", ");
	if (joined.length <= 100) return joined;

	if (hasZip) {
		joined = splitBeforeToken(joined, z, true);
	} else if (zipIndexInParts !== -1) {
		joined =
			parts.slice(0, zipIndexInParts).join(", ") +
			"\n" +
			parts.slice(zipIndexInParts).join(", ");
	}

	if (joined.length <= 100) return joined;

	if (hasCity) {
		return splitBeforeToken(joined, c, false);
	}

	if (parts.indexOf(c) !== -1) {
		return buildMultilineFromParts(parts, c, z);
	}

	return joined;
}
