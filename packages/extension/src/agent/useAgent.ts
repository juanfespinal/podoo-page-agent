/**
 * React hook for using AgentController
 */
import type {
	AgentActivity,
	AgentStatus,
	ExecutionResult,
	HistoricalEvent,
	SupportedLanguage,
} from '@page-agent/core'
import type { LLMConfig } from '@page-agent/llms'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { OdooMode } from '@/odoo/agent-tools'

import { MultiPageAgent } from './MultiPageAgent'
import { DEMO_CONFIG, isTestingEndpoint, migrateLegacyEndpoint } from './constants'

/** Language preference: undefined means follow system */
export type LanguagePreference = SupportedLanguage | undefined

export interface AdvancedConfig {
	maxSteps?: number
	systemInstruction?: string
	experimentalLlmsTxt?: boolean
	experimentalIncludeAllTabs?: boolean
	disableNamedToolChoice?: boolean
	odooMode?: OdooMode
}

export interface ExtConfig extends LLMConfig, AdvancedConfig {
	language?: LanguagePreference
}

export interface UseAgentResult {
	status: AgentStatus
	history: HistoricalEvent[]
	activity: AgentActivity | null
	currentTask: string
	config: ExtConfig | null
	approval: string | null
	taskError: string | null
	execute: (task: string) => Promise<ExecutionResult>
	stop: () => void
	answerApproval: (approved: boolean) => void
	configure: (config: ExtConfig) => Promise<void>
}

export function useAgent(): UseAgentResult {
	const agentRef = useRef<MultiPageAgent | null>(null)
	const [status, setStatus] = useState<AgentStatus>('idle')
	const [history, setHistory] = useState<HistoricalEvent[]>([])
	const [activity, setActivity] = useState<AgentActivity | null>(null)
	const [currentTask, setCurrentTask] = useState('')
	const [config, setConfig] = useState<ExtConfig | null>(null)
	const [approval, setApproval] = useState<string | null>(null)
	const [taskError, setTaskError] = useState<string | null>(null)
	const approvalRef = useRef<{ finish: (approved: boolean) => void } | null>(null)

	const answerApproval = useCallback((approved: boolean) => {
		approvalRef.current?.finish(approved)
	}, [])

	const requestApproval = useCallback((question: string, signal: AbortSignal) => {
		return new Promise<boolean>((resolve) => {
			if (signal.aborted || approvalRef.current) {
				resolve(false)
				return
			}
			const finish = (approved: boolean) => {
				signal.removeEventListener('abort', onAbort)
				approvalRef.current = null
				setApproval(null)
				resolve(approved)
			}
			const onAbort = () => finish(false)
			approvalRef.current = { finish }
			setApproval(question)
			signal.addEventListener('abort', onAbort, { once: true })
		})
	}, [])

	useEffect(() => {
		chrome.storage.local.get(['llmConfig', 'language', 'advancedConfig']).then((result) => {
			let llmConfig = (result.llmConfig as LLMConfig) ?? DEMO_CONFIG
			const language = (result.language as SupportedLanguage) || undefined
			const advancedConfig = (result.advancedConfig as AdvancedConfig) ?? {}

			// Auto-migrate legacy testing endpoints
			const migrated = migrateLegacyEndpoint(llmConfig)
			if (migrated !== llmConfig) {
				llmConfig = migrated
				chrome.storage.local.set({ llmConfig: migrated })
			} else if (!result.llmConfig) {
				chrome.storage.local.set({ llmConfig: DEMO_CONFIG })
			}

			setConfig({ ...llmConfig, ...advancedConfig, language })
		})
	}, [])

	useEffect(() => {
		if (!config) return

		const { systemInstruction, ...agentConfig } = config
		const agent = new MultiPageAgent({
			...agentConfig,
			odooMode: config.odooMode ?? 'explain',
			requestApproval,
			instructions: systemInstruction ? { system: systemInstruction } : undefined,
		})
		agentRef.current = agent

		const handleStatusChange = (e: Event) => {
			const newStatus = agent.status as AgentStatus
			setStatus(newStatus)
			if (newStatus !== 'running') {
				setActivity(null)
			}
		}

		const handleHistoryChange = (e: Event) => {
			setHistory([...agent.history])
		}

		const handleActivity = (e: Event) => {
			const newActivity = (e as CustomEvent).detail as AgentActivity
			setActivity(newActivity)
		}

		agent.addEventListener('statuschange', handleStatusChange)
		agent.addEventListener('historychange', handleHistoryChange)
		agent.addEventListener('activity', handleActivity)

		return () => {
			answerApproval(false)
			agent.removeEventListener('statuschange', handleStatusChange)
			agent.removeEventListener('historychange', handleHistoryChange)
			agent.removeEventListener('activity', handleActivity)
			agent.dispose()
		}
	}, [config, requestApproval, answerApproval])

	const execute = useCallback(
		async (task: string) => {
			const agent = agentRef.current
			if (!agent) throw new Error('Agent not initialized')

			setCurrentTask(task)
			setHistory([])
			setTaskError(null)
			try {
				if (!config || isTestingEndpoint(config.baseURL)) {
					throw new Error(
						'Configure an approved model endpoint in Settings before sending Odoo page data.'
					)
				}
				return await agent.execute(task)
			} catch (error) {
				setTaskError(error instanceof Error ? error.message : String(error))
				throw error
			}
		},
		[config]
	)

	const stop = useCallback(() => {
		answerApproval(false)
		agentRef.current?.stop()
	}, [answerApproval])

	const configure = useCallback(
		async ({
			language,
			maxSteps,
			systemInstruction,
			experimentalLlmsTxt,
			experimentalIncludeAllTabs,
			disableNamedToolChoice,
			odooMode,
			...llmConfig
		}: ExtConfig) => {
			await chrome.storage.local.set({ llmConfig })
			if (language) {
				await chrome.storage.local.set({ language })
			} else {
				await chrome.storage.local.remove('language')
			}
			const advancedConfig: AdvancedConfig = {
				maxSteps,
				systemInstruction,
				experimentalLlmsTxt,
				experimentalIncludeAllTabs,
				disableNamedToolChoice,
				odooMode,
			}
			await chrome.storage.local.set({ advancedConfig })
			setConfig({ ...llmConfig, ...advancedConfig, language })
		},
		[]
	)

	return {
		status,
		history,
		activity,
		currentTask,
		config,
		approval,
		taskError,
		execute,
		stop,
		answerApproval,
		configure,
	}
}
