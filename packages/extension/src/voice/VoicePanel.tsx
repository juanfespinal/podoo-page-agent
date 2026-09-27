import { AlertCircle, Headphones, LoaderCircle, Mic, MicOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { OdooPageContext } from '@/odoo/context'

import type { AnalyticGuideStep } from './analytic-guide'
import { activeOdooTabId, guideMessage } from './guide-client'
import { voiceInstructions } from './instructions'
import { hasMicrophonePermission, openMicrophonePermissionTab } from './microphone-permission'

type VoiceStatus =
	'idle' | 'permission' | 'connecting' | 'listening' | 'speaking' | 'responding' | 'error'

interface RealtimeEvent {
	type: string
	delta?: string
	transcript?: string
	error?: { message?: string }
}

interface VoicePanelProps {
	context: OdooPageContext
	onClose: () => void
}

function statusLabel(status: VoiceStatus): string {
	switch (status) {
		case 'connecting':
			return 'Conectando la voz…'
		case 'permission':
			return 'Activa el micrófono en la pestaña que abrió Podoo.'
		case 'listening':
			return 'Te escucho. Habla con Podoo.'
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
	const [guideStep, setGuideStep] = useState<AnalyticGuideStep | null>(null)
	const peerRef = useRef<RTCPeerConnection | null>(null)
	const channelRef = useRef<RTCDataChannel | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const audioRef = useRef<HTMLAudioElement>(null)
	const abortRef = useRef<AbortController | null>(null)
	const guideStepRef = useRef<AnalyticGuideStep | null>(null)
	const pendingAnnouncementRef = useRef<AnalyticGuideStep | null>(null)
	const respondingRef = useRef(false)
	const sessionReadyRef = useRef(false)
	const instructionsRef = useRef(voiceInstructions(context, null))
	const guideTabRef = useRef<number | null>(null)

	const announceStep = useCallback(() => {
		const channel = channelRef.current
		const step = pendingAnnouncementRef.current
		if (
			!step ||
			!sessionReadyRef.current ||
			respondingRef.current ||
			channel?.readyState !== 'open'
		)
			return
		pendingAnnouncementRef.current = null
		respondingRef.current = true
		channel.send(
			JSON.stringify({
				type: 'response.create',
				response: {
					output_modalities: ['audio'],
					instructions:
						step.state === 'target'
							? `Di en una sola frase cuál es el control resaltado: ${step.instruction} Luego espera.`
							: `Di brevemente: ${step.instruction} Luego espera.`,
				},
			})
		)
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
		sessionReadyRef.current = false
		respondingRef.current = false
		pendingAnnouncementRef.current = null
		if (audioRef.current) audioRef.current.srcObject = null
	}, [])

	useEffect(() => closeConnection, [closeConnection])
	useEffect(() => {
		let active = true
		let polling = false
		const poll = async () => {
			if (polling) return
			polling = true
			try {
				const tabId = await activeOdooTabId(context.origin)
				if (!active || tabId === null) return
				if (guideTabRef.current !== tabId) {
					if (guideTabRef.current !== null)
						void guideMessage(guideTabRef.current, 'guide_analytic_clear')
					guideTabRef.current = tabId
					await guideMessage(tabId, 'guide_analytic_reset')
				}
				const step = await guideMessage(tabId, 'guide_analytic_step')
				if (!active) return
				const currentStep = step ?? {
					key: 'unavailable',
					label: 'Sin conexión con la pantalla',
					instruction: 'Recarga la pestaña de Odoo y vuelve a abrir la guía.',
					state: 'blocked' as const,
				}
				const previous = guideStepRef.current
				if (
					previous?.key === currentStep.key &&
					previous.label === currentStep.label &&
					previous.instruction === currentStep.instruction
				)
					return
				guideStepRef.current = currentStep
				setGuideStep(currentStep)
				pendingAnnouncementRef.current = currentStep
			} catch {
				if (active) setGuideStep(null)
			} finally {
				polling = false
			}
		}
		void poll()
		const timer = window.setInterval(() => void poll(), 850)
		return () => {
			active = false
			window.clearInterval(timer)
			if (guideTabRef.current !== null)
				void guideMessage(guideTabRef.current, 'guide_analytic_clear')
			guideTabRef.current = null
		}
	}, [context.origin])
	useEffect(() => {
		const nextInstructions = voiceInstructions(context, guideStep)
		if (nextInstructions === instructionsRef.current) return
		instructionsRef.current = nextInstructions
		const channel = channelRef.current
		if (channel?.readyState === 'open') {
			channel.send(
				JSON.stringify({
					type: 'session.update',
					session: { type: 'realtime', instructions: nextInstructions },
				})
			)
		}
	}, [context, guideStep])

	const stop = () => {
		closeConnection()
		setStatus('idle')
		setCaption('')
	}

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
		pendingAnnouncementRef.current = guideStepRef.current
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
				channel.send(
					JSON.stringify({
						type: 'session.update',
						session: {
							type: 'realtime',
							model: 'gpt-realtime-2.1',
							output_modalities: ['audio'],
							instructions: instructionsRef.current,
							audio: {
								input: { turn_detection: { type: 'semantic_vad' } },
								output: { voice: 'marin' },
							},
						},
					})
				)
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
						sessionReadyRef.current = true
						streamRef.current?.getAudioTracks().forEach((track) => {
							track.enabled = true
						})
						setStatus('listening')
						announceStep()
						break
					case 'response.done':
						respondingRef.current = false
						setStatus('listening')
						announceStep()
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
				headers: {
					Authorization: `Bearer ${result.token}`,
					'Content-Type': 'application/sdp',
				},
				body: offer.sdp,
				signal: abort.signal,
			})
			if (!response.ok) {
				throw new Error(`OpenAI rechazó la conexión de voz (${response.status}).`)
			}
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
	}, [status, closeConnection, announceStep])

	useEffect(() => {
		const onMessage = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
			if (
				message.type === 'PODOO_MIC_PERMISSION_GRANTED' &&
				sender.url === chrome.runtime.getURL('mic-permission.html')
			)
				void start()
		}
		chrome.runtime.onMessage.addListener(onMessage)
		return () => chrome.runtime.onMessage.removeListener(onMessage)
	}, [start])

	return (
		<section className="border-b bg-primary/5 px-4 py-4" aria-label="Prueba de voz en vivo">
			<audio ref={audioRef} autoPlay playsInline />
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-sm font-semibold">
						<Headphones className="size-4 text-primary" /> Voz en vivo · Realtime 2.1
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Guía visual para cuentas analíticas. Tú haces clic; Podoo señala el control.
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
			<div className="mt-3 rounded-xl border border-primary/30 bg-card p-3" aria-live="polite">
				<p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
					{guideStep?.state === 'target' ? 'Siguiente clic en Odoo' : 'Guía en Odoo'}
				</p>
				<p className="mt-1 text-sm font-semibold">
					{guideStep?.label ?? 'Preparando el siguiente paso…'}
				</p>
				<p className="mt-1 text-xs text-muted-foreground">{guideStep?.instruction}</p>
			</div>
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
