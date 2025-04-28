const buildInsUserIdRequest = (username) => {
	const apiKey = getRequiredProperty('RAPIDAPI_KEY');
	const base    = `https://${Config.RAPIDAPI_INS_HOST}/id`;
	const url = `${base}?username=${encodeURIComponent(username)}`;
	const options = {
		method: 'get',
		headers: {
			'x-rapidapi-host': Config.RAPIDAPI_INS_HOST,
			'x-rapidapi-key': apiKey
		},
		muteHttpExceptions: true
	};
	return { url, options };
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

	const data = sheet.getRange(3, 1, lastRow - 2, 2).getValues();
	const targets = data
		.map(([rawName, id], idx) => {
			const username = extractInstagramUsername(rawName);
			return {
				row: idx + 3,
				username,
				needsUpdate: !!username && !id,
			};
		})
		.filter(item => item.needsUpdate);

	if (!targets.length) {
		log('✅ 업데이트할 인스타 ID 없음');
		return;
	}

	const requests = targets.map(({ username }) => {
		const { url, options } = buildInsUserIdRequest(username);
		return Object.assign({ url , muteHttpExceptions: true }, options);
	});

	const responses = fetchAllInBatches(requests, Config.BATCH_SIZE, Config.DELAY_MS);

 	 const failures = [];
	responses.forEach((resp, idx) => {
		const { username, row } = targets[idx];
		try {
			if (resp.getResponseCode() !== 200) throw new Error(`HTTP ${resp.getResponseCode()}`);
				const json = JSON.parse(resp.getContentText());
			if (json?.status && json.user_id) {
				sheet.getRange(row, 1).setValue(username);
				sheet.getRange(row, 2).setValue(json.user_id);
				log(`✅ ${username} → ID: ${json.user_id}`);
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