const buildTkUserPostsUrl = (username, oldest_createtime) => {
	const endpoint = "/tt/user/posts";
	const params = {
		username,
		depth: 1,
		oldest_createtime,
		token: Config.TOKEN,
	};
	const qs = Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
	return `${Config.API_ROOT}${endpoint}?${qs}`;
};

const runTikTokTracking = () => {
	const ui	= SpreadsheetApp.getUi();
	const ss    = SpreadsheetApp.getActiveSpreadsheet();
	const main  = ss.getSheetByName('메인');
	const inf   = ss.getSheetByName('인플루언서목록');
	const res     = ss.getSheetByName('포스팅 결과');
	const kwSheet = ss.getSheetByName('키워드목록');

	const startCell = main.getRange('C3').getValue();
	const endCell   = main.getRange('C4').getValue();
	const startDate = new Date(startCell);
	const endDate   = new Date(endCell);
	if (!(startDate instanceof Date) || isNaN(startDate) || !(endDate instanceof Date) || isNaN(endDate)) {
		throw new Error('메인 시트 C3/C4에 올바른 날짜 형식(YYYY-MM-DD)을 입력하세요.');
	}

	main.getRange('C11').setValue(0);
	main.getRange('C12').setValue(0);

	const keywords = kwSheet.getRange(2,1, kwSheet.getLastRow()-1,1)
		.getValues().flat().filter(Boolean).map(k=>k.toLowerCase());

	const rawRows = inf.getRange(4, 3, inf.getLastRow() - 3, 1).getValues();
	const userRows = rawRows.map(r => r[0]).filter(Boolean);

	const urls  = userRows.map(u => 
		buildTkUserPostsUrl(u, Math.floor(startDate.getTime()/1000))
	);
	const resps = fetchAllInBatches(urls, Config.BATCH_SIZE, Config.DELAY_MS);
  
	const rowsToWrite = [];
	let totalNew = 0, totalRel = 0;
  
	resps.forEach((resp, i) => {
		if (resp.getResponseCode() !== 200) return;
		
		const items = JSON.parse(resp.getContentText())?.data || [];

		items.forEach(w => {
			const ts = new Date(w.create_time * 1000);
			if (ts <= startDate || ts >= endDate) return;
			totalNew++;

			const username = userRows[i];
			const desc = w.desc || '';
			if (!keywords.some(k => desc.toLowerCase().includes(k))) return;
			totalRel++;

			rowsToWrite.push([
				'TikTok',
				username,
				ts,
				`https://www.tiktok.com/@${username}/video/${w.aweme_id}`,
				desc,
			]);
		})
	});

	if (rowsToWrite.length) {
	  const start = res.getLastRow() + 1;
	  res.getRange(start,1, rowsToWrite.length, rowsToWrite[0].length)
		 .setValues(rowsToWrite);
	}

	main.getRange('C11').setValue(totalNew);
	main.getRange('C12').setValue(totalRel);
  
	const failures = getLastFetchFailureLogs();
	const failCount = failures.length;
	const failLines = failures.length
		? '\n\n실패 상세:\n' + failures.join('\n')
		: '';
	ui.alert(
		`Tiktok 트래킹 결과\n\n신규 포스트: ${totalNew}\n관련 포스트: ${totalRel}\n실패 요청: ${failCount}${failLines}`
	);
	log(`✅ Tiktok 트래킹 완료: 신규 ${totalNew}, 관련 ${totalRel}`);
}
  