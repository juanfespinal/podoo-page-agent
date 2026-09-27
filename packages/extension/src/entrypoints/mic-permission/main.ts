const button = document.querySelector<HTMLButtonElement>('#allow')!
const status = document.querySelector<HTMLParagraphElement>('#status')!

button.addEventListener('click', async () => {
	button.disabled = true
	status.textContent = 'Esperando el permiso de Chrome…'
	let stream: MediaStream
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: true })
	} catch (error) {
		status.textContent =
			error instanceof DOMException && error.name === 'NotAllowedError'
				? 'Chrome bloqueó el micrófono. Revisa el permiso de esta pestaña en el icono junto a la dirección y vuelve a intentarlo.'
				: `No se pudo activar el micrófono: ${error instanceof Error ? error.message : String(error)}`
		button.disabled = false
		return
	}
	stream.getTracks().forEach((track) => track.stop())
	status.textContent = 'Micrófono activado. Volviendo a Podoo…'
	try {
		await chrome.runtime.sendMessage({ type: 'PODOO_MIC_PERMISSION_GRANTED' })
		const tab = await chrome.tabs.getCurrent()
		if (tab?.id !== undefined) await chrome.tabs.remove(tab.id)
	} catch {
		status.textContent = 'Micrófono activado. Vuelve a Podoo y pulsa Iniciar voz.'
	}
})
