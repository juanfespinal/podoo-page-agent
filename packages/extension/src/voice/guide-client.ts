export async function activeOdooTabId(origin: string): Promise<number | null> {
	const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
	if (!tab?.id || !tab.url) return null
	try {
		return new URL(tab.url).origin === origin ? tab.id : null
	} catch {
		return null
	}
}

export async function guideMessage(
	tabId: number,
	action: 'guide_inspect' | 'guide_highlight' | 'guide_clear',
	payload?: unknown[]
): Promise<Record<string, unknown>> {
	try {
		return (await chrome.runtime.sendMessage({
			type: 'PAGE_CONTROL',
			action,
			targetTabId: tabId,
			payload,
		})) as Record<string, unknown>
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) }
	}
}
