import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	clearConversation,
	conversationStorageKey,
	formatConversationMemory,
	loadConversation,
	normalizeConversation,
	saveConversation,
} from './conversation'

afterEach(() => vi.unstubAllGlobals())

describe('Odoo conversation memory', () => {
	it('keeps conversations separate by Odoo origin', () => {
		expect(conversationStorageKey('https://one.odoo.com')).not.toBe(
			conversationStorageKey('https://two.odoo.com')
		)
	})

	it('accepts only valid turns and limits history sent to the model', () => {
		const turns = Array.from({ length: 20 }, (_, index) => ({
			id: String(index),
			role: index % 2 === 0 ? 'user' : 'assistant',
			text: `Message ${index}`,
			mode: 'guide',
			createdAt: index,
		}))
		const memory = formatConversationMemory(normalizeConversation([...turns, { text: 'invalid' }]))
		expect(memory).toContain('Message 19')
		expect(memory).not.toContain('Message 0')
		expect(memory).toContain('Prior replies do not prove')
	})

	it('restores a chat after reopening while isolating each Odoo instance', async () => {
		const records = new Map<string, unknown>()
		vi.stubGlobal('chrome', {
			storage: {
				local: {
					get: async (key: string) => ({ [key]: records.get(key) }),
					set: async (values: Record<string, unknown>) => {
						for (const [key, value] of Object.entries(values)) records.set(key, value)
					},
					remove: async (key: string) => {
						records.delete(key)
					},
				},
			},
		})
		const turn = {
			id: 'one',
			role: 'user' as const,
			text: '¿Qué significa esta cotización?',
			mode: 'explain' as const,
			createdAt: 1,
		}
		await saveConversation('https://one.odoo.com', [turn])
		expect(await loadConversation('https://one.odoo.com')).toEqual([turn])
		expect(await loadConversation('https://two.odoo.com')).toEqual([])
		await clearConversation('https://one.odoo.com')
		expect(await loadConversation('https://one.odoo.com')).toEqual([])
	})
})
