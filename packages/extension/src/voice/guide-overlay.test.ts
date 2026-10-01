// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GuideOverlay } from './guide-overlay'

describe('guide overlay follows the human', () => {
	afterEach(() => {
		vi.useRealTimers()
		document.body.innerHTML = ''
		for (const node of document.querySelectorAll('[data-podoo-guide]')) node.remove()
		vi.restoreAllMocks()
	})

	it('notifies immediately when the person uses another Odoo control', () => {
		document.body.innerHTML =
			'<div class="o_web_client"><button id="target">Configuración</button><button id="other">Ventas</button></div>'
		vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			top: 10,
			left: 10,
			right: 110,
			bottom: 40,
			width: 100,
			height: 30,
		} as DOMRect)
		const used = vi.fn()
		const overlay = new GuideOverlay()
		overlay.show(
			{ key: 'one', label: 'Configuración', instruction: 'Abre el menú' },
			document.querySelector<HTMLElement>('#target')!,
			used
		)
		document.querySelector<HTMLElement>('#other')!.click()
		expect(used).toHaveBeenCalledOnce()
		expect(document.querySelector('[data-podoo-guide]')).toBeNull()
	})

	it('interrupts speech on input focus and advances after the value changes', () => {
		document.body.innerHTML = '<div class="o_web_client"><input id="quantity"></div>'
		vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			top: 10,
			left: 10,
			right: 110,
			bottom: 40,
			width: 100,
			height: 30,
		} as DOMRect)
		const engaged = vi.fn()
		const used = vi.fn()
		const input = document.querySelector<HTMLInputElement>('#quantity')!
		const overlay = new GuideOverlay()
		overlay.show(
			{ key: 'quantity', label: 'Cantidad', instruction: 'Escribe la cantidad' },
			input,
			used,
			engaged
		)
		input.click()
		expect(engaged).toHaveBeenCalledOnce()
		expect(used).not.toHaveBeenCalled()
		input.dispatchEvent(new Event('change', { bubbles: true }))
		expect(used).toHaveBeenCalledOnce()
	})

	it('reassesses when Odoo replaces the highlighted control during navigation', () => {
		vi.useFakeTimers()
		document.body.innerHTML = '<div class="o_web_client"><button id="target">Nuevo</button></div>'
		vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			top: 10,
			left: 10,
			right: 110,
			bottom: 40,
			width: 100,
			height: 30,
		} as DOMRect)
		const used = vi.fn()
		const target = document.querySelector<HTMLElement>('#target')!
		const overlay = new GuideOverlay()
		overlay.show({ key: 'new', label: 'Nuevo', instruction: 'Abre el formulario' }, target, used)
		target.remove()
		vi.advanceTimersByTime(151)
		expect(used).toHaveBeenCalledOnce()
	})
})
