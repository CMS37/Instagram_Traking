const buildTikTokIdRequest = (username) => ({
	url: `https://${Config.TK_HOST}/api/user/info?uniqueId=${encodeURIComponent(username)}`,
	method: 'get',
	headers: {
		'x-rapidapi-host': Config.TK_HOST,
		'x-rapidapi-key': Config.API_KEY,
	},
	muteHttpExceptions: true,
});

const updateTiktokIds = () =>
	updateUserIds({
		sheetName: '인플루언서목록',
		rawNameCol: 3,
		idCol: 4,
		requestBuilder: buildTikTokIdRequest,
		extractRawName: extractTikTokUsername,
		extractIdFromResponse: (json) => json?.userInfo?.user?.secUid,
		rawPrefix: '@',
	});
