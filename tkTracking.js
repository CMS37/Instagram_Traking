const runTikTokTracking = () =>
	runTracking({
		serviceName: 'TikTok',
		sheetNames: { main: '메인', list: '인플루언서목록', result: '틱톡 결과', keywords: '키워드목록' },
		listConfig: { startRow: 4, rawNameCol: 3, extractName: extractTikTokUsername },
		buildRequest: buildTikTokPostsRequest,
		getItems: json => json.data.itemList,
		getNextCursor: (json, items) => json.data.cursor !== '-1' ? json.data.cursor : null,
		filterFn: filterTikTokPosts,
		counterRanges: { newCount: 'C11', relCount: 'C12' },
		initialCursor: '0'
});
