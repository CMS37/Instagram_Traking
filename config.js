const Config = {
	INS_HOST: "instagram-looter2.p.rapidapi.com",
	TK_HOST: "tiktok-api23.p.rapidapi.com",
	API_KEY: getRequiredProperty("RAPIDAPI_KEY"),
	BATCH_SIZE: 10, 
	DELAY_MS: 1000,
};

//Gas환경 최적 BATCH_SIZE = 50 / DELAY_MS = 100 이나 API 호출제한에 따라 변경할것
