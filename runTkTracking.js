const buildTkUserPostsUrl = (username, oldest_createtime) => {
	const root = "https://ensembledata.com/apis";
	const endpoint = "/tt/user/posts";
	const token = getRequiredProperty("API_TOKEN");
	const params = {
		username,
		depth: 10,
		oldest_createtime,
		token
	};
	const qs = Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
	return `${root}${endpoint}?${qs}`;
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
	const resps = fetchAllInBatches(urls, 20, 100);
  
	const rowsToWrite = [];
	let totalNew = 0, totalRel = 0;
  
	resps.forEach((resp, i) => {
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
  
	// 시트에 일괄 기록
	if (rowsToWrite.length) {
	  const start = res.getLastRow() + 1;
	  res.getRange(start,1, rowsToWrite.length, rowsToWrite[0].length)
		 .setValues(rowsToWrite);
	}
  
	// 통계 및 실행시간 갱신
	main.getRange('B11').setValue(totalNew);
	main.getRange('B12').setValue(totalRel);
	lastCell.setValue(new Date());
  
	log(`✅ TikTok 트래킹 완료: 신규 ${totalNew}, 관련 ${totalRel}`);
}
  