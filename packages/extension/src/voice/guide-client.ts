import { CONTENT_SCRIPT_MISSING, isMissingContentScript } from '@/agent/pageControlErrors'

import type { OdooScreenInspection } from './realtime-flow'

function matchesOdooOrigin(tab: chrome.tabs.Tab, origin: string): boolean {
	if (!tab.id || !tab.url) return false
	try {
		return new URL(tab.url).origin === origin
	} catch {
		return false
	}
}

export async function activeOdooTabId(origin: string, path?: string): Promise<number | null> {
	const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
	if (tab && matchesOdooOrigin(tab, origin)) return tab.id ?? null
	const candidates = (await chrome.tabs.query({})).filter((candidate) =>
		matchesOdooOrigin(candidate, origin)
	)
	const matchingPath = path
		? candidates.find((candidate) => candidate.url && new URL(candidate.url).pathname === path)
		: null
	return (
		matchingPath?.id ??
		candidates.find((candidate) => candidate.active)?.id ??
		candidates[0]?.id ??
		null
	)
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
		return {
			success: false,
			...(isMissingContentScript(error) ? { code: CONTENT_SCRIPT_MISSING } : {}),
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export async function inspectOdooScreen(
	origin: string,
	path?: string
): Promise<{ tabId: number | null; screen: OdooScreenInspection }> {
	const tabId = await activeOdooTabId(origin, path)
	if (tabId === null)
		return { tabId: null, screen: { success: false, error: 'No encuentro la pestaña de Odoo.' } }
	const response = await guideMessage(tabId, 'guide_inspect')
	return {
		tabId,
		screen: {
			success: response.success === true,
			code: typeof response.code === 'string' ? response.code : undefined,
			error: typeof response.error === 'string' ? response.error : undefined,
			snapshotId: typeof response.snapshotId === 'string' ? response.snapshotId : undefined,
			context: response.context,
			title: typeof response.title === 'string' ? response.title : undefined,
			controls: typeof response.controls === 'string' ? response.controls : undefined,
			fields: Array.isArray(response.fields) ? response.fields : undefined,
			footer: typeof response.footer === 'string' ? response.footer : undefined,
		},
	}
}
