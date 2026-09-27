import type { AnalyticGuideStep } from './analytic-guide'

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
	action: 'guide_analytic_reset' | 'guide_analytic_step' | 'guide_analytic_clear'
): Promise<AnalyticGuideStep | null> {
	try {
		const response = await chrome.runtime.sendMessage({
			type: 'PAGE_CONTROL',
			action,
			targetTabId: tabId,
		})
		if (!response || response.success === false) return null
		return action === 'guide_analytic_step' ? (response as AnalyticGuideStep) : null
	} catch {
		return null
	}
}
