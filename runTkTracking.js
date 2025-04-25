const buildTikTokUserPostsRequest = (secUid, count = 35, cursor = '0') => {
  const apiKey = getRequiredProperty('RAPIDAPI_KEY');
  const url = `https://${Config.RAPIDAPI_TK_HOST}/api/user/posts`;
  let qs = `?secUid=${encodeURIComponent(secUid)}&count=${count}&cursor=${cursor}`;
  return {
    url: `${url}${qs}`,
    options: {
      method: 'get',
      headers: {
        'x-rapidapi-host': Config.RAPIDAPI_TK_HOST,
        'x-rapidapi-key': apiKey
      },
      muteHttpExceptions: true
    }
  };
};

const fetchTikTokPage = (secUid, cursor = '0') => {
  const { url, options } = buildTikTokUserPostsRequest(secUid, 35, cursor);
  const resp = UrlFetchApp.fetch(url, options);
  if (resp.getResponseCode() !== 200) throw new Error(`HTTP ${resp.getResponseCode()}`);
  const json = JSON.parse(resp.getContentText());
  const data = json.data;
  if (!data || !Array.isArray(data.itemList)) {
    throw new Error('포스트를 불러올 수 없습니다.');
  }
  return data;
};

const filterTikTokPosts = (items, username, startDate, endDate, keywords) => {
	const rows = [];
	let newCount = 0, relCount = 0;
	let stopPaging = false;

	for (const item of items) {
		const ts = new Date(item.createTime * 1000);
		
		if (ts <= startDate) {
			stopPaging = true;
			break;
		}
		if (ts > endDate) continue;
		
		newCount++;
		const descLower = (item.desc || '').toLowerCase();
		if (keywords.length && !keywords.some(k => descLower.includes(k))) continue;

		relCount++;
		const videoUrl = `https://www.tiktok.com/@${username}/video/${item.id}`;
		rows.push([
			username,
			ts,
			videoUrl,
			item.desc,
			item.stats.playCount,
			item.stats.diggCount,
			item.stats.commentCount,
			item.stats.collectCount,
		]);
	}

	return { rows, newCount, relCount, stopPaging };
};

const runTikTokTracking = () => {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = {
		main:      ss.getSheetByName('메인'),
		influList: ss.getSheetByName('인플루언서목록'),
		result:    ss.getSheetByName('틱톡 결과'),
		keywords:  ss.getSheetByName('키워드목록')
    };

    const parseDate = cellRef => {
		const d = new Date(sheets.main.getRange(cellRef).getValue());
		if (isNaN(d)) {
			throw new Error(`메인 시트 ${cellRef}에 올바른 날짜(YYYY-MM-DD)를 입력하세요.`);
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
		.getRange(4, 3, sheets.influList.getLastRow() - 3, 2)
		.getValues()
		.filter(([name, secUid]) => name && secUid);

    let totalNew = 0, totalRel = 0;
    const allRows = [];
    const failures = [];

    for (const [username, secUid] of userRows) {
		let cursor = '0';
		let hasMore = true;

		while (hasMore) {
			let data;
			try {
				data = fetchTikTokPage(secUid, cursor);
			} catch (err) {
				failures.push(`${username}: ${err.message}`);
				break;
			}

			const items = data.itemList;
			const { rows, newCount, relCount, stopPaging } = filterTikTokPosts(
			items, username, startDate, endDate, keywords
			);
			allRows.push(...rows);
			totalNew += newCount;
			totalRel += relCount;

			if (stopPaging) {
				hasMore = false;
			} else if ((data.cursor != '-1')) {
				cursor = data.cursor;
			} else {
				hasMore = false;
			}
		}
    }

    writeResults(allRows, sheets.result);
    sheets.main.getRange('C11').setValue(totalNew);
    sheets.main.getRange('C12').setValue(totalRel);
	log(`✅ TikTok 트래킹 완료: 전체 ${totalNew}, 관련 ${totalRel}`);

    const failCount = failures.length;
    const failMsg = failCount
		?`\n\n실패 상세:\n${failures.join('\n')}`
		: '';
    ui.alert(
		`TikTok 트래킹 결과\n\n전체 포스트: ${totalNew}\n관련 포스트: ${totalRel}\n실패 요청: ${failCount}${failMsg}`
    );
}
