export interface GuideSnapshot {
	id: string
	url: string
	createdAt: number
	indices: Set<number>
}

export function indexedControls(content: string): Set<number> {
	return new Set([...content.matchAll(/(?:^|\n)\s*\*?\[(\d+)\]/g)].map((match) => Number(match[1])))
}

export function assertHighlightSelection(
	snapshot: GuideSnapshot | null,
	request: { snapshotId?: string; index?: number } | undefined,
	currentUrl: string,
	now: number
): number {
	if (
		!snapshot ||
		request?.snapshotId !== snapshot.id ||
		currentUrl !== snapshot.url ||
		now - snapshot.createdAt > 60000
	) {
		throw new Error('Screen snapshot changed or expired. Inspect the screen again.')
	}
	if (!Number.isInteger(request.index) || !snapshot.indices.has(request.index!)) {
		throw new Error('The chosen control was not in the inspected screen. Inspect again.')
	}
	return request.index!
}
