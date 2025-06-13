(function (global) {
	'use strict';

	// ───────────────────────────────────────────────────────────────────────────
	// Configuration
	// ───────────────────────────────────────────────────────────────────────────
	const Config = {
		TK_HOST: PropertiesService.getScriptProperties().getProperty('TK_HOST'),
		INS_HOST:
			PropertiesService.getScriptProperties().getProperty('INS_HOST'),
		API_KEY: PropertiesService.getScriptProperties().getProperty('API_KEY'),
		YT_API_KEY:
			PropertiesService.getScriptProperties().getProperty(
				'YOUTUBE_API_KEY',
			),
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
	const chunkArray = (arr, size) => {
		const chunks = [];
		for (let i = 0; i < arr.length; i += size) {
			chunks.push(arr.slice(i, i + size));
		}
		return chunks;
	};

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

	// function logDebugToSheet(debugArray) {
	// 	const ss = SpreadsheetApp.getActiveSpreadsheet();
	// 	let logSheet = ss.getSheetByName('DebugLog');
	// 	if (!logSheet) {
	// 		logSheet = ss.insertSheet('DebugLog');
	// 		logSheet.appendRow(['idx', 'url', 'status', 'body']);
	// 	}

	// 	const rows = debugArray.map((item) => [
	// 		item.idx,
	// 		item.url,
	// 		item.status,
	// 		typeof item.body === 'object'
	// 			? JSON.stringify(item.body)
	// 			: item.body,
	// 	]);

	// 	// 한 번에 쓰기
	// 	logSheet
	// 		.getRange(logSheet.getLastRow() + 1, 1, rows.length, 4)
	// 		.setValues(rows);
	// }

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

				// const debugArray = responses.map((resp, idx) => {
				// 	let bodyText;
				// 	try {
				// 		bodyText = resp.getContentText();
				// 		// JSON 형태면 파싱해서 객체로, 아니면 원본 문자열로
				// 		try {
				// 			bodyText = JSON.parse(bodyText);
				// 		} catch (e) {
				// 			/* 그냥 문자열 유지 */
				// 		}
				// 	} catch (e) {
				// 		bodyText = null;
				// 	}
				// 	return {
				// 		idx,
				// 		url: batch[idx].url,
				// 		status: resp.getResponseCode(),
				// 		body: bodyText,
				// 	};
				// });
				// logDebugToSheet(debugArray);

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
	const extractInstagramUsername = (raw) => {
		const s = (raw || '').toString().trim();
		const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
		return m ? m[1] : s.replace(/^@+/, '');
	};

	const extractTikTokUsername = (raw) => {
		const s = (raw || '').toString().trim();
		const m = s.match(/tiktok\.com\/(?:@)?([A-Za-z0-9._]+)/i);
		return m ? m[1] : s.replace(/^@+/, '');
	};

	// ───────────────────────────────────────────────────────────────────────────
	// Request Builders
	// ───────────────────────────────────────────────────────────────────────────
	const buildTikTokPostsRequest = (id, cursor = '') => ({
		url: `https://${Config.TK_HOST}/user/posts?unique_id=${encodeURIComponent(id)}&count=10&cursor=${cursor}`,
		method: 'get',
		headers: {
			'x-rapidapi-host': Config.TK_HOST,
			'x-rapidapi-key': Config.API_KEY,
		},
		muteHttpExceptions: true,
	});

	const buildInstagramPostsRequest = (username, paginationToken = '') => ({
		url: `https://${Config.INS_HOST}/v1/posts?username_or_id_or_url=${encodeURIComponent(username)}${paginationToken ? `&pagination_token=${encodeURIComponent(paginationToken)}` : ''}`,
		method: 'get',
		headers: {
			'x-rapidapi-host': Config.INS_HOST,
			'x-rapidapi-key': Config.API_KEY,
		},
		muteHttpExceptions: true,
	});

	const buildYouTubeSearchRequest = (channelId, pageToken = '') => {
		const params = [
			`key=${Config.YT_API_KEY}`,
			`channelId=${encodeURIComponent(channelId)}`,
			'part=snippet',
			'order=date',
			'maxResults=50',
			pageToken && `pageToken=${encodeURIComponent(pageToken)}`,
		]
			.filter(Boolean)
			.join('&');
		return {
			url: `https://www.googleapis.com/youtube/v3/search?${params}`,
			method: 'get',
			muteHttpExceptions: true,
		};
	};

	const buildYouTubeStatsAndTagsRequest = (videoIds) => ({
		url: `https://www.googleapis.com/youtube/v3/videos?key=${Config.YT_API_KEY}&id=${videoIds.join(',')}&part=snippet,statistics`,
		method: 'get',
		muteHttpExceptions: true,
	});

	// ───────────────────────────────────────────────────────────────────────────
	// Parsers & Filters
	// ───────────────────────────────────────────────────────────────────────────
	function parseYouTubeStatsAndTags(responseText) {
		const data = JSON.parse(responseText);
		return data.items.reduce((map, item) => {
			map[item.id] = {
				stats: item.statistics || {},
				tags: item.snippet?.tags || [],
				description: item.snippet?.description || '',
			};
			return map;
		}, {});
	}

	function logDebugToSheet(debugArray) {
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		let logSheet = ss.getSheetByName('DebugLog');
		if (!logSheet) {
			logSheet = ss.insertSheet('DebugLog');
			logSheet.appendRow(['idx', 'url', 'status', 'body']);
		}

		const rows = debugArray.map((item) => [
			item.idx,
			item.url,
			item.status,
			typeof item.body === 'object'
				? JSON.stringify(item.body)
				: item.body,
		]);

		// 한 번에 쓰기
		logSheet
			.getRange(logSheet.getLastRow() + 1, 1, rows.length, 4)
			.setValues(rows);
	}
	function filterTikTokPosts(items, username, startDate, endDate, keywords) {
		const rows = [];
		let newCount = 0,
			relCount = 0;
		let stopPaging = false;
		console.log(
			`Filtering TikTok posts for user: ${username}, startDate: ${startDate.toISOString()}, endDate: ${endDate.toISOString()}`,
		);
		for (const item of items) {
			const ts = new Date(item.create_time * 1000);
			console.log(
				`Processing post: ${item.video_id}, timestamp: ${ts.toISOString()}`,
			);

			if (ts <= startDate) {
				stopPaging = true;
				break;
			}

			newCount++;
			if (ts < startDate || ts > endDate) continue;

			const title = (item.title || '').toLowerCase();
			if (
				keywords.length &&
				!keywords.some((k) => title.includes(k.toLowerCase()))
			) {
				continue;
			}
			relCount++;
			rows.push([
				username,
				ts,
				`https://www.tiktok.com/@${username}/video/${item.video_id}`,
				item.title,
				item.play_count,
				item.digg_count,
				item.comment_count,
				item.collect_count,
			]);
			console.log(
				`Matched post: ${item.video_id}, title: ${item.title}, views: ${item.play_count} likes: ${item.digg_count}, comments: ${item.comment_count}`,
			);
		}
		return { rows, newCount, relCount, stopPaging };
	}

	function filterInstagramPosts(
		items,
		username,
		startDate,
		endDate,
		keywords,
	) {
		const rows = [];
		let newCount = 0,
			relCount = 0;
		let stopPaging = false;

		for (const item of items) {
			const ts = new Date(item.taken_at_date);
			console.log(
				`Processing post: ${item.code}, timestamp: ${ts.toISOString()}`,
			);

			const pinned = Boolean(item.is_pinned);
			if (!pinned && ts <= startDate) {
				stopPaging = true;
				break;
			}
			newCount++;

			if (!pinned && (ts < startDate || ts > endDate)) continue;

			const text = (item.caption?.text || '').toLowerCase();
			const tags = Array.isArray(item.caption?.hashtags)
				? item.caption.hashtags.map((t) => t.toLowerCase())
				: [];
			const matched = keywords.some(
				(k) =>
					text.includes(k.toLowerCase()) ||
					tags.includes(k.toLowerCase()),
			);
			if (keywords.length && !matched) continue;

			relCount++;

			const link = `https://www.instagram.com/p/${item.code}`;
			rows.push([
				username,
				ts,
				link,
				text,
				item.ig_play_count ?? 'x',
				item.like_count ?? 'x',
				item.comment_count ?? 'x',
			]);
		}

		return { rows, newCount, relCount, stopPaging };
	}

	// ───────────────────────────────────────────────────────────────────────────
	// ID Updaters
	// ───────────────────────────────────────────────────────────────────────────
	function updateTikTokIds() {
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		const sheet = ss.getSheetByName('인플루언서목록');
		if (!sheet)
			throw new Error('Sheet "인플루언서목록"을 찾을 수 없습니다.');

		const raws = sheet
			.getRange('B4:B')
			.getValues()
			.map((row) => row[0])
			.filter((row) => row);

		if (raws.length === 0) {
			SpreadsheetApp.getUi().alert(
				'틱톡 ID를 업데이트할 데이터가 없습니다.',
			);
			return;
		}

		const normalized = raws.map((raw) => [extractTikTokUsername(raw)]);

		sheet.getRange(4, 2, normalized.length, 1).setValues(normalized);
	}

	function updateInstagramIds() {
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		const sheet = ss.getSheetByName('인플루언서목록');
		if (!sheet)
			throw new Error('Sheet "인플루언서목록"을 찾을 수 없습니다.');

		const lastRow = sheet.getLastRow();
		if (lastRow < 4) return;

		const raws = sheet
			.getRange(4, 1, lastRow - 3, 1)
			.getValues()
			.flat();
		const normalized = raws.map((raw) => [extractInstagramUsername(raw)]);
		sheet.getRange(4, 1, normalized.length, 1).setValues(normalized);
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

	function runTikTokTracking() {
		return runTracking({
			serviceName: 'TikTok',
			sheetNames: {
				main: '메인',
				list: '인플루언서목록',
				result: '틱톡 결과',
				keywords: '키워드목록',
			},
			listConfig: {
				startRow: 4,
				rawNameCol: 2,
				idCol: 2,
				extractName: (raw) => raw.toString().trim(),
			},
			buildRequest: buildTikTokPostsRequest,
			getItems: (json) =>
				Array.isArray(json.data?.videos) ? json.data.videos : [],
			getNextCursor: (json /*, items*/) =>
				json.data?.hasMore ? json.data.cursor : null,
			filterFn: filterTikTokPosts,
			counterRanges: { newCount: 'C11', relCount: 'C12' },
			initialCursor: '0',
		});
	}

	function runInstagramTracking() {
		return runTracking({
			serviceName: 'Instagram',
			sheetNames: {
				main: '메인',
				list: '인플루언서목록',
				result: '인스타 결과',
				keywords: '키워드목록',
			},
			listConfig: {
				startRow: 4,
				rawNameCol: 1,
				idCol: 1,
				extractName: (raw) => raw.toString().trim(),
			},
			buildRequest: buildInstagramPostsRequest,
			getItems: (json) =>
				json.data && Array.isArray(json.data.items)
					? json.data.items
					: [],
			getNextCursor: (json) => json.pagination_token || null,
			filterFn: filterInstagramPosts,
			counterRanges: { newCount: 'C7', relCount: 'C8' },
			initialCursor: '',
		});
	}

	function getChannelIdBySearch(rawInput) {
		const input = rawInput.toString().trim();
		const handle = input.startsWith('@') ? input : '@' + input;

		const url = [
			'https://www.googleapis.com/youtube/v3/search?',
			'part=snippet',
			'type=channel',
			'maxResults=1',
			`q=${encodeURIComponent(handle)}`,
			`key=${Config.YT_API_KEY}`,
		].join('&');

		const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
		if (resp.getResponseCode() !== 200) return null;

		const items = JSON.parse(resp.getContentText()).items || [];
		return items[0]?.id.channelId || null;
	}

	function runYouTubeTracking() {
		const ss = SpreadsheetApp.getActive();
		const listSheet = ss.getSheetByName('인플루언서목록');
		const keywordSheet = ss.getSheetByName('키워드목록');
		const mainSheet = ss.getSheetByName('메인');
		const resultSheet = ss.getSheetByName('유튜브 결과');

		const START_ROW_LIST = 4;
		const COL_LIST = 3; // C열
		const START_ROW_KEYWORDS = 2;
		const COL_KEYWORDS = 1; // A열

		function getColumnData(sheet, col, startRow) {
			const all = sheet
				.getRange(1, col, sheet.getMaxRows(), 1)
				.getValues()
				.flat()
				.map((v) => v.toString().trim());
			let lastRow = 0;
			all.forEach((val, idx) => {
				if (val !== '') lastRow = idx + 1; // 0-based → 1-based
			});
			if (lastRow < startRow) return [];
			const numRows = lastRow - startRow + 1;
			return sheet
				.getRange(startRow, col, numRows, 1)
				.getValues()
				.flat()
				.filter((v) => v !== '');
		}

		const influencers = getColumnData(listSheet, COL_LIST, START_ROW_LIST);
		if (influencers.length === 0) {
			SpreadsheetApp.getUi().alert(
				'C열 4행 이하에 인플루언서 목록이 없습니다.',
			);
			return;
		}

		const keywords = getColumnData(
			keywordSheet,
			COL_KEYWORDS,
			START_ROW_KEYWORDS,
		);
		if (keywords.length === 0) {
			SpreadsheetApp.getUi().alert(
				'A열 2행 이하에 읽을 키워드가 없습니다.',
			);
			return;
		}
		const lowerKeywords = keywords.map((k) => k.toLowerCase());
		const startDate = new Date(mainSheet.getRange('C3').getValue());
		const endDate = new Date(mainSheet.getRange('C4').getValue());

		resultSheet
			.getRange(
				2,
				1,
				resultSheet.getMaxRows() - 1,
				resultSheet.getMaxColumns(),
			)
			.clearContent();

		const allMeta = [];
		const allIds = [];
		let totalCount = 0;

		// ← 여기만 raws → influencers 로 바뀜
		influencers.forEach((channelName) => {
			totalCount++;
			const channelId = getChannelIdBySearch(channelName);
			if (!channelId) return;

			let cursor = '';
			let stop = false;
			while (!stop) {
				const { url } = buildYouTubeSearchRequest(channelId, cursor);
				totalCount++;
				const resp = UrlFetchApp.fetch(url, {
					muteHttpExceptions: true,
				});
				const data = JSON.parse(resp.getContentText());
				const items = data.items || [];

				for (const item of items) {
					if (item.id.kind !== 'youtube#video') continue;

					const sn = item.snippet;
					const ts = new Date(sn.publishedAt);

					if (ts < startDate) {
						stop = true;
						break;
					}
					if (ts > endDate) continue;

					allIds.push(item.id.videoId);
					allMeta.push({
						vid: item.id.videoId,
						channelName,
						ts,
						url: `https://youtu.be/${item.id.videoId}`,
						title: sn.title,
						desc: sn.description,
					});
				}

				if (stop || !data.nextPageToken) break;
				cursor = data.nextPageToken;
			}
		});

		mainSheet.getRange('C15').setValue(allMeta.length);

		if (!allIds.length) {
			mainSheet.getRange('C16').setValue(0);
			SpreadsheetApp.getUi().alert('조회된 영상이 없습니다.');
			return;
		}

		const statsMap = {};
		chunkArray(allIds, 50).forEach((batch) => {
			const { url } = buildYouTubeStatsAndTagsRequest(batch);
			totalCount++;
			const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
			if (resp.getResponseCode() !== 200) return;
			Object.assign(
				statsMap,
				parseYouTubeStatsAndTags(resp.getContentText()),
			);
		});

		const finalRows = allMeta
			.filter((m) => {
				const entry = statsMap[m.vid] || { tags: [], description: '' };
				const titleLow = m.title.toLowerCase();
				const descLow = entry.description.toLowerCase();
				const tagsLow = entry.tags.map((t) => t.toLowerCase());
				return lowerKeywords.some(
					(k) =>
						titleLow.includes(k) ||
						descLow.includes(k) ||
						tagsLow.includes(k),
				);
			})
			.map((m) => {
				const entry = statsMap[m.vid] || {};
				const st = entry.stats || {};
				return [
					m.channelName,
					m.ts,
					m.url,
					m.title,
					entry.description,
					+st.viewCount || 0,
					+st.likeCount || 0,
					+st.commentCount || 0,
				];
			});

		mainSheet.getRange('C16').setValue(finalRows.length);
		recordLog('YouTube Tracking', totalCount);

		if (finalRows.length) {
			resultSheet
				.getRange(2, 1, finalRows.length, finalRows[0].length)
				.setValues(finalRows);
		} else {
			SpreadsheetApp.getUi().alert(
				`전체 ${allMeta.length}개의 영상중 \n 기간내 키워드에 매칭되는 영상이 없습니다.`,
			);
		}
	}

	// ───────────────────────────────────────────────────────────────────────────
	// Exports
	// ───────────────────────────────────────────────────────────────────────────
	global.updateTikTokIds = updateTikTokIds;
	global.updateInstagramIds = updateInstagramIds;
	global.runTikTokTracking = runTikTokTracking;
	global.runInstagramTracking = runInstagramTracking;
	global.runYouTubeTracking = runYouTubeTracking;
})(this);
