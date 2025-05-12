const runTracking = ({
	serviceName,
	sheetNames,
	listConfig,
	buildRequest,
	getItems,
	getNextCursor,
	filterFn,
	counterRanges,
	initialCursor
}) => {
	log(`${serviceName} Tracking 시작`);
	const ui = SpreadsheetApp.getUi();
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sheets = {
		main: ss.getSheetByName(sheetNames.main),
		list: ss.getSheetByName(sheetNames.list),
		result: ss.getSheetByName(sheetNames.result),
		keywords: ss.getSheetByName(sheetNames.keywords)
	};

	const parseDate = cell => {
		const d = new Date(sheets.main.getRange(cell).getValue());
		if (isNaN(d)) throw new Error(`❌ 메인 시트 ${cell}에 올바른 날짜를 입력하세요.`);
		return d;
	};

	const startDate = parseDate('C3');
	const endDate = parseDate('C4');
	const keywords = sheets.keywords
		.getRange(2, 1, sheets.keywords.getLastRow() - 1)
		.getValues()
		.flat()
		.filter(Boolean)
		.map(k => `${k}`.toLowerCase());

	let userRows = sheets.list
		.getRange(listConfig.startRow, listConfig.rawNameCol, sheets.list.getLastRow() - listConfig.startRow + 1, 2)
		.getValues()
		.map(([raw, id]) => [listConfig.extractName(raw), id?.toString().trim() || ''])
		.filter(([n, i]) => n && i);

	const seen = new Set();
	userRows = userRows
		.filter(([u, id]) => { const key = `${u}|${id}`; if (seen.has(key)) return false; seen.add(key); return true; });

	let totalNew = 0, totalRel = 0;
	const rowsToWrite = [];
	const failures = [];
	const cursors = new Map(userRows.map(([u, id]) => [`${u}|${id}`, initialCursor]));

	while (cursors.size) {
		const requests = [];
		const infos = [];
		cursors.forEach((cursor, key) => { const [username, id] = key.split('|');
		requests.push(buildRequest(id, cursor));
		infos.push({ key, username }); });
		cursors.clear();
		const responses = fetchAllWithBackoff(requests);
		responses.forEach((resp, idx) => {
			const { key, username } = infos[idx];
			try {
				if (resp.getResponseCode() !== 200) throw new Error(`HTTP ${resp.getResponseCode()}`);
				const json = JSON.parse(resp.getContentText());
				const items = getItems(json);
				const { rows, newCount, relCount, stopPaging } = filterFn(items, username, startDate, endDate, keywords);
				rowsToWrite.push(...rows);
				totalNew += newCount;
				totalRel += relCount;
				const next = getNextCursor(json, items);
				if (!stopPaging && next) cursors.set(key, next);
			} catch (err) {
				if (err.message.includes('HTTP 429')) {
					failures.push(`${username}: 다른 부서(사용자)가 사용 중입니다. 잠시 후 다시 시도해 주세요.}`);
				}
				else {
					failures.push(`${username}: ${err.message}`);
				}
			}
		});
	}
	writeResults(rowsToWrite, sheets.result);
	sheets.main.getRange(counterRanges.newCount).setValue(totalNew);
	sheets.main.getRange(counterRanges.relCount).setValue(totalRel);
	ui.alert(`✅ ${serviceName} 트래킹 완료\n\n전체 포스트: ${totalNew}\n관련 포스트: ${totalRel}${failures.length ? `\n\n실패 상세:\n${failures.join('\n')}` : ''}`);
};
