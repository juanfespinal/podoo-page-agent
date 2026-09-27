import { afterEach, describe, expect, it, vi } from 'vitest'

import { PageController } from './PageController'

describe('PageController', () => {
	afterEach(() => {
		document.body.innerHTML = ''
		vi.restoreAllMocks()
	})

	it('indexes controls without drawing numeric overlays when configured for voice guidance', async () => {
		document.body.innerHTML = '<button id="guide-target">Open</button><input aria-label="Name">'
		const rect = {
			x: 10,
			y: 10,
			top: 10,
			left: 10,
			bottom: 40,
			right: 110,
			width: 100,
			height: 30,
			toJSON: () => ({}),
		}
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
		vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
			rect,
		] as unknown as DOMRectList)
		vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
		vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30)
		const controller = new PageController({ viewportExpansion: -1, showIndexOverlays: false })
		const state = await controller.getBrowserState()
		expect(state.content).toMatch(/\[\d+\].*button/i)
		expect(state.content).toMatch(/\[\d+\].*input/i)
		expect(document.querySelector('.playwright-highlight-label')).toBeNull()
		const visibleState = await new PageController({ viewportExpansion: -1 }).getBrowserState()
		expect(state.content.replaceAll('*[', '[')).toBe(visibleState.content.replaceAll('*[', '['))
	})
	it('constructs and exposes the current url', async () => {
		const controller = new PageController()
		expect(controller).toBeInstanceOf(PageController)
		expect(await controller.getCurrentUrl()).toBe(window.location.href)
	})

	describe('executeJavascript', () => {
		it('runs a script and returns its result', async () => {
			const controller = new PageController()
			const result = await controller.executeJavascript('return 1 + 2')
			expect(result).toMatchObject({ success: true })
			expect(result.message).toContain('3')
		})

		it('exposes the abort signal to the script scope', async () => {
			const controller = new PageController()
			const controllerSignal = new AbortController()
			controllerSignal.abort()

			const result = await controller.executeJavascript(
				'return signal.aborted',
				controllerSignal.signal
			)
			expect(result).toMatchObject({ success: true })
			expect(result.message).toContain('true')
		})

		it('reports a syntax error as a failed result', async () => {
			const controller = new PageController()
			const result = await controller.executeJavascript('return (')
			expect(result.success).toBe(false)
			expect(result.message).toContain('❌')
		})
	})
})
