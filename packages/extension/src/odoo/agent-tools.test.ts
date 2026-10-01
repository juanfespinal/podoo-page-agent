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

function mockAgent(content = '[7] button Guardar') {
	const pageController = {
		getOdooContext: vi.fn(async () => screen),
		getBrowserState: vi.fn(async () => ({ content })),
		clickElement: vi.fn(async () => ({ message: 'clicked' })),
		inputText: vi.fn(async () => ({ message: 'typed' })),
		selectOption: vi.fn(async () => ({ message: 'selected' })),
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

	it.each([
		'[7] button Catálogo',
		'[7] <button type=object name=action_add_from_catalog>Catálogo />',
		'[7] button Guardar',
		'[7] button Nueva cotización',
	])('clicks routine controls without asking: %s', async (content) => {
		const { agent, pageController } = mockAgent(content)
		const approval = vi.fn(async () => false)
		const click = createOdooToolOverrides('assist', approval).click_element_by_index!
		await click.execute.call(agent, { index: 7 }, { signal: new AbortController().signal })
		expect(approval).not.toHaveBeenCalled()
		expect(pageController.clickElement).toHaveBeenCalledWith(7)
	})

	it('edits fields and selects options without asking', async () => {
		const { agent, pageController } = mockAgent('[7] input Cantidad')
		const approval = vi.fn(async () => false)
		const tools = createOdooToolOverrides('assist', approval)
		await tools.input_text!.execute.call(
			agent,
			{ index: 7, text: '548' },
			{ signal: new AbortController().signal }
		)
		await tools.select_dropdown_option!.execute.call(
			agent,
			{ index: 7, text: 'Alpina' },
			{ signal: new AbortController().signal }
		)
		expect(approval).not.toHaveBeenCalled()
		expect(pageController.inputText).toHaveBeenCalledWith(7, '548')
		expect(pageController.selectOption).toHaveBeenCalledWith(7, 'Alpina')
	})

	it('never clicks a consequential control when approval is declined', async () => {
		const { agent, pageController } = mockAgent('[7] button Confirmar')
		const approval = vi.fn(async () => false)
		const click = createOdooToolOverrides('assist', approval).click_element_by_index!
		await expect(
			click.execute.call(agent, { index: 7 }, { signal: new AbortController().signal })
		).rejects.toThrow('rechazó')
		expect(approval).toHaveBeenCalledWith(
			'Hacer clic en\n[7] button Confirmar',
			expect.any(AbortSignal)
		)
		expect(pageController.clickElement).not.toHaveBeenCalled()
	})

	it('recognizes a consequential Odoo action name even when the visible label is generic', async () => {
		const { agent, pageController } = mockAgent('[7] <button name=action_confirm>Ok />')
		const approval = vi.fn(async () => false)
		const click = createOdooToolOverrides('assist', approval).click_element_by_index!
		await expect(
			click.execute.call(agent, { index: 7 }, { signal: new AbortController().signal })
		).rejects.toThrow('rechazó')
		expect(approval).toHaveBeenCalledOnce()
		expect(pageController.clickElement).not.toHaveBeenCalled()
	})

	it('rejects an approved consequential click if the screen changes while waiting', async () => {
		const { agent, pageController } = mockAgent('[7] button Confirmar')
		pageController.getOdooContext
			.mockResolvedValueOnce(screen)
			.mockResolvedValueOnce({ ...screen, path: '/odoo/another-record' })
		const click = createOdooToolOverrides('assist', async () => true).click_element_by_index!
		await expect(
			click.execute.call(agent, { index: 7 }, { signal: new AbortController().signal })
		).rejects.toThrow('pantalla de Odoo cambió')
		expect(pageController.clickElement).not.toHaveBeenCalled()
	})

	it('rejects a routine click if its indexed target changes', async () => {
		const { agent, pageController } = mockAgent()
		pageController.getBrowserState
			.mockResolvedValueOnce({ content: '[7] button Guardar' })
			.mockResolvedValueOnce({ content: '[7] button Delete' })
		const click = createOdooToolOverrides('assist').click_element_by_index!
		await expect(
			click.execute.call(agent, { index: 7 }, { signal: new AbortController().signal })
		).rejects.toThrow('página de Odoo cambió')
		expect(pageController.clickElement).not.toHaveBeenCalled()
	})
})
