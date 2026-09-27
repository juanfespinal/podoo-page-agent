import { AlertCircle, Headphones, LoaderCircle, Mic, MicOff, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { OdooPageContext } from '@/odoo/context'

import { voiceInstructions } from './instructions'

type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'responding' | 'error'

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
	const peerRef = useRef<RTCPeerConnection | null>(null)
	const channelRef = useRef<RTCDataChannel | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const audioRef = useRef<HTMLAudioElement>(null)
	const abortRef = useRef<AbortController | null>(null)
	const instructionsRef = useRef(voiceInstructions(context))

	const closeConnection = useCallback(() => {
		abortRef.current?.abort()
		abortRef.current = null
		channelRef.current?.close()
		channelRef.current = null
		peerRef.current?.close()
		peerRef.current = null
		streamRef.current?.getTracks().forEach((track) => track.stop())
		streamRef.current = null
		if (audioRef.current) audioRef.current.srcObject = null
	}, [])

	useEffect(() => closeConnection, [closeConnection])
	useEffect(() => {
		const nextInstructions = voiceInstructions(context)
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
	}, [context])

	const stop = () => {
		closeConnection()
		setStatus('idle')
		setCaption('')
	}

	const start = async () => {
		if (status === 'connecting' || peerRef.current) return
		setError(null)
		setCaption('')
		setStatus('connecting')
		const abort = new AbortController()
		abortRef.current = abort
		try {
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

			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true },
			})
			if (abort.signal.aborted) {
				stream.getTracks().forEach((track) => track.stop())
				return
			}
			streamRef.current = stream
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
						streamRef.current?.getAudioTracks().forEach((track) => {
							track.enabled = true
						})
						setStatus('listening')
						break
					case 'response.done':
						setStatus('listening')
						break
					case 'input_audio_buffer.speech_started':
						setStatus('speaking')
						break
					case 'input_audio_buffer.speech_stopped':
					case 'response.created':
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
			setError(cause instanceof Error ? cause.message : String(cause))
			setStatus('error')
			closeConnection()
		}
	}

	return (
		<section className="border-b bg-primary/5 px-4 py-4" aria-label="Prueba de voz en vivo">
			<audio ref={audioRef} autoPlay playsInline />
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-sm font-semibold">
						<Headphones className="size-4 text-primary" /> Voz en vivo · Realtime 2.1
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						Prueba explicativa: conversa sobre cuentas analíticas. La voz no modifica Odoo.
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
			<div className="mt-3 flex items-center gap-2">
				<Button
					type="button"
					className="min-h-11"
					variant={status === 'idle' || status === 'error' ? 'default' : 'outline'}
					onClick={status === 'idle' || status === 'error' ? () => void start() : stop}
				>
					{status === 'connecting' ? (
						<LoaderCircle className="mr-2 size-4 animate-spin" />
					) : status === 'idle' || status === 'error' ? (
						<Mic className="mr-2 size-4" />
					) : (
						<MicOff className="mr-2 size-4" />
					)}
					{status === 'idle' || status === 'error' ? 'Iniciar voz' : 'Terminar voz'}
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
