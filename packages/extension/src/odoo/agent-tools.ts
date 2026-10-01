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

const CONSEQUENTIAL_CLICK =
	/(?:^|[^a-z])(?:confirm(?:ar)?|approve|aprobar|validate|validar|send|enviar|delete|eliminar|unlink|cancel(?:ar)?|post|publicar|publish|pay|pagar|refund|reembolsar|sign|firmar|archive|archivar|registrar[_\s-]?pago|register[_\s-]?payment|facturar|invoice|crear[_\s-]?factura)(?=$|[^a-z])/i

async function verifyIndexedAction(
	agent: PageAgentCore,
	index: number,
	verb: string,
	requestApproval: RequestApproval | undefined,
	{ signal }: ToolContext,
	approveConsequentialClick = false
): Promise<void> {
	signal.throwIfAborted()
	const controller = agent.pageController as typeof agent.pageController & {
		getOdooContext: () => Promise<OdooPageContext | null>
	}
	const screenBefore = await controller.getOdooContext()
	if (!screenBefore) throw new Error('La pestaña actual ya no muestra Odoo.')
	const before = indexedLine((await controller.getBrowserState()).content, index)
	if (!before)
		throw new Error(`El control ${index} ya no está visible. Revisa la pantalla de Odoo.`)
	if (approveConsequentialClick && CONSEQUENTIAL_CLICK.test(before)) {
		if (!requestApproval) throw new Error('Esta acción importante requiere el panel de aprobación.')
		if (!(await requestApproval(`${verb}\n${before}`, signal))) {
			throw new Error('El usuario rechazó esta acción de Odoo.')
		}
	}
	signal.throwIfAborted()
	const screenAfter = await controller.getOdooContext()
	if (JSON.stringify(screenAfter) !== JSON.stringify(screenBefore)) {
		throw new Error('La pantalla de Odoo cambió mientras esperábamos la aprobación.')
	}
	const after = indexedLine((await controller.getBrowserState()).content, index)
	if (after !== before) {
		throw new Error('La página de Odoo cambió mientras esperábamos la aprobación.')
	}
}

/** Explain and guide cannot operate the page. Assist confirms consequential clicks. */
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
			description:
				'Click an Odoo control to complete the requested task. Consequential actions require confirmation in the side panel.',
			inputSchema: z.object({ index: z.int().min(0) }),
			async execute(input: { index: number }, context) {
				await verifyIndexedAction(
					this,
					input.index,
					'Hacer clic en',
					requestApproval,
					context,
					true
				)
				return (await this.pageController.clickElement(input.index)).message
			},
		},
		input_text: {
			description: 'Type into an Odoo field as part of the requested task.',
			inputSchema: z.object({ index: z.int().min(0), text: z.string() }),
			async execute(input: { index: number; text: string }, context) {
				await verifyIndexedAction(
					this,
					input.index,
					`Escribir ${JSON.stringify(input.text)} en`,
					requestApproval,
					context
				)
				return (await this.pageController.inputText(input.index, input.text)).message
			},
		},
		select_dropdown_option: {
			description: 'Select an Odoo option as part of the requested task.',
			inputSchema: z.object({ index: z.int().min(0), text: z.string() }),
			async execute(input: { index: number; text: string }, context) {
				await verifyIndexedAction(
					this,
					input.index,
					`Seleccionar ${JSON.stringify(input.text)} en`,
					requestApproval,
					context
				)
				return (await this.pageController.selectOption(input.index, input.text)).message
			},
		},
	}
}
