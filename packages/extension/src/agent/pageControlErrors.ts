export const CONTENT_SCRIPT_MISSING = 'CONTENT_SCRIPT_MISSING'
export const RELOAD_ODOO_TAB_MESSAGE =
	'Reload the Odoo tab after installing or updating Podoo Copilot, then retry. If this continues, allow Podoo Copilot access to the Odoo site in Chrome extension settings.'

export function isMissingContentScript(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return (
		message.includes('Could not establish connection') ||
		message.includes('Receiving end does not exist')
	)
}

export function pageControlError(response: { code?: string; error?: string } | null): Error {
	return new Error(
		response?.code === CONTENT_SCRIPT_MISSING
			? RELOAD_ODOO_TAB_MESSAGE
			: response?.error || 'Could not control the Odoo tab.'
	)
}
