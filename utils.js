const log = (message) => {
	Logger.log(message);
}

const getRequiredProperty = (key) => {
	const value = PropertiesService.getScriptProperties().getProperty(key);
	if (!value) throw new Error(`"${key}" 항목이 설정되어 있지 않습니다.`);
	return value;
};