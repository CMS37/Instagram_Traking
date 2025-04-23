const buildInsUserPostsUrl = (user_id, oldest_timestamp) => {
	const endpoint = "/instagram/user/posts";
	const params = {
		user_id,
		depth: 100,
		oldest_timestamp,
		chunk_size: 1,
		token: Config.TOKEN,
	};
	const qs = Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
	return `${Config.API_ROOT}${endpoint}?${qs}`;
};

const runInstagramTracking = () => {
	const ui = SpreadsheetApp.getUi();
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const main = ss.getSheetByName('메인');
	const inf = ss.getSheetByName('인플루언서목록');
	const res = ss.getSheetByName('포스팅 결과');
	const kwSheet = ss.getSheetByName('키워드목록');

	const startCell = main.getRange('C3').getValue();
	const endCell = main.getRange('C4').getValue();
	const startDate = new Date(startCell);
	const endDate = new Date(endCell);
	if (!(startDate instanceof Date) || isNaN(startDate) || !(endDate instanceof Date) || isNaN(endDate)) {
		throw new Error('메인 시트 C3/C4에 올바른 날짜 형식(YYYY-MM-DD)을 입력하세요.');
	}

	main.getRange('C7').setValue(0);
	main.getRange('C8').setValue(0);

	const keywords = kwSheet.getRange(2, 1, kwSheet.getLastRow() - 1, 1)
		.getValues().flat().filter(Boolean).map(k => k.toLowerCase());

	const rawRows = inf.getRange(4, 1, inf.getLastRow() - 3, 2).getValues();
	const userRows = rawRows.filter(([username, user_id]) => !!username && !!user_id);

	
	const urls = userRows.map(([_, user_id]) =>
		buildInsUserPostsUrl(user_id, Math.floor(startDate.getTime()/1000))
	);
	const resps = fetchAllInBatches(urls, Config.BATCH_SIZE, Config.DELAY_MS);

	const rowsToWrite = [];
	let totalNew = 0, totalRel = 0;

	resps.forEach((resp, i) => {
		if (resp.getResponseCode() !== 200) return;
		
		const [username] = userRows[i];
		const items = JSON.parse(resp.getContentText())?.data?.posts || [];
	
		items.forEach(w => {
			const node = w.node || {};
			const ts   = new Date((node.taken_at_timestamp||0)*1000);
			
			if (ts <= startDate || ts > endDate) return;
			totalNew++;

			const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
			if (!keywords.some(k => caption.toLowerCase().includes(k))) return;
			totalRel++;
		
			rowsToWrite.push([
				'Instagram',
				username,
				ts,
				`https://www.instagram.com/p/${node.shortcode}`,
				caption,
			]);
		});
	});
	if (rowsToWrite.length) {
		const startRow = res.getLastRow() + 1;
		res.getRange(startRow, 1, rowsToWrite.length, rowsToWrite[0].length)
			.setValues(rowsToWrite);
	}
	main.getRange('C7').setValue(totalNew);
	main.getRange('C8').setValue(totalRel);
	
	const failures = getLastFetchFailureLogs();
	const failCount = failures.length;
	const failLines = failures.length
		? '\n\n실패 상세:\n' + failures.join('\n')
		: '';
	ui.alert(
		`Instagram 트래킹 결과\n\n신규 포스트: ${totalNew}\n관련 포스트: ${totalRel}\n실패 요청: ${failCount}${failLines}`
	);
	log(`✅ Instagram 트래킹 완료: 신규 ${totalNew}, 관련 ${totalRel}`);
}
