const buildInsUserInfoUrl = (username) => {
	const root = "https://ensembledata.com/apis";
	const token = getRequiredProperty("API_TOKEN");
	const params = { username, token };
	const qs = Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
  
	return `${root}/instagram/user/info?${qs}`;
};

const updateInstagramIds = () => {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sheet = ss.getSheetByName('인플루언서목록');
	if (!sheet) {
		log('❌ "인플루언서목록" 시트를 찾을 수 없습니다.');
		return;
	}

	const lastRow = sheet.getLastRow();
	if (lastRow < 3) {
		log('✅ 업데이트할 인스타 ID 없음');
		return;
	}

	const userData = sheet.getRange(3, 1, lastRow - 2, 2).getValues();
	const targets = userData
		.map(([username, id], idx) => ({
		username: username?.toString().trim(),
		row: idx + 3,
		needsUpdate: !!username && !id
		}))
		.filter(item => item.needsUpdate);

	if (targets.length === 0) {
		log('✅ 업데이트할 인스타 ID 없음');
		return;
	}

	const now = new Date();
	const urls = targets.map(({ username }) => buildInsUserInfoUrl(username));
	const responses = fetchAllInBatches(urls, 100, 500);

	responses.forEach((resp, i) => {
		const { username, row } = targets[i];
		try {
			const json = JSON.parse(resp.getContentText());
			const userId = json.data?.pk || '';

			if (userId) {
				sheet.getRange(row, 2).setValue(userId);
				sheet.getRange(row, 3).setValue(now);
				log(`✅ ${username} → ID: ${userId}`);
			} else {
				log(`⚠️ ${username} user_id 응답 없음`);
			}
		} catch (err) {
			log(`❌ ${username} 처리 중 오류: ${err}`);
		}
	});
};
