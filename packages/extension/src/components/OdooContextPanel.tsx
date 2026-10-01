import { ChevronDown, ChevronUp, RefreshCw, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { CONTENT_SCRIPT_MISSING, RELOAD_ODOO_TAB_MESSAGE } from '@/agent/pageControlErrors'
import { Button } from '@/components/ui/button'
import { type OdooPageContext, companyRulesStorageKey } from '@/odoo/context'

const VIEW_LABELS: Record<OdooPageContext['view'], string> = {
	form: 'Formulario',
	kanban: 'Tablero',
	list: 'Lista',
	graph: 'Gráfico',
	pivot: 'Tabla dinámica',
	calendar: 'Calendario',
	other: 'Pantalla',
}

export function OdooContextPanel({
	onContextChange,
}: {
	onContextChange?: (context: OdooPageContext | null) => void
}) {
	const [context, setContext] = useState<OdooPageContext | null>(null)
	const [rulesState, setRulesState] = useState({ origin: '', draft: '', saved: '' })
	const [message, setMessage] = useState('Buscando una pestaña de Odoo…')
	const [rulesOpen, setRulesOpen] = useState(false)
	const origin = context?.origin
	const rules = rulesState.origin === origin ? rulesState.draft : ''
	const savedRules = rulesState.origin === origin ? rulesState.saved : ''

	const updateContext = useCallback(
		(next: OdooPageContext | null) => {
			setContext(next)
			onContextChange?.(next)
		},
		[onContextChange]
	)

	const refresh = useCallback(async () => {
		try {
			const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
			if (tab?.url === chrome.runtime.getURL('mic-permission.html')) return
			if (!tab?.id || !/^https?:\/\//.test(tab.url ?? '')) {
				updateContext(null)
				setMessage('Abre Odoo en esta ventana para empezar.')
				return
			}
			const response = await chrome.runtime.sendMessage({
				type: 'PAGE_CONTROL',
				action: 'get_odoo_context',
				targetTabId: tab.id,
			})
			if (!response || response.success === false) {
				updateContext(null)
				setMessage(
					response?.code === CONTENT_SCRIPT_MISSING
						? RELOAD_ODOO_TAB_MESSAGE
						: 'Abre una pantalla de Odoo y actualízala.'
				)
				return
			}
			updateContext(response as OdooPageContext)
			setMessage('')
		} catch {
			updateContext(null)
			setMessage('No pude leer esta pestaña. Actualiza Odoo e inténtalo otra vez.')
		}
	}, [updateContext])

	useEffect(() => {
		void refresh()
		const timer = window.setInterval(() => void refresh(), 4000)
		return () => window.clearInterval(timer)
	}, [refresh])

	useEffect(() => {
		if (!origin) return
		let active = true
		const key = companyRulesStorageKey(origin)
		chrome.storage.local.get(key).then((stored) => {
			if (!active) return
			const value = typeof stored[key] === 'string' ? stored[key] : ''
			setRulesState({ origin, draft: value, saved: value })
		})
		return () => {
			active = false
		}
	}, [origin])

	const saveRules = async () => {
		if (!context) return
		await chrome.storage.local.set({ [companyRulesStorageKey(context.origin)]: rules.trim() })
		setRulesState({ origin: context.origin, draft: rules.trim(), saved: rules.trim() })
	}

	return (
		<section className="border-b border-border/80 bg-card px-4 py-3" aria-label="Contexto de Odoo">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<ShieldCheck className="size-4" aria-hidden="true" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
						{context ? 'Viendo en Odoo' : 'Sin conexión con Odoo'}
					</p>
					{context ? (
						<>
							<p className="truncate text-sm font-semibold" title={context.breadcrumbs.join(' › ')}>
								{context.breadcrumbs.at(-1) || context.app || 'Odoo'}
							</p>
							<p className="truncate text-xs text-muted-foreground" title={context.origin}>
								{context.app || new URL(context.origin).hostname} · {VIEW_LABELS[context.view]}
							</p>
						</>
					) : (
						<p className="text-xs leading-relaxed text-muted-foreground">{message}</p>
					)}
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="size-9 shrink-0 cursor-pointer"
					onClick={() => void refresh()}
					aria-label="Actualizar contexto de Odoo"
					title="Actualizar contexto"
				>
					<RefreshCw className="size-4" />
				</Button>
			</div>
			{context && (
				<div className="mt-2 pl-11">
					<button
						type="button"
						className="flex min-h-9 items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-pointer"
						aria-expanded={rulesOpen}
						onClick={() => setRulesOpen((open) => !open)}
					>
						Reglas de tu empresa {savedRules ? '· guardadas' : '· opcionales'}
						{rulesOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
					</button>
					{rulesOpen && (
						<div className="space-y-2 pb-1">
							<label htmlFor="company-rules" className="block text-xs text-muted-foreground">
								Añade políticas aprobadas para que Podoo las tenga en cuenta.
							</label>
							<textarea
								id="company-rules"
								className="min-h-24 w-full resize-y rounded-lg border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
								placeholder="Ej.: Antes de confirmar una venta, verifica el cliente y las condiciones de pago."
								value={rules}
								maxLength={8000}
								onChange={(event) =>
									setRulesState({
										origin: context.origin,
										draft: event.target.value,
										saved: savedRules,
									})
								}
							/>
							<div className="flex items-center justify-between gap-3">
								<span className="text-xs text-muted-foreground">
									Se guarda solo en este navegador.
								</span>
								<Button
									size="sm"
									disabled={rules.trim() === savedRules}
									onClick={() => void saveRules()}
								>
									Guardar
								</Button>
							</div>
						</div>
					)}
				</div>
			)}
		</section>
	)
}
