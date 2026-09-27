import { describe, expect, it, vi } from 'vitest'

import { hasMicrophonePermission, openMicrophonePermissionTab } from './microphone-permission'

describe('microphone permission handoff', () => {
	it('opens a full extension tab when the side panel cannot request permission', async () => {
		const getURL = vi.fn(() => 'chrome-extension://test/mic-permission.html')
		vi.stubGlobal('chrome', { runtime: { getURL } })
		const create = vi.fn(async () => ({ id: 2 }))

		await openMicrophonePermissionTab({ create } as unknown as typeof chrome.tabs)

		expect(create).toHaveBeenCalledWith({
			url: 'chrome-extension://test/mic-permission.html',
			active: true,
		})
		vi.unstubAllGlobals()
	})

	it('only skips the permission tab after the extension origin has access', async () => {
		const query = vi.fn(async () => ({ state: 'prompt' }))
		expect(await hasMicrophonePermission({ query } as unknown as Permissions)).toBe(false)
		query.mockResolvedValueOnce({ state: 'granted' })
		expect(await hasMicrophonePermission({ query } as unknown as Permissions)).toBe(true)
	})
})
