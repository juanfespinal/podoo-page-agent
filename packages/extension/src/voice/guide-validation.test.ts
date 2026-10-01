// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import {
	GuideSelectionError,
	assertHighlightSelection,
	guideTargetKey,
	indexedControls,
} from './guide-validation'

describe('live voice guide target validation', () => {
	const screen = {
		id: 'screen-1',
		url: 'https://odoo.example/odoo',
		createdAt: 1000,
		indices: indexedControls(
			'[2]<button>Contabilidad</button>\n  *[7]<button>Configuración</button>'
		),
	}

	it('only accepts controls included in the model-visible screen', () => {
		expect([...screen.indices]).toEqual([2, 7])
		expect(
			assertHighlightSelection(screen, { snapshotId: 'screen-1', index: 7 }, screen.url, 2000)
		).toBe(7)
		expect(() =>
			assertHighlightSelection(screen, { snapshotId: 'screen-1', index: 8 }, screen.url, 2000)
		).toThrow('not in the inspected screen')
	})

	it('rejects an old snapshot or navigation before highlighting', () => {
		expect(() =>
			assertHighlightSelection(screen, { snapshotId: 'other', index: 2 }, screen.url, 2000)
		).toThrow('changed or expired')
		expect(() =>
			assertHighlightSelection(
				screen,
				{ snapshotId: 'screen-1', index: 2 },
				'https://odoo.example/other',
				2000
			)
		).toThrow('changed or expired')
		expect(() =>
			assertHighlightSelection(screen, { snapshotId: 'screen-1', index: 2 }, screen.url, 62000)
		).toThrow('changed or expired')
	})

	it('marks navigation or expiry as a recoverable stale screen', () => {
		expect.assertions(2)
		try {
			assertHighlightSelection(
				screen,
				{ snapshotId: 'screen-1', index: 2 },
				'https://odoo.example/odoo/sales/new',
				2000
			)
		} catch (error) {
			expect(error).toBeInstanceOf(GuideSelectionError)
			expect((error as GuideSelectionError).code).toBe('STALE_SNAPSHOT')
		}
	})

	it('detects a control repurposed without changing its URL', () => {
		const button = document.createElement('button')
		button.textContent = 'Nuevo'
		const original = guideTargetKey(button)
		button.textContent = 'Eliminar'
		expect(guideTargetKey(button)).not.toBe(original)
	})
})
