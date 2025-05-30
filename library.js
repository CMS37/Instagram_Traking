/*
	Combined Tracking Library
	Exposes only:
		- updateTikTokIds()
		- updateInstagramIds()
		- runTikTokTracking()
		- runInstagramTracking()
*/
(function (global) {
	'use strict';

	// Configuration
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

	// Utilities
	// const log = (message) => Logger.log(message);

	function writeResults(rows, sheet) {
		const lastRow = sheet.getLastRow();
		const lastCol = sheet.getLastColumn();
		if (lastRow >= 2 && lastCol) {
			sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
		}
		if (rows.length) {
			sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
		}
	}

	function recordLog(apiName, count) {
		const sourceSS = SpreadsheetApp.getActiveSpreadsheet();
		const sheetName = sourceSS.getName();
		const logSS = SpreadsheetApp.openById(Config.LOG_SHEET);
		let logSheet = logSS.getSheetByName(sheetName);
		if (!logSheet) {
			logSheet = logSS.insertSheet(sheetName);
			logSheet
				.getRange(1, 1, 1, 4)
				.setValues([
					['Timestamp', 'UserEmail', 'APIName', 'CallCount'],
				]);
			logSheet.setFrozenRows(1);
		}
		logSheet.insertRowAfter(1);
		const userEmail = Session.getActiveUser().getEmail() || 'unknown';
		logSheet
			.getRange(2, 1, 1, 4)
			.setValues([[new Date(), userEmail, apiName, count]]);
	}

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
					if (RETRY_CODES.includes(code)) {
						retry.push(batch[idx]);
					} else {
						results.push(resp);
					}
				});

				if (!retry.length) {
					batch = [];
					break;
				}

				batch = retry;
				Utilities.sleep(delayMs * Math.pow(2, attempt));
				attempt++;
			}
			if (batch.length && attempt > maxRetries) {
				lastResponses.forEach((resp) => {
					const err = new Error(
						`최대 재시도 횟수 초과: HTTP ${resp.getResponseCode()}`,
					);
					err.response = resp;
					results.push(err);
				});
			}
		}
		return { responses: results, totalCalls };
	};

	// Extract raw usernames
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

	// Generic ID updater
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
	}

	// Build requests
	function buildTikTokIdRequest(username) {
		return {
			url: `https://${Config.TK_HOST}/api/user/info?uniqueId=${encodeURIComponent(username)}`,
			method: 'get',
			headers: {
				'x-rapidapi-host': Config.TK_HOST,
				'x-rapidapi-key': Config.API_KEY,
			},
			muteHttpExceptions: true,
		};
	}

	function buildTikTokPostsRequest(secUid, cursor = '0') {
		return {
			url: `https://${Config.TK_HOST}/api/user/posts?secUid=${encodeURIComponent(secUid)}&count=${35}&cursor=${cursor}`,
			method: 'get',
			headers: {
				'x-rapidapi-host': Config.TK_HOST,
				'x-rapidapi-key': Config.API_KEY,
			},
			muteHttpExceptions: true,
		};
	}

	function buildInstagramPostsRequest(userId, endCursor = '') {
		return {
			url: `https://${Config.INS_HOST}/user-feeds2?id=${encodeURIComponent(userId)}&count=${12}${endCursor ? `&end_cursor=${encodeURIComponent(endCursor)}` : ''}`,
			method: 'get',
			headers: {
				'x-rapidapi-host': Config.INS_HOST,
				'x-rapidapi-key': Config.API_KEY,
			},
			muteHttpExceptions: true,
		};
	}

	function buildInstagramIdRequest(username) {
		return {
			url: `https://${Config.INS_HOST}/id?username=${encodeURIComponent(username)}`,
			method: 'get',
			headers: {
				'x-rapidapi-host': Config.INS_HOST,
				'x-rapidapi-key': Config.API_KEY,
			},
			muteHttpExceptions: true,
		};
	}

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
		url: [
			'https://www.googleapis.com/youtube/v3/videos',
			`?key=${Config.YT_API_KEY}`,
			`&id=${videoIds.join(',')}`,
			'&part=snippet,statistics',
		].join(''),
		method: 'get',
		muteHttpExceptions: true,
	});

	// TikTok ID
	function updateTikTokIds() {
		return updateUserIds({
			serviceName: 'TikTok',
			sheetName: '인플루언서목록',
			rawNameCol: 3,
			idCol: 4,
			requestBuilder: buildTikTokIdRequest,
			extractRawName: extractTikTokUsername,
			extractIdFromResponse: (json) => json?.userInfo?.user?.secUid,
			rawPrefix: '@',
		});
	}

	// Instagram ID
	function updateInstagramIds() {
		return updateUserIds({
			serviceName: 'Instagram',
			sheetName: '인플루언서목록',
			rawNameCol: 1,
			idCol: 2,
			requestBuilder: buildInstagramIdRequest,
			extractRawName: extractInstagramUsername,
			extractIdFromResponse: (json) => json.user_id,
		});
	}

	// Post filters
	function filterTikTokPosts(items, username, startDate, endDate, keywords) {
		const rows = [];
		let newCount = 0,
			relCount = 0;
		let stopPaging = false;
		for (const item of items) {
			const ts = new Date(item.createTime * 1000);
			if (ts <= startDate && !item.isPinnedItem) {
				stopPaging = true;
				break;
			}
			newCount++;
			if (ts < startDate || ts > endDate) continue;
			const descLower = (item.desc || '').toLowerCase();
			if (keywords.length && !keywords.some((k) => descLower.includes(k)))
				continue;
			relCount++;
			rows.push([
				username,
				ts,
				`https://www.tiktok.com/@${username}/video/${item.id}`,
				item.desc,
				item.stats.playCount,
				item.stats.diggCount,
				item.stats.commentCount,
				item.stats.collectCount,
			]);
		}
		return { rows, newCount, relCount, stopPaging };
	}

	function filterInstagramPosts(
		edges,
		username,
		startDate,
		endDate,
		keywords,
	) {
		const rows = [];
		let newCount = 0,
			relCount = 0;
		let stopPaging = false;

		for (const { node } of edges) {
			const ts = new Date((node.taken_at_timestamp ?? 0) * 1000);
			const isPinned =
				Array.isArray(node.pinned_for_users) &&
				node.pinned_for_users.length > 0;
			if (!isPinned && ts <= startDate) {
				stopPaging = true;
				break;
			}
			newCount++;
			if (ts < startDate || ts > endDate) continue;
			const caption =
				node.edge_media_to_caption?.edges?.[0]?.node?.text?.toLowerCase() ??
				'';
			if (!keywords.some((k) => caption.includes(k))) continue;
			relCount++;
			const likeCount = node.like_and_view_counts_disabled
				? 'x'
				: (node.edge_media_preview_like?.count ?? 'x');
			const commentCount = node.like_and_view_counts_disabled
				? 'x'
				: (node.edge_media_to_comment?.count ?? 'x');
			const viewCount = node.is_video
				? (node.video_view_count ?? 'x')
				: 'x';
			rows.push([
				username,
				ts,
				`https://www.instagram.com/p/${node.shortcode}`,
				caption,
				viewCount,
				likeCount,
				commentCount,
			]);
		}
		return { rows, newCount, relCount, stopPaging };
	}

	// Core tracker
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

		let userRows = sheets.list
			.getRange(
				listConfig.startRow,
				listConfig.rawNameCol,
				sheets.list.getLastRow() - listConfig.startRow + 1,
				2,
			)
			.getValues()
			.map(([raw, id]) => [
				listConfig.extractName(raw),
				id?.toString().trim() || '',
			])
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
		const cursors = new Map(
			userRows.map(([u, id]) => [`${u}|${id}`, initialCursor]),
		);
		while (cursors.size) {
			const requests = [];
			const infos = [];
			cursors.forEach((cursor, key) => {
				const [username, id] = key.split('|');
				requests.push(buildRequest(id, cursor));
				infos.push({ key, username });
			});
			cursors.clear();
			const { responses, totalCalls } = fetchAllWithBackoff(requests);
			recordLog(`${serviceName} API`, totalCalls);
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
		writeResults(rowsToWrite, sheets.result);
		sheets.main.getRange(counterRanges.newCount).setValue(totalNew);
		sheets.main.getRange(counterRanges.relCount).setValue(totalRel);
		ui.alert(
			`✅ ${serviceName} 트래킹 완료\n\n전체 포스트: ${totalNew}\n관련 포스트: ${totalRel}${failures.length ? `\n\n실패 상세:\n${failures.join('\n')}` : ''}`,
		);
	}

	// TikTok tracking
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
				rawNameCol: 3,
				extractName: extractTikTokUsername,
			},
			buildRequest: buildTikTokPostsRequest,
			getItems: (json) => json.data.itemList,
			getNextCursor: (json, items) =>
				json.data.cursor !== '-1' ? json.data.cursor : null,
			filterFn: filterTikTokPosts,
			counterRanges: { newCount: 'C11', relCount: 'C12' },
			initialCursor: '0',
		});
	}

	// Instagram tracking
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
				extractName: extractInstagramUsername,
			},
			buildRequest: buildInstagramPostsRequest,
			getItems: (json) =>
				json.data.user.edge_owner_to_timeline_media.edges,
			getNextCursor: (json, edges) =>
				edges.page_info?.has_next_page
					? edges.page_info.end_cursor
					: null,
			filterFn: filterInstagramPosts,
			counterRanges: { newCount: 'C7', relCount: 'C8' },
			initialCursor: '',
		});
	}

	// YouTube stats and tags
	const parseYouTubeStatsAndTags = (jsonText) => {
		const data = JSON.parse(jsonText);
		const map = {};
		(data.items || []).forEach((item) => {
			map[item.id] = {
				stats: item.statistics || {},
				tags: (item.snippet.tags || []).map((t) => t.toLowerCase()),
			};
		});
		return map;
	};

	function chunkArray(arr, size) {
		const chunks = [];
		for (let i = 0; i < arr.length; i += size) {
			chunks.push(arr.slice(i, i + size));
		}
		return chunks;
	}

	function getChannelIdBySearch(query) {
		const clean = query.replace(/^@/, '').trim();
		const url = [
			'https://www.googleapis.com/youtube/v3/search',
			'?part=snippet',
			'&type=channel',
			`&q=${encodeURIComponent(clean)}`,
			'&maxResults=1',
			`&key=${Config.YT_API_KEY}`,
		].join('');

		const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
		Logger.log('Request URL → ' + url);
		Logger.log('Status Code → ' + resp.getResponseCode());
		Logger.log('Response Text → ' + resp.getContentText());

		if (resp.getResponseCode() !== 200) return null;
		const items = JSON.parse(resp.getContentText()).items || [];
		return items[0]?.id?.channelId || null;
	}

	// YouTube tracking with stats
	function runYouTubeTracking() {
		const ss = SpreadsheetApp.getActive();
		const listSheet = ss.getSheetByName('인플루언서목록');
		const mainSheet = ss.getSheetByName('메인');
		const resultSheet = ss.getSheetByName('유튜브 결과');
		const START_ROW = 4;

		const raws = listSheet
			.getRange(START_ROW, 5, listSheet.getLastRow() - START_ROW + 1, 1)
			.getValues()
			.flat()
			.filter((r) => r);

		const startDate = new Date(mainSheet.getRange('C3').getValue());
		const endDate = new Date(mainSheet.getRange('C4').getValue());
		const keywords = ss
			.getSheetByName('키워드목록')
			.getRange(4, 1, ss.getSheetByName('키워드목록').getLastRow() - 3, 1)
			.getValues()
			.flat()
			.filter((k) => k)
			.map((k) => k.toString().toLowerCase());

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

		raws.forEach((raw) => {
			const channelName = raw.toString().trim();
			const channelId = getChannelIdBySearch(channelName);
			if (!channelId) return;

			let cursor = '';
			let stop = false;
			while (!stop) {
				const { url } = buildYouTubeSearchRequest(channelId, cursor);
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
						Logger.log(
							`Stopping search for ${raw} - first video is before start date: ${ts}`,
						);
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
			const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
			if (resp.getResponseCode() !== 200) return;
			Object.assign(
				statsMap,
				parseYouTubeStatsAndTags(resp.getContentText()),
			);
		});

		const finalRows = allMeta
			.filter((m) => {
				const entry = statsMap[m.vid] || { tags: [] };
				const titleLow = m.title.toLowerCase();
				const descLow = m.desc.toLowerCase();
				const tags = entry.tags;
				return keywords.some(
					(k) =>
						titleLow.includes(k) ||
						descLow.includes(k) ||
						tags.includes(k),
				);
			})
			.map((m) => {
				const st = (statsMap[m.vid] || {}).stats || {};
				return [
					m.channelName,
					m.ts,
					m.url,
					m.title,
					m.desc,
					+st.viewCount || 0,
					+st.likeCount || 0,
					+st.commentCount || 0,
				];
			});

		mainSheet.getRange('C16').setValue(finalRows.length);

		if (finalRows.length) {
			resultSheet
				.getRange(2, 1, finalRows.length, finalRows[0].length)
				.setValues(finalRows);
		} else {
			SpreadsheetApp.getUi().alert(
				'기간내 키워드에 매칭되는 영상이 없습니다.',
			);
		}
	}

	// Expose
	global.updateTikTokIds = updateTikTokIds;
	global.updateInstagramIds = updateInstagramIds;
	global.runTikTokTracking = runTikTokTracking;
	global.runInstagramTracking = runInstagramTracking;
	global.runYouTubeTracking = runYouTubeTracking;
})(this);
