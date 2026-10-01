import { handlePageControlMessage } from '@/agent/RemotePageController.background'
import { handleTabControlMessage } from '@/agent/TabsController.background'
import { mintRealtimeToken } from '@/voice/realtime-token'

export default defineBackground(() => {
	console.log('[Background] Service Worker started')

	// message proxy

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (
			message.type === 'PODOO_GUIDE_TARGET_USED' ||
			message.type === 'PODOO_GUIDE_TARGET_ENGAGED'
		) {
			sendResponse({ ok: Boolean(sender.tab?.id) })
			return
		}
		if (message.type === 'PODOO_MIC_PERMISSION_GRANTED') {
			sendResponse({ ok: sender.url === chrome.runtime.getURL('mic-permission.html') })
			return
		}
		if (message.type === 'PODOO_REALTIME_TOKEN') {
			const sidepanelUrls = [
				chrome.runtime.getURL('sidepanel.html'),
				chrome.runtime.getURL('sidepanel/index.html'),
			]
			if (!sender.url || !sidepanelUrls.includes(sender.url)) {
				sendResponse({ error: 'Solo el panel de Podoo puede iniciar una sesión de voz.' })
				return
			}
			void chrome.storage.local
				.get('llmConfig')
				.then(async ({ llmConfig }) => {
					const token = await mintRealtimeToken(llmConfig ?? {})
					sendResponse({ token })
				})
				.catch((error: unknown) => {
					sendResponse({ error: error instanceof Error ? error.message : String(error) })
				})
			return true
		}
		if (message.type === 'TAB_CONTROL') {
			return handleTabControlMessage(message, sender, sendResponse)
		} else if (message.type === 'PAGE_CONTROL') {
			return handlePageControlMessage(message, sender, sendResponse)
		} else {
			sendResponse({ error: 'Unknown message type' })
			return
		}
	})

	// setup

	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})
