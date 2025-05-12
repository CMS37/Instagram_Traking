const RETRY_CODES = [429, 204];
const log = message => Logger.log(message);

const getRequiredProperty = key => {
	const value = PropertiesService.getScriptProperties().getProperty(key);
	if (!value) throw new Error(`"${key}" 항목이 설정되어 있지 않습니다.`);
	return value;
};

const fetchAllWithBackoff = (requests, batchSize = Config.BATCH_SIZE, baseDelay = Config.DELAY_MS, maxRetries = Config.MAX_RETRIES) => {
	const allResponses = [];
	// let count = 0;

	for (let i = 0; i < requests.length; i += batchSize) {
		const batch = requests.slice(i, i + batchSize);
		// count += batch.length;
		// log(`요청 ${i + 1} ~ ${i + batch.length}: ${batch.length}건`);
		let responses = UrlFetchApp.fetchAll(batch);

		let retryItems = batch
			.map((req, idx) => ({ req, idx }))
			.filter(({ idx }) => RETRY_CODES.includes(responses[idx].getResponseCode()));

		let attempt = 0, delay = baseDelay;
		while (retryItems.length > 0 && attempt < maxRetries) {
			// log(`재시도 ${attempt + 1}회: ${retryItems.length}건`);
			// count += retryItems.length;
			Utilities.sleep(delay);
			const retryReqs = retryItems.map(item => item.req);
			const retryResps = UrlFetchApp.fetchAll(retryReqs);

			retryItems.forEach((item, j) => {
				responses[item.idx] = retryResps[j];
			});

			retryItems = retryItems.filter((item, j) =>
				RETRY_CODES.includes(retryResps[j].getResponseCode())
			);

			delay *= 2;
			attempt++;
		}

		allResponses.push(...responses);

		if (i + batchSize < requests.length) Utilities.sleep(baseDelay);
	}
	// log (`총 ${count}번 요청`);
	return allResponses;
};

const writeResults = (rows, sheet) => {
	if (!rows.length) return;
	sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
};

const extractInstagramUsername = raw => {
	const s = raw?.toString().trim() || "";
	const m = s.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/i);
	return m?.[1] ?? s.replace(/^@+/, "");
};

const extractTikTokUsername = raw => {
	const s = raw?.toString().trim() || "";
	const m = s.match(/(?:https?:\/\/)?(?:www\.)?tiktok\.com\/(?:@)?([A-Za-z0-9._]+)/i);
	return m?.[1] ?? s.replace(/^@+/, "");
};
