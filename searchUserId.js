const searchUserId = () => {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sheet = ss.getSheetByName("인플루언서목록");
	const token = "여기에_ensembledata_API_토큰_입력";
  
	const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  
	const usernamesToFetch = [];
	const rowMap = [];
  
	dataRange.forEach(([username, user_id], i) => {
	  if (!user_id && username) {
		usernamesToFetch.push(username.toString().trim());
		rowMap.push(i + 2); // 시트의 실제 행 번호
	  }
	});
  
	if (usernamesToFetch.length === 0) {
	  Logger.log("업데이트할 user_id 없음");
	  return;
	}
  
	const urls = usernamesToFetch.map(
	  username => `https://ensembledata.com/apis/instagram/user/info?username=${username}&token=${token}`
	);
  
	const responses = fetchAllInBatches(urls, 100, 500);
  
	responses.forEach((res, idx) => {
	  try {
		const json = JSON.parse(res.getContentText());
		const user_id = json.user_id || "";
  
		if (user_id) {
		  sheet.getRange(rowMap[idx], 2).setValue(user_id); // B열에 기록
		  Logger.log(`✅ ${usernamesToFetch[idx]} → user_id: ${user_id}`);
		} else {
		  Logger.log(`❌ ${usernamesToFetch[idx]} user_id 없음`);
		}
	  } catch (e) {
		Logger.log(`⚠️ ${usernamesToFetch[idx]} 처리 중 오류: ${e}`);
	  }
	});
};
