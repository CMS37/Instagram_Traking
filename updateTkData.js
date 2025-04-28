const buildTkUserIdRequest = (username) => {
	const apiKey = getRequiredProperty('RAPIDAPI_KEY');
	const base    = `https://${Config.RAPIDAPI_TK_HOST}/api/user/info`;
	const url = `${base}?uniqueId=${encodeURIComponent(username)}`;
	const options = {
		method: 'get',
		headers: {
			'x-rapidapi-host': Config.RAPIDAPI_TK_HOST,
			'x-rapidapi-key': apiKey
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
	.map(([rawName, secUid], idx) => {
		const displayName = extractTikTokUsername(rawName);
		const apiName     = displayName.replace(/^@+/, '');
		return {
		row: idx + 3,
		displayName,
		apiName,
		needsUpdate: !!displayName && !secUid
		};
	})
	.filter(item => item.needsUpdate);

	if (!targets.length) {
		log('✅ 업데이트할 틱톡 ID 없음');
		return;
	}

	const requests = targets.map(({ apiName }) => {
		const { url, options } = buildTkUserIdRequest(apiName);
		return Object.assign({ url, muteHttpExceptions: true }, options);
	});

	const responses = fetchAllInBatches(requests, Config.BATCH_SIZE, Config.DELAY_MS);

	const failures = [];
	responses.forEach((resp, idx) => {
		const { row, displayName } = targets[idx];
		try {
			if (resp.getResponseCode() !== 200) {
				throw new Error(`HTTP ${resp.getResponseCode()}`);
			}
			const json = JSON.parse(resp.getContentText());
			const secUid = json?.userInfo?.user?.secUid;
			if (!secUid) {
				throw new Error(`secUid 응답 없음: ${resp.getContentText()}`);
			}
			sheet.getRange(row, 3).setValue(displayName);
			sheet.getRange(row, 4).setValue(secUid);
			log(`✅ ${displayName} → secUID: ${secUid}`);
		} catch (err) {
			failures.push(`${displayName}: ${err.message}`);
			log(`❌ ${displayName} 처리 중 오류: ${err.message}`);
		}
	});

	if (failures.length) {
	SpreadsheetApp.getUi().alert(`ID 업데이트 중 오류 발생:\n${failures.join('\n')}`);
	}
};