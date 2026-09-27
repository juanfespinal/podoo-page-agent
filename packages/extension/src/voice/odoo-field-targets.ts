export interface OdooFieldTarget {
	index: number
	label: string
	kind: 'field' | 'column'
	editable: boolean
	element: HTMLElement
}

function visible(element: HTMLElement): boolean {
	if (element.closest('[hidden], [aria-hidden="true"]')) return false
	const style = getComputedStyle(element)
	if (style.display === 'none' || style.visibility === 'hidden') return false
	const rect = element.getBoundingClientRect()
	return rect.width > 0 && rect.height > 0 && rect.bottom >= -400 && rect.top <= innerHeight + 400
}

function text(element: Element | null): string {
	return element?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100) ?? ''
}

function fieldLabel(doc: Document, field: HTMLElement, name: string): string {
	const ownLabel = field.getAttribute('aria-label') || field.getAttribute('title')
	if (ownLabel?.trim()) return ownLabel.trim()
	if (field.id) {
		const matching = [...doc.querySelectorAll<HTMLLabelElement>('label[for]')].find(
			(label) => label.htmlFor === field.id
		)
		if (matching && text(matching)) return text(matching)
	}
	const local = field.closest('.o_wrap_field, .o_field_box, td, tr')
	const label = local?.querySelector('label, .o_form_label, .o_td_label')
	if (label && text(label)) return text(label)
	const header = [...doc.querySelectorAll<HTMLElement>('th[data-name]')].find(
		(item) => item.dataset.name === name
	)
	if (header && text(header)) return text(header)
	return name.replace(/_/g, ' ')
}

/** Odoo-specific semantic targets supplement Page Agent's interactive index. */
export function collectOdooFieldTargets(
	doc: Document,
	firstIndex: number,
	indexedElements: Iterable<HTMLElement>
): OdooFieldTarget[] {
	const covered = [...indexedElements]
	const targets: OdooFieldTarget[] = []
	const counts = new Map<string, number>()
	const add = (
		element: HTMLElement,
		name: string,
		label: string,
		kind: OdooFieldTarget['kind']
	) => {
		if (
			!label ||
			!visible(element) ||
			covered.some((item) => element === item || element.contains(item)) ||
			targets.some(
				(item) =>
					item.element === element ||
					item.element.contains(element) ||
					element.contains(item.element)
			)
		)
			return
		const count = counts.get(name) ?? 0
		if (count >= 3 || targets.length >= 80) return
		counts.set(name, count + 1)
		targets.push({
			index: firstIndex + targets.length,
			label: count ? `${label} · línea ${count + 1}` : label,
			kind,
			editable:
				kind === 'field' &&
				!element.matches('.o_readonly_modifier, [readonly], [aria-disabled="true"]') &&
				!element.closest('.o_readonly_modifier'),
			element,
		})
	}

	for (const field of doc.querySelectorAll<HTMLElement>(
		'.o_form_view .o_field_widget[name], .o_list_view .o_field_widget[name], .o_field_analytic_distribution'
	)) {
		const name =
			field.getAttribute('name') ||
			field.getAttribute('data-name') ||
			(field.classList.contains('o_field_analytic_distribution') ? 'analytic_distribution' : '')
		if (!name) continue
		add(field, name, fieldLabel(doc, field, name), 'field')
	}
	for (const placeholder of doc.querySelectorAll<HTMLElement>(
		'.analytic_distribution_placeholder'
	)) {
		const widget = placeholder.closest<HTMLElement>('.o_field_widget, .o_field_tags')
		if (widget)
			add(
				widget,
				'analytic_distribution',
				fieldLabel(doc, widget, 'analytic_distribution'),
				'field'
			)
	}
	for (const header of doc.querySelectorAll<HTMLElement>(
		'.o_list_view th[data-name], .o_form_view th[data-name]'
	)) {
		const name = header.dataset.name || ''
		if (!name || counts.has(name)) continue
		add(header, name, text(header), 'column')
	}
	return targets
}
