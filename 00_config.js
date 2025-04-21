const Config = {
	INS_ROOT: "https://ensembledata.com/apis",
	API_TOKEN: PropertiesService.getScriptProperties()("API_TOKEN"),
	TZ: Session.getScriptTimeZone(),
	DATE_FMT: "yyyy-MM-dd'T'HH:mm:ss'Z'"
};