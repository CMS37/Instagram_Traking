const updateUserIds = ({
	sheetName,
	rawNameCol,
	idCol,
	requestBuilder,
	extractRawName,
	extractIdFromResponse,
	rawPrefix = ''
}) => {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sheet = ss.getSheetByName(sheetName);
	const ui = SpreadsheetApp.getUi();
	if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);
	const lastRow = sheet.getLastRow();
	if (lastRow < 3) return ui.alert('✅ 업데이트할 유저가 없습니다');

	const data = sheet.getRange(3, rawNameCol, lastRow - 2, 1).getValues();
	const targets = data
		.map(([raw], i) => {
			const name = extractRawName(raw);
			const existing = sheet.getRange(i + 3, idCol).getValue().toString().trim();
			return { row: i + 3, name, needs: !!name && !existing };
		})
		.filter(t => t.needs);
	if (!targets.length) return ui.alert('✅ 업데이트할 유저가 없습니다');
  
	const responses = fetchAllInBatches(targets.map(t => requestBuilder(t.name)));
	const errs = [];
  
	responses.forEach((resp, idx) => {
		const { row, name } = targets[idx];
		try {
			if (resp.getResponseCode() !== 200) throw new Error(`HTTP ${resp.getResponseCode()}`);
			const j = JSON.parse(resp.getContentText());
			const id = extractIdFromResponse(j);
			if (!id) throw new Error('ID not found');
			sheet.getRange(row, rawNameCol).setValue(rawPrefix + name);
			sheet.getRange(row, idCol).setValue(id);
		} catch (e) {
			errs.push(`${name}: ${e.message}`);
		}
	});
  
	if (errs.length) ui.alert(`ID 업데이트 오류:\n${errs.join('\n')}`);
};
