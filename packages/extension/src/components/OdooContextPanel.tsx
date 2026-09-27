import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type OdooPageContext, companyRulesStorageKey } from '@/odoo/context'

export function OdooContextPanel() {
	const [context, setContext] = useState<OdooPageContext | null>(null)
	const [rulesState, setRulesState] = useState({ origin: '', draft: '', saved: '' })
	const [message, setMessage] = useState('Checking the active tab…')
	const origin = context?.origin
	const rules = rulesState.origin === origin ? rulesState.draft : ''
	const savedRules = rulesState.origin === origin ? rulesState.saved : ''

	const refresh = useCallback(async () => {
		try {
			const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
			if (!tab?.id || !/^https?:\/\//.test(tab.url ?? '')) {
				setContext(null)
				setMessage('Open an Odoo tab to see its context.')
				return
			}
			const response = await chrome.runtime.sendMessage({
				type: 'PAGE_CONTROL',
				action: 'get_odoo_context',
				targetTabId: tab.id,
			})
			if (!response || response.success === false) {
				setContext(null)
				setMessage('Open an Odoo web client tab, then refresh.')
				return
			}
			const next = response as OdooPageContext
			setContext(next)
			setMessage('')
		} catch {
			setContext(null)
			setMessage('Could not read this tab. Reload the Odoo page and refresh.')
		}
	}, [])

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
		<section className="border-b px-3 py-2 space-y-2 text-xs" aria-label="Odoo context">
			<div className="flex items-center justify-between">
				<strong>Odoo context</strong>
				<Button variant="ghost" size="sm" onClick={() => void refresh()}>
					Refresh
				</Button>
			</div>
			{context ? (
				<>
					<p className="text-muted-foreground truncate" title={context.origin}>
						{context.origin} · {context.app ?? 'Odoo'} · {context.view}
					</p>
					{context.breadcrumbs.length > 0 && (
						<p className="truncate" title={context.breadcrumbs.join(' > ')}>
							{context.breadcrumbs.join(' > ')}
						</p>
					)}
					<label htmlFor="company-rules" className="block font-medium">
						Company process rules
					</label>
					<textarea
						id="company-rules"
						className="w-full min-h-16 rounded-md border bg-background p-2 text-xs"
						placeholder="Example: Before confirming a sales order, verify the customer and payment terms."
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
					<div className="flex items-center justify-between gap-2">
						<span className="text-muted-foreground">Saved locally for this Odoo instance.</span>
						<Button
							size="sm"
							disabled={rules.trim() === savedRules}
							onClick={() => void saveRules()}
						>
							Save
						</Button>
					</div>
				</>
			) : (
				<p className="text-muted-foreground">{message}</p>
			)}
		</section>
	)
}
