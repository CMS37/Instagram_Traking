/**
 * 인스타그램 포스트 트래킹 실행
 * 1) 메인 시트에서 기간(start, end) 읽기
 * 2) 키워드목록 시트에서 필터용 키워드 읽기
 * 3) 인플루언서목록 시트에서 (username, user_id, lastTs) 읽기
 * 4) 각 user_id별 API 호출 → posts 배열 반환
 * 5) lastTs 이후의 포스트만 처리, 키워드 매칭 여부 검사
 * 6) “포스팅 결과” 시트에 appendRow
 * 7) 신규/관련 포스트 수 집계 → 메인 시트 B9/B10에 기록
 * 8) 인플루언서목록 C열에 최신 lastTs 갱신
 */
const runInstagramTracking = () => {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const main = ss.getSheetByName("메인");
	const inf = ss.getSheetByName("인플루언서목록");
	let res = ss.getSheetByName("포스팅 결과");
	if (!res) {
	  res = ss.insertSheet("포스팅 결과");
	}
	
	// 1) 기간
	const startDate = main.getRange("B2").getValue();
	const endDate   = main.getRange("B3").getValue();
	if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
	  throw new Error("메인 시트 B2/B3에 날짜가 올바르게 입력되어 있어야 합니다.");
	}
	
	// 2) 키워드 리스트 (소문자)
	const kwSheet = ss.getSheetByName("키워드목록");
	const rawKW   = kwSheet.getRange(2,1, kwSheet.getLastRow()-1,1).getValues().flat();
	const keywords = rawKW.filter(String).map(k => k.toLowerCase());
	
	// 3) 인플루언서 목록
	const lastRow = inf.getLastRow();
	const infData = inf.getRange(3,1, lastRow-2, 3).getValues();
	// [ [username, user_id, lastTs], ... ]
	
	// 초기화: 결과 시트 헤더
	res.clearContents();
	res.appendRow(["username","user_id","post_id","timestamp","caption","matched_keyword"]);
	
	let totalNew     = 0;
	let totalRelated = 0;
	const token = getRequiredProperty("API_TOKEN");
	
	infData.forEach((row, idx) => {
	  const [username, userId, lastTs] = row;
	  if (!username || !userId) {
		log(`⚠️ ID 누락: ${username || "(blank)"}, 스킵합니다.`);
		return;
	  }
	  const sinceTs = lastTs instanceof Date
		? Utilities.formatDate(lastTs, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'")
		: Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'");
	  
	  // 4) API 호출 (엔드포인트는 실제 경로에 맞게 수정)
	  const url = `https://ensembledata.com/apis/instagram/user/posts?user_id=${userId}`
				+ `&token=${token}`
				+ `&since=${sinceTs}`
				+ `&until=${Utilities.formatDate(endDate, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'")}`;
	  let posts = [];
	  try {
		const resp = UrlFetchApp.fetch(url);
		posts = JSON.parse(resp.getContentText()).data || [];
	  } catch(e) {
		log(`❌ ${username} 게시물 조회 오류: ${e}`);
		return;
	  }
	  
	  // 5) 필터링 & 6) 결과 적재
	  let maxTs = lastTs instanceof Date ? lastTs : startDate;
	  posts.forEach(post => {
		const ts = new Date(post.timestamp);
		if (ts <= maxTs || ts < startDate || ts > endDate) return;
		
		totalNew++;
		const caption = post.caption || "";
		const lc = caption.toLowerCase();
		const matched = keywords.some(k => lc.includes(k));
		if (matched) totalRelated++;
		
		res.appendRow([
		  username,
		  userId,
		  post.id,
		  post.timestamp,
		  caption,
		  matched
		]);
		
		if (ts > maxTs) maxTs = ts;
	  });
	  inf.getRange(idx + 3, 3).setValue(maxTs);
	});

	main.getRange("B9").setValue(totalNew);
	main.getRange("B10").setValue(totalRelated);
	log(`✅ 인스타 트래킹 완료 → 신규: ${totalNew}, 관련: ${totalRelated}`);
};  