// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { assertVoiceActionTarget } from './voice-action'

describe('voice actions on Odoo controls', () => {
	it('allows a routine click and text entry on visible editable controls', () => {
		document.body.innerHTML =
			'<div class="o_web_client"><button>Nuevo</button><input aria-label="Cantidad"></div>'
		const button = document.querySelector('button')!
		const input = document.querySelector('input')!
		expect(assertVoiceActionTarget(button, 'click')).toBe(button)
		expect(assertVoiceActionTarget(input, 'input', '548')).toBe(input)
	})

	it('blocks consequential clicks and text entry into noneditable or detached elements', () => {
		document.body.innerHTML =
			'<div class="o_web_client"><button name="action_confirm">Ok</button><input readonly><input type="checkbox"></div>'
		expect(() => assertVoiceActionTarget(document.querySelector('button')!, 'click')).toThrow(
			'REQUIRES_CONFIRMATION'
		)
		expect(() => assertVoiceActionTarget(document.querySelector('input')!, 'input', '548')).toThrow(
			'not editable'
		)
		expect(() =>
			assertVoiceActionTarget(document.querySelector('input[type="checkbox"]')!, 'input', '548')
		).toThrow('not editable')
		const removed = document.querySelector('input')!
		removed.remove()
		expect(() => assertVoiceActionTarget(removed, 'input', '548')).toThrow('no longer')
	})
})
