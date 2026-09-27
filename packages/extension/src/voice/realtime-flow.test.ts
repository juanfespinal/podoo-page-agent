import { describe, expect, it, vi } from 'vitest'

import { SpokenTranscript, interruptRealtimeGuidance } from './realtime-flow'

describe('live guidance pacing', () => {
	it('cuts the ongoing explanation and queued WebRTC audio when the person clicks', () => {
		const send = vi.fn()
		interruptRealtimeGuidance(send, { responseInProgress: true, audioPlaying: true })
		expect(send.mock.calls.map(([event]) => event.type)).toEqual([
			'response.cancel',
			'output_audio_buffer.clear',
		])
	})

	it('does not show generated words before audio finishes playing', () => {
		const transcript = new SpokenTranscript()
		transcript.complete('Haz clic en Configuración.')
		expect(transcript.visible).toBe('')
		transcript.playbackStopped()
		expect(transcript.visible).toBe('Haz clic en Configuración.')
	})

	it('discards unspoken transcript after a click interrupts speech', () => {
		const transcript = new SpokenTranscript()
		transcript.complete('Una explicación demasiado larga.')
		transcript.clear()
		transcript.playbackStopped()
		expect(transcript.visible).toBe('')
	})
})
