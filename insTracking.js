const runInstagramTracking = () =>
	runTracking({
		serviceName: 'Instagram',
		sheetNames: { main: '메인', list: '인플루언서목록', result: '인스타 결과', keywords: '키워드목록' },
		listConfig: { startRow: 4, rawNameCol: 1, extractName: extractInstagramUsername },
		buildRequest: buildInstagramPostsRequest,
		getItems: json => json.data.user.edge_owner_to_timeline_media.edges,
		getNextCursor: (json, edges) => edges.page_info?.has_next_page ? edges.page_info.end_cursor : null,
		filterFn: filterInstagramPosts,
		counterRanges: { newCount: 'C7', relCount: 'C8' },
		initialCursor: ''
});
