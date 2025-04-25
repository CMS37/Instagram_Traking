const buildTkUserIdRequest = (username) => {
	const apiKey = getRequiredProperty('RAPIDAPI_KEY');
	const base    = `https://${Config.RAPIDAPI_TK_HOST}/api/user/info`;
	const url = `${base}?uniqueId=${encodeURIComponent(username)}`;
	const options = {
		method: 'get',
		headers: {
			'x-rapidapi-host': Config.RAPIDAPI_TK_HOST,
			'x-rapidapi-key': '927bff4967msh9acd10f200aab13p188a5djsn6be055db9f6b'
			// 'x-rapidapi-key': apiKey
		},
		muteHttpExceptions: true
	};
	return { url, options };
  };

const updateTiktokIds = () => {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sheet = ss.getSheetByName('인플루언서목록');
	if (!sheet) {
		log('❌ "인플루언서목록" 시트를 찾을 수 없습니다.');
		return;
	}
	const lastRow = sheet.getLastRow();

	const data = sheet.getRange(3, 3, lastRow - 2, 2).getValues();
	const targets = data
		.map(([username, id], idx) => ({
		username: username?.toString().trim(),
		row: idx + 3,
		needsUpdate: !!username && !id
		}))
		.filter(item => item.needsUpdate);

	if (!targets.length) {
		log('✅ 업데이트할 틱톡 ID 없음');
		return;
	}

	const requests = targets.map(({ username }) => {
		const { url, options } = buildTkUserIdRequest(username);
		return Object.assign({ url , muteHttpExceptions: true }, options);
	});

	const responses = fetchAllInBatches(requests, Config.BATCH_SIZE, Config.DELAY_MS);

 	 const failures = [];
	responses.forEach((resp, idx) => {
		const { username, row } = targets[idx];
		try {
			if (resp.getResponseCode() !== 200) throw new Error(`HTTP ${resp.getResponseCode()}`);
				const json = JSON.parse(resp.getContentText());
			if (json?.userInfo && json.userInfo.user.secUid) {
				sheet.getRange(row, 4).setValue(json.userInfo.user.secUid);
				log(`✅ ${username} → secUID: ${json.userInfo.user.secUid}`);
			} else {
				throw new Error(`user_id 응답 없음: ${resp.getContentText()}`);
			}
		} catch (err) {
			failures.push(`${username}: ${err.message}`);
			log(`❌ ${username} 처리 중 오류: ${err.message}`);
		}
	});

	if (failures.length) {
		SpreadsheetApp.getUi().alert(
			`ID 업데이트 중 오류 발생:\n${failures.join('\n')}`
		);
	}
}