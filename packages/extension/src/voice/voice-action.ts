export type VoiceAction = 'click' | 'input'

const CONSEQUENTIAL_CONTROL =
	/(?:^|[^a-z])(?:confirm(?:ar)?|approve|aprobar|validate|validar|send|enviar|delete|eliminar|unlink|cancel(?:ar)?|post|publicar|publish|pay|pagar|refund|reembolsar|sign|firmar|archive|archivar|registrar[_\s-]?pago|register[_\s-]?payment|facturar|invoice|crear[_\s-]?factura)(?=$|[^a-z])/i

/** Returns the actual DOM target after checking that a voice action is routine and editable. */
export function assertVoiceActionTarget(
	element: HTMLElement,
	action: VoiceAction,
	text?: string
): HTMLElement {
	if (!element.isConnected) throw new Error('The selected control is no longer on screen.')
	if (!element.closest('.o_web_client, .o_main_navbar'))
		throw new Error('The selected control is outside Odoo.')
	if (element.matches('[disabled], [aria-disabled="true"]'))
		throw new Error('The selected control is disabled.')
	if (action === 'click') {
		const target =
			element.querySelector<HTMLElement>('.analytic_distribution_placeholder') ?? element
		const identity = [target.outerHTML.slice(0, 1000), target.textContent?.slice(0, 200)].join(' ')
		if (CONSEQUENTIAL_CONTROL.test(identity)) throw new Error('REQUIRES_CONFIRMATION')
		return target
	}
	if (typeof text !== 'string' || text.length > 5000) throw new Error('Invalid input text.')
	const target = element.matches('input,textarea,[contenteditable="true"]')
		? element
		: element.querySelector<HTMLElement>('input,textarea,[contenteditable="true"]')
	if (
		!target ||
		target.matches('[readonly], [disabled], [aria-disabled="true"]') ||
		target.closest('.o_readonly_modifier') ||
		(target instanceof HTMLInputElement &&
			![
				'text',
				'search',
				'number',
				'email',
				'tel',
				'url',
				'date',
				'datetime-local',
				'time',
				'month',
				'week',
			].includes(target.type))
	)
		throw new Error('The selected field is not editable.')
	return target
}
