import { afterEach, describe, expect, it, vi } from 'vitest'

import { RemotePageController } from './RemotePageController'
import { handlePageControlMessage } from './RemotePageController.background'
import type { TabsController } from './TabsController'

afterEach(() => vi.unstubAllGlobals())

describe('RemotePageController on an existing Odoo tab', () => {
	it('explains how to recover when the content script is absent', async () => {
		const noReceiver = new Error('Could not establish connection. Receiving end does not exist.')
		vi.stubGlobal('chrome', {
			tabs: { sendMessage: vi.fn().mockRejectedValue(noReceiver) },
			runtime: {
				sendMessage: (message: any) =>
					new Promise((resolve) =>
						handlePageControlMessage(message, {} as chrome.runtime.MessageSender, resolve)
					),
			},
		})
		const tabsController = {
			currentTabId: 7,
			getTabInfo: async () => ({ url: 'https://client.odoo.com/odoo/contacts' }),
		} as unknown as TabsController

		const controller = new RemotePageController(tabsController)
		await expect(controller.getOdooContext()).rejects.toThrow('Reload the Odoo tab')
		await expect(controller.getBrowserState()).rejects.toThrow('Reload the Odoo tab')
	})
})
