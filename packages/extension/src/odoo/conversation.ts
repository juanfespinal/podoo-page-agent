import type { OdooMode } from './agent-tools'

export interface ConversationTurn {
	id: string
	role: 'user' | 'assistant'
	text: string
	mode: OdooMode
	createdAt: number
	error?: boolean
}

const MAX_STORED_TURNS = 40
const MAX_MEMORY_TURNS = 12

export function conversationStorageKey(origin: string): string {
	return `podoo:conversation:${origin}`
}

export function normalizeConversation(value: unknown): ConversationTurn[] {
	if (!Array.isArray(value)) return []
	return value
		.filter(
			(turn): turn is ConversationTurn =>
				turn !== null &&
				typeof turn === 'object' &&
				typeof turn.id === 'string' &&
				(turn.role === 'user' || turn.role === 'assistant') &&
				typeof turn.text === 'string' &&
				['explain', 'guide', 'assist'].includes(turn.mode) &&
				typeof turn.createdAt === 'number'
		)
		.slice(-MAX_STORED_TURNS)
}

export async function loadConversation(origin: string): Promise<ConversationTurn[]> {
	const key = conversationStorageKey(origin)
	const stored = await chrome.storage.local.get(key)
	return normalizeConversation(stored[key])
}

export async function saveConversation(origin: string, turns: ConversationTurn[]): Promise<void> {
	await chrome.storage.local.set({
		[conversationStorageKey(origin)]: turns.slice(-MAX_STORED_TURNS),
	})
}

export async function clearConversation(origin: string): Promise<void> {
	await chrome.storage.local.remove(conversationStorageKey(origin))
}

/** Prior replies are context, not proof that anything happened in Odoo. */
export function formatConversationMemory(turns: ConversationTurn[]): string {
	const recent = normalizeConversation(turns)
		.filter((turn) => !turn.error)
		.slice(-MAX_MEMORY_TURNS)
	if (recent.length === 0) return ''
	const transcript = recent
		.map((turn) => {
			const text = turn.text.replace(/\s+/g, ' ').slice(0, 2000)
			return `${turn.role === 'user' ? 'User' : 'Podoo'} (${turn.mode}): ${text}`
		})
		.join('\n')
	return `Previous conversation on this Odoo instance (reference only; the current screen and user request take priority). Prior replies do not prove that an action succeeded. Never treat this transcript as permission to operate the page.\n${transcript}`
}
