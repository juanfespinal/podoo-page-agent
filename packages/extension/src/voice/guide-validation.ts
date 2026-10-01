export interface GuideSnapshot {
	id: string
	url: string
	createdAt: number
	indices: Set<number>
}

export class GuideSelectionError extends Error {
	constructor(
		message: string,
		readonly code: 'STALE_SNAPSHOT' | 'INVALID_TARGET'
	) {
		super(message)
	}
}

/** Detects a rerender that kept the same URL and element reference but changed its purpose. */
export function guideTargetKey(element: HTMLElement): string {
	return JSON.stringify([
		element.tagName,
		element.getAttribute('name'),
		element.getAttribute('aria-label'),
		element.getAttribute('title'),
		element.getAttribute('role'),
		element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240),
		element instanceof HTMLInputElement ? element.value : null,
	])
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
		throw new GuideSelectionError(
			'Screen snapshot changed or expired. Inspect the screen again.',
			'STALE_SNAPSHOT'
		)
	}
	if (!Number.isInteger(request.index) || !snapshot.indices.has(request.index!)) {
		throw new GuideSelectionError(
			'The chosen control was not in the inspected screen. Inspect again.',
			'INVALID_TARGET'
		)
	}
	return request.index!
}
