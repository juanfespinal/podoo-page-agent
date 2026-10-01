/** A small, observable description of the current Odoo screen. */
export interface OdooPageContext {
	origin: string
	path: string
	app: string | null
	view: 'form' | 'kanban' | 'list' | 'graph' | 'pivot' | 'calendar' | 'other'
	breadcrumbs: string[]
	recordTitle: string | null
}

const VIEW_SELECTORS: [OdooPageContext['view'], string][] = [
	['form', '.o_form_view'],
	['kanban', '.o_kanban_view'],
	['list', '.o_list_view'],
	['graph', '.o_graph_view'],
	['pivot', '.o_pivot_view'],
	['calendar', '.o_calendar_view'],
]

function visibleText(element: Element | null): string | null {
	const value = element?.textContent?.replace(/\s+/g, ' ').trim()
	return value || null
}

/** Reads only screen identity. PageAgent already observes the interactive DOM separately. */
export function readOdooContext(doc: Document, url: URL): OdooPageContext | null {
	if (!doc.querySelector('.o_web_client, .o_main_navbar')) return null

	const app = visibleText(doc.querySelector('.o_menu_brand, .o_main_navbar .o_menu_brand'))
	const view = VIEW_SELECTORS.find(([, selector]) => doc.querySelector(selector))?.[0] ?? 'other'
	const breadcrumbs = Array.from(
		doc.querySelectorAll(
			'.o_breadcrumb .breadcrumb-item, .o_control_panel_breadcrumbs .breadcrumb-item'
		)
	)
		.map(visibleText)
		.filter((value): value is string => Boolean(value))
	const recordTitle = visibleText(doc.querySelector('.o_form_view .o_form_sheet h1'))

	return {
		origin: url.origin,
		path: url.pathname,
		app,
		view,
		breadcrumbs: [...new Set(breadcrumbs)].slice(0, 6),
		recordTitle,
	}
}

export function companyRulesStorageKey(origin: string): string {
	return `podoo:company-rules:${origin}`
}

export function formatOdooContext(context: OdooPageContext, companyRules?: string): string {
	const screen = [
		`Odoo instance: ${context.origin}`,
		`Path: ${context.path}`,
		`App: ${context.app ?? 'unknown'}`,
		`View: ${context.view}`,
		`Breadcrumbs: ${context.breadcrumbs.join(' > ') || 'unknown'}`,
		`Record title: ${context.recordTitle ?? 'unknown'}`,
	].join('\n')

	return companyRules?.trim()
		? `${screen}\n\nClient-approved process rules for this instance:\n${companyRules.trim()}`
		: `${screen}\n\nNo client-approved process rules have been configured for this instance. Do not invent them.`
}
