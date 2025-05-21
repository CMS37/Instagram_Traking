/*
  Combined Tracking Library
  Exposes only:
    - updateTikTokIds()
    - updateInstagramIds()
    - runTikTokTracking()
    - runInstagramTracking()
*/
(function(global) {
  'use strict';

  //---- Configuration (formerly config.js) ----
  const Config = {
    TK_HOST: PropertiesService.getScriptProperties().getProperty('TK_HOST'),
    INS_HOST: PropertiesService.getScriptProperties().getProperty('INS_HOST'),
    API_KEY: PropertiesService.getScriptProperties().getProperty('API_KEY'),
    BATCH_SIZE: parseInt(PropertiesService.getScriptProperties().getProperty('BATCH_SIZE'), 10) || 50,
    DELAY_MS: parseInt(PropertiesService.getScriptProperties().getProperty('DELAY_MS'), 10) || 1000
  };

  //---- Utilities (formerly utils.js) ----
  const log = message => Logger.log(message);
  const fetchAllInBatches = (requests, batchSize = Config.BATCH_SIZE, delay = Config.DELAY_MS) => {
    const all = [];
    for (let i = 0; i < requests.length; i += batchSize) {
      all.push(...UrlFetchApp.fetchAll(requests.slice(i, i + batchSize)));
      if (i + batchSize < requests.length) Utilities.sleep(delay);
    }
    return all;
  };
  const extractInstagramUsername = raw => {
    const s = (raw||'').toString().trim();
    const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
    return m ? m[1] : s.replace(/^@+/, '');
  };
  const extractTikTokUsername = raw => {
    const s = (raw||'').toString().trim();
    const m = s.match(/tiktok\.com\/(?:@)?([A-Za-z0-9._]+)/i);
    return m ? m[1] : s.replace(/^@+/, '');
  };
  function updateUserIds({ sheetName, rawNameCol, idCol, requestBuilder, extractRawName, extractIdFromResponse, rawPrefix = '' }) {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    const raws = sheet.getRange(2, rawNameCol, lastRow - 1, 1).getValues().flat();
    const reqs = raws.map(r => requestBuilder(extractRawName(r))).filter(Boolean);
    const resps = fetchAllInBatches(reqs);
    resps.forEach((r, i) => {
      const json = JSON.parse(r.getContentText());
      const id = extractIdFromResponse(json);
      sheet.getRange(i + 2, idCol).setValue(id ? `${rawPrefix}${id}` : '');
    });
  }

  //---- TikTok ID functions (formerly tkUserId.js) ----
  function buildTikTokIdRequest(username) {
    return {
      url: `https://${Config.TK_HOST}/api/user/info?uniqueId=${encodeURIComponent(username)}`,
      method: 'get',
      headers: {
        'x-rapidapi-host': Config.TK_HOST,
        'x-rapidapi-key': Config.API_KEY
      },
      muteHttpExceptions: true
    };
  }
  function updateTikTokIds() {
    Logger.log("start");
    return updateUserIds({
      sheetName: '인플루언서목록',
      rawNameCol: 3,
      idCol: 4,
      requestBuilder: buildTikTokIdRequest,
      extractRawName: extractTikTokUsername,
      extractIdFromResponse: json => json?.userInfo?.user?.secUid,
      rawPrefix: '@'
    });
  }

  //---- Instagram ID functions (formerly insUserId.js) ----
  function buildInstagramIdRequest(username) {
    return {
      url: `https://${Config.INS_HOST}/id?username=${encodeURIComponent(username)}`,
      method: 'get',
      headers: {
        'x-rapidapi-host': Config.INS_HOST,
        'x-rapidapi-key': Config.API_KEY
      },
      muteHttpExceptions: true
    };
  }
  function updateInstagramIds() {
    return updateUserIds({
      sheetName: '인플루언서목록',
      rawNameCol: 1,
      idCol: 2,
      requestBuilder: buildInstagramIdRequest,
      extractRawName: extractInstagramUsername,
      extractIdFromResponse: json => json.user_id
    });
  }

  //---- Post filtering (formerly trackingUtils.js) ----
  function filterTikTokPosts(items, username, startDate, endDate, keywords) {
    const rows = [];
    for (const item of items) {
      const ts = new Date(item.createTime * 1000);
      if (ts < startDate || ts > endDate) continue;
      const desc = (item.desc||'').toLowerCase();
      if (keywords.length && !keywords.some(k => desc.includes(k))) continue;
      rows.push([username, ts, `https://www.tiktok.com/${username}/video/${item.id}`, item.desc,
        item.stats.playCount, item.stats.diggCount, item.stats.commentCount, item.stats.collectCount]);
    }
    return rows;
  }
  function filterInstagramPosts(edges, username, startDate, endDate, keywords) {
    const rows = [];
    for (const { node } of edges) {
      const ts = new Date((node.taken_at_timestamp||0)*1000);
      if (ts < startDate || ts > endDate) continue;
      const caption = (node.edge_media_to_caption?.edges[0]?.node.text||'').toLowerCase();
      if (keywords.length && !keywords.some(k => caption.includes(k))) continue;
      rows.push([username, ts, `https://www.instagram.com/p/${node.shortcode}`, caption,
        node.is_video ? node.video_view_count : 'x', node.edge_media_preview_like?.count, node.edge_media_to_comment?.count]);
    }
    return rows;
  }

  //---- Core tracking runner (shared runTracking) ----
  function runTracking({ serviceName, sheetNames, listConfig, buildRequest, getItems, getNextCursor, filterFn, counterRanges, initialCursor }) {
    const ss = SpreadsheetApp.getActive();
    const listSheet = ss.getSheetByName(sheetNames.list);
    const resultSheet = ss.getSheetByName(sheetNames.result);
    const raws = listSheet.getRange(listConfig.startRow, listConfig.rawNameCol,
      listSheet.getLastRow()-listConfig.startRow+1, 1).getValues().flat();
    const ids = raws.map(listConfig.extractName).filter(Boolean);
    let cursor = initialCursor;
    const rows = [];
    while (ids.length) {
      const reqs = ids.map(id => buildRequest(id, Config.BATCH_SIZE, cursor));
      const resps = fetchAllInBatches(reqs);
      // 안전하게 itemList 취득
      const allItems = resps.flatMap(r => {
        try {
          const json = JSON.parse(r.getContentText());
          return getItems(json) || [];
        } catch (e) {
          log(`Error parsing response: ${e}`);
          return [];
        }
      });
      rows.push(...filterFn(allItems, ids.shift(), new Date(), new Date(), []));
      // 다음 커서 추출
      let next = null;
      try {
        const json0 = JSON.parse(resps[0].getContentText());
        const candidate = getNextCursor(json0, allItems);
        next = candidate != null ? candidate : null;
      } catch (e) {
        log(`Error getting next cursor: ${e}`);
      }
      if (!next) break;
      cursor = next;
    }
    writeRows(resultSheet, rows);
  }
  function writeRows(sheet, rows) {
    if (!rows.length) return;
    sheet.getRange(sheet.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
  }

  //---- Public tracking functions ----
  function runTikTokTracking() {
    return runTracking({
      serviceName: 'TikTok',
      sheetNames: { main: '메인', list: '인플루언서목록', result: '틱톡 결과', keywords: '키워드목록' },
      listConfig: { startRow: 4, rawNameCol: 3, extractName: extractTikTokUsername },
      buildRequest: (secUid, count, cursor) => ({
        url: `https://${Config.TK_HOST}/api/user/posts?secUid=${encodeURIComponent(secUid)}&count=${count}&cursor=${cursor}`,
        method: 'get', headers: { 'x-rapidapi-host': Config.TK_HOST, 'x-rapidapi-key': Config.API_KEY }, muteHttpExceptions: true
      }),
      getItems: json => json.data?.itemList || [],
      getNextCursor: (json) => json.data?.cursor && json.data.cursor !== '-1' ? json.data.cursor : null,
      filterFn: filterTikTokPosts,
      counterRanges: { newCount: 'C11', relCount: 'C12' },
      initialCursor: '0'
    });
  }
  function runInstagramTracking() {
    return runTracking({
      serviceName: 'Instagram',
      sheetNames: { main: '메인', list: '인플루언서목록', result: '인스타 결과', keywords: '키워드목록' },
      listConfig: { startRow: 4, rawNameCol: 1, extractName: extractInstagramUsername },
      buildRequest: (userId, count, endCursor) => ({
        url: `https://${Config.INS_HOST}/user-feeds2?id=${encodeURIComponent(userId)}&count=${count}${endCursor?`&end_cursor=${encodeURIComponent(endCursor)}`:''}`,
        method: 'get', headers: { 'x-rapidapi-host': Config.INS_HOST, 'x-rapidapi-key': Config.API_KEY }, muteHttpExceptions: true
      }),
      getItems: json => json.data?.user?.edge_owner_to_timeline_media?.edges || [],
      getNextCursor: (json, edges) => edges.page_info?.has_next_page ? edges.page_info.end_cursor : null,
      filterFn: filterInstagramPosts,
      counterRanges: { newCount: 'C7', relCount: 'C8' },
      initialCursor: ''
    });
  }

  //---- Expose only these 4 functions ----
  global.updateTikTokIds       = updateTikTokIds;
  global.updateInstagramIds    = updateInstagramIds;
  global.runTikTokTracking     = runTikTokTracking;
  global.runInstagramTracking  = runInstagramTracking;

})(this);
