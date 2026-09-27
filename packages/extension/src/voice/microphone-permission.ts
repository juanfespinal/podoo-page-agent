export async function hasMicrophonePermission(
	permissions: Pick<Permissions, 'query'> = navigator.permissions
): Promise<boolean> {
	try {
		const permission = await permissions.query({ name: 'microphone' as PermissionName })
		return permission.state === 'granted'
	} catch {
		return false
	}
}

export async function openMicrophonePermissionTab(
	tabs: Pick<typeof chrome.tabs, 'create'> = chrome.tabs
): Promise<void> {
	await tabs.create({ url: chrome.runtime.getURL('mic-permission.html'), active: true })
}
