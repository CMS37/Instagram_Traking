const buildTkUserPostsUrl = (username, oldest_createtime) => {
	const endpoint = "/tt/user/posts";
	const params = {
		username,
		depth: 100,
		oldest_createtime,
		token: Config.TOKEN,
	};
	const qs = Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
	return `${Config.API_ROOT}${endpoint}?${qs}`;
};

const runTikTokTracking = () => {
	const ss    = SpreadsheetApp.getActiveSpreadsheet();
	const main  = ss.getSheetByName('메인');
	const inf   = ss.getSheetByName('인플루언서목록');
	const res     = ss.getSheetByName('포스팅 결과');
	const kwSheet = ss.getSheetByName('키워드목록');

	const lastCell = main.getRange('F12');
	let sinceDate = lastCell.getValue();
	if (!(sinceDate instanceof Date)) sinceDate = new Date(sinceDate);

	const keywords = kwSheet.getRange(2,1, kwSheet.getLastRow()-1,1)
		.getValues().flat().filter(Boolean).map(k=>k.toLowerCase());

	const startRow = 4;
	const lastRow  = inf.getLastRow();
	const rowCount = lastRow >= startRow ? lastRow - startRow + 1 : 0;
	const raw = rowCount > 0
		? inf.getRange(startRow, 3, rowCount, 1).getValues()
		: [];
	const users = raw.map(r => r[0].toString().trim()).filter(u => u);

	const urls  = users.map(u => 
		buildTkUserPostsUrl(u, Math.floor(sinceDate.getTime()/1000))
	);
	const resps = fetchAllInBatches(urls, Config.BATCH_SIZE, Config.DELAY_MS);
  
	const rowsToWrite = [];
	let totalNew = 0, totalRel = 0;
  
	resps.forEach((resp, i) => {
		if (resp.getResponseCode() !== 200) return;
		
		const username = users[i];
		const items = JSON.parse(resp.getContentText())?.data || [];
		totalNew += items.length;

		items.forEach(w => {
			const ts = new Date(w.create_time * 1000);
			if (ts <= sinceDate) return;

			const desc = w.desc || '';
			const matched = keywords.some(k => desc.toLowerCase().includes(k));
			if (matched) totalRel++;

			rowsToWrite.push([
				'TikTok',
				username,
				`https://www.tiktok.com/@${username}/video/${w.aweme_id}`,
				ts,
				desc,
				matched? 'o' : 'x',
			]);
		})
	});

	if (rowsToWrite.length) {
	  const start = res.getLastRow() + 1;
	  res.getRange(start,1, rowsToWrite.length, rowsToWrite[0].length)
		 .setValues(rowsToWrite);
	}

	main.getRange('B11').setValue(totalNew);
	main.getRange('B12').setValue(totalRel);
	lastCell.setValue(new Date());
  
	log(`✅ TikTok 트래킹 완료: 신규 ${totalNew}, 관련 ${totalRel}`);
}
  