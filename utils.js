const log = (message) => {
	Logger.log(message);
}

const getRequiredProperty = (key) => {
	const value = PropertiesService.getScriptProperties().getProperty(key);
	if (!value) throw new Error(`"${key}" 항목이 설정되어 있지 않습니다.`);
	return value;
};

const fetchAllInBatches = (urls, batchSize, delay) => {
	let responses = [];
	for (let i = 0; i < urls.length; i += batchSize) {
		const batch = urls.slice(i, i + batchSize);
		responses = responses.concat(UrlFetchApp.fetchAll(batch));
		if (i + batchSize < urls.length) {
			Utilities.sleep(delay);
		}
	}
	return responses;
};