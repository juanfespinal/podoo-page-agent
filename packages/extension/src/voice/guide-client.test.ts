import { afterEach, describe, expect, it, vi } from 'vitest'

import { activeOdooTabId, inspectOdooScreen } from './guide-client'

afterEach(() => vi.unstubAllGlobals())

describe('voice screen selection', () => {
	it('finds the Odoo tab when another tab or window is currently focused', async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce([{ id: 4, url: 'chrome://extensions/' }])
			.mockResolvedValueOnce([
				{ id: 4, url: 'chrome://extensions/' },
				{ id: 7, url: 'https://test-brillaaseo.odoo.com/odoo/sales/new' },
			])
		vi.stubGlobal('chrome', { tabs: { query } })

		expect(await activeOdooTabId('https://test-brillaaseo.odoo.com')).toBe(7)
	})

	it('inspects the Odoo form behind an extension tab and retains the actual failure code', async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce([{ id: 4, url: 'chrome://extensions/' }])
			.mockResolvedValueOnce([
				{ id: 7, url: 'https://test-brillaaseo.odoo.com/odoo/sales' },
				{ id: 8, url: 'https://test-brillaaseo.odoo.com/odoo/sales/new' },
			])
		const sendMessage = vi.fn().mockResolvedValueOnce({
			success: true,
			snapshotId: 'quote-form',
			controls: '[2] <button>Guardar</button>',
		})
		vi.stubGlobal('chrome', { tabs: { query }, runtime: { sendMessage } })

		expect(
			await inspectOdooScreen('https://test-brillaaseo.odoo.com', '/odoo/sales/new')
		).toMatchObject({
			tabId: 8,
			screen: { success: true, snapshotId: 'quote-form' },
		})
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'guide_inspect', targetTabId: 8 })
		)

		query.mockReset()
		query.mockResolvedValueOnce([{ id: 8, url: 'https://test-brillaaseo.odoo.com/odoo/sales/new' }])
		sendMessage.mockResolvedValueOnce({
			success: false,
			code: 'CONTENT_SCRIPT_MISSING',
			error: 'Receiving end does not exist',
		})
		expect((await inspectOdooScreen('https://test-brillaaseo.odoo.com')).screen).toMatchObject({
			success: false,
			code: 'CONTENT_SCRIPT_MISSING',
		})
	})
})
