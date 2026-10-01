// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { collectOdooFieldTargets } from './odoo-field-targets'

describe('Odoo custom field guide targets', () => {
	afterEach(() => {
		document.body.innerHTML = ''
		vi.restoreAllMocks()
	})

	function showElements() {
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			width: 120,
			height: 30,
			top: 10,
			left: 10,
			right: 130,
			bottom: 40,
		} as DOMRect)
	}

	it('offers an Odoo widget absent from Page Agent’s indexed controls', () => {
		showElements()
		document.body.innerHTML =
			'<div class="o_form_view"><div class="o_wrap_field"><label for="distribution">Distribución analítica</label><div id="distribution" name="analytic_distribution" class="o_field_widget o_field_analytic_distribution"><div class="o_analytic_distribution"></div></div></div></div>'
		const targets = collectOdooFieldTargets(document, 50, [])
		expect(targets).toEqual([
			expect.objectContaining({ index: 50, label: 'Distribución analítica', kind: 'field' }),
		])
		expect(targets[0].element.getAttribute('name')).toBe('analytic_distribution')
	})

	it('can point to an analytic distribution column before any line exists', () => {
		showElements()
		document.body.innerHTML =
			'<div class="o_list_view"><table><thead><tr><th data-name="analytic_distribution">Distribución analítica</th></tr></thead></table></div>'
		const targets = collectOdooFieldTargets(document, 70, [])
		expect(targets).toEqual([
			expect.objectContaining({ index: 70, label: 'Distribución analítica', kind: 'column' }),
		])
	})

	it('recognizes the analytic widget class even when Odoo omits its name attribute', () => {
		showElements()
		document.body.innerHTML =
			'<div class="o_form_view"><table><thead><tr><th data-name="analytic_distribution">Distribución analítica</th></tr></thead><tbody><tr><td><div class="o_field_analytic_distribution"></div></td></tr></tbody></table></div>'
		const targets = collectOdooFieldTargets(document, 90, [])
		expect(targets[0]).toEqual(
			expect.objectContaining({ index: 90, label: 'Distribución analítica', kind: 'field' })
		)
	})

	it('recognizes the Odoo analytic distribution template without a field name', () => {
		showElements()
		document.body.innerHTML =
			'<div class="o_form_view"><table><thead><tr><th data-name="analytic_distribution">Distribución analítica</th></tr></thead><tbody><tr><td><div class="o_field_tags o_tags_input"><div class="o_input_dropdown"><span class="analytic_distribution_placeholder"></span></div></div></td></tr></tbody></table></div>'
		const targets = collectOdooFieldTargets(document, 90, [])
		expect(targets[0]).toEqual(
			expect.objectContaining({ index: 90, label: 'Distribución analítica', kind: 'field' })
		)
	})

	it('does not duplicate a widget already represented by an indexed input', () => {
		showElements()
		document.body.innerHTML =
			'<div class="o_form_view"><div class="o_wrap_field"><label for="city">Ciudad</label><div class="o_field_widget" name="city"><input id="city"></div></div></div>'
		const input = document.querySelector('input') as HTMLElement
		expect(collectOdooFieldTargets(document, 10, [input])).toEqual([])
	})
})
