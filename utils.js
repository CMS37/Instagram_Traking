let lastFetchFailures = [];

const log = (message) => {
	Logger.log(message);
}

const getRequiredProperty = (key) => {
	const value = PropertiesService.getScriptProperties().getProperty(key);
	if (!value) throw new Error(`"${key}" 항목이 설정되어 있지 않습니다.`);
	return value;
};

const fetchAllInBatches = (urls, batchSize = 20, delay = 100) => {
	let responses = [];
	for (let i = 0; i < urls.length; i += batchSize) {
		const batch = urls.slice(i, i + batchSize);
		const requests = batch.map(url => ({ url, muteHttpExceptions: true }));
		const respsBatch = UrlFetchApp.fetchAll(requests);

		respsBatch.forEach((resp, idx) => {
			const code = resp.getResponseCode();
			if (code !== 200) {
				const msg = `${batch[idx].url} → HTTP ${code}`;
				lastFetchFailures.push(msg);
				log(`⚠️ fetchAllInBatches 오류: ${msg}`);
			}
		});
    	responses = responses.concat(respsBatch);
		if (i + batchSize < urls.length) {
			Utilities.sleep(delay);
		}
	}
	return responses;
};

const getLastFetchFailureLogs = () => lastFetchFailures.slice();
