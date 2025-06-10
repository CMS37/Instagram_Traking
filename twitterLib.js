(function (global) {
	'use strict';

	// ───────────────────────────────────────────────────────────────────────────
	// Configuration
	// ───────────────────────────────────────────────────────────────────────────
	const Config = {
		TW_HOST: PropertiesService.getScriptProperties().getProperty('TW_HOST'),
		API_KEY: PropertiesService.getScriptProperties().getProperty('API_KEY'),
		LOG_SHEET:
			PropertiesService.getScriptProperties().getProperty('LOG_SHEET'),
		BATCH_SIZE: parseInt(
			PropertiesService.getScriptProperties().getProperty('BATCH_SIZE'),
			10,
		),
		DELAY_MS: parseInt(
			PropertiesService.getScriptProperties().getProperty('DELAY_MS'),
			10,
		),
		MAX_RETRIES: parseInt(
			PropertiesService.getScriptProperties().getProperty('MAX_RETRIES'),
			10,
		),
	};

	// ───────────────────────────────────────────────────────────────────────────
	// Utilities
	// ───────────────────────────────────────────────────────────────────────────

	const writeResults = (rows, sheet) => {
		const lastRow = sheet.getLastRow();
		const lastCol = sheet.getLastColumn();
		if (lastRow >= 2 && lastCol) {
			sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
		}
		if (rows.length) {
			sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
		}
	};

	const recordLog = (apiName, count) => {
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		const name = ss.getName();
		const logSS = SpreadsheetApp.openById(Config.LOG_SHEET);
		let logSheet = logSS.getSheetByName(name);
		if (!logSheet) {
			logSheet = logSS.insertSheet(name);
			logSheet
				.getRange(1, 1, 1, 4)
				.setValues([
					['Timestamp', 'UserEmail', 'APIName', 'CallCount'],
				]);

			logSheet.setFrozenRows(1);
		}
		logSheet
			.insertRowAfter(1)
			.getRange(2, 1, 1, 4)
			.setValues([
				[
					new Date(),
					Session.getActiveUser().getEmail() || 'unknown',
					apiName,
					count,
				],
			]);
	};

	const fetchAllWithBackoff = (
		requests,
		batchSize = Config.BATCH_SIZE,
		delayMs = Config.DELAY_MS,
		maxRetries = Config.MAX_RETRIES,
	) => {
		const RETRY_CODES = [204, 429, 500, 502, 503, 504];
		const results = [];
		let totalCalls = 0;

		for (let i = 0; i < requests.length; i += batchSize) {
			let batch = requests.slice(i, i + batchSize);
			let attempt = 0;
			let lastResponses = [];

			while (batch.length && attempt <= maxRetries) {
				totalCalls += batch.length;
				const responses = UrlFetchApp.fetchAll(batch);
				lastResponses = responses;
				const retry = [];

				responses.forEach((resp, idx) => {
					const code = resp.getResponseCode();
					if (RETRY_CODES.includes(code)) retry.push(batch[idx]);
					else results.push(resp);
				});

				if (!retry.length) break;
				batch = retry;
				Utilities.sleep(delayMs * 2 ** attempt);
				attempt++;
			}

			if (batch.length && attempt > maxRetries) {
				lastResponses.forEach((resp) => {
					const err = new Error(
						`Max retries exceeded: HTTP ${resp.getResponseCode()}`,
					);
					err.response = resp;
					results.push(err);
				});
			}
		}

		return { responses: results, totalCalls };
	};
	// ───────────────────────────────────────────────────────────────────────────
	// Extractors
	// ───────────────────────────────────────────────────────────────────────────
	function extractTwitterUsername(raw) {
		const s = (raw || '').toString().trim();
		const m = s.match(/twitter\.com\/(?:@)?([A-Za-z0-9_]+)/i);
		return m ? m[1] : s.replace(/^@+/, '');
	}

	function extractTweetsFromResponse(resp) {
		const instructions = resp?.result?.timeline?.instructions || [];
		const allEntries = instructions
			.filter((inst) => inst.type === 'TimelineAddEntries')
			.flatMap((inst) => inst.entries);

		return allEntries
			.filter((en) => en.content?.entryType === 'TimelineTimelineItem')
			.map((en) => en.content.itemContent.tweet_results.result);
	}

	function extractNextCursor(resp) {
		const instructions = resp?.result?.timeline?.instructions || [];
		const allEntries = instructions
			.filter((inst) => inst.type === 'TimelineAddEntries')
			.flatMap((inst) => inst.entries);

		const cursorEntry = allEntries.find(
			(en) =>
				en.content?.entryType === 'TimelineTimelineCursor' &&
				en.content.cursorType === 'Bottom',
		);
		return cursorEntry?.content?.value || null;
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Request Builders
	// ───────────────────────────────────────────────────────────────────────────
	function buildTwitterIdRequest(username) {
		return {
			url: `https://${Config.TW_HOST}/user?username=${encodeURIComponent(username)}`,
			method: 'get',
			headers: {
				'x-rapidapi-host': Config.TW_HOST,
				'x-rapidapi-key': Config.API_KEY,
			},
			muteHttpExceptions: true,
		};
	}

	function buildTwitterTweetsRequest(userId, cursor = '') {
		const cursorParam = cursor
			? `&cursor=${encodeURIComponent(cursor)}`
			: '';
		return {
			url: `https://${Config.TW_HOST}/user-media?user=${encodeURIComponent(userId)}&count=100${cursorParam}`,
			method: 'get',
			headers: {
				'x-rapidapi-host': Config.TW_HOST,
				'x-rapidapi-key': Config.API_KEY,
			},
			muteHttpExceptions: true,
		};
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Parsers & Filters
	// ───────────────────────────────────────────────────────────────────────────
	function filterTwitterTweets(
		items,
		username,
		startDate,
		endDate,
		keywords,
	) {
		const rows = [];
		let newCount = 0;
		let relCount = 0;
		let stopPaging = false;

		for (const item of items) {
			const tweet = item.tweet || item;
			const legacy = tweet.legacy || {};
			const createdAt = legacy.created_at;
			console.log(`Processing tweet by ${username} at ${createdAt}`);
			if (!createdAt) continue;
			const ts = new Date(createdAt);
			if (ts <= startDate) {
				stopPaging = true;
				break;
			}
			newCount++;
			if (ts < startDate || ts > endDate) continue;

			let text = (legacy.full_text || '')
				.replace(/https?:\/\/\S+$/, '')
				.trim();
			const lowerText = text.toLowerCase();
			if (
				keywords.length &&
				!keywords.some((k) => lowerText.includes(k.toLowerCase()))
			)
				continue;

			relCount++;
			// Counts
			const views = item.views?.count || 0;
			const likes = legacy.favorite_count || 0;
			const retweets = legacy.retweet_count || 0;
			const replies = legacy.reply_count || 0;
			const quotes = legacy.quote_count || 0;
			const bookmarks = legacy.bookmark_count || 0;

			rows.push([
				username,
				ts,
				`https://twitter.com/${username}/status/${legacy.id_str}`,
				text,
				views,
				likes,
				retweets,
				replies,
				quotes,
				bookmarks,
			]);
			console.log(`Found tweet by ${username} on ${ts.toISOString()}`);
		}

		return { rows, newCount, relCount, stopPaging };
	}

	// ───────────────────────────────────────────────────────────────────────────
	// ID Updaters
	// ───────────────────────────────────────────────────────────────────────────
	function updateUserIds({
		serviceName,
		sheetName,
		rawNameCol,
		idCol,
		requestBuilder,
		extractRawName,
		extractIdFromResponse,
		rawPrefix = '',
	}) {
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		const sheet = ss.getSheetByName(sheetName);
		const ui = SpreadsheetApp.getUi();
		if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);

		const lastRow = sheet.getLastRow();
		if (lastRow < 4) return ui.alert('✅ 업데이트할 유저가 없습니다');

		const rowCount = lastRow - 3;

		const rawVals = sheet
			.getRange(4, rawNameCol, rowCount, 1)
			.getValues()
			.flat();
		const idVals = sheet.getRange(4, idCol, rowCount, 1).getValues().flat();

		const targets = rawVals
			.map((raw, idx) => {
				const name = extractRawName(raw);
				const existing = idVals[idx].toString().trim();
				return { row: idx + 4, name, needs: !!name && !existing };
			})
			.filter((t) => t.needs);

		if (!targets.length) return ui.alert('✅ 업데이트할 유저가 없습니다');

		const { responses, totalCalls } = fetchAllWithBackoff(
			targets.map((t) => requestBuilder(t.name)),
		);
		recordLog(`${serviceName} ID update`, totalCalls);
		console.log(
			` 응답내용: ${responses.map((r) => r.getContentText()).join('\n')}`,
		);
		const respMap = {};
		targets.forEach((t, i) => (respMap[t.row] = responses[i]));

		const newRaw = [];
		const newIds = [];
		const errs = [];

		for (let i = 0; i < rowCount; i++) {
			const row = i + 4;
			const origRaw = rawVals[i];
			const origId = idVals[i];

			if (respMap[row]) {
				try {
					const resp = respMap[row];
					if (resp.getResponseCode() !== 200) {
						throw new Error(`HTTP ${resp.getResponseCode()}`);
					}
					const j = JSON.parse(resp.getContentText());
					const id = extractIdFromResponse(j);
					if (!id) throw new Error('ID not found');

					newRaw.push([rawPrefix + extractRawName(origRaw)]);
					newIds.push([id]);
				} catch (e) {
					errs.push(`${extractRawName(origRaw)}: ${e.message}`);
					newRaw.push([origRaw]);
					newIds.push([origId]);
				}
			} else {
				newRaw.push([origRaw]);
				newIds.push([origId]);
			}
		}

		sheet.getRange(4, rawNameCol, rowCount, 1).setValues(newRaw);
		sheet.getRange(4, idCol, rowCount, 1).setValues(newIds);

		if (errs.length) ui.alert(`ID 업데이트 오류:\n${errs.join('\n')}`);
		else ui.alert(`✅ ${serviceName} ID 업데이트 완료`);
	}

	function updateTwitterIds() {
		return updateUserIds({
			serviceName: 'Twitter',
			sheetName: '인플루언서목록',
			rawNameCol: 5, // E열
			idCol: 6, // F열
			requestBuilder: buildTwitterIdRequest,
			extractRawName: extractTwitterUsername,
			extractIdFromResponse: (json) =>
				json.result.data.user.result.rest_id,
			rawPrefix: '',
		});
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Core Tracking Runner
	// ───────────────────────────────────────────────────────────────────────────
	function runTracking({
		serviceName,
		sheetNames,
		listConfig,
		buildRequest,
		getItems,
		getNextCursor,
		filterFn,
		counterRanges,
		initialCursor,
	}) {
		const ui = SpreadsheetApp.getUi();
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		const sheets = {
			main: ss.getSheetByName(sheetNames.main),
			list: ss.getSheetByName(sheetNames.list),
			result: ss.getSheetByName(sheetNames.result),
			keywords: ss.getSheetByName(sheetNames.keywords),
		};

		const parseDate = (cell) => {
			const d = new Date(sheets.main.getRange(cell).getValue());
			if (isNaN(d))
				throw new Error(
					`❌ 메인 시트 ${cell}에 올바른 날짜를 입력하세요.`,
				);
			return d;
		};

		const startDate = parseDate('C3');
		const endDate = parseDate('C4');
		const keywords = sheets.keywords
			.getRange(2, 1, sheets.keywords.getLastRow() - 1)
			.getValues()
			.flat()
			.filter(Boolean)
			.map((k) => `${k}`.toLowerCase());

		const numCols = listConfig.idCol - listConfig.rawNameCol + 1;
		let userRows = sheets.list
			.getRange(
				listConfig.startRow,
				listConfig.rawNameCol,
				sheets.list.getLastRow() - listConfig.startRow + 1,
				numCols,
			)
			.getValues()
			.map((row) => {
				const raw = row[0];
				const idCell = row[listConfig.idCol - listConfig.rawNameCol];
				const id = idCell != null ? idCell.toString().trim() : raw;
				return [listConfig.extractName(raw), id];
			})
			.filter(([n, i]) => n && i);

		const seen = new Set();
		userRows = userRows.filter(([u, id]) => {
			const key = `${u}|${id}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		let totalNew = 0,
			totalRel = 0;
		const rowsToWrite = [];
		const failures = [];
		let Calls = 0;
		const cursors = new Map(
			userRows.map(([u, id]) => [`${u}|${id}`, initialCursor]),
		);
		console.log(
			`Starting ${serviceName} tracking from ${startDate.toISOString()} to ${endDate.toISOString()}`,
		);
		console.log(`Found ${cursors.size} unique users to track.`);
		while (cursors.size) {
			const requests = [];
			const infos = [];
			cursors.forEach((cursor, key) => {
				const [username, id] = key.split('|');
				requests.push(buildRequest(id, cursor));
				infos.push({ key, username });
			});
			cursors.clear();
			console.log(
				`Processing ${requests.length} requests for ${serviceName}...`,
			);
			const { responses, totalCalls } = fetchAllWithBackoff(requests);
			Calls += totalCalls;
			responses.forEach((resp, idx) => {
				const { key, username } = infos[idx];
				if (resp instanceof Error) {
					failures.push(`${username}: ${resp.message}`);
					return;
				}
				try {
					if (resp.getResponseCode() !== 200)
						throw new Error(`HTTP ${resp.getResponseCode()}`);
					const json = JSON.parse(resp.getContentText());
					const items = getItems(json);
					const { rows, newCount, relCount, stopPaging } = filterFn(
						items,
						username,
						startDate,
						endDate,
						keywords,
					);
					rowsToWrite.push(...rows);
					totalNew += newCount;
					totalRel += relCount;
					const next = getNextCursor(json, items);
					if (!stopPaging && next) cursors.set(key, next);
				} catch (err) {
					if (err.message.includes('HTTP 429')) {
						failures.push(
							`${username}: 다른 부서(사용자)가 사용 중입니다. 잠시 후 다시 시도해 주세요.`,
						);
					} else if (err.message.includes('HTTP 204')) {
						failures.push(
							`${username}: 응답이 누락되었습니다. 잠시 후 다시 시도해 주세요.`,
						);
					} else {
						failures.push(`${username}: ${err.message}`);
					}
				}
			});
		}
		recordLog(`${serviceName} API`, Calls);
		writeResults(rowsToWrite, sheets.result);
		sheets.main.getRange(counterRanges.newCount).setValue(totalNew);
		sheets.main.getRange(counterRanges.relCount).setValue(totalRel);
		ui.alert(
			`✅ ${serviceName} 트래킹 완료\n\n전체 포스트: ${totalNew}\n관련 포스트: ${totalRel}${failures.length ? `\n\n실패 상세:\n${failures.join('\n')}` : ''}`,
		);
	}

	function runTwitterTracking() {
		return runTracking({
			serviceName: 'Twitter',
			sheetNames: {
				main: '메인',
				list: '인플루언서목록',
				result: '트위터 결과',
				keywords: '키워드목록',
			},
			listConfig: {
				startRow: 4,
				rawNameCol: 5,
				idCol: 6,
				extractName: extractTwitterUsername,
			},
			buildRequest: buildTwitterTweetsRequest,
			getItems: (resp) => extractTweetsFromResponse(resp),
			getNextCursor: (resp) => extractNextCursor(resp),
			filterFn: filterTwitterTweets,
			counterRanges: { newCount: 'C19', relCount: 'C20' },
			initialCursor: '',
		});
	}

	global.updateTwitterIds = updateTwitterIds;
	global.runTwitterTracking = runTwitterTracking;
})(this);
