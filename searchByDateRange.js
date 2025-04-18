const buildInsPostUrl = (shortcode, token) => {
	const root = "https://ensembledata.com/apis";
	const endpoint = "/instagram/user/posts"
	const params = {
		code: shortcode,
		n_comments_to_fetch: 0,
		token: token
	};
	const queryString = Object.keys(params)
		.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
		.join("&");
	return `${root}${endpoint}?${queryString}`;
};

const searchByDateRange = () => {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const mainSheet = ss.getSheetByName("메인");
	const influencerSheet = ss.getSheetByName("인플루언서목록");
	const keywordSheet = ss.getSheetByName("키워드목록");
  
	const token = getRequiredProperty("API_TOKEN")
  
	const startDate = new Date(mainSheet.getRange("B2").getValue());
	const endDate = new Date(mainSheet.getRange("B3").getValue());
  
	if (isNaN(startDate) || isNaN(endDate)) {
	  SpreadsheetApp.getUi().alert("시작일과 종료일을 올바르게 입력해주세요.");
	  return;
	}
  
	const influencers = influencerSheet
		.getRange(2, 1, influencerSheet.getLastRow() - 1, 1)
		.getValues()
		.flat()
		.filter(Boolean);
  
	const keywords = keywordSheet
		.getRange(2, 1, keywordSheet.getLastRow() - 1)
		.getValues()
		.flat()
		.map(k => k.toLowerCase().trim())
		.filter(Boolean);

	const urls = influencers.map(username => buildInsPostUrl(username, token));
  
	// 📌 [2] 일괄 요청
	const responses = fetchAllInBatches(urls, 100, 500);
  
	let newPostCount = 0;
	let keywordPostCount = 0;
  
	// 📌 [3] 응답 처리
	responses.forEach((res, idx) => {
	  try {
		const json = JSON.parse(res.getContentText());
		const posts = json.data || [];
  
		posts.forEach(post => {
		  const ts = new Date(post.taken_at_timestamp * 1000);
		  if (ts >= startDate && ts <= endDate) {
			newPostCount++;
  
			const caption = (post.caption || "").toLowerCase();
			const matched = keywords.some(k => caption.includes(k));
			if (matched) keywordPostCount++;
		  }
		});
	  } catch (e) {
		Logger.log(`${influencers[idx]} 응답 오류: ${e.toString()}`);
	  }
	});
  
	// 📌 [4] 결과 기록
	mainSheet.getRange("B9").setValue(newPostCount);
	mainSheet.getRange("B10").setValue(keywordPostCount);
  };
  