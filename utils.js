const log = (message) => {
	Logger.log(message);
}

const getRequiredProperty = (key) => {
	const value = PropertiesService.getScriptProperties().getProperty(key);
	if (!value) throw new Error(`"${key}" 항목이 설정되어 있지 않습니다.`);
	return value;
};

const fetchAllInBatches = (requests, batchSize = 20, delay = 100) => {
	const responses = [];
	for (let i = 0; i < requests.length; i += batchSize) {
		const batch = requests.slice(i, i + batchSize);
		const batchResponses = UrlFetchApp.fetchAll(batch);
		responses.push(...batchResponses);
		if (i + batchSize < requests.length) {
			Utilities.sleep(delay);
		}
	}
	return responses;
};

