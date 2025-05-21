const buildInstagramPostsRequest = (userId, endCursor = '') => ({
	url: `https://${Config.INS_HOST}/user-feeds2?id=${encodeURIComponent(userId)}&count=${12}${endCursor ? `&end_cursor=${encodeURIComponent(endCursor)}` : ''}`,
	method: 'get',
	headers: {
		'x-rapidapi-host': Config.INS_HOST,
		'x-rapidapi-key': Config.API_KEY,
	},
	muteHttpExceptions: true,
});

const buildTikTokPostsRequest = (secUid, cursor = '0') => ({
	url: `https://${Config.TK_HOST}/api/user/posts?secUid=${encodeURIComponent(secUid)}&count=${35}&cursor=${cursor}`,
	method: 'get',
	headers: {
		'x-rapidapi-host': Config.TK_HOST,
		'x-rapidapi-key': Config.API_KEY,
	},
	muteHttpExceptions: true,
});

const filterInstagramPosts = (
	edges,
	username,
	startDate,
	endDate,
	keywords,
) => {
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
		const viewCount = node.is_video ? (node.video_view_count ?? 'x') : 'x';
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
};

const filterTikTokPosts = (items, username, startDate, endDate, keywords) => {
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
};
