import { afterEach, describe, expect, it, vi } from 'vitest'

import { type OdooPageContext } from '@/odoo/context'

import { MultiPageAgent } from './MultiPageAgent'
import { RemotePageController } from './RemotePageController'
import { TabsController } from './TabsController'

const screen: OdooPageContext = {
	origin: 'https://client.odoo.com',
	path: '/odoo/sales',
	app: 'Ventas',
	view: 'list',
	breadcrumbs: ['Cotizaciones'],
	recordTitle: null,
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('MultiPageAgent conversation continuity', () => {
	it('connects prior Odoo turns to the next task without mixing origins', async () => {
		vi.stubGlobal('navigator', { language: 'es-CO' })
		vi.stubGlobal('chrome', {
			storage: { local: { get: async () => ({}), set: async () => {} } },
		})
		vi.spyOn(TabsController.prototype, 'init').mockImplementation(async function (
			this: TabsController
		) {
			this.currentTabId = 7
		})
		vi.spyOn(TabsController.prototype, 'waitUntilTabLoaded').mockResolvedValue()
		vi.spyOn(RemotePageController.prototype, 'getOdooContext').mockResolvedValue(screen)

		const agent = new MultiPageAgent({
			baseURL: 'https://llm.test',
			model: 'test',
			odooMode: 'guide',
		})
		const setMessages = vi.spyOn(agent, 'setConversationMessages')
		agent.task = 'Cofia JB Azul, 150 a 5698 pesos'
		agent.setConversationContext(screen.origin, [
			{
				id: '1',
				role: 'user',
				text: 'Haz una cotización nueva dirigida a Alpina y déjala en borrador',
				mode: 'guide',
				createdAt: 1,
			},
			{
				id: '2',
				role: 'assistant',
				text: '¿Qué producto y cantidad?',
				mode: 'guide',
				createdAt: 2,
			},
		])

		await agent.config.onBeforeTask?.(agent)
		expect(setMessages).toHaveBeenCalledWith([
			{ role: 'user', content: 'Haz una cotización nueva dirigida a Alpina y déjala en borrador' },
			{ role: 'assistant', content: '¿Qué producto y cantidad?' },
		])

		setMessages.mockClear()
		agent.setConversationContext('https://other.odoo.com', [
			{
				id: '3',
				role: 'user',
				text: 'Secret from another instance',
				mode: 'guide',
				createdAt: 3,
			},
		])
		await agent.config.onBeforeTask?.(agent)
		expect(setMessages).not.toHaveBeenCalled()
	})
})
