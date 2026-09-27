import { ArrowLeft, ChevronDown, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { DEMO_BASE_URL, DEMO_MODEL, isTestingEndpoint } from '@/agent/constants'
import type { ExtConfig, LanguagePreference } from '@/agent/useAgent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ConfigPanelProps {
	config: ExtConfig | null
	onSave: (config: ExtConfig) => Promise<void>
	onClose: () => void
}

export function ConfigPanel({ config, onSave, onClose }: ConfigPanelProps) {
	const [baseURL, setBaseURL] = useState(config?.baseURL || DEMO_BASE_URL)
	const [model, setModel] = useState(config?.model || DEMO_MODEL)
	const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
	const [language, setLanguage] = useState<LanguagePreference>(config?.language)
	const [maxSteps, setMaxSteps] = useState(config?.maxSteps)
	const [systemInstruction, setSystemInstruction] = useState(config?.systemInstruction ?? '')
	const [disableNamedToolChoice, setDisableNamedToolChoice] = useState(
		config?.disableNamedToolChoice ?? false
	)
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const [saving, setSaving] = useState(false)
	const [showApiKey, setShowApiKey] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)

	const handleSave = async () => {
		setSaving(true)
		setSaveError(null)
		try {
			await onSave({
				apiKey,
				baseURL: baseURL.trim(),
				model: model.trim(),
				language,
				maxSteps: maxSteps || undefined,
				systemInstruction: systemInstruction || undefined,
				disableNamedToolChoice,
				odooMode: config?.odooMode ?? 'explain',
			})
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : 'No se pudo guardar la configuración.')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="podoo-panel flex h-screen flex-col overflow-y-auto bg-background text-foreground">
			<header className="flex items-center gap-3 border-b bg-card px-4 py-4">
				<Button
					variant="ghost"
					size="icon"
					className="size-10 cursor-pointer"
					onClick={onClose}
					aria-label="Volver al chat"
				>
					<ArrowLeft className="size-4" />
				</Button>
				<div>
					<h1 className="text-base font-semibold">Configuración</h1>
					<p className="text-xs text-muted-foreground">Conecta el modelo que usará Podoo</p>
				</div>
			</header>
			<main className="flex-1 space-y-5 p-4">
				<div className="rounded-xl border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
					<ShieldCheck className="mr-1 inline size-4 align-text-bottom text-primary" /> Tu clave se
					guarda en este navegador. Podoo enviará el contenido de la pantalla al proveedor que
					configures.
				</div>
				<div className="space-y-2">
					<label htmlFor="base-url" className="block text-sm font-medium">
						URL de la API
					</label>
					<Input
						id="base-url"
						placeholder="https://api.openai.com/v1"
						value={baseURL}
						onChange={(event) => setBaseURL(event.target.value)}
						className="h-11 text-sm"
					/>
					<p className="text-xs text-muted-foreground">
						Usa la URL base del proveedor de tu modelo.
					</p>
				</div>
				{isTestingEndpoint(baseURL) && (
					<p
						role="alert"
						className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
					>
						Configura tu propio proveedor antes de enviar datos de Odoo. El endpoint de prueba no
						está habilitado para este uso.
					</p>
				)}
				<div className="space-y-2">
					<label htmlFor="model" className="block text-sm font-medium">
						Modelo
					</label>
					<Input
						id="model"
						placeholder="gpt-6-luna"
						value={model}
						onChange={(event) => setModel(event.target.value)}
						className="h-11 text-sm"
					/>
				</div>
				<div className="space-y-2">
					<label htmlFor="api-key" className="block text-sm font-medium">
						Clave de API
					</label>
					<div className="flex gap-2">
						<Input
							id="api-key"
							type={showApiKey ? 'text' : 'password'}
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
							className="h-11 text-sm"
							autoComplete="off"
						/>
						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-11 shrink-0 cursor-pointer"
							onClick={() => setShowApiKey((visible) => !visible)}
							aria-label={showApiKey ? 'Ocultar clave' : 'Mostrar clave'}
						>
							{showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
						</Button>
					</div>
				</div>
				<div className="space-y-2">
					<label htmlFor="language" className="block text-sm font-medium">
						Idioma de respuesta
					</label>
					<select
						id="language"
						value={language ?? ''}
						onChange={(event) =>
							setLanguage((event.target.value || undefined) as LanguagePreference)
						}
						className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
					>
						<option value="">Seguir el idioma de la conversación</option>
						<option value="es-ES">Español</option>
						<option value="en-US">English</option>
						<option value="zh-CN">中文</option>
					</select>
				</div>
				<div className="rounded-xl border bg-card">
					<button
						type="button"
						onClick={() => setAdvancedOpen((open) => !open)}
						aria-expanded={advancedOpen}
						className="flex min-h-12 w-full items-center justify-between px-4 text-left text-sm font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
					>
						Opciones avanzadas{' '}
						<ChevronDown
							className={`size-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
						/>
					</button>
					{advancedOpen && (
						<div className="space-y-4 border-t p-4">
							<div className="space-y-2">
								<label htmlFor="max-steps" className="block text-sm font-medium">
									Máximo de pasos por tarea
								</label>
								<Input
									id="max-steps"
									type="number"
									min={1}
									max={200}
									value={maxSteps ?? ''}
									onChange={(event) =>
										setMaxSteps(event.target.value ? Number(event.target.value) : undefined)
									}
									className="h-11 text-sm"
								/>
							</div>
							<div className="space-y-2">
								<label htmlFor="system-instruction" className="block text-sm font-medium">
									Instrucciones adicionales
								</label>
								<textarea
									id="system-instruction"
									value={systemInstruction}
									onChange={(event) => setSystemInstruction(event.target.value)}
									rows={3}
									className="w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
									placeholder="Ej.: Responde con ejemplos del equipo comercial."
								/>
							</div>
							<label className="flex items-center gap-3 text-sm">
								<input
									type="checkbox"
									checked={disableNamedToolChoice}
									onChange={(event) => setDisableNamedToolChoice(event.target.checked)}
									className="size-4 accent-primary"
								/>{' '}
								Desactivar selección de herramienta por nombre
							</label>
						</div>
					)}
				</div>
				{saveError && (
					<p role="alert" className="text-sm text-destructive">
						{saveError}
					</p>
				)}
			</main>
			<footer className="border-t bg-card p-4">
				<Button
					onClick={() => void handleSave()}
					disabled={saving || !baseURL.trim() || !model.trim()}
					className="min-h-11 w-full cursor-pointer"
				>
					{saving ? <LoaderCircle className="size-4 animate-spin" /> : 'Guardar configuración'}
				</Button>
			</footer>
		</div>
	)
}
