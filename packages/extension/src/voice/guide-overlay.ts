import type { AnalyticGuideStep } from './analytic-guide'

/** A passive, leased coachmark. It does not intercept clicks on Odoo. */
export class GuideOverlay {
	private host: HTMLDivElement | null = null
	private ring: HTMLDivElement | null = null
	private bubble: HTMLDivElement | null = null
	private target: HTMLElement | null = null
	private key = ''
	private refreshedAt = 0
	private timer: number | null = null
	private onClick: ((event: MouseEvent) => void) | null = null

	show(step: AnalyticGuideStep, element: HTMLElement, onTargetClick: () => void): void {
		this.refreshedAt = Date.now()
		if (this.target === element && this.key === step.key && this.host?.isConnected) return
		this.clear()
		this.target = element
		this.key = step.key
		this.refreshedAt = Date.now()

		const host = document.createElement('div')
		host.setAttribute('data-podoo-guide', '')
		host.style.cssText =
			'position:fixed;inset:0;z-index:2147483645;pointer-events:none;overflow:visible'
		const shadow = host.attachShadow({ mode: 'open' })
		const ring = document.createElement('div')
		ring.style.cssText =
			'position:fixed;box-sizing:border-box;border:3px solid #0d8b69;border-radius:10px;box-shadow:0 0 0 5px rgba(13,139,105,.2),0 8px 28px rgba(10,60,48,.2);pointer-events:none;transition:top .16s,left .16s,width .16s,height .16s'
		const bubble = document.createElement('div')
		bubble.style.cssText =
			'position:fixed;max-width:min(290px,calc(100vw - 24px));box-sizing:border-box;padding:10px 13px;border-radius:11px;background:#123d33;color:white;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.24);pointer-events:none'
		bubble.textContent = `Podoo · ${step.label}: ${step.instruction}`
		shadow.append(ring, bubble)
		document.documentElement.append(host)
		this.host = host
		this.ring = ring
		this.bubble = bubble
		element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
		this.position()
		this.onClick = (event) => {
			if (this.target && event.target instanceof Node && this.target.contains(event.target)) {
				onTargetClick()
			}
		}
		document.addEventListener('click', this.onClick, true)
		this.timer = window.setInterval(() => {
			if (Date.now() - this.refreshedAt > 3000 || !this.target?.isConnected) {
				this.clear()
				return
			}
			this.position()
		}, 150)
	}

	clear(): void {
		if (this.timer !== null) window.clearInterval(this.timer)
		if (this.onClick) document.removeEventListener('click', this.onClick, true)
		this.host?.remove()
		this.host = null
		this.ring = null
		this.bubble = null
		this.target = null
		this.key = ''
		this.timer = null
		this.onClick = null
	}

	private position(): void {
		if (!this.target || !this.ring || !this.bubble) return
		const rect = this.target.getBoundingClientRect()
		this.ring.style.top = `${Math.max(0, rect.top - 4)}px`
		this.ring.style.left = `${Math.max(0, rect.left - 4)}px`
		this.ring.style.width = `${rect.width + 8}px`
		this.ring.style.height = `${rect.height + 8}px`
		const bubbleWidth = Math.min(290, window.innerWidth - 24)
		const left = Math.min(Math.max(12, rect.left), window.innerWidth - bubbleWidth - 12)
		const below = rect.bottom + 62 < window.innerHeight
		this.bubble.style.left = `${left}px`
		this.bubble.style.top = below ? `${rect.bottom + 12}px` : `${Math.max(12, rect.top - 70)}px`
	}
}
