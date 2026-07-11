// Fixed-identity grid overlay colors.
//
// These are deliberately theme-INDEPENDENT: like Google Sheets / Excel,
// the spreadsheet's selection, drag, ref, and marker chrome keeps the
// same recognizable hue in light and dark mode rather than following the
// user's chosen accent theme. They are UI chrome (not cell data), but the
// point of naming them here — instead of routing them through
// useThemeColor — is to give the grid a single, self-documenting source
// of truth for its identity palette while preserving that fixed behavior.
//
// (Actual cell fills/text ARE theme-aware — Cell renders bg-background /
// text-foreground. Cell-data colors the user picks are stored per cell and
// are not part of this palette. Drop shadows use shadowColor: '#000', the
// ecosystem-wide convention, and are intentionally not centralized here.)

// Primary selection accent — outer selection outline, resize guide lines,
// active drag targets, and the in-cell ref-insertion border.
export const SELECTION_GREEN = '#22a06b'
// Translucent fill painted inside a selected range / ref-drag preview.
export const SELECTION_GREEN_TINT = 'rgba(34, 160, 107, 0.10)'
// Slightly stronger tint for a toggled-on control (e.g. the conditional-
// format style-picker's active bold/italic buttons).
export const SELECTION_GREEN_TINT_STRONG = 'rgba(34, 160, 107, 0.15)'
// Darker green for the inner primary-anchor outline and the cut
// marching-ants border, so they read as distinct from the outer outline.
export const SELECTION_GREEN_DARK = '#1a8757'

// Formula ref-drag preview (matches the blue used for formula cell refs).
export const REF_DRAG_BLUE = '#3b82f6'
export const REF_DRAG_BLUE_TINT = 'rgba(59, 130, 246, 0.10)'
// Format-painter destination outline.
export const FORMAT_PAINTER_BLUE = '#2563eb'

// Comment-presence marker (top-right triangle on a commented cell).
export const COMMENT_MARKER_AMBER = '#F9A825'

// Find/replace match highlight. The "current" match is emphasized with a
// solid fill + stronger border; other matches get a translucent fill.
export const FIND_MATCH_CURRENT_BG = '#fde68a'
export const FIND_MATCH_CURRENT_BORDER = '#d97706'
export const FIND_MATCH_OTHER_BG = '#fef3c780'
export const FIND_MATCH_OTHER_BORDER = '#fbbf24'

// White stroke around the small square selection-edge / fill handles, so
// they stay visible against both the green fill and the cells beneath.
export const HANDLE_BORDER_WHITE = '#ffffff'
