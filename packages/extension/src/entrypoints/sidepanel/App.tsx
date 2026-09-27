import type { AgentActivity } from '@page-agent/core'
import {
	AlertCircle,
	BookOpenText,
	Check,
	ChevronDown,
	Clock3,
	ListChecks,
	LoaderCircle,
	MessageCircle,
	Mic,
	MousePointerClick,
	Plus,
	Send,
	Settings2,
	ShieldCheck,
	Square,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { ConfigPanel } from '@/components/ConfigPanel'
import { HistoryDetail } from '@/components/HistoryDetail'
import { HistoryList } from '@/components/HistoryList'
import { OdooContextPanel } from '@/components/OdooContextPanel'
import { EventCard } from '@/components/cards'
import { Button } from '@/components/ui/button'
import { saveSession } from '@/lib/db'
import type { OdooMode } from '@/odoo/agent-tools'
import type { OdooPageContext } from '@/odoo/context'
import {
	type ConversationTurn,
	clearConversation,
	loadConversation,
	saveConversation,
} from '@/odoo/conversation'
import { VoicePanel } from '@/voice/VoicePanel'

import { useAgent } from '../../agent/useAgent'

import './podoo.css'

type View =
	| { name: 'chat' }
	| { name: 'config' }
	| { name: 'history' }
	| { name: 'history-detail'; sessionId: string }

const MODES = {
	explain: {
		label: 'Entender',
		heading: 'Entiende la pantalla',
		description: 'Te explico lo que ves y para qué sirve. No hago cambios en Odoo.',
		placeholder: 'Pregunta qué significa algo en esta pantalla…',
		suggestions: ['¿Qué puedo hacer en esta pantalla?', 'Explícame los campos principales'],
		icon: BookOpenText,
	},
	guide: {
		label: 'Guiarme',
		heading: 'Avanza paso a paso',
		description: 'Te digo el siguiente paso y tú lo haces en Odoo.',
		placeholder: 'Dime qué quieres aprender a hacer…',
		suggestions: ['Guíame para completar esta tarea', '¿Cuál es el siguiente paso?'],
		icon: ListChecks,
	},
	assist: {
		label: 'Hacer conmigo',
		heading: 'Hazlo conmigo',
		description:
			'Hago los pasos de tu tarea. Solo confirmas acciones importantes como enviar, confirmar o eliminar.',
		placeholder: 'Describe qué quieres hacer en Odoo…',
		suggestions: ['Ayúdame a completar este formulario', 'Haz esta tarea conmigo'],
		icon: MousePointerClick,
	},
} satisfies Record<
	OdooMode,
	{
		label: string
		heading: string
		description: string
		placeholder: string
		suggestions: string[]
		icon: typeof BookOpenText
	}
>

function activityLabel(activity: AgentActivity | null): string {
	if (!activity) return 'Revisando la pantalla de Odoo…'
	switch (activity.type) {
		case 'thinking':
			return 'Preparando una respuesta…'
		case 'executing':
			return 'Revisando el siguiente paso…'
		case 'executed':
			return 'Comprobando el resultado…'
		case 'retrying':
			return 'Intentándolo de nuevo…'
		case 'error':
			return 'Ha ocurrido un problema.'
	}
}

export default function App() {
	const [view, setView] = useState<View>({ name: 'chat' })
	const [inputValue, setInputValue] = useState('')
	const [context, setContext] = useState<OdooPageContext | null>(null)
	const [conversation, setConversation] = useState<ConversationTurn[]>([])
	const [loadedOrigin, setLoadedOrigin] = useState<string | null>(null)
	const [conversationError, setConversationError] = useState<string | null>(null)
	const [confirmNew, setConfirmNew] = useState(false)
	const [processing, setProcessing] = useState(false)
	const [voiceOpen, setVoiceOpen] = useState(false)
	const transcriptRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const conversationRef = useRef<ConversationTurn[]>([])
	const activeOriginRef = useRef<string | null>(null)
	const pendingRef = useRef(false)

	const {
		status,
		history,
		activity,
		currentTask,
		config,
		approval,
		execute,
		stop,
		answerApproval,
		configure,
	} = useAgent()
	const mode = config?.odooMode ?? 'explain'
	const isRunning = status === 'running'
	const isBusy = isRunning || processing
	const origin = context?.origin ?? null
	const handleContextChange = useCallback((next: OdooPageContext | null) => {
		const nextOrigin = next?.origin ?? null
		if (activeOriginRef.current !== nextOrigin) {
			setVoiceOpen(false)
			activeOriginRef.current = nextOrigin
			conversationRef.current = []
			setConversation([])
			setLoadedOrigin(null)
			setConversationError(null)
		}
		setContext(next)
	}, [])

	const changeMode = useCallback(
		(next: OdooMode) => {
			if (config && !isBusy && !voiceOpen && !pendingRef.current)
				void configure({ ...config, odooMode: next })
		},
		[config, configure, isBusy, voiceOpen]
	)

	useEffect(() => {
		let active = true
		if (!origin) return
		loadConversation(origin)
			.then((turns) => {
				if (!active) return
				conversationRef.current = turns
				setConversation(turns)
				setLoadedOrigin(origin)
				setConversationError(null)
			})
			.catch(() => {
				if (active)
					setConversationError('No pude cargar la conversación local. Actualiza el panel.')
			})
		return () => {
			active = false
		}
	}, [origin])

	// Preserve the detailed trace for the existing History view.
	const prevStatusRef = useRef(status)
	useEffect(() => {
		const prev = prevStatusRef.current
		prevStatusRef.current = status
		if (
			prev === 'running' &&
			(status === 'completed' || status === 'error' || status === 'stopped') &&
			history.length > 0 &&
			currentTask
		) {
			saveSession({ task: currentTask, history, status }).catch((error) =>
				console.error('[Podoo] Failed to save task trace:', error)
			)
		}
	}, [status, history, currentTask])

	useEffect(() => {
		if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
	}, [conversation, activity, approval, isBusy])

	const runTask = useCallback(
		async (task: string) => {
			const normalizedTask = task.trim()
			if (!normalizedTask || isRunning || voiceOpen || pendingRef.current) return
			if (!origin || loadedOrigin !== origin) {
				setConversationError('Abre una pantalla de Odoo y espera a que Podoo la reconozca.')
				return
			}
			pendingRef.current = true
			setProcessing(true)
			try {
				const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
				const activeScreen = tab?.id
					? await chrome.runtime.sendMessage({
							type: 'PAGE_CONTROL',
							action: 'get_odoo_context',
							targetTabId: tab.id,
						})
					: null
				if (activeScreen?.origin !== origin) {
					setConversationError('La pestaña activa cambió. Vuelve a Odoo y actualiza el contexto.')
					return
				}
				setConversationError(null)
				setConfirmNew(false)
				setInputValue('')
				setView({ name: 'chat' })
				const previous = conversationRef.current
				const userTurn: ConversationTurn = {
					id: crypto.randomUUID(),
					role: 'user',
					text: normalizedTask,
					mode,
					createdAt: Date.now(),
				}
				const withUser = [...previous, userTurn]
				conversationRef.current = withUser
				setConversation(withUser)
				try {
					await saveConversation(origin, withUser)
				} catch {
					setConversationError('No pude guardar la conversación en este navegador.')
				}

				let answer: ConversationTurn
				try {
					const result = await execute(normalizedTask, { origin, turns: previous })
					answer = {
						id: crypto.randomUUID(),
						role: 'assistant',
						text: result.data,
						mode,
						createdAt: Date.now(),
						error: !result.success,
					}
				} catch (error) {
					answer = {
						id: crypto.randomUUID(),
						role: 'assistant',
						text: error instanceof Error ? error.message : String(error),
						mode,
						createdAt: Date.now(),
						error: true,
					}
				}
				const finished = [...withUser, answer]
				try {
					await saveConversation(origin, finished)
				} catch {
					if (activeOriginRef.current === origin)
						setConversationError('La respuesta no se pudo guardar en este navegador.')
				}
				if (activeOriginRef.current === origin) {
					conversationRef.current = finished
					setConversation(finished)
				}
			} catch {
				setConversationError(
					'No pude comprobar la pestaña de Odoo. Actualízala e inténtalo otra vez.'
				)
			} finally {
				pendingRef.current = false
				setProcessing(false)
			}
		},
		[execute, isRunning, loadedOrigin, mode, origin, voiceOpen]
	)

	const newConversation = useCallback(async () => {
		if (!origin || isBusy || pendingRef.current) return
		try {
			await clearConversation(origin)
			conversationRef.current = []
			setConversation([])
			setConfirmNew(false)
			textareaRef.current?.focus()
		} catch {
			setConversationError('No pude empezar una nueva conversación. Inténtalo otra vez.')
		}
	}, [origin, isBusy])

	const submit = useCallback(
		(event?: React.SyntheticEvent) => {
			event?.preventDefault()
			void runTask(inputValue)
		},
		[inputValue, runTask]
	)

	if (view.name === 'config') {
		return (
			<ConfigPanel
				config={config}
				onSave={async (next) => {
					await configure(next)
					setView({ name: 'chat' })
				}}
				onClose={() => setView({ name: 'chat' })}
			/>
		)
	}
	if (view.name === 'history') {
		return (
			<HistoryList
				onSelect={(id) => setView({ name: 'history-detail', sessionId: id })}
				onBack={() => setView({ name: 'chat' })}
				onRerun={(task) => {
					setInputValue(task)
					setView({ name: 'chat' })
				}}
			/>
		)
	}
	if (view.name === 'history-detail') {
		return (
			<HistoryDetail
				sessionId={view.sessionId}
				onBack={() => setView({ name: 'history' })}
				onRerun={(task) => {
					setInputValue(task)
					setView({ name: 'chat' })
				}}
			/>
		)
	}

	const selected = MODES[mode]
	const canSend = Boolean(
		origin && loadedOrigin === origin && inputValue.trim() && !isBusy && !voiceOpen
	)

	return (
		<div className="podoo-panel flex h-screen min-h-0 flex-col bg-background text-foreground">
			<header className="flex shrink-0 items-center justify-between border-b bg-card px-4 py-3">
				<div className="flex min-w-0 items-center gap-3">
					<img src="/assets/podoo-64.png" alt="" className="size-9 shrink-0 rounded-xl" />
					<div className="min-w-0">
						<h1 className="text-sm font-bold leading-tight tracking-tight">Podoo</h1>
						<p className="text-xs text-muted-foreground">Tu copiloto en Odoo</p>
					</div>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant={voiceOpen ? 'secondary' : 'ghost'}
						size="icon"
						className="size-10 cursor-pointer"
						disabled={!origin || loadedOrigin !== origin || isBusy}
						onClick={() => setVoiceOpen((open) => !open)}
						aria-label={voiceOpen ? 'Cerrar voz en vivo' : 'Abrir voz en vivo'}
						aria-pressed={voiceOpen}
						title="Voz en vivo"
					>
						<Mic className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-10 cursor-pointer"
						disabled={!origin || isBusy || voiceOpen || conversation.length === 0}
						onClick={() => setConfirmNew(true)}
						aria-label="Nueva conversación"
						title="Nueva conversación"
					>
						<Plus className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-10 cursor-pointer"
						disabled={isBusy || voiceOpen}
						onClick={() => setView({ name: 'history' })}
						aria-label="Historial de tareas"
						title="Historial de tareas"
					>
						<Clock3 className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-10 cursor-pointer"
						disabled={isBusy || voiceOpen}
						onClick={() => setView({ name: 'config' })}
						aria-label="Configuración"
						title="Configuración"
					>
						<Settings2 className="size-4" />
					</Button>
				</div>
			</header>

			<OdooContextPanel onContextChange={handleContextChange} />

			<section className="shrink-0 border-b bg-card px-4 py-3" aria-label="Cómo quieres trabajar">
				<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					¿Cómo te ayudo?
				</p>
				<div className="grid grid-cols-3 gap-2" role="group" aria-label="Modo del copiloto">
					{(Object.keys(MODES) as OdooMode[]).map((option) => {
						const item = MODES[option]
						const Icon = item.icon
						return (
							<button
								type="button"
								key={option}
								aria-pressed={mode === option}
								disabled={!config || isBusy || voiceOpen}
								onClick={() => changeMode(option)}
								className={`podoo-mode flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${mode === option ? 'podoo-mode-active' : 'bg-background hover:bg-muted'}`}
							>
								<Icon className="size-4" aria-hidden="true" />
								<span>{item.label}</span>
							</button>
						)
					})}
				</div>
				<div
					className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
					role="status"
				>
					<ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
					<p>
						<strong className="text-foreground">{selected.heading}.</strong> {selected.description}
					</p>
				</div>
			</section>
			{voiceOpen && context && <VoicePanel context={context} onClose={() => setVoiceOpen(false)} />}

			{conversationError && (
				<div
					role="alert"
					className="flex items-start gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive"
				>
					<AlertCircle className="mt-0.5 size-4 shrink-0" />
					{conversationError}
				</div>
			)}
			{confirmNew && (
				<div
					className="border-b bg-card px-4 py-3 text-sm"
					role="alertdialog"
					aria-label="Nueva conversación"
				>
					<p className="font-semibold">¿Empezar una conversación nueva?</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Se borrará este chat de este navegador. El historial de tareas seguirá disponible.
					</p>
					<div className="mt-3 flex gap-2">
						<Button size="sm" onClick={() => void newConversation()}>
							Empezar de nuevo
						</Button>
						<Button size="sm" variant="outline" onClick={() => setConfirmNew(false)}>
							Cancelar
						</Button>
					</div>
				</div>
			)}

			<main
				ref={transcriptRef}
				className="podoo-transcript min-h-0 flex-1 overflow-y-auto px-4 py-5"
				aria-label="Conversación"
				aria-live="polite"
			>
				{loadedOrigin !== origin && origin && (
					<p className="text-center text-sm text-muted-foreground">Cargando conversación…</p>
				)}
				{conversation.length === 0 && !isBusy && loadedOrigin === origin && (
					<div className="flex h-full min-h-64 flex-col items-center justify-center gap-4 text-center">
						<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
							<MessageCircle className="size-6" />
						</div>
						<div className="max-w-64 space-y-1">
							<h2 className="text-base font-semibold">Aprendamos juntos en Odoo</h2>
							<p className="text-sm leading-relaxed text-muted-foreground">
								Pregúntame sobre la pantalla que tienes abierta. Puedes seguir la conversación sin
								repetir el contexto.
							</p>
						</div>
						{origin && (
							<div className="flex w-full max-w-sm flex-col gap-2">
								{selected.suggestions.map((suggestion) => (
									<button
										key={suggestion}
										type="button"
										disabled={voiceOpen}
										className="min-h-11 rounded-xl border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
										onClick={() => void runTask(suggestion)}
									>
										{suggestion}
									</button>
								))}
							</div>
						)}
					</div>
				)}
				<div className="space-y-5">
					{conversation.map((turn) => (
						<div
							key={turn.id}
							className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}
						>
							<div
								className={
									turn.role === 'user'
										? 'podoo-user-bubble max-w-[88%] rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed'
										: `podoo-assistant-bubble w-full rounded-2xl rounded-bl-sm border bg-card px-4 py-3 text-sm leading-relaxed ${turn.error ? 'border-destructive/40' : ''}`
								}
							>
								{turn.role === 'assistant' && (
									<div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
										{turn.error ? (
											<AlertCircle className="size-4 text-destructive" />
										) : (
											<Check className="size-4" />
										)}
										Podoo · {MODES[turn.mode].label}
									</div>
								)}
								{turn.role === 'assistant' && !turn.error ? (
									<div className="podoo-markdown">
										<Markdown
											remarkPlugins={[remarkGfm]}
											components={{
												a: ({ ...props }) => (
													<a {...props} target="_blank" rel="noopener noreferrer" />
												),
											}}
										>
											{turn.text}
										</Markdown>
									</div>
								) : (
									<p className="whitespace-pre-wrap break-words">{turn.text}</p>
								)}
							</div>
						</div>
					))}
					{isBusy && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
							<LoaderCircle className="size-4 animate-spin text-primary" />
							{activityLabel(activity)}
						</div>
					)}
					{!isBusy && history.length > 0 && conversation.length > 0 && (
						<details className="rounded-xl border bg-card/70 p-3 text-xs">
							<summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
								Ver actividad de la última respuesta <ChevronDown className="size-3.5" />
							</summary>
							<div className="mt-3 space-y-2">
								{history.map((event, index) => (
									<EventCard key={index} event={event} />
								))}
							</div>
						</details>
					)}
				</div>
			</main>

			{approval && (
				<section
					className="border-t border-primary/25 bg-primary/5 px-4 py-4"
					role="alertdialog"
					aria-label="Confirmar acción importante en Odoo"
				>
					<div className="flex items-center gap-2 text-sm font-semibold">
						<MousePointerClick className="size-4 text-primary" />
						Confirma esta acción importante
					</div>
					<p className="mt-2 whitespace-pre-wrap break-words rounded-lg border bg-card p-3 text-sm">
						{approval}
					</p>
					<p className="mt-2 text-xs text-muted-foreground">
						Esta acción puede enviar, confirmar o cambiar el estado de un registro.
					</p>
					<div className="mt-3 flex gap-2">
						<Button className="min-h-11 flex-1" onClick={() => answerApproval(true)}>
							Permitir este paso
						</Button>
						<Button variant="outline" className="min-h-11" onClick={() => answerApproval(false)}>
							No permitir
						</Button>
					</div>
				</section>
			)}

			<footer className="shrink-0 border-t bg-card px-4 py-3">
				<form
					onSubmit={submit}
					className="podoo-composer rounded-2xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40"
				>
					<label htmlFor="podoo-message" className="sr-only">
						Escribe a Podoo
					</label>
					<textarea
						id="podoo-message"
						ref={textareaRef}
						rows={2}
						value={inputValue}
						onChange={(event) => setInputValue(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault()
								submit()
							}
						}}
						disabled={isBusy || voiceOpen || !origin || loadedOrigin !== origin}
						placeholder={origin ? selected.placeholder : 'Abre Odoo para empezar…'}
						className="min-h-12 max-h-36 w-full resize-y bg-transparent px-2 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed"
					/>
					<div className="flex items-center justify-between gap-2 px-1">
						<span className="text-[11px] text-muted-foreground">
							{conversation.length > 0
								? 'Recuerdo los mensajes recientes de este Odoo'
								: 'Tu conversación se guarda en este navegador'}
						</span>
						{isRunning ? (
							<Button
								type="button"
								variant="destructive"
								size="icon"
								className="size-10 cursor-pointer"
								onClick={() => stop()}
								aria-label="Detener respuesta"
							>
								<Square className="size-4" />
							</Button>
						) : (
							<Button
								type="submit"
								size="icon"
								className="size-10 cursor-pointer rounded-xl"
								disabled={!canSend}
								aria-label="Enviar mensaje"
							>
								<Send className="size-4" />
							</Button>
						)}
					</div>
				</form>
				<p className="mt-2 text-center text-[11px] text-muted-foreground">
					Enter para enviar · Shift + Enter para otra línea
				</p>
			</footer>
		</div>
	)
}
