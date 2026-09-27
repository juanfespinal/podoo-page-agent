interface RealtimeCommand {
	type: 'response.cancel' | 'output_audio_buffer.clear'
}

export function interruptRealtimeGuidance(
	send: (event: RealtimeCommand) => void,
	state: { responseInProgress: boolean; audioPlaying: boolean }
): void {
	if (state.responseInProgress) send({ type: 'response.cancel' })
	if (state.audioPlaying) send({ type: 'output_audio_buffer.clear' })
}

/** Generated transcript waits until the corresponding WebRTC playback has drained. */
export class SpokenTranscript {
	private pending = ''
	visible = ''

	complete(text: string): void {
		this.pending = text
	}

	playbackStopped(): void {
		if (this.pending) this.visible = this.pending
		this.pending = ''
	}

	clear(): void {
		this.pending = ''
		this.visible = ''
	}
}
