const buildInsUserPostsUrl = (user_id, oldest_timestamp) => {
	const root = "https://ensembledata.com/apis";
	const endpoint = "/instagram/user/posts";
	const token = getRequiredProperty("API_TOKEN");
	const params = {
		user_id,
		depth: 50,
		oldest_timestamp,
		chunk_size: 1,
		token
	};
	const qs = Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
	return `${root}${endpoint}?${qs}`;
};

const runInstagramTracking = () => {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const main = ss.getSheetByName('메인');
	const inf = ss.getSheetByName('인플루언서목록');
	const res = ss.getSheetByName('포스팅 결과');
	const kwSheet = ss.getSheetByName('키워드목록');

	const lastCell = main.getRange('F9')
	let sinceDate = lastCell.getValue(); // 사용자가 임의로 날짜 수정한경우 instanceof Date 체크가 안되어서 새로 생성
	if (!(sinceDate instanceof Date)) sinceDate = new Date(sinceDate);

	const rawRows = inf.getRange(4, 1, inf.getLastRow() - 3, 2).getValues();
	const userRows = rawRows.filter(([username, userId]) => !!username && !!userId);

	const keywords = kwSheet.getRange(2, 1, kwSheet.getLastRow() - 1, 1)
		.getValues().flat().filter(Boolean).map(k => k.toLowerCase());
	
	const urls = userRows.map(([_, userId]) =>
		buildInsUserPostsUrl(userId, Math.floor(sinceDate.getTime()/1000))
	);
	const resps = fetchAllInBatches(urls, 20, 100);

	const rowsToWrite = [];
	let totalNew = 0, totalRel = 0;

	resps.forEach((resp, i) => {
		const [username] = userRows[i];
		const items = JSON.parse(resp.getContentText())?.data?.posts || [];
		totalNew += items.length;
	
		items.forEach(w => {
			const node = w.node || {};
			const ts   = new Date((node.taken_at_timestamp||0)*1000);
			if (ts <= sinceDate) return;
		
			const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';
			const matched = keywords.includes(k => caption.toLowerCase().includes(k));
			// if (!matched) return;
			if (matched) totalRel++;
		
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
}