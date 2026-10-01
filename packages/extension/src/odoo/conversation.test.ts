import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	clearConversation,
	conversationStorageKey,
	loadConversation,
	normalizeConversation,
	saveConversation,
	toConversationMessages,
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
		const messages = toConversationMessages(normalizeConversation([...turns, { text: 'invalid' }]))
		expect(messages).toHaveLength(12)
		expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'Message 19' })
		expect(messages.some((message) => message.content === 'Message 0')).toBe(false)
	})

	it('preserves Alpina from the earlier request as a user turn', () => {
		const messages = toConversationMessages([
			{
				id: '1',
				role: 'user',
				text: 'Haz una cotización nueva dirigida a Alpina y déjala en borrador',
				mode: 'guide',
				createdAt: 1,
			},
			{
				id: '2',
				role: 'assistant',
				text: '¿Qué producto y cantidad?',
				mode: 'guide',
				createdAt: 2,
			},
		])
		expect(messages).toEqual([
			{ role: 'user', content: 'Haz una cotización nueva dirigida a Alpina y déjala en borrador' },
			{ role: 'assistant', content: '¿Qué producto y cantidad?' },
		])
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
