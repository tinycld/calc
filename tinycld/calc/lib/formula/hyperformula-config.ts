import type { ConfigParams } from 'hyperformula'
import { HYPERFORMULA_LICENSE_KEY } from './hyperformula-license'

// HYPERFORMULA_CONFIG is the one engine configuration every bridge (and
// test) builds from, so the app and the tests read dates the same way.
//
// Date formats: the doc stores dates as ISO text, which the bridge
// hands to the engine as "YYYY-MM-DD[ hh:mm:ss]". The US forms let a
// date typed inside a formula ("=DATEVALUE("12/6/24")") read month
// first, matching the editor's input rules. HyperFormula's default is
// day first, which read "12/6/24" as 12 June.
export const HYPERFORMULA_CONFIG: Partial<ConfigParams> = {
    licenseKey: HYPERFORMULA_LICENSE_KEY,
    dateFormats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'MM/DD/YY'],
    timeFormats: ['hh:mm', 'hh:mm:ss', 'hh:mm:ss.sss'],
}
