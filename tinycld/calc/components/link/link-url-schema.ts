import { z } from '@tinycld/core/ui/form'

export const INVALID_LINK_ERROR = 'Enter a valid link, like https://example.com'

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

// Web links need a host with at least one dot (or localhost).
const WEB_LINK =
    /^(?:https?|ftps?):\/\/(?:[^\s/?#@]+@)?(?:localhost|[^\s/?#:@.]+(?:\.[^\s/?#:@.]+)+)(?::\d+)?(?:[/?#]\S*)?$/i
const OTHER_LINK = /^(?:mailto|tel):\S+$/i
// A place in this workbook, as the xlsx import stores it ("#Sheet2!A1").
const WORKBOOK_LINK = /^#\S+$/

// A bare "example.com" is a web address the user typed without a
// scheme; give it https:// so opening it does not resolve against
// this site.
export function normalizeLinkUrl(raw: string) {
    if (raw === '' || raw.startsWith('#') || HAS_SCHEME.test(raw)) return raw
    return `https://${raw}`
}

function isValidLinkUrl(url: string) {
    return url === '' || WEB_LINK.test(url) || OTHER_LINK.test(url) || WORKBOOK_LINK.test(url)
}

// An empty URL is valid: it tells the caller to remove the link.
export const linkUrlSchema = z.object({
    url: z.string().trim().transform(normalizeLinkUrl).refine(isValidLinkUrl, INVALID_LINK_ERROR),
})
