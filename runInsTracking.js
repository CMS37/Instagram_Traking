const buildInsUserPostsUrl = (userId, oldestSec = 0) => {
	const root = "https://ensembledata.com/apis";
	const token = getRequiredProperty("API_TOKEN");
	const params = {
		user_id: userId,
		depth: 100,
		oldest_timestamp: oldestSec,
		chunk_size: 1,
		token: token
	};
	const qs = Object.entries(params)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
	return `${root}/instagram/user/posts?${qs}`;
};

const fetchInstagramPosts = (userId, sinceDate) => {
	const oldestSec = Math.floor(sinceDate.getTime() / 1000);
	const url = buildInsUserPostsUrl(userId, oldestSec);
	try {
		const resp = UrlFetchApp.fetch(url);
		const items = JSON.parse(resp.getContentText())?.data?.posts || [];
		return items.map(p => ({
			shortcode: p.node.shortcode,
			caption: p.node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
			timestamp: new Date((p.node.taken_at_timestamp || 0) * 1000)
		}));
	} catch (err) {
		log(`❌ [fetchInstagramPosts] ${userId} 오류: ${err}`);
		return [];
	}
};

const runInstagramTracking = () => {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const inf = ss.getSheetByName('인플루언서목록');
	const res = ss.getSheetByName('포스팅 결과');
	const kwSheet = ss.getSheetByName('키워드목록');
	const main = ss.getSheetByName('메인');
	const lastTs = main.getRange('F9').getValue();



	const keywords = kwSheet.getRange(2, 1, kwSheet.getLastRow() - 1, 1)
		.getValues().flat()
		.filter(Boolean)
		.map(k => k.toLowerCase());

	const userRows = inf.getRange(4, 1, inf.getLastRow() - 3, 2).getValues();
	
	let totalNew = 0;
	let totalRel = 0;

	userRows.forEach(([username, userId]) => {
		if (!username || !userId) return;

		let sinceDate = new Date(lastTs);
		const posts = fetchInstagramPosts(userId, sinceDate);

		totalNew = posts.length;
		
		const rowUpdate = [];	
		posts.forEach(p => {
			log(`🔍 [runInstagramTracking] ${p.shortcode} ${p.timestamp} \n ${p.caption}`);

			const matched = keywords.some(k => p.caption.toLowerCase().includes(k));
			if (matched) totalRel++;

			const postUrl = p.shortcode ? `https://www.instagram.com/p/${p.shortcode}` : '';
			rowUpdate.push([
				'Instagram',
				username,
				postUrl,
				p.timestamp,
				p.caption,
				matched? 'O' : 'X',
			]);
		});
		if (rowsToWrite.length) {
			const startRow = res.getLastRow() + 1;
			res.getRange(startRow, 1, rowsToWrite.length, rowsToWrite[0].length)
				.setValues(rowsToWrite);
		}
	});
	lastTs.setValue(new Date());

	main.getRange('B9').setValue(totalNew);
	main.getRange('B10').setValue(totalRel);

	log(`✅ 트래킹 완료: 신규 ${totalNew}, 관련 ${totalRel}`);
};
