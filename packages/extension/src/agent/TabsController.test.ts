import { afterEach, describe, expect, it, vi } from 'vitest'

import { TabsController } from './TabsController'

afterEach(() => vi.unstubAllGlobals())

describe('TabsController in Odoo mode', () => {
	it('tracks the active tab without creating a visible Chrome tab group', async () => {
		const sendMessage = vi.fn(async (message: { action: string }) => {
			if (message.action === 'get_active_tab') {
				return { success: true, tab: { id: 7, windowId: 2 } }
			}
			if (message.action === 'get_tab_info') {
				return {
					id: 7,
					windowId: 2,
					url: 'https://client.odoo.com/odoo/sales',
					title: 'Sales',
					status: 'complete',
				}
			}
			throw new Error(`Unexpected action: ${message.action}`)
		})
		vi.stubGlobal('chrome', {
			windows: { getCurrent: async () => ({ id: 2 }) },
			runtime: { sendMessage },
			storage: { local: { set: async () => {} } },
		})

		const controller = new TabsController()
		await controller.init('What is this?', { groupInitialTab: false })

		expect(controller.currentTabId).toBe(7)
		expect(sendMessage.mock.calls.map(([message]) => message.action)).not.toContain(
			'create_tab_group'
		)
	})
})

describe('TabsController.waitUntilTabLoaded', () => {
	interface TabRow {
		id: number
		isInitial: boolean
		status?: 'loading' | 'unloaded' | 'complete'
	}

	// White-box helper: build a controller with a known tab list and a stubbed `syncTabs`
	// (the only chrome-backed dependency the wait touches), so tab-status transitions can be
	// driven deterministically without the background service worker.
	function makeController(
		tabs: TabRow[],
		onSync: () => void = () => {}
	): { controller: TabsController; syncCount: () => number } {
		const controller = new TabsController()
		;(controller as unknown as { tabs: TabRow[] }).tabs = tabs
		let syncs = 0
		;(controller as unknown as { syncTabs: () => Promise<void> }).syncTabs = async () => {
			syncs += 1
			onSync()
		}
		return { controller, syncCount: () => syncs }
	}

	it('throws for an unknown tab id', async () => {
		const { controller } = makeController([{ id: 1, isInitial: false, status: 'complete' }])
		await expect(controller.waitUntilTabLoaded(999)).rejects.toThrow('not found')
	})

	it('resolves once a loading tab transitions to complete during the wait', async () => {
		const tabs: TabRow[] = [{ id: 1, isInitial: false, status: 'loading' }]
		const { controller, syncCount } = makeController(tabs, () => {
			// The background reports the tab finished loading after a couple of polls.
			if (syncCount() >= 2) tabs[0].status = 'complete'
		})

		await expect(controller.waitUntilTabLoaded(1)).resolves.toBeUndefined()
		expect(syncCount()).toBeGreaterThanOrEqual(2)
	})

	it('throws when the tab ends up unloaded', async () => {
		const tabs: TabRow[] = [{ id: 1, isInitial: false, status: 'loading' }]
		const { controller } = makeController(tabs, () => {
			tabs[0].status = 'unloaded'
		})

		await expect(controller.waitUntilTabLoaded(1)).rejects.toThrow('unloaded')
	})

	it('rejects with an AbortError when aborted while the tab is still loading', async () => {
		// syncTabs never leaves the tab in `loading`, so only the signal can end the wait.
		const tabs: TabRow[] = [{ id: 1, isInitial: false, status: 'loading' }]
		const { controller } = makeController(tabs)
		const ac = new AbortController()

		const promise = controller.waitUntilTabLoaded(1, { signal: ac.signal })
		setTimeout(() => ac.abort(), 20)

		await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
	})

	it('rejects immediately without polling when the signal is already aborted', async () => {
		const tabs: TabRow[] = [{ id: 1, isInitial: false, status: 'loading' }]
		const { controller, syncCount } = makeController(tabs)
		const ac = new AbortController()
		ac.abort()

		await expect(controller.waitUntilTabLoaded(1, { signal: ac.signal })).rejects.toMatchObject({
			name: 'AbortError',
		})
		// The already-aborted signal must short-circuit before the wait polls (no syncTabs).
		expect(syncCount()).toBe(0)
	})
})
