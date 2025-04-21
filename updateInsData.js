const INS_ROOT = "https://ensembledata.com/apis";
const INS_TOKEN = getRequiredProperty("API_TOKEN");

const buildInsUserInfoUrl = (username) => {
  const params = {
    username: username,
    token: INS_TOKEN,
  };
  const qs = Object.entries(params)
    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${INS_ROOT}/instagram/user/posts?${qs}`;
};

const updateInstagramIds = () => {
	const ss       = SpreadsheetApp.getActiveSpreadsheet();
	const sheet    = ss.getSheetByName("인플루언서목록");
	const token    = getRequiredProperty("API_TOKEN");
	const lastRow  = sheet.getLastRow();
	const userData = sheet.getRange(3, 1, lastRow - 2, 2).getValues();
  
	const targets = userData
		.map(([username, id], idx) => ({
			username: username?.toString().trim(),
			row: idx + 3,
			needsUpdate: !!username && !id
		}))
		.filter(item => item.needsUpdate);
  
	if (!targets.length) {
		log("✅ 업데이트할 인스타 ID 없음");
		return;
	}
  
	const now  = new Date();
	const urls = targets.map(({ username }) =>
	  `https://ensembledata.com/apis/instagram/user/info?username=${username}&token=${token}`
	);

	const responses = fetchAllInBatches(urls, 100, 500);
  
	responses.forEach((res, i) => {
	  const { username, row } = targets[i];
	  try {
		const { user_id: userId = "" } = JSON.parse(res.getContentText());
		if (userId) {
		  sheet.getRange(row, 2).setValue(userId);       // B열: ID
		  sheet.getRange(row, 3).setValue(now);          // C열: timestamp
		  log(`✅ ${username} → ID: ${userId} @ ${now.toISOString()}`);
		} else {
		  log(`⚠️ ${username} user_id 응답 없음`);
		}
	  } catch (e) {
		log(`❌ ${username} 처리 중 오류: ${e}`);
	  }
	});
  };
  