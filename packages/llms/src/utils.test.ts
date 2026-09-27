import { describe, expect, it } from 'vitest'

import { modelPatch, normalizeModelName } from './utils'

describe('normalizeModelName', () => {
	it.each([
		['gpt-5.2', 'gpt-52'],
		['gpt_5_2', 'gpt52'],
		['GPT-52-2026-01-01', 'gpt-52-2026-01-01'],
		['openai/gpt-5.2-chat', 'gpt-52-chat'],
		['claude_sonnet4_5', 'claudesonnet45'],
	])('%s -> %s', (input, expected) => {
		expect(normalizeModelName(input)).toBe(expected)
	})
})

describe('modelPatch', () => {
	it('enables GPT-6 Luna function calling through Chat Completions', () => {
		const request = { model: 'gpt-6-luna', tools: [{ type: 'function' }], tool_choice: 'required' }
		modelPatch(request, 'https://api.openai.com/v1')
		expect(request).toEqual({
			model: 'gpt-6-luna',
			tools: [{ type: 'function' }],
			tool_choice: 'required',
			reasoning_effort: 'none',
		})
	})
})
