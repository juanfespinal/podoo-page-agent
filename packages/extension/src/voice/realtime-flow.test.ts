import { describe, expect, it, vi } from 'vitest'

import {
	SpokenTranscript,
	guidanceTurnDetection,
	interruptRealtimeGuidance,
	planRealtimeGuidance,
	shouldCancelGuidanceResponse,
	speakRealtimeGuidance,
} from './realtime-flow'

describe('live guidance pacing', () => {
	it('keeps the model silent while it chooses a control, then speaks only after the highlight succeeds', () => {
		expect(guidanceTurnDetection.create_response).toBe(false)
		expect(guidanceTurnDetection.interrupt_response).toBe(false)
		const plan = planRealtimeGuidance({
			success: true,
			snapshotId: 'screen-1',
			controls: '[4] <button>Empleados</button>',
			fields: [],
		})
		expect(plan.response.output_modalities).toEqual(['text'])
		expect(plan.response.tool_choice).toBe('required')
		expect(plan.response.tools).toHaveLength(1)
		expect(plan.response.tools[0].parameters.properties.mode.enum).toEqual([
			'guide',
			'explain',
			'click',
			'input',
		])
		expect(plan.response.tools[0].parameters.properties.text).toBeDefined()
		expect(JSON.stringify(plan)).toContain('screen-1')
		const spoken = speakRealtimeGuidance('Haz clic en Empleados.')
		expect(spoken.response.output_modalities).toEqual(['audio'])
		expect(spoken.response.tool_choice).toBe('none')
		expect(spoken.response.input).toEqual([])
	})

	it('cancels a delayed response when the person has already spoken or clicked again', () => {
		expect(shouldCancelGuidanceResponse(1, 2, false)).toBe(true)
		expect(shouldCancelGuidanceResponse(2, 2, true)).toBe(true)
		expect(shouldCancelGuidanceResponse(2, 2, false)).toBe(false)
	})
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
