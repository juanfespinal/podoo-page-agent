import { VOICE_MODEL } from './realtime-model'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

interface StoredLlmConfig {
	apiKey?: string
	baseURL?: string
}

export async function mintRealtimeToken(
	config: StoredLlmConfig,
	fetcher: typeof fetch = fetch
): Promise<string> {
	if (config.baseURL?.replace(/\/+$/, '') !== OPENAI_BASE_URL) {
		throw new Error('La prueba de voz requiere la URL https://api.openai.com/v1 en Configuración.')
	}
	if (!config.apiKey?.trim()) {
		throw new Error('Configura tu clave de OpenAI para probar la voz en vivo.')
	}

	const response = await fetcher(`${OPENAI_BASE_URL}/realtime/client_secrets`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${config.apiKey.trim()}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			session: {
				type: 'realtime',
				model: VOICE_MODEL,
				output_modalities: ['audio'],
				audio: { output: { voice: 'marin' } },
			},
		}),
	})
	const data = (await response.json()) as { value?: unknown; error?: { message?: string } }
	if (!response.ok) {
		throw new Error(data.error?.message || `OpenAI rechazó la sesión de voz (${response.status}).`)
	}
	if (typeof data.value !== 'string' || !data.value) {
		throw new Error('OpenAI no devolvió una credencial temporal para la sesión de voz.')
	}
	return data.value
}
