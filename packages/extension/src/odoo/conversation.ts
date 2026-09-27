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

/** Reuse actual chat roles; prior assistant replies do not prove Odoo actions succeeded. */
export function toConversationMessages(
	turns: ConversationTurn[]
): { role: 'user' | 'assistant'; content: string }[] {
	const recent = normalizeConversation(turns)
		.filter((turn) => !turn.error)
		.slice(-MAX_MEMORY_TURNS)
	return recent.map((turn) => ({ role: turn.role, content: turn.text.slice(0, 2000) }))
}
