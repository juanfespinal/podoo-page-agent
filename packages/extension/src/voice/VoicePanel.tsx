import { AlertCircle, Headphones, LoaderCircle, Mic, MicOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type OdooPageContext, companyRulesStorageKey } from '@/odoo/context'

import { activeOdooTabId, guideMessage } from './guide-client'
import type { GuideTarget } from './guide-overlay'
import { voiceInstructions } from './instructions'
import { hasMicrophonePermission, openMicrophonePermissionTab } from './microphone-permission'
import {
	type OdooScreenInspection,
	SpokenTranscript,
	guidanceTurnDetection,
	interruptRealtimeGuidance,
	planRealtimeGuidance,
	shouldCancelGuidanceResponse,
	speakRealtimeGuidance,
} from './realtime-flow'
import { VOICE_MODEL } from './realtime-model'

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
	response_id?: string
	error?: { message?: string }
	response?: {
		id?: string
		status?: string
		output?: { type: string; name?: string; call_id?: string; arguments?: string }[]
	}
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
	const [lastAnswer, setLastAnswer] = useState('')
	const [guideTarget, setGuideTarget] = useState<GuideTarget | null>(null)
	const peerRef = useRef<RTCPeerConnection | null>(null)
	const channelRef = useRef<RTCDataChannel | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const audioRef = useRef<HTMLAudioElement>(null)
	const abortRef = useRef<AbortController | null>(null)
	const guideTabRef = useRef<number | null>(null)
	const respondingRef = useRef(false)
	const toolProcessingRef = useRef(false)
	const audioPlayingRef = useRef(false)
	const playingResponseIdRef = useRef<string | null>(null)
	const userSpeakingRef = useRef(false)
	const pendingProgressRef = useRef(false)
	const progressTimerRef = useRef<number | null>(null)
	const activeResponseIdRef = useRef<string | null>(null)
	const interruptedResponseIdsRef = useRef(new Set<string>())
	const suppressCaptionRef = useRef(false)
	const transcriptRef = useRef(new SpokenTranscript())
	const transcriptResponseIdRef = useRef<string | null>(null)
	const guideEpochRef = useRef(0)
	const responseEpochRef = useRef(0)
	const decisionPendingRef = useRef(false)
	const guideRetriesRef = useRef(0)
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
		toolProcessingRef.current = false
		audioPlayingRef.current = false
		playingResponseIdRef.current = null
		userSpeakingRef.current = false
		pendingProgressRef.current = false
		if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current)
		progressTimerRef.current = null
		activeResponseIdRef.current = null
		interruptedResponseIdsRef.current.clear()
		transcriptRef.current.clear()
		transcriptResponseIdRef.current = null
		guideEpochRef.current++
		responseEpochRef.current = guideEpochRef.current
		decisionPendingRef.current = false
		guideRetriesRef.current = 0
		if (audioRef.current) audioRef.current.srcObject = null
		if (guideTabRef.current !== null) void guideMessage(guideTabRef.current, 'guide_clear')
		guideTabRef.current = null
		setGuideTarget(null)
		setLastAnswer('')
	}, [])

	useEffect(() => closeConnection, [closeConnection])

	const interruptGuidance = useCallback(() => {
		if (activeResponseIdRef.current)
			interruptedResponseIdsRef.current.add(activeResponseIdRef.current)
		if (playingResponseIdRef.current)
			interruptedResponseIdsRef.current.add(playingResponseIdRef.current)
		interruptRealtimeGuidance(send, {
			responseInProgress: activeResponseIdRef.current !== null,
			audioPlaying: audioPlayingRef.current,
		})
		audioPlayingRef.current = false
		playingResponseIdRef.current = null
		transcriptRef.current.clear()
		transcriptResponseIdRef.current = null
		suppressCaptionRef.current = true
		setLastAnswer('')
	}, [send])

	const startGuideTurn = useCallback(async () => {
		const epoch = guideEpochRef.current
		respondingRef.current = true
		setStatus('responding')
		try {
			const tabId = await activeOdooTabId(contextRef.current.origin)
			if (tabId !== null) guideTabRef.current = tabId
			const screen: OdooScreenInspection =
				tabId === null
					? { success: false, error: 'La pestaña de Odoo no está abierta.' }
					: ((await guideMessage(tabId, 'guide_inspect')) as unknown as OdooScreenInspection)
			if (epoch !== guideEpochRef.current || userSpeakingRef.current) {
				respondingRef.current = false
				return
			}
			setGuideTarget(null)
			decisionPendingRef.current = true
			responseEpochRef.current = epoch
			send(planRealtimeGuidance(screen))
		} catch (cause) {
			respondingRef.current = false
			if (epoch !== guideEpochRef.current) return
			setError(cause instanceof Error ? cause.message : String(cause))
			setStatus('listening')
		}
	}, [send])

	const scheduleProgress = useCallback(
		(delay = 350) => {
			if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current)
			const attempt = () => {
				if (!pendingProgressRef.current || channelRef.current?.readyState !== 'open') return
				if (userSpeakingRef.current || respondingRef.current || toolProcessingRef.current) {
					progressTimerRef.current = window.setTimeout(attempt, 100)
					return
				}
				pendingProgressRef.current = false
				void startGuideTurn()
			}
			progressTimerRef.current = window.setTimeout(attempt, delay)
		},
		[startGuideTurn]
	)

	const callTool = useCallback(async (call: FunctionCall): Promise<Record<string, unknown>> => {
		if (call.name !== 'choose_odoo_response')
			return { success: false, error: `Unknown tool: ${call.name}` }
		let args: Record<string, unknown>
		try {
			args = JSON.parse(call.arguments || '{}') as Record<string, unknown>
		} catch {
			return { success: false, error: 'Invalid tool arguments.' }
		}
		if (args.mode === 'explain') {
			if (typeof args.speech !== 'string' || !args.speech.trim())
				return { success: false, error: 'A spoken answer is required.' }
			const tabId = guideTabRef.current
			setGuideTarget(null)
			if (tabId !== null) await guideMessage(tabId, 'guide_clear')
			return { success: true, speech: args.speech.trim().slice(0, 1200) }
		}
		if (args.mode === 'guide') {
			const tabId = guideTabRef.current
			if (tabId === null) return { success: false, error: 'Open the Odoo tab.' }
			const result = await guideMessage(tabId, 'guide_highlight', [
				{
					snapshotId: args.snapshot_id,
					index: args.index,
					label: args.label,
					instruction: args.instruction,
				},
			])
			if (result.success === true) {
				setGuideTarget({
					key: `${args.snapshot_id}:${args.index}`,
					label: String(result.label),
					instruction: String(result.instruction),
				})
				return { ...result, speech: String(result.instruction).slice(0, 220) }
			}
			return result
		}
		return { success: false, error: 'Invalid response mode.' }
	}, [])

	const finishResponse = useCallback(
		async (event: RealtimeEvent) => {
			if (
				event.response?.id &&
				activeResponseIdRef.current &&
				event.response.id !== activeResponseIdRef.current
			)
				return
			if (
				shouldCancelGuidanceResponse(
					responseEpochRef.current,
					guideEpochRef.current,
					userSpeakingRef.current
				)
			) {
				respondingRef.current = false
				activeResponseIdRef.current = null
				decisionPendingRef.current = false
				setStatus(userSpeakingRef.current ? 'speaking' : 'listening')
				return
			}
			const wasDecision = decisionPendingRef.current
			decisionPendingRef.current = false
			respondingRef.current = false
			activeResponseIdRef.current = null
			if (event.response?.status === 'cancelled') {
				setStatus(audioPlayingRef.current ? 'responding' : 'listening')
				return
			}
			const calls = (event.response?.output ?? []).filter(
				(item): item is FunctionCall =>
					item.type === 'function_call' &&
					typeof item.name === 'string' &&
					typeof item.call_id === 'string' &&
					typeof item.arguments === 'string'
			)
			if (calls.length) {
				setStatus('responding')
				toolProcessingRef.current = true
				const epoch = guideEpochRef.current
				let speech: string | null = null
				for (const [position, call] of calls.entries()) {
					let result: Record<string, unknown>
					if (
						position > 0 ||
						pendingProgressRef.current ||
						event.response?.status === 'cancelled' ||
						interruptedResponseIdsRef.current.has(event.response?.id ?? '')
					) {
						result = {
							success: false,
							error:
								position > 0
									? 'Choose only one control at a time.'
									: 'The person already moved on. Inspect the new screen.',
						}
					} else {
						try {
							result = await callTool(call)
						} catch (error) {
							result = {
								success: false,
								error: error instanceof Error ? error.message : String(error),
							}
						}
						if (epoch !== guideEpochRef.current) {
							if (guideTabRef.current !== null)
								void guideMessage(guideTabRef.current, 'guide_clear')
							setGuideTarget(null)
							result = {
								success: false,
								error: 'The person already moved on. Inspect the new screen.',
							}
						}
					}
					if (result.success === true && typeof result.speech === 'string') speech = result.speech
					send({
						type: 'conversation.item.create',
						item: {
							type: 'function_call_output',
							call_id: call.call_id,
							output: JSON.stringify(result),
						},
					})
				}
				toolProcessingRef.current = false
				if (
					!pendingProgressRef.current &&
					epoch === guideEpochRef.current &&
					event.response?.status !== 'cancelled' &&
					!interruptedResponseIdsRef.current.has(event.response?.id ?? '') &&
					channelRef.current?.readyState === 'open'
				) {
					if (speech) {
						guideRetriesRef.current = 0
						respondingRef.current = true
						responseEpochRef.current = epoch
						send(speakRealtimeGuidance(speech))
					} else if (wasDecision && guideRetriesRef.current < 2) {
						guideRetriesRef.current++
						pendingProgressRef.current = true
						scheduleProgress(100)
					} else {
						setError(
							'No pude ubicar el siguiente control en esta pantalla. Puedes intentarlo de nuevo.'
						)
						setStatus('listening')
					}
				}
				return
			}
			if (wasDecision && guideRetriesRef.current < 2) {
				guideRetriesRef.current++
				pendingProgressRef.current = true
				scheduleProgress(100)
				return
			}
			if (wasDecision)
				setError('No pude decidir un paso seguro en esta pantalla. Puedes intentarlo de nuevo.')
			setStatus(audioPlayingRef.current ? 'responding' : 'listening')
		},
		[callTool, scheduleProgress, send]
	)

	const start = useCallback(async () => {
		if (status === 'connecting' || peerRef.current) return
		setError(null)
		setLastAnswer('')
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
						model: VOICE_MODEL,
						output_modalities: ['audio'],
						instructions: voiceInstructions(contextRef.current, companyRules),
						audio: {
							input: { turn_detection: guidanceTurnDetection },
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
						guideEpochRef.current++
						userSpeakingRef.current = true
						pendingProgressRef.current = false
						if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current)
						interruptGuidance()
						setStatus('speaking')
						break
					case 'input_audio_buffer.speech_stopped':
						userSpeakingRef.current = false
						setStatus('responding')
						break
					case 'input_audio_buffer.committed':
						guideRetriesRef.current = 0
						pendingProgressRef.current = true
						scheduleProgress(0)
						break
					case 'response.created':
						respondingRef.current = true
						activeResponseIdRef.current = event.response?.id ?? null
						if (
							shouldCancelGuidanceResponse(
								responseEpochRef.current,
								guideEpochRef.current,
								userSpeakingRef.current
							)
						) {
							if (event.response?.id) interruptedResponseIdsRef.current.add(event.response.id)
							send({ type: 'response.cancel' })
							break
						}
						suppressCaptionRef.current = false
						transcriptRef.current.clear()
						transcriptResponseIdRef.current = null
						setLastAnswer('')
						setStatus('responding')
						break
					case 'output_audio_buffer.started':
						audioPlayingRef.current = true
						playingResponseIdRef.current = event.response_id ?? null
						setStatus('responding')
						break
					case 'output_audio_buffer.stopped':
						if (
							event.response_id &&
							playingResponseIdRef.current &&
							event.response_id !== playingResponseIdRef.current
						)
							break
						audioPlayingRef.current = false
						playingResponseIdRef.current = null
						if (
							!suppressCaptionRef.current &&
							!interruptedResponseIdsRef.current.has(event.response_id ?? '') &&
							(!transcriptResponseIdRef.current ||
								!event.response_id ||
								transcriptResponseIdRef.current === event.response_id)
						) {
							transcriptRef.current.playbackStopped()
							setLastAnswer(transcriptRef.current.visible)
						}
						if (!respondingRef.current) setStatus('listening')
						break
					case 'output_audio_buffer.cleared':
						if (
							event.response_id &&
							playingResponseIdRef.current &&
							event.response_id !== playingResponseIdRef.current
						)
							break
						audioPlayingRef.current = false
						playingResponseIdRef.current = null
						transcriptRef.current.clear()
						transcriptResponseIdRef.current = null
						setLastAnswer('')
						if (!respondingRef.current) setStatus('listening')
						break
					case 'response.output_audio_transcript.delta':
						break
					case 'response.output_audio_transcript.done':
						if (
							!suppressCaptionRef.current &&
							!interruptedResponseIdsRef.current.has(event.response_id ?? '')
						) {
							transcriptRef.current.complete(event.transcript ?? '')
							transcriptResponseIdRef.current = event.response_id ?? null
						}
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
	}, [status, closeConnection, finishResponse, interruptGuidance, scheduleProgress, send])

	useEffect(() => {
		const onMessage = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
			if (
				message.type === 'PODOO_MIC_PERMISSION_GRANTED' &&
				sender.url === chrome.runtime.getURL('mic-permission.html')
			)
				void start()
			if (
				(message.type === 'PODOO_GUIDE_TARGET_USED' ||
					message.type === 'PODOO_GUIDE_TARGET_ENGAGED') &&
				sender.tab?.id === guideTabRef.current
			) {
				guideEpochRef.current++
				if (message.type === 'PODOO_GUIDE_TARGET_USED') {
					guideRetriesRef.current = 0
					pendingProgressRef.current = true
				}
				interruptGuidance()
				if (message.type !== 'PODOO_GUIDE_TARGET_USED') return
				setGuideTarget(null)
				scheduleProgress(450)
			}
		}
		chrome.runtime.onMessage.addListener(onMessage)
		return () => chrome.runtime.onMessage.removeListener(onMessage)
	}, [start, interruptGuidance, scheduleProgress])

	const stop = () => {
		closeConnection()
		setStatus('idle')
	}

	return (
		<section className="border-b bg-primary/5 px-4 py-4" aria-label="Voz en vivo">
			<audio ref={audioRef} autoPlay playsInline />
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-sm font-semibold">
						<Headphones className="size-4 text-primary" /> Voz en vivo · Realtime 2.1 mini
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
			{lastAnswer && (
				<p
					className="mt-3 rounded-lg border bg-card p-3 text-sm leading-relaxed"
					aria-live="polite"
				>
					<strong>Podoo:</strong> {lastAnswer}
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
