const buildInstagramIdRequest = username => ({
	url: `https://${Config.INS_HOST}/id?username=${encodeURIComponent(username)}`,
	method: "get",
	headers: {
		"x-rapidapi-host": Config.INS_HOST,
		"x-rapidapi-key": Config.API_KEY,
	},
	muteHttpExceptions: true,
});

const updateInstagramIds = () =>
	updateUserIds({
		sheetName: "인플루언서목록",
		rawNameCol: 1,
		idCol: 2,
		requestBuilder: buildInstagramIdRequest,
		extractRawName: extractInstagramUsername,
		extractIdFromResponse: json => json.user_id,
});