import type { PageAgentCore, PageAgentTool, ToolContext } from '@page-agent/core'
import * as z from 'zod/v4'

import type { OdooPageContext } from './context'

export type OdooMode = 'explain' | 'guide' | 'assist'
export type RequestApproval = (question: string, signal: AbortSignal) => Promise<boolean>

const DISABLED_TOOLS: Record<string, null> = {
	open_new_tab: null,
	switch_to_tab: null,
	close_tab: null,
}

function indexedLine(content: string, index: number): string | null {
	const marker = new RegExp(`\\[${index}\\](?!\\d)`)
	return (
		content
			.split('\n')
			.find((line) => marker.test(line))
			?.trim() ?? null
	)
}

async function approveIndexedAction(
	agent: PageAgentCore,
	index: number,
	verb: string,
	requestApproval: RequestApproval | undefined,
	{ signal }: ToolContext
): Promise<void> {
	if (!requestApproval) throw new Error('Assisted actions require the Podoo approval panel.')
	const controller = agent.pageController as typeof agent.pageController & {
		getOdooContext: () => Promise<OdooPageContext | null>
	}
	const screenBefore = await controller.getOdooContext()
	if (!screenBefore) throw new Error('The current tab is no longer an Odoo web client.')
	const before = indexedLine((await controller.getBrowserState()).content, index)
	if (!before)
		throw new Error(`Control ${index} is no longer visible. Observe the Odoo page again.`)
	if (!(await requestApproval(`${verb}\n${before}`, signal))) {
		throw new Error('The user declined this Odoo action.')
	}
	signal.throwIfAborted()
	const screenAfter = await controller.getOdooContext()
	if (JSON.stringify(screenAfter) !== JSON.stringify(screenBefore)) {
		throw new Error('The Odoo screen changed while approval was pending. Observe it again.')
	}
	const after = indexedLine((await controller.getBrowserState()).content, index)
	if (after !== before) {
		throw new Error('The Odoo page changed while approval was pending. Observe it again.')
	}
}

/** Explain and guide cannot operate the page. Assist asks before every edit or click. */
export function createOdooToolOverrides(
	mode: OdooMode,
	requestApproval?: RequestApproval
): Record<string, PageAgentTool | null> {
	if (mode !== 'assist') {
		return {
			...DISABLED_TOOLS,
			click_element_by_index: null,
			input_text: null,
			select_dropdown_option: null,
			scroll: null,
			scroll_horizontally: null,
		}
	}

	return {
		...DISABLED_TOOLS,
		click_element_by_index: {
			description: 'Click an Odoo control after the user approves the exact target.',
			inputSchema: z.object({ index: z.int().min(0) }),
			async execute(input: { index: number }, context) {
				await approveIndexedAction(this, input.index, 'Click', requestApproval, context)
				return (await this.pageController.clickElement(input.index)).message
			},
		},
		input_text: {
			description: 'Type into an Odoo field after the user approves the field and value.',
			inputSchema: z.object({ index: z.int().min(0), text: z.string() }),
			async execute(input: { index: number; text: string }, context) {
				await approveIndexedAction(
					this,
					input.index,
					`Type ${JSON.stringify(input.text)} into`,
					requestApproval,
					context
				)
				return (await this.pageController.inputText(input.index, input.text)).message
			},
		},
		select_dropdown_option: {
			description: 'Select an Odoo option after the user approves the control and option.',
			inputSchema: z.object({ index: z.int().min(0), text: z.string() }),
			async execute(input: { index: number; text: string }, context) {
				await approveIndexedAction(
					this,
					input.index,
					`Select ${JSON.stringify(input.text)} in`,
					requestApproval,
					context
				)
				return (await this.pageController.selectOption(input.index, input.text)).message
			},
		},
	}
}
