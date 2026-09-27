/**
 * content script for RemotePageController
 */
import { PageController } from '@page-agent/page-controller'

import { readOdooContext } from '@/odoo/context'
import { GuideOverlay } from '@/voice/guide-overlay'
import {
	type GuideSnapshot,
	assertHighlightSelection,
	indexedControls,
} from '@/voice/guide-validation'

export function initPageController() {
	let pageController: PageController | null = null
	let intervalID: number | null = null
	const guideOverlay = new GuideOverlay()
	const guideController = new PageController({ enableMask: false, viewportExpansion: 400 })
	let guideSnapshot: GuideSnapshot | null = null

	const myTabIdPromise = chrome.runtime
		.sendMessage({ type: 'PAGE_CONTROL', action: 'get_my_tab_id' })
		.then((response) => {
			return (response as { tabId: number | null }).tabId
		})
		.catch((error) => {
			console.error('[RemotePageController.ContentScript]: Failed to get my tab id', error)
			return null
		})

	function getPC(): PageController {
		if (!pageController) {
			pageController = new PageController({
				enableMask: false,
				viewportExpansion: 400,
			})
		}
		return pageController
	}

	intervalID = window.setInterval(async () => {
		const agentHeartbeat = (await chrome.storage.local.get('agentHeartbeat')).agentHeartbeat
		const now = Date.now()
		const agentInTouch = typeof agentHeartbeat === 'number' && now - agentHeartbeat < 2_000

		const isAgentRunning = (await chrome.storage.local.get('isAgentRunning')).isAgentRunning
		const currentTabId = (await chrome.storage.local.get('currentTabId')).currentTabId

		const shouldShowMask = isAgentRunning && agentInTouch && currentTabId === (await myTabIdPromise)

		if (shouldShowMask) {
			const pc = getPC()
			pc.initMask()
			await pc.showMask()
		} else {
			// await getPC().hideMask()
			if (pageController) {
				pageController.hideMask()
				pageController.cleanUpHighlights()
			}
		}

		if (!isAgentRunning && agentInTouch) {
			if (pageController) {
				pageController.dispose()
				pageController = null
			}
		}
	}, 500)

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type !== 'PAGE_CONTROL') {
			// sendResponse({
			// 	success: false,
			// 	error: `[RemotePageController.ContentScript]: Invalid message type: ${message.type}`,
			// })
			return
		}

		const { action, payload } = message
		const methodName = getMethodName(action)

		switch (action) {
			case 'guide_clear':
				guideOverlay.clear()
				guideSnapshot = null
				sendResponse({ success: true })
				break
			case 'guide_inspect': {
				const startedUrl = window.location.href
				const context = readOdooContext(document, new URL(startedUrl))
				if (!context) {
					sendResponse({ success: false, error: 'The current tab is not an Odoo screen.' })
					break
				}
				void guideController
					.getBrowserState()
					.then((state) => {
						if (window.location.href !== startedUrl)
							throw new Error('Odoo navigated during inspection. Inspect again.')
						const id = crypto.randomUUID()
						const controls = state.content.slice(0, 22000)
						guideSnapshot = {
							id,
							url: window.location.href,
							createdAt: Date.now(),
							indices: indexedControls(controls),
						}
						guideOverlay.clear()
						sendResponse({
							success: true,
							snapshotId: id,
							context,
							title: state.title,
							controls,
							footer: state.footer,
						})
					})
					.catch((error: unknown) =>
						sendResponse({
							success: false,
							error: error instanceof Error ? error.message : String(error),
						})
					)
				break
			}
			case 'guide_highlight': {
				const request = payload?.[0] as
					{ snapshotId?: string; index?: number; label?: string; instruction?: string } | undefined
				try {
					const index = assertHighlightSelection(
						guideSnapshot,
						request,
						window.location.href,
						Date.now()
					)
					if (typeof request?.label !== 'string' || typeof request.instruction !== 'string')
						throw new Error('Invalid highlight request')
					const element = guideController.getIndexedElement(index)
					const rect = element.getBoundingClientRect()
					if (
						rect.width < 1 ||
						rect.height < 1 ||
						getComputedStyle(element).visibility === 'hidden'
					)
						throw new Error('The selected control is not visible')
					const label = request.label.trim().slice(0, 100)
					const instruction = request.instruction.trim().slice(0, 220)
					if (!label || !instruction) throw new Error('Highlight needs a label and instruction')
					guideOverlay.show(
						{ key: `${guideSnapshot!.id}:${index}`, label, instruction },
						element,
						() => {
							guideSnapshot = null
							void chrome.runtime
								.sendMessage({ type: 'PODOO_GUIDE_TARGET_USED' })
								.catch(() => undefined)
						}
					)
					sendResponse({ success: true, label, instruction })
				} catch (error) {
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				}
				break
			}
			case 'get_odoo_context':
				sendResponse(readOdooContext(document, new URL(window.location.href)))
				break
			case 'get_last_update_time':
			case 'get_browser_state':
			case 'update_tree':
			case 'clean_up_highlights':
			case 'click_element':
			case 'input_text':
			case 'select_option':
			case 'scroll':
			case 'scroll_horizontally':
			case 'execute_javascript': {
				const pc = getPC() as any
				pc[methodName](...(payload || []))
					.then((result: any) => sendResponse(result))
					.catch((error: any) =>
						sendResponse({
							success: false,
							error: error instanceof Error ? error.message : String(error),
						})
					)
				break
			}

			default:
				sendResponse({
					success: false,
					error: `Unknown PAGE_CONTROL action: ${action}`,
				})
		}

		return true
	})
}

function getMethodName(action: string): string {
	switch (action) {
		case 'get_last_update_time':
			return 'getLastUpdateTime' as const
		case 'get_browser_state':
			return 'getBrowserState' as const
		case 'update_tree':
			return 'updateTree' as const
		case 'clean_up_highlights':
			return 'cleanUpHighlights' as const

		// DOM actions

		case 'click_element':
			return 'clickElement' as const
		case 'input_text':
			return 'inputText' as const
		case 'select_option':
			return 'selectOption' as const
		case 'scroll':
			return 'scroll' as const
		case 'scroll_horizontally':
			return 'scrollHorizontally' as const
		case 'execute_javascript':
			return 'executeJavascript' as const

		default:
			return action
	}
}
