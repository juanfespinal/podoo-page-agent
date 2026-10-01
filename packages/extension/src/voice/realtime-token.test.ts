import { describe, expect, it, vi } from 'vitest'

import { mintRealtimeToken } from './realtime-token'

describe('Realtime voice credential', () => {
	it('mints a short-lived Realtime 2.1 mini credential using the configured OpenAI key', async () => {
		const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
			Response.json({ value: 'ephemeral-test-token' }, { status: 200 })
		)
		const token = await mintRealtimeToken(
			{ apiKey: 'private-api-key', baseURL: 'https://api.openai.com/v1/' },
			fetcher as typeof fetch
		)

		expect(token).toBe('ephemeral-test-token')
		expect(fetcher).toHaveBeenCalledWith(
			'https://api.openai.com/v1/realtime/client_secrets',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ Authorization: 'Bearer private-api-key' }),
			})
		)
		const requestBody = fetcher.mock.calls[0]?.[1]?.body
		expect(typeof requestBody).toBe('string')
		const body = JSON.parse(requestBody as string)
		expect(body.session).toMatchObject({ type: 'realtime', model: 'gpt-realtime-2.1-mini' })
	})

	it('rejects a non-OpenAI endpoint before using the key', async () => {
		const fetcher = vi.fn()
		await expect(
			mintRealtimeToken(
				{ apiKey: 'private-api-key', baseURL: 'https://other.example/v1' },
				fetcher as typeof fetch
			)
		).rejects.toThrow('requiere la URL')
		expect(fetcher).not.toHaveBeenCalled()
	})

	it('surfaces OpenAI errors without returning a credential', async () => {
		const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
			Response.json({ error: { message: 'Realtime access unavailable' } }, { status: 403 })
		)
		await expect(
			mintRealtimeToken(
				{ apiKey: 'private-api-key', baseURL: 'https://api.openai.com/v1' },
				fetcher as typeof fetch
			)
		).rejects.toThrow('Realtime access unavailable')
	})
})
