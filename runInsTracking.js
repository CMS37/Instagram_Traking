const buildInsUserPostsRequest = (userId, count = 12, endCursor = '') => {
	const url = `https://${Config.RAPIDAPI_INS_HOST}/user-feeds2`;
	let qs = `?id=${encodeURIComponent(userId)}&count=${count}`;
	if (endCursor) qs += `&end_cursor=${encodeURIComponent(endCursor)}`;
	
	return {
		url: `${url}${qs}`,
		method: 'get',
		headers: {
			'x-rapidapi-host': Config.RAPIDAPI_INS_HOST,
			'x-rapidapi-key': Config.TOKEN
		},
		muteHttpExceptions: true
	};
};

const fetchPage = (userId, endCursor = '') => {
	const { url, options } = buildInsUserPostsRequest(userId, 12, endCursor);
	const resp = UrlFetchApp.fetch(url, options);
	if (resp.getResponseCode() !== 200) throw new Error(`HTTP ${resp.getResponseCode()}`);
	const json = JSON.parse(resp.getContentText());
	const media = json?.data?.user?.edge_owner_to_timeline_media;
	if (!Array.isArray(media.edges) || media.edges.length === 0) {
		throw new Error('비공개 계정이거나 포스트가 없습니다.');
	}
	return media;
};

const filterPosts = (edges, username, startDate, endDate, keywords) => {
	const rows = [];
	let newCount = 0, relCount = 0;
	let stopPaging = false;

	for (const { node } of edges) {
		const ts = new Date((node.taken_at_timestamp ?? 0) * 1000);
		
		const isPinned = Array.isArray(node.pinned_for_users) && node.pinned_for_users.length > 0;
		if (!isPinned && ts <= startDate) {
			stopPaging = true;
			break;
		}
		newCount++;
		if (ts > endDate) continue;

		const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text?.toLowerCase() ?? '';
		if (!keywords.some(k => caption.includes(k))) continue;

		relCount++;
		const likeCount = node.like_and_view_counts_disabled
		? 'x'
		: node.edge_media_preview_like?.count ?? 'x';
		const commentCount = node.like_and_view_counts_disabled
		? 'x'
		: node.edge_media_to_comment?.count ?? 'x';
		const viewCount = node.is_video
		? node.video_view_count ?? 'x'
		: 'x';

		rows.push([
			username,
			ts,
			`https://www.instagram.com/p/${node.shortcode}`,
			caption,
			viewCount,
			likeCount,
			commentCount
		]);
	}

	return { rows, newCount, relCount, stopPaging };
};

const runInstagramTracking = () => {
	log('Instagram Tracking 시작');
	const ui      = SpreadsheetApp.getUi();
	const ss      = SpreadsheetApp.getActiveSpreadsheet();
	const sheets  = {
		main:      ss.getSheetByName('메인'),
		influList: ss.getSheetByName('인플루언서목록'),
		result:    ss.getSheetByName('인스타 결과'),
		keywords:  ss.getSheetByName('키워드목록')
	};
  
	const parseDate = cell => {
		const d = new Date(sheets.main.getRange(cell).getValue());
		if (isNaN(d)) throw new Error(`메인 시트 ${cell}에 올바른 날짜를 입력하세요.`);
		return d;
	};
	const startDate = parseDate('C3');
	const endDate   = parseDate('C4');

	const keywords = sheets.keywords
		.getRange(2, 1, sheets.keywords.getLastRow() - 1)
		.getValues().flat()
		.filter(Boolean).map(k => `${k}`.toLowerCase());

	let userRows = sheets.influList
		.getRange(4, 1, sheets.influList.getLastRow() - 3, 2)
		.getValues()
		.filter(([u, id]) => u && id);
	log(`시트 데이터 수집 완료`);

	{
		const seen = new Set();
		userRows = userRows.filter(([u, id]) => {
			const key = `${u}|${id}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}
	log(`인플루언서 목록 중복 제거 완료`);

	let totalNew = 0, totalRel = 0;
	const rowsToWrite = [];
	const failures    = [];
  
	const cursors = new Map(
		  userRows.map(([u, id]) => [`${u}|${id}`, ''])
	);

	log(`반복 호출 시작`);
	while (cursors.size) {
		log(`${cursors.size}개의 호출 시작`);
		const requests  = [];
		const userInfos = [];
		cursors.forEach((cursor, key) => {
			const [username, userId] = key.split('|');
			requests.push(buildInsUserPostsRequest(userId, 12, cursor));
			userInfos.push({ key, username });
		});
	
		const responses = fetchAllInBatches(requests, Config.BATCH_SIZE, Config.DELAY_MS);

		cursors.clear();
	
		responses.forEach((resp, idx) => {
			const { key, username } = userInfos[idx];
			log(`처리중: ${username}`);
			try {
				if (resp.getResponseCode() !== 200) {
					throw new Error(`HTTP ${resp.getResponseCode()}`);
				}
				const json = JSON.parse(resp.getContentText());
				const media = json?.data?.user?.edge_owner_to_timeline_media;
				if (!media || !Array.isArray(media.edges)) {
					throw new Error('데이터 형식 이상');
				}
				
				const { rows, newCount, relCount, stopPaging } =
				filterPosts(media.edges, username, startDate, endDate, keywords);
				
				rowsToWrite.push(...rows);
				totalNew += newCount;
				totalRel += relCount;

				if (!stopPaging && media.page_info?.has_next_page) {
					cursors.set(key, media.page_info.end_cursor);
				}
			} catch (err) {
				failures.push(`${username}: ${err.message}`);
			}
		});
	}
	log(`반복 호출 완료`);

	writeResults(rowsToWrite, sheets.result);
	sheets.main.getRange('C7').setValue(totalNew);
	sheets.main.getRange('C8').setValue(totalRel);

	const failCount = failures.length;
	ui.alert(
	  `✅ Instagram 트래킹 완료\n\n` +
	  `전체 포스트: ${totalNew}\n` +
	  `관련 포스트: ${totalRel}\n` +
	  `실패 요청: ${failCount}` +
	  (failCount ? `\n\n실패 상세:\n${failures.join('\n')}` : '')
	);
};