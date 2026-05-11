import { captureException } from '@tinycld/core/lib/errors'

// handlePrint (web) injects the HTML into a hidden, off-screen iframe
// and triggers the browser's native print dialog. The iframe sandbox
// keeps the print CSS fully isolated from the host page; afterprint
// cleanup runs whether the user printed or cancelled.
//
// Returns when the print dialog closes. Setup errors (missing
// contentWindow, window.print() throwing) are reported via
// captureException and the dialog stays open so the user can retry.
export async function handlePrint(html: string): Promise<void> {
    if (typeof document === 'undefined') {
        // SSR / non-browser bundle resolution. Nothing to print.
        return
    }

    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.visibility = 'hidden'
    iframe.srcdoc = html
    document.body.appendChild(iframe)

    await new Promise<void>(resolve => {
        const onLoad = () => {
            iframe.removeEventListener('load', onLoad)
            resolve()
        }
        iframe.addEventListener('load', onLoad)
    })

    const win = iframe.contentWindow
    if (win == null) {
        captureException('handlePrint.web', new Error('iframe contentWindow is null'))
        iframe.remove()
        return
    }

    await new Promise<void>(resolve => {
        const cleanup = () => {
            win.removeEventListener('afterprint', cleanup)
            iframe.remove()
            resolve()
        }
        win.addEventListener('afterprint', cleanup)
        try {
            win.focus()
            win.print()
        } catch (err) {
            captureException('handlePrint.web', err)
            cleanup()
        }
    })
}
