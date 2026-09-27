import { AlertCircle, Headphones, LoaderCircle, Mic, MicOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type OdooPageContext, companyRulesStorageKey } from '@/odoo/context'

import { activeOdooTabId, guideMessage } from './guide-client'
import type { GuideTarget } from './guide-overlay'
import { voiceInstructions } from './instructions'
import { hasMicrophonePermission, openMicrophonePermissionTab } from './microphone-permission'

type VoiceStatus =
	'idle' | 'permission' | 'connecting' | 'listening' | 'speaking' | 'responding' | 'error'

interface FunctionCall {
	type: 'function_call'
	name: string
	call_id: string
	arguments: string
}

interface RealtimeEvent {
	type: string
	delta?: string
	transcript?: string
	error?: { message?: string }
	response?: { output?: { type: string; name?: string; call_id?: string; arguments?: string }[] }
}

interface VoicePanelProps {
	context: OdooPageContext
	onClose: () => void
}

const tools = [
	{
		type: 'function',
		name: 'inspect_odoo_screen',
		description:
			'Read the current Odoo screen and its indexed visible controls. Call before choosing a control to highlight, and again after the user acts.',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
	},
	{
		type: 'function',
		name: 'highlight_odoo_control',
		description:
			'Visually point to ONE control from the most recent screen inspection. This does not click or change Odoo. Speak about the control only after this succeeds.',
		parameters: {
			type: 'object',
			properties: {
				snapshot_id: { type: 'string', description: 'snapshotId returned by inspect_odoo_screen' },
				index: { type: 'integer', description: 'Numeric index of the control in that snapshot' },
				label: { type: 'string', description: 'Short, human-readable name for the control' },
				instruction: {
					type: 'string',
					description: 'One short instruction explaining what the person can do here',
				},
			},
			required: ['snapshot_id', 'index', 'label', 'instruction'],
			additionalProperties: false,
		},
	},
	{
		type: 'function',
		name: 'clear_odoo_highlight',
		description:
			'Remove the visual highlight when changing topics or answering a conceptual question.',
		parameters: { type: 'object', properties: {}, additionalProperties: false },
	},
]

function statusLabel(status: VoiceStatus): string {
	switch (status) {
		case 'connecting':
			return 'Conectando la voz…'
		case 'permission':
			return 'Activa el micrófono en la pestaña que abrió Podoo.'
		case 'listening':
			return 'Te escucho. Pregúntame sobre Odoo.'
		case 'speaking':
			return 'Te escucho…'
		case 'responding':
			return 'Podoo está respondiendo…'
		case 'error':
			return 'No se pudo continuar la conversación.'
		default:
			return 'Inicia la voz para hablar con Podoo.'
	}
}

