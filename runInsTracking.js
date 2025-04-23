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
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const main = ss.getSheetByName('메인');
	const inf = ss.getSheetByName('인플루언서목록');
	const res = ss.getSheetByName('포스팅 결과');
	const kwSheet = ss.getSheetByName('키워드목록');

	const lastCell = main.getRange('F8')
	let sinceDate = lastCell.getValue();
	if (!(sinceDate instanceof Date)) sinceDate = new Date(sinceDate);

	const rawRows = inf.getRange(4, 1, inf.getLastRow() - 3, 2).getValues();
	const userRows = rawRows.filter(([username, user_id]) => !!username && !!user_id);

	const keywords = kwSheet.getRange(2, 1, kwSheet.getLastRow() - 1, 1)
		.getValues().flat().filter(Boolean).map(k => k.toLowerCase());
	
	const urls = userRows.map(([_, user_id]) =>
		buildInsUserPostsUrl(user_id, Math.floor(sinceDate.getTime()/1000))
	);
	const resps = fetchAllInBatches(urls, Config.BATCH_SIZE, Config.DELAY_MS);

	const rowsToWrite = [];
	let totalNew = 0, totalRel = 0;

	resps.forEach((resp, i) => {
		if (resp.getResponseCode() !== 200) return;
		
		const [username] = userRows[i];
		const items = JSON.parse(resp.getContentText())?.data?.posts || [];
		totalNew += items.length;
	
		items.forEach(w => {
			const node = w.node || {};
			const ts   = new Date((node.taken_at_timestamp||0)*1000);
			if (ts <= sinceDate) return;
		
			const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
			const matched = keywords.some(k => caption.toLowerCase().includes(k));
			if (!matched) return;
			totalRel++;
		
			rowsToWrite.push([
				'Instagram',
				username,
				`https://www.instagram.com/p/${node.shortcode}`,
				ts,
				caption,
				matched? 'o' : 'x',
			]);
		});
	});
	if (rowsToWrite.length) {
		const startRow = res.getLastRow() + 1;
		res.getRange(startRow, 1, rowsToWrite.length, rowsToWrite[0].length)
			.setValues(rowsToWrite);
	}
	main.getRange('B9').setValue(totalNew);
	main.getRange('B10').setValue(totalRel);
	lastCell.setValue(new Date());

	log(`✅ Instagram 트래킹 완료: 신규 ${totalNew}, 관련 ${totalRel}`);
}