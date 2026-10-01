import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'

import { companyRulesStorageKey, formatOdooContext, readOdooContext } from './context'

describe('Odoo screen context', () => {
	it('extracts the active view and client scope from an Odoo screen', () => {
		const window = new Window()
		window.document.body.innerHTML = `
			<div class="o_web_client">
				<nav class="o_main_navbar"><span class="o_menu_brand">Sales</span></nav>
				<div class="o_control_panel_breadcrumbs"><span class="breadcrumb-item">Quotations</span></div>
				<div class="o_form_view"><div class="o_form_sheet"><h1>SO0042</h1></div></div>
			</div>`
		const context = readOdooContext(
			window.document as unknown as Document,
			new URL('https://client.example/odoo/action-12')
		)

		expect(context).toEqual({
			origin: 'https://client.example',
			path: '/odoo/action-12',
			app: 'Sales',
			view: 'form',
			breadcrumbs: ['Quotations'],
			recordTitle: 'SO0042',
		})
		expect(formatOdooContext(context!, 'Check payment terms first')).toContain(
			'Check payment terms first'
		)
		expect(companyRulesStorageKey(context!.origin)).toBe(
			'podoo:company-rules:https://client.example'
		)
	})

	it('rejects unrelated pages even if they contain similar labels', () => {
		const window = new Window()
		window.document.body.innerHTML = '<h1>Sales</h1><div class="o_form_view"></div>'
		expect(
			readOdooContext(window.document as unknown as Document, new URL('https://elsewhere.example'))
		).toBeNull()
	})
})
