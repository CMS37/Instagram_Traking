const RAPIDAPI_HOST = 'instagram-looter2.p.rapidapi.com';
const API_BASE_URL = `https://${RAPIDAPI_HOST}/user-feeds2`;
const PAGE_SIZE = 12;

const buildInsUserPostsRequest = (userId, count = PAGE_SIZE, endCursor = '') => {
	const apiKey = getRequiredProperty('RAPIDAPI_KEY');
	let qs = `?id=${encodeURIComponent(userId)}&count=${count}`;
	if (endCursor) qs += `&end_cursor=${encodeURIComponent(endCursor)}`;
	
	return {
		url: `${API_BASE_URL}${qs}`,
		options: {
		method: 'get',
		headers: {
			'x-rapidapi-host': RAPIDAPI_HOST,
			'x-rapidapi-key': apiKey
		},
		muteHttpExceptions: true
		}
	};
};

const fetchPage = (userId, endCursor = '') => {
	const { url, options } = buildInsUserPostsRequest(userId, PAGE_SIZE, endCursor);
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
		newCount++;
		const ts = new Date((node.taken_at_timestamp ?? 0) * 1000);

		const isPinned = Array.isArray(node.pinned_for_users) && node.pinned_for_users.length > 0;
		if (!isPinned && ts <= startDate) {
			stopPaging = true;
			break;
		}
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

const writeResults = (rows, sheet) => {
	if (!rows.length) return;
	const startRow = sheet.getLastRow() + 1;
	sheet.getRange(startRow, 1, rows.length, rows[0].length)
		.setValues(rows);
};

const runInstagramTracking = () => {
	const lock = LockService.getScriptLock();
	lock.waitLock(30000);

	try {
		const ui = SpreadsheetApp.getUi();
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		const sheets = {
			main:      ss.getSheetByName('메인'),
			influList: ss.getSheetByName('인플루언서목록'),
			result:    ss.getSheetByName('인스타 결과'),
			keywords:  ss.getSheetByName('키워드목록')
		};

		const parseDate = cell => {
			const d = new Date(sheets.main.getRange(cell).getValue());
			if (isNaN(d)) {
				throw new Error(`메인 시트 ${cell}에 올바른 날짜(YYYY-MM-DD)를 입력하세요.`);
			}
			return d;
		};
		
		const startDate = parseDate('C3');
		const endDate   = parseDate('C4');

		const keywords = sheets.keywords
			.getRange(2, 1, sheets.keywords.getLastRow() - 1, 1)
			.getValues()
			.flat()
			.filter(Boolean)
			.map(k => `${k}`.toLowerCase());

		const userRows = sheets.influList
			.getRange(4, 1, sheets.influList.getLastRow() - 3, 2)
			.getValues()
			.filter(([u, id]) => u && id);

		let totalNew = 0, totalRel = 0;
		const rowsToWrite = [];
		const failures = [];

		for (const [username, userId] of userRows) {
			let endCursor = '';
			let hasNextPage = true;

			while (hasNextPage) {
				let media;
				
				try {
					media = fetchPage(userId, endCursor);
				} catch (err) {
					failures.push(`${username} : ${err.message}`);
					break;
				}
				
				if (!media) break;

				const { edges = [], page_info: pageInfo = {} } = media;
				const { rows, newCount, relCount, stopPaging } = filterPosts(
					edges, username, startDate, endDate, keywords
				);
				rowsToWrite.push(...rows);
				totalNew += newCount;
				totalRel += relCount;

				if (stopPaging) {
					hasNextPage = false;
				}
				else if (pageInfo.has_next_page) {
					endCursor = pageInfo.end_cursor;
				}
				else {
					hasNextPage = false;
				}
			}
		}

		writeResults(rowsToWrite, sheets.result);
		sheets.main.getRange('C7').setValue(totalNew);
		sheets.main.getRange('C8').setValue(totalRel);

		const failCount = failures.length;
		const failDetails = failCount
			? `\n\n실패 상세:\n${failures.join('\n')}`
			: '';
		ui.alert(
		`Instagram 트래킹 결과\n\n신규 포스트: ${totalNew}\n관련 포스트: ${totalRel}\n실패 요청: ${failCount}${failDetails}`
		);

		log(`✅ Instagram 트래킹 완료: 신규 ${totalNew}, 관련 ${totalRel}`);
	} finally {
		lock.releaseLock();
	}
};