export function VoicePanel({ context, onClose }: VoicePanelProps) {
	const [status, setStatus] = useState<VoiceStatus>('idle')
	const [error, setError] = useState<string | null>(null)
	const [caption, setCaption] = useState('')
	const [lastAnswer, setLastAnswer] = useState('')
	const [guideTarget, setGuideTarget] = useState<GuideTarget | null>(null)
	const peerRef = useRef<RTCPeerConnection | null>(null)
	const channelRef = useRef<RTCDataChannel | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const audioRef = useRef<HTMLAudioElement>(null)
	const abortRef = useRef<AbortController | null>(null)
	const guideTabRef = useRef<number | null>(null)
	const respondingRef = useRef(false)
	const pendingProgressRef = useRef(false)
	const contextRef = useRef(context)
	contextRef.current = context

	const send = useCallback((event: unknown) => {
		if (channelRef.current?.readyState === 'open') channelRef.current.send(JSON.stringify(event))
	}, [])

	const closeConnection = useCallback(() => {
		abortRef.current?.abort()
		abortRef.current = null
		channelRef.current?.close()
		channelRef.current = null
		peerRef.current?.close()
		peerRef.current = null
		streamRef.current?.getTracks().forEach((track) => track.stop())
		streamRef.current = null
		respondingRef.current = false
		pendingProgressRef.current = false
		if (audioRef.current) audioRef.current.srcObject = null
		if (guideTabRef.current !== null) void guideMessage(guideTabRef.current, 'guide_clear')
		guideTabRef.current = null
		setGuideTarget(null)
	}, [])

	useEffect(() => closeConnection, [closeConnection])

	const callTool = useCallback(async (call: FunctionCall): Promise<Record<string, unknown>> => {
		const tabId = await activeOdooTabId(contextRef.current.origin)
		if (tabId === null) return { success: false, error: 'Open the Odoo tab for this conversation.' }
		guideTabRef.current = tabId
		let args: Record<string, unknown>
		try {
			args = JSON.parse(call.arguments || '{}') as Record<string, unknown>
		} catch {
			return { success: false, error: 'Invalid tool arguments.' }
		}
		switch (call.name) {
			case 'inspect_odoo_screen': {
				setGuideTarget(null)
				const result = await guideMessage(tabId, 'guide_inspect')
				const key = companyRulesStorageKey(contextRef.current.origin)
				const rules = (await chrome.storage.local.get(key))[key]
				return { ...result, companyRules: typeof rules === 'string' ? rules.slice(0, 4000) : '' }
			}
			case 'highlight_odoo_control': {
				const result = await guideMessage(tabId, 'guide_highlight', [
					{
						snapshotId: args.snapshot_id,
						index: args.index,
						label: args.label,
						instruction: args.instruction,
					},
				])
				if (result.success === true)
					setGuideTarget({
						key: `${args.snapshot_id}:${args.index}`,
						label: String(result.label),
						instruction: String(result.instruction),
					})
				return result
			}
			case 'clear_odoo_highlight':
				setGuideTarget(null)
				return guideMessage(tabId, 'guide_clear')
			default:
				return { success: false, error: `Unknown tool: ${call.name}` }
		}
	}, [])

	const finishResponse = useCallback(
		async (event: RealtimeEvent) => {
			respondingRef.current = false
			const calls = (event.response?.output ?? []).filter(
				(item): item is FunctionCall =>
					item.type === 'function_call' &&
					typeof item.name === 'string' &&
					typeof item.call_id === 'string' &&
					typeof item.arguments === 'string'
			)
			if (calls.length) {
				setStatus('responding')
				for (const call of calls) {
					let result: Record<string, unknown>
					try {
						result = await callTool(call)
					} catch (error) {
						result = {
							success: false,
							error: error instanceof Error ? error.message : String(error),
						}
					}
					send({
						type: 'conversation.item.create',
						item: {
							type: 'function_call_output',
							call_id: call.call_id,
							output: JSON.stringify(result),
						},
					})
				}
				if (channelRef.current?.readyState === 'open') {
					respondingRef.current = true
					send({ type: 'response.create' })
				}
				return
			}
			setStatus('listening')
			if (pendingProgressRef.current && channelRef.current?.readyState === 'open') {
				pendingProgressRef.current = false
				respondingRef.current = true
				send({
					type: 'response.create',
					response: {
						instructions:
							'La persona usó el control resaltado. Llama a inspect_odoo_screen, decide el siguiente paso según su objetivo y la pantalla actual; si corresponde, resalta un solo control y explícalo.',
					},
				})
			}
		},
		[callTool, send]
	)

	const start = useCallback(async () => {
		if (status === 'connecting' || peerRef.current) return
		setError(null)
		setCaption('')
		try {
			if (!(await hasMicrophonePermission())) {
				setStatus('permission')
				await openMicrophonePermissionTab()
				return
			}
		} catch (cause) {
			setError(
				`No se pudo abrir la pestaña del micrófono: ${cause instanceof Error ? cause.message : String(cause)}`
			)
			setStatus('error')
			return
		}
		setStatus('connecting')
		const abort = new AbortController()
		abortRef.current = abort
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true },
			})
			if (abort.signal.aborted) {
				stream.getTracks().forEach((track) => track.stop())
				return
			}
			streamRef.current = stream
			const result = (await chrome.runtime.sendMessage({ type: 'PODOO_REALTIME_TOKEN' })) as {
				token?: string
				error?: string
			}
			abort.signal.throwIfAborted()
			if (!result?.token) throw new Error(result?.error || 'No se pudo iniciar la voz.')
			const rulesKey = companyRulesStorageKey(contextRef.current.origin)
			const storedRules = (await chrome.storage.local.get(rulesKey))[rulesKey]
			const companyRules = typeof storedRules === 'string' ? storedRules : ''
			const peer = new RTCPeerConnection()
			peerRef.current = peer
			peer.ontrack = (event) => {
				if (audioRef.current) audioRef.current.srcObject = event.streams[0]
			}
			peer.onconnectionstatechange = () => {
				if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
					setError('La conexión de voz se interrumpió. Pulsa Iniciar voz para reconectar.')
					setStatus('error')
					closeConnection()
				}
			}
			for (const track of stream.getAudioTracks()) {
				track.enabled = false
				peer.addTrack(track, stream)
			}
			const channel = peer.createDataChannel('oai-events')
			channelRef.current = channel
			channel.addEventListener('open', () => {
				send({
					type: 'session.update',
					session: {
						type: 'realtime',
						model: 'gpt-realtime-2.1',
						output_modalities: ['audio'],
						instructions: voiceInstructions(contextRef.current, companyRules),
						tools,
						tool_choice: 'auto',
						audio: {
							input: { turn_detection: { type: 'semantic_vad' } },
							output: { voice: 'marin' },
						},
					},
				})
			})
			channel.addEventListener('message', (message: MessageEvent<string>) => {
				let event: RealtimeEvent
				try {
					event = JSON.parse(message.data) as RealtimeEvent
				} catch {
					return
				}
				switch (event.type) {
					case 'session.updated':
						streamRef.current?.getAudioTracks().forEach((track) => {
							track.enabled = true
						})
						setStatus('listening')
						break
					case 'response.done':
						void finishResponse(event)
						break
					case 'input_audio_buffer.speech_started':
						setStatus('speaking')
						break
					case 'input_audio_buffer.speech_stopped':
					case 'response.created':
						respondingRef.current = true
						setStatus('responding')
						break
					case 'response.output_audio_transcript.delta':
						setCaption((text) => text + (event.delta ?? ''))
						break
					case 'response.output_audio_transcript.done':
						setLastAnswer(event.transcript ?? '')
						setCaption('')
						break
					case 'error':
						setError(event.error?.message || 'La sesión de voz devolvió un error.')
						setStatus('error')
						closeConnection()
						break
				}
			})
			const offer = await peer.createOffer()
			await peer.setLocalDescription(offer)
			abort.signal.throwIfAborted()
			if (!offer.sdp) throw new Error('El navegador no pudo preparar el audio.')
			const response = await fetch('https://api.openai.com/v1/realtime/calls', {
				method: 'POST',
				headers: { Authorization: `Bearer ${result.token}`, 'Content-Type': 'application/sdp' },
				body: offer.sdp,
				signal: abort.signal,
			})
			if (!response.ok) throw new Error(`OpenAI rechazó la conexión de voz (${response.status}).`)
			await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() })
			abort.signal.throwIfAborted()
		} catch (cause) {
			if (abort.signal.aborted) return
			setError(
				cause instanceof DOMException && cause.name === 'NotAllowedError'
					? 'Chrome bloqueó el micrófono. Pulsa Iniciar voz para abrir la pestaña de permisos.'
					: cause instanceof Error
						? cause.message
						: String(cause)
			)
			setStatus('error')
			closeConnection()
		}
	}, [status, closeConnection, finishResponse, send])

	useEffect(() => {
		const onMessage = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
			if (
				message.type === 'PODOO_MIC_PERMISSION_GRANTED' &&
				sender.url === chrome.runtime.getURL('mic-permission.html')
			)
				void start()
			if (message.type === 'PODOO_GUIDE_TARGET_USED' && sender.tab?.id === guideTabRef.current) {
				setGuideTarget(null)
				pendingProgressRef.current = true
				window.setTimeout(() => {
					if (
						pendingProgressRef.current &&
						!respondingRef.current &&
						channelRef.current?.readyState === 'open'
					) {
						pendingProgressRef.current = false
						respondingRef.current = true
						send({
							type: 'response.create',
							response: {
								instructions:
									'La persona usó el control resaltado. Llama a inspect_odoo_screen y decide qué control mostrar después según el objetivo y la pantalla actual. Explica solo el siguiente paso.',
							},
						})
					}
				}, 600)
			}
		}
		chrome.runtime.onMessage.addListener(onMessage)
		return () => chrome.runtime.onMessage.removeListener(onMessage)
	}, [start, send])

	const stop = () => {
		closeConnection()
		setStatus('idle')
		setCaption('')
	}

	return (
		<section className="border-b bg-primary/5 px-4 py-4" aria-label="Voz en vivo">
			<audio ref={audioRef} autoPlay playsInline />
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-sm font-semibold">
						<Headphones className="size-4 text-primary" /> Voz en vivo · Realtime 2.1
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Pregunta lo que quieras sobre Odoo. Para guiarte, Podoo señala el siguiente control en
						tu pantalla.
					</p>
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="size-9 shrink-0"
					onClick={onClose}
					aria-label="Cerrar voz"
				>
					<X className="size-4" />
				</Button>
			</div>
			{guideTarget && (
				<div className="mt-3 rounded-xl border border-primary/30 bg-card p-3" aria-live="polite">
					<p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
						Señalado en Odoo
					</p>
					<p className="mt-1 text-sm font-semibold">{guideTarget.label}</p>
					<p className="mt-1 text-xs text-muted-foreground">{guideTarget.instruction}</p>
				</div>
			)}
			<div className="mt-3 flex items-center gap-2">
				<Button
					type="button"
					className="min-h-11"
					variant={
						status === 'idle' || status === 'error' || status === 'permission'
							? 'default'
							: 'outline'
					}
					onClick={
						status === 'idle' || status === 'error' || status === 'permission'
							? () => void start()
							: stop
					}
				>
					{status === 'connecting' ? (
						<LoaderCircle className="mr-2 size-4 animate-spin" />
					) : status === 'idle' || status === 'error' || status === 'permission' ? (
						<Mic className="mr-2 size-4" />
					) : (
						<MicOff className="mr-2 size-4" />
					)}
					{status === 'idle' || status === 'error' || status === 'permission'
						? 'Iniciar voz'
						: 'Terminar voz'}
				</Button>
				<span className="text-xs text-muted-foreground" role="status">
					{statusLabel(status)}
				</span>
			</div>
			{(caption || lastAnswer) && (
				<p
					className="mt-3 rounded-lg border bg-card p-3 text-sm leading-relaxed"
					aria-live="polite"
				>
					<strong>Podoo:</strong> {caption || lastAnswer}
				</p>
			)}
			{error && (
				<p className="mt-3 flex items-start gap-2 text-xs text-destructive" role="alert">
					<AlertCircle className="size-4 shrink-0" /> {error}
				</p>
			)}
		</section>
	)
}
