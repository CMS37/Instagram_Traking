const buildInsUserPostsUrl = (userId, oldestSec = 0) => {
	const root = "https://ensembledata.com/apis";
	const token = getRequiredProperty("API_TOKEN");
	const params = {
		user_id: userId,
		depth: 1,
		oldest_timestamp: oldestSec,
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
		const items = JSON.parse(resp.getContentText())?.data || [];
		return items.map(p => ({
			shortcode: p.shortcode,
			caption: p.edge_media_to_caption?.edges?.node?.text || '',
			timestamp: new Date((p.taken_at_timestamp || 0) * 1000)
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
	const keywords = kwSheet.getRange(2, 1, kwSheet.getLastRow() - 1, 1)
		.getValues().flat()
		.filter(Boolean)
		.map(k => k.toLowerCase());

	let totalNew = 0;
	let totalRel = 0;
	const userRows = inf.getRange(3, 1, inf.getLastRow() - 2, 3).getValues();

	userRows.forEach(([username, userId, lastTs], idx) => {
		if (!username || !userId) return;

		const sinceDate = lastTs;
		const posts = fetchInstagramPosts(userId, sinceDate);

		totalNew = posts.length;
		latestTimestamp = posts[0]?.timestamp;
	
		posts.forEach(p => {
			const ts = p.timestamp;
			if (ts <= sinceDate) return;

			const matched = keywords.some(k => p.caption.toLowerCase().includes(k));
			if (!matched) return;

			const postUrl = p.shortcode ? `https://www.instagram.com/p/${p.shortcode}` : '';
			res.appendRow([
				'Instagram',
				username,
				postUrl,
				ts,
				p.caption,
			]);
		});
		if (latestTimestamp > sinceDate) {
			inf.getRange(idx + 3, 3).setValue(latestTimestamp);
		}
	});
	const main = ss.getSheetByName('메인');
	main.getRange('B9').setValue(totalNew);
	main.getRange('B10').setValue(totalRel);

	log(`✅ 트래킹 완료: 신규 ${totalNew}, 관련 ${totalRel}`);
};
