import { readOdooContext } from '@/odoo/context'

export interface AnalyticGuideStep {
	key: string
	label: string
	instruction: string
	state: 'target' | 'blocked' | 'verify'
}

export interface AnalyticGuideMatch {
	step: AnalyticGuideStep
	target: HTMLElement | null
}

export interface AnalyticGuideProgress {
	saveWasClicked?: boolean
	newFormObserved?: boolean
}

function normalized(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase()
}

function isVisible(element: HTMLElement): boolean {
	const style = getComputedStyle(element)
	const rect = element.getBoundingClientRect()
	return (
		style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
	)
}

function findControl(doc: Document, labels: string[]): HTMLElement | null {
	const expected = labels.map(normalized)
	const matches = Array.from(
		doc.querySelectorAll<HTMLElement>('a, button, [role="menuitem"], [role="button"]')
	).filter((element) => {
		const label =
			normalized(element.getAttribute('aria-label')) ||
			normalized(element.textContent) ||
			normalized(element.title)
		return expected.includes(label) && isVisible(element)
	})
	return matches.length === 1 ? matches[0] : null
}

function findSelector(doc: Document, selectors: string[]): HTMLElement | null {
	for (const selector of selectors) {
		const candidate = Array.from(doc.querySelectorAll<HTMLElement>(selector)).find(isVisible)
		if (candidate) return candidate
	}
	return null
}

function findInputByLabel(doc: Document, labels: string[]): HTMLInputElement | null {
	const expected = labels.map(normalized)
	for (const label of doc.querySelectorAll<HTMLLabelElement>('.o_form_view label[for]')) {
		if (!expected.includes(normalized(label.textContent))) continue
		const field = doc.getElementById(label.htmlFor)
		if (field?.tagName === 'INPUT' && isVisible(field)) return field as HTMLInputElement
	}
	return null
}

function target(
	key: string,
	label: string,
	instruction: string,
	element: HTMLElement
): AnalyticGuideMatch {
	return { step: { key, label, instruction, state: 'target' }, target: element }
}

function blocked(label: string, instruction: string): AnalyticGuideMatch {
	return { step: { key: 'blocked', label, instruction, state: 'blocked' }, target: null }
}

/** Match only controls found on the live Odoo page. This guide never clicks or writes. */
export function resolveAnalyticGuideStep(
	doc: Document,
	url: URL,
	progress: AnalyticGuideProgress = {}
): AnalyticGuideMatch {
	const context = readOdooContext(doc, url)
	if (!context) return blocked('Abre Odoo', 'Abre una pestaña de Odoo para iniciar la guía.')
	if (progress.saveWasClicked) {
		return {
			step: {
				key: 'verify',
				label: 'Comprueba el guardado',
				instruction: 'Revisa si Odoo guardó la cuenta o muestra un campo pendiente.',
				state: 'verify',
			},
			target: null,
		}
	}

	const accounting = ['contabilidad', 'accounting'].some((name) =>
		normalized(context.app).includes(name)
	)
	const location = normalized(
		[
			...context.breadcrumbs,
			doc.querySelector('.o_control_panel')?.textContent,
			doc.querySelector('.o_form_view .o_form_sheet')?.querySelector('h1')?.textContent,
		].join(' ')
	)
	const analyticScreen =
		/(cuenta[s]? analitica[s]?|analytic account[s]?)/.test(location) ||
		(accounting && /\/analytic[-_/]?accounts?(?:\/|$)/.test(url.pathname)) ||
		url.searchParams.get('model') === 'account.analytic.account' ||
		(accounting && Boolean(doc.querySelector('.o_form_view [name="plan_id"]')))

	if (analyticScreen && context.view === 'form') {
		const name = (findSelector(doc, [
			'.o_form_view .o_field_widget[name="name"] input',
			'.o_form_view [name="name"] input',
			'.o_form_view input[name="name"]',
		]) ?? findInputByLabel(doc, ['Nombre', 'Name'])) as HTMLInputElement | null
		if (!name) return blocked('Nombre de la cuenta', 'No encuentro el campo Nombre en esta ficha.')
		if (!name.value.trim()) {
			return target('name', 'Nombre de la cuenta', 'Escribe el nombre de la cuenta aquí.', name)
		}
		if (!progress.newFormObserved) {
			const back = findControl(doc, ['Cuentas analíticas', 'Analytic Accounts'])
			if (back)
				return target(
					'back-to-list',
					'Cuentas analíticas',
					'Vuelve a la lista con el control señalado para crear una cuenta nueva.',
					back
				)
			return blocked(
				'Cuenta existente',
				'Esta ficha ya tiene nombre. Vuelve a la lista de cuentas analíticas para crear otra.'
			)
		}
		const plan = findSelector(doc, [
			'.o_form_view .o_field_widget[name="plan_id"] input',
			'.o_form_view [name="plan_id"] input',
		]) as HTMLInputElement | null
		const planOptions = plan
			?.closest('[name="plan_id"]')
			?.querySelector<HTMLElement>('.o-autocomplete--dropdown-menu, [role="listbox"]')
		if (plan && (!plan.value.trim() || (planOptions && isVisible(planOptions)))) {
			return target(
				'plan',
				'Plan analítico',
				'Selecciona aquí el plan analítico que usa tu empresa.',
				plan
			)
		}
		const save = findSelector(doc, ['.o_form_button_save']) ?? findControl(doc, ['Guardar', 'Save'])
		if (save) {
			return target(
				'save',
				'Guardar cuenta',
				'Revisa los datos y haz clic aquí para guardar.',
				save
			)
		}
		return blocked('Formulario de cuenta', 'No encuentro el botón Guardar en esta vista.')
	}

	if (analyticScreen && context.view === 'list') {
		const add =
			findSelector(doc, ['.o_list_button_add']) ?? findControl(doc, ['Nuevo', 'Nueva', 'New'])
		if (add) return target('new', 'Nueva cuenta', 'Haz clic en el botón señalado.', add)
		return blocked('Cuentas analíticas', 'No encuentro el botón Nuevo en esta vista.')
	}

	if (accounting) {
		const accounts = findControl(doc, ['Cuentas analíticas', 'Analytic Accounts'])
		if (accounts)
			return target('accounts', 'Cuentas analíticas', 'Haz clic en el menú señalado.', accounts)
		const settings = findControl(doc, ['Configuración', 'Configuration', 'Settings'])
		if (settings) return target('settings', 'Configuración', 'Abre el menú señalado.', settings)
		return blocked(
			'Menú de Contabilidad',
			'No encuentro Configuración en la pantalla actual. Abre el menú de Contabilidad.'
		)
	}

	const accountingApp = findControl(doc, ['Contabilidad', 'Accounting'])
	if (accountingApp)
		return target(
			'accounting',
			'Contabilidad',
			'Haz clic en la aplicación señalada.',
			accountingApp
		)
	const appMenu = findSelector(doc, [
		'.o_navbar_apps_menu button',
		'.o_menu_toggle',
		'button[aria-label="Apps"]',
		'button[aria-label="Aplicaciones"]',
	])
	if (appMenu) return target('app-menu', 'Aplicaciones', 'Abre el menú señalado.', appMenu)
	return blocked('Aplicaciones de Odoo', 'No encuentro el menú de aplicaciones en esta pantalla.')
}
