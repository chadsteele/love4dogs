export function formatDisplayAddress({ address = "", city = "", state = "", zip = "", country = "" }) {
	const addr = String(address || "").trim();
	const c = String(city || "").trim();
	const s = String(state || "").trim();
	const z = String(zip || "").trim();
	const cntry = String(country || "").trim();

	if (!addr) {
		const locality = [c, s, z].filter(Boolean).join(", ");
		return [locality, cntry].filter(Boolean).join(", ");
	}

	const addrLower = addr.toLowerCase();
	const cLower = c.toLowerCase();
	const sLower = s.toLowerCase();
	const zLower = z.toLowerCase();
	const cntryLower = cntry.toLowerCase();

	const hasCity = c && addrLower.includes(cLower);
	const hasState = s && addrLower.includes(sLower);
	const hasZip = z && addrLower.includes(zLower);
	const hasCountry = cntry && addrLower.includes(cntryLower);

	let parts = [addr];

	if (c && !hasCity) {
		parts.push(c);
	}
	if (s && !hasState) {
		parts.push(s);
	}
	let zipIndexInParts = -1;
	if (z && !hasZip) {
		zipIndexInParts = parts.length;
		parts.push(z);
	}
	if (cntry && !hasCountry) {
		parts.push(cntry);
	}

	let joined = parts.join(", ");

	if (joined.length > 100) {
		if (hasZip) {
			const zipPos = joined.lastIndexOf(z);
			if (zipPos > 0) {
				const beforeZip = joined.slice(0, zipPos);
				const afterZip = joined.slice(zipPos);
				if (beforeZip.endsWith(", ")) {
					joined = beforeZip.slice(0, -2) + "\n" + afterZip;
				} else if (beforeZip.endsWith(",")) {
					joined = beforeZip.slice(0, -1) + "\n" + afterZip;
				} else {
					joined = beforeZip + "\n" + afterZip;
				}
			}
		} else if (zipIndexInParts !== -1) {
			const beforeZipParts = parts.slice(0, zipIndexInParts);
			const afterZipParts = parts.slice(zipIndexInParts);
			joined = beforeZipParts.join(", ") + "\n" + afterZipParts.join(", ");
		}

		if (joined.length > 100) {
			if (hasCity) {
				const cityPos = joined.indexOf(c);
				if (cityPos > 0) {
					const beforeCity = joined.slice(0, cityPos);
					const afterCity = joined.slice(cityPos);
					if (beforeCity.endsWith(", ")) {
						joined = beforeCity.slice(0, -2) + "\n" + afterCity;
					} else if (beforeCity.endsWith(",")) {
						joined = beforeCity.slice(0, -1) + "\n" + afterCity;
					} else {
						joined = beforeCity + "\n" + afterCity;
					}
				}
			} else {
				const cityIndex = parts.indexOf(c);
				if (cityIndex !== -1) {
					let constructed = "";
					for (let i = 0; i < parts.length; i++) {
						if (i > 0) {
							if (parts[i] === z) {
								constructed += "\n";
							} else if (parts[i] === c) {
								constructed += "\n";
							} else {
								if (constructed.endsWith("\n")) {
									// no comma
								} else {
									constructed += ", ";
								}
							}
						}
						constructed += parts[i];
					}
					joined = constructed;
				}
			}
		}
	}

	return joined;
}
