const Config = {
    BATCH_SIZE: 5,
    DELAY_MS: 500,
    MAX_RETRIES: 5,
    TK_HOST: 'tiktok-api23.p.rapidapi.com',
    IG_HOST: 'instagram-looter2.p.rapidapi.com',
    get API_KEY() {
        return getRequiredProperty("API_KEY");
    },
};


//Gas환경 최적 BATCH_SIZE = 50 / DELAY_MS = 100 이나 API 호출제한에 따라 변경할것
