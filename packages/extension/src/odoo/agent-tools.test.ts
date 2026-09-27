import type { PageAgentCore } from '@page-agent/core'
import { describe, expect, it, vi } from 'vitest'

import { createOdooToolOverrides } from './agent-tools'
import type { OdooPageContext } from './context'

const screen: OdooPageContext = {
	origin: 'https://client.example',
	path: '/odoo/sales',
	app: 'Sales',
	view: 'list',
	breadcrumbs: ['Quotations'],
	recordTitle: null,
}

function mockAgent(content = '[7] button Save') {
	const pageController = {
		getOdooContext: vi.fn(async () => screen),
		getBrowserState: vi.fn(async () => ({ content })),
		clickElement: vi.fn(async () => ({ message: 'clicked' })),
	}
	return { agent: { pageController } as unknown as PageAgentCore, pageController }
}

describe('Odoo tool permissions', () => {
	it('removes all page mutations in Explain and Guide', () => {
		for (const mode of ['explain', 'guide'] as const) {
			const tools = createOdooToolOverrides(mode)
			for (const name of [
				'click_element_by_index',
				'input_text',
				'select_dropdown_option',
				'scroll',
				'open_new_tab',
			]) {
				expect(tools[name]).toBeNull()
			}
		}
	})

	it('never clicks when approval is declined', async () => {
		const { agent, pageController } = mockAgent()
		const approval = vi.fn(async () => false)
		const click = createOdooToolOverrides('assist', approval).click_element_by_index!
		await expect(
			click.execute.call(agent, { index: 7 }, { signal: new AbortController().signal })
		).rejects.toThrow('rechazó')
		expect(approval).toHaveBeenCalledWith('Hacer clic en\n[7] button Save', expect.any(AbortSignal))
		expect(pageController.clickElement).not.toHaveBeenCalled()
	})

	it('rejects an approved click if the screen changes while waiting', async () => {
		const { agent, pageController } = mockAgent()
		pageController.getOdooContext
			.mockResolvedValueOnce(screen)
			.mockResolvedValueOnce({ ...screen, path: '/odoo/another-record' })
		const click = createOdooToolOverrides('assist', async () => true).click_element_by_index!
		await expect(
			click.execute.call(agent, { index: 7 }, { signal: new AbortController().signal })
		).rejects.toThrow('pantalla de Odoo cambió')
		expect(pageController.clickElement).not.toHaveBeenCalled()
	})

	it('rejects an approved click if its indexed target changes', async () => {
		const { agent, pageController } = mockAgent()
		pageController.getBrowserState
			.mockResolvedValueOnce({ content: '[7] button Save' })
			.mockResolvedValueOnce({ content: '[7] button Delete' })
		const click = createOdooToolOverrides('assist', async () => true).click_element_by_index!
		await expect(
			click.execute.call(agent, { index: 7 }, { signal: new AbortController().signal })
		).rejects.toThrow('página de Odoo cambió')
		expect(pageController.clickElement).not.toHaveBeenCalled()
	})
})
