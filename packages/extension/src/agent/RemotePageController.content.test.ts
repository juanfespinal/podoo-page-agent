// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initPageController } from './RemotePageController.content'

const { indexed, click, input } = vi.hoisted(() => ({
	indexed: new Map<number, HTMLElement>(),
	click: vi.fn(async (element: HTMLElement) => element.click()),
	input: vi.fn(async (element: HTMLInputElement, text: string) => {
		element.value = text
		element.dispatchEvent(new Event('input', { bubbles: true }))
	}),
}))

vi.mock('@page-agent/page-controller', () => ({
	PageController: class {
		async getBrowserState() {
			return {
				content: '[1]<button>Nuevo</button>\n[2]<input>Cantidad</input>',
				title: 'Odoo',
				footer: '',
			}
		}
		getIndexedElement(index: number) {
			const element = indexed.get(index)
			if (!element?.isConnected) throw new Error('Element is no longer on screen')
			return element
		}
	},
	clickDomElement: click,
	inputDomText: input,
}))

type MessageHandler = (
	message: unknown,
	sender: unknown,
	respond: (result: Record<string, unknown>) => void
) => unknown

describe('live voice page-control bridge', () => {
	let handler: MessageHandler
	const message = (action: string, request?: Record<string, unknown>) =>
		new Promise<Record<string, unknown>>((resolve) => {
			handler(
				{ type: 'PAGE_CONTROL', action, payload: request ? [request] : undefined },
				{},
				resolve
			)
		})

	beforeEach(() => {
		vi.useFakeTimers()
		click.mockClear()
		input.mockClear()
		window.history.replaceState({}, '', '/odoo/sales')
		document.body.innerHTML = `
			<div class="o_web_client">
				<div class="o_menu_brand">Ventas</div>
				<div class="o_form_view">
					<button>Nuevo</button>
					<div class="o_field_widget" name="quantity"><input aria-label="Cantidad"></div>
				</div>
			</div>`
		indexed.clear()
		indexed.set(1, document.querySelector('button')!)
		indexed.set(2, document.querySelector('.o_field_widget')!)
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 100,
			bottom: 30,
			width: 100,
			height: 30,
			toJSON: () => ({}),
		})
		vi.stubGlobal('chrome', {
			runtime: {
				sendMessage: vi.fn(async () => ({ tabId: 1 })),
				onMessage: {
					addListener: (listener: MessageHandler) => {
						handler = listener
					},
				},
			},
			storage: { local: { get: vi.fn(async () => ({})) } },
		})
		initPageController()
	})

	afterEach(() => {
		vi.clearAllTimers()
		vi.useRealTimers()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it('clicks once, then requires a fresh snapshot for another action', async () => {
		const screen = await message('guide_inspect')
		const request = { snapshotId: screen.snapshotId, index: 1, action: 'click' }
		expect(await message('guide_act', request)).toMatchObject({ success: true, acted: true })
		expect(click).toHaveBeenCalledExactlyOnceWith(indexed.get(1))
		expect(await message('guide_act', request)).toMatchObject({
			success: false,
			code: 'STALE_SNAPSHOT',
		})
		expect(click).toHaveBeenCalledTimes(1)
	})

	it('writes into the real input inside an indexed Odoo widget', async () => {
		const screen = await message('guide_inspect')
		const field = document.querySelector('input')!
		expect(
			await message('guide_act', {
				snapshotId: screen.snapshotId,
				index: 2,
				action: 'input',
				text: '548',
			})
		).toMatchObject({ success: true, acted: true })
		expect(input).toHaveBeenCalledExactlyOnceWith(field, '548')
		expect(field.value).toBe('548')
	})

	it.each(['navigation', 'rerender', 'repurposed control', 'view change'])(
		'rejects a stale %s before clicking',
		async (change) => {
			const screen = await message('guide_inspect')
			const button = indexed.get(1)!
			if (change === 'navigation') window.history.pushState({}, '', '/odoo/employees')
			if (change === 'rerender') button.replaceWith(document.createElement('button'))
			if (change === 'repurposed control') button.textContent = 'Eliminar'
			if (change === 'view change')
				document.querySelector('.o_menu_brand')!.textContent = 'Contabilidad'
			expect(
				await message('guide_act', {
					snapshotId: screen.snapshotId,
					index: 1,
					action: 'click',
				})
			).toMatchObject({ success: false, code: 'STALE_SNAPSHOT' })
			expect(click).not.toHaveBeenCalled()
		}
	)

	it('opens analytic distribution through its real widget control', async () => {
		document.querySelector('.o_form_view')!.insertAdjacentHTML(
			'beforeend',
			`
			<div class="o_field_widget o_field_analytic_distribution" name="analytic_distribution" aria-label="Distribución analítica">
				<div class="analytic_distribution_placeholder">100 %</div>
			</div>`
		)
		const screen = await message('guide_inspect')
		const fields = screen.fields as { index: number; label: string }[]
		const field = fields.find((item) => item.label === 'Distribución analítica')!
		expect(
			await message('guide_act', {
				snapshotId: screen.snapshotId,
				index: field.index,
				action: 'click',
			})
		).toMatchObject({ success: true, acted: true })
		expect(click).toHaveBeenCalledExactlyOnceWith(
			document.querySelector('.analytic_distribution_placeholder')
		)
	})

	it('does not treat an informational column heading as an action', async () => {
		document
			.querySelector('.o_form_view')!
			.insertAdjacentHTML(
				'beforeend',
				'<table><thead><tr><th data-name="analytic_distribution">Distribución analítica</th></tr></thead></table>'
			)
		const screen = await message('guide_inspect')
		const field = (screen.fields as { index: number; kind: string }[]).find(
			(item) => item.kind === 'column'
		)!
		expect(
			await message('guide_act', {
				snapshotId: screen.snapshotId,
				index: field.index,
				action: 'click',
			})
		).toMatchObject({ success: false, code: 'INVALID_TARGET' })
		expect(click).not.toHaveBeenCalled()
	})

	it('leaves a consequential button for the person to click', async () => {
		indexed.get(1)!.setAttribute('name', 'action_confirm')
		const screen = await message('guide_inspect')
		expect(
			await message('guide_act', {
				snapshotId: screen.snapshotId,
				index: 1,
				action: 'click',
			})
		).toMatchObject({ success: false, code: 'REQUIRES_CONFIRMATION' })
		expect(click).not.toHaveBeenCalled()
	})
})
