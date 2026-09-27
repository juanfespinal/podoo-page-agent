import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveAnalyticGuideStep } from './analytic-guide'

const url = new URL('https://client.example/odoo/action-analytic')

function screen(html: string): Document {
	const window = new Window()
	window.document.body.innerHTML = `<div class="o_web_client">${html}</div>`
	vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window))
	vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
		new window.DOMRect(20, 20, 120, 32)
	)
	return window.document as unknown as Document
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('analytic account screen guide', () => {
	it('points to a verified control and advances with the live Odoo screen', () => {
		let doc = screen(`
			<nav class="o_main_navbar"><span class="o_menu_brand">Ventas</span></nav>
			<button>Contabilidad</button>`)
		let match = resolveAnalyticGuideStep(doc, url)
		expect(match.step.key).toBe('accounting')
		expect(match.target?.textContent).toBe('Contabilidad')

		doc = screen(`
			<nav class="o_main_navbar"><span class="o_menu_brand">Contabilidad</span></nav>
			<button>Configuración</button>`)
		match = resolveAnalyticGuideStep(doc, url)
		expect(match.step.key).toBe('settings')
		expect(match.target?.textContent).toBe('Configuración')

		doc.body.insertAdjacentHTML('beforeend', '<a>Cuentas analíticas</a>')
		match = resolveAnalyticGuideStep(doc, url)
		expect(match.step.key).toBe('accounts')
		expect(match.target?.textContent).toBe('Cuentas analíticas')

		doc = screen(`
			<nav class="o_main_navbar"><span class="o_menu_brand">Contabilidad</span></nav>
			<div class="o_control_panel_breadcrumbs"><span class="breadcrumb-item">Cuentas analíticas</span></div>
			<button class="o_list_button_add">Nuevo</button><div class="o_list_view"></div>`)
		match = resolveAnalyticGuideStep(doc, url)
		expect(match.step.key).toBe('new')
		expect(match.target?.textContent).toBe('Nuevo')
	})

	it('points to each visible form field and stops short of claiming a save succeeded', () => {
		const doc = screen(`
			<nav class="o_main_navbar"><span class="o_menu_brand">Contabilidad</span></nav>
			<div class="o_control_panel_breadcrumbs"><span class="breadcrumb-item">Cuentas analíticas</span></div>
			<div class="o_form_view"><div class="o_form_sheet">
				<div class="o_field_widget" name="name"><input id="name"></div>
				<div class="o_field_widget" name="plan_id"><input id="plan"></div>
			</div></div>
			<button class="o_form_button_save">Guardar</button>`)
		expect(resolveAnalyticGuideStep(doc, url).step.key).toBe('name')
		const name = doc.querySelector<HTMLInputElement>('#name')!
		name.value = 'Proyectos de software'
		expect(resolveAnalyticGuideStep(doc, url).step.state).toBe('blocked')
		expect(resolveAnalyticGuideStep(doc, url, { newFormObserved: true }).step.key).toBe('plan')
		const plan = doc.querySelector<HTMLInputElement>('#plan')!
		plan.value = 'Plan de proyectos'
		expect(resolveAnalyticGuideStep(doc, url, { newFormObserved: true }).step.key).toBe('save')
		const afterClick = resolveAnalyticGuideStep(doc, url, {
			newFormObserved: true,
			saveWasClicked: true,
		})
		expect(afterClick.step.state).toBe('verify')
		expect(afterClick.target).toBeNull()
	})

	it('refuses to point at an unseen or missing control', () => {
		const doc = screen(`
			<nav class="o_main_navbar"><span class="o_menu_brand">Contabilidad</span></nav>
			<button style="display:none">Configuración</button>`)
		const match = resolveAnalyticGuideStep(doc, url)
		expect(match.step.state).toBe('blocked')
		expect(match.target).toBeNull()
	})

	it('does not pick between duplicate controls with the same label', () => {
		const doc = screen(`
			<nav class="o_main_navbar"><span class="o_menu_brand">Contabilidad</span></nav>
			<button>Configuración</button><button>Configuración</button>`)
		const match = resolveAnalyticGuideStep(doc, url)
		expect(match.step.state).toBe('blocked')
		expect(match.target).toBeNull()
	})
})
