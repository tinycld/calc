package calc

import (
	"log/slog"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/nathanstitt/omnidoc/pkg/xlsx"
	ycrdt "github.com/skyterra/y-crdt"
)

// filterViewKey is the sheet meta key of calc's filter view (FILTER_VIEW_KEY
// in tinycld/calc/lib/filter.ts).
const filterViewKey = "filterView"

// FilterView mirrors the client's FilterDefinition (lib/filter.ts). Range
// is 1-based; its StartRow is the label (header) row the client never
// hides. Criteria are keyed by absolute 1-based column number.
// SavedHeights holds the pixel heights rows had before the filter hid any
// (1-based keys), which removing the filter restores.
type FilterView struct {
	Mode         string                  `json:"mode"`
	Range        FilterRange             `json:"range"`
	Criteria     map[int]FilterCriterion `json:"criteria,omitempty"`
	SavedHeights map[int]int             `json:"savedHeights,omitempty"`
}

// FilterRange is the filter view's rectangle (the `range` Y.Map).
type FilterRange struct {
	StartRow int `json:"startRow"`
	EndRow   int `json:"endRow"`
	StartCol int `json:"startCol"`
	EndCol   int `json:"endCol"`
}

// FilterCriterion is one column's criterion: Type "values" with
// AllowedValues (an empty string is the "(blanks)" entry), or Type
// "condition" with Condition.
type FilterCriterion struct {
	Type          string           `json:"type"`
	AllowedValues []string         `json:"allowedValues,omitempty"`
	Condition     *FilterCondition `json:"condition,omitempty"`
}

// FilterCondition is a comparison: Op is gt, lt, eq, neq, contains,
// startsWith, endsWith (each with Values), isEmpty or isNotEmpty. The
// value list is any-of, except neq which is none-of.
type FilterCondition struct {
	Op     string   `json:"op"`
	Values []string `json:"values,omitempty"`
}

// readFilterView converts a sheet's autoFilter into calc's filter view.
// Columns calc cannot show get no criterion; the save keeps them from
// the file (see autoFilterFromView). Returns nil when the sheet has no
// filter or its ref does not parse.
func readFilterView(af *xlsx.AutoFilter) *FilterView {
	if af == nil {
		return nil
	}
	rng, err := xlsx.ParseRange(af.Ref)
	if err != nil {
		return nil
	}
	fv := &FilterView{
		Mode:  "header",
		Range: FilterRange{StartRow: rng.StartRow, EndRow: rng.EndRow, StartCol: rng.StartCol, EndCol: rng.EndCol},
	}
	for _, col := range af.Columns {
		c, ok := filterColumnCriterion(col)
		if !ok {
			continue
		}
		if fv.Criteria == nil {
			fv.Criteria = map[int]FilterCriterion{}
		}
		fv.Criteria[rng.StartCol+col.ColID] = c
	}
	return fv
}

func condition(op string, values ...string) FilterCriterion {
	return FilterCriterion{Type: "condition", Condition: &FilterCondition{Op: op, Values: values}}
}

// filterColumnCriterion maps one autoFilter column to the criterion calc
// shows for it. ok is false when calc's filter cannot express the
// column: date groups, top-10, dynamic, color and icon filters, the
// >= and <= comparisons, "?" or inner "*" wildcards, and two-comparison
// pairs that are not the same comparison joined the way calc joins it.
func filterColumnCriterion(col xlsx.FilterColumn) (FilterCriterion, bool) {
	if len(col.DateGroups) > 0 || col.Top10 != nil || col.Dynamic != nil || col.Color != nil || col.Icon != nil {
		return FilterCriterion{}, false
	}
	if col.Custom != nil {
		return customFilterCriterion(*col.Custom)
	}
	switch {
	case len(col.Values) > 0:
		allowed := slices.Clone(col.Values)
		if col.Blank {
			allowed = append(allowed, "")
		}
		return FilterCriterion{Type: "values", AllowedValues: allowed}, true
	case col.Blank:
		return condition("isEmpty"), true
	}
	return FilterCriterion{}, false
}

// customFilterCriterion maps <customFilters>. One comparison maps on its
// own; two map only to one calc op over two values, OR-joined for every
// op but neq, which calc joins with AND (none-of).
func customFilterCriterion(cf xlsx.CustomFilters) (FilterCriterion, bool) {
	if len(cf.Filters) == 0 || len(cf.Filters) > 2 {
		return FilterCriterion{}, false
	}
	op, first, ok := customComparison(cf.Filters[0])
	if !ok {
		return FilterCriterion{}, false
	}
	if len(cf.Filters) == 1 {
		if op == "isEmpty" || op == "isNotEmpty" {
			return condition(op), true
		}
		return condition(op, first), true
	}
	op2, second, ok := customComparison(cf.Filters[1])
	if !ok || op2 != op || op == "isEmpty" || op == "isNotEmpty" {
		return FilterCriterion{}, false
	}
	if cf.And != (op == "neq") {
		return FilterCriterion{}, false
	}
	return condition(op, first, second), true
}

// customComparison maps one <customFilter> to a calc op and value.
func customComparison(c xlsx.CustomFilter) (string, string, bool) {
	switch c.Operator {
	case "greaterThan":
		return "gt", c.Val, true
	case "lessThan":
		return "lt", c.Val, true
	case "notEqual":
		if strings.TrimSpace(c.Val) == "" {
			// Excel writes "(NonBlanks)" as notEqual " ".
			return "isNotEmpty", "", true
		}
		text, lead, trail, ok := parseWildcardPattern(c.Val)
		if !ok || lead || trail {
			return "", "", false
		}
		return "neq", text, true
	case "equal", "":
		if c.Val == "" {
			return "isEmpty", "", true
		}
		text, lead, trail, ok := parseWildcardPattern(c.Val)
		switch {
		case !ok:
			return "", "", false
		case lead && trail:
			return "contains", text, true
		case trail:
			return "startsWith", text, true
		case lead:
			return "endsWith", text, true
		}
		return "eq", text, true
	}
	return "", "", false
}

// parseWildcardPattern splits an Excel filter pattern into its literal
// text and whether it starts and/or ends with a "*" wildcard. "~"
// escapes the next character. ok is false for a pattern calc cannot
// match: a "?" wildcard, a "*" inside the text, or a pattern that is
// only wildcards.
func parseWildcardPattern(p string) (text string, lead, trail, ok bool) {
	var sb strings.Builder
	runes := []rune(p)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case r == '~' && i+1 < len(runes):
			i++
			sb.WriteRune(runes[i])
		case r == '?':
			return "", false, false, false
		case r == '*' && i == 0:
			lead = true
		case r == '*' && i == len(runes)-1:
			trail = true
		case r == '*':
			return "", false, false, false
		default:
			sb.WriteRune(r)
		}
	}
	if sb.Len() == 0 {
		return "", false, false, false
	}
	return sb.String(), lead, trail, true
}

// escapeWildcards makes text match literally in an Excel filter pattern.
func escapeWildcards(text string) string {
	return strings.NewReplacer("~", "~~", "*", "~*", "?", "~?").Replace(text)
}

// criterionFilterColumn is the inverse of filterColumnCriterion: the
// autoFilter column that filters as calc's criterion does. Excel allows
// at most two comparisons per column, so a condition with more values
// keeps its first two (logged); eq with more becomes a value list,
// which matches the same rows. ok is false for a criterion with no
// file form (an empty value list, which shows no rows).
func criterionFilterColumn(colID int, c FilterCriterion) (xlsx.FilterColumn, bool) {
	col := xlsx.FilterColumn{ColID: colID}
	if c.Type == "values" {
		for _, v := range c.AllowedValues {
			if v == "" {
				col.Blank = true
				continue
			}
			col.Values = append(col.Values, v)
		}
		return col, len(col.Values) > 0 || col.Blank
	}
	if c.Type != "condition" || c.Condition == nil {
		return col, false
	}
	op, values := c.Condition.Op, c.Condition.Values
	switch op {
	case "isEmpty":
		col.Blank = true
		return col, true
	case "isNotEmpty":
		col.Custom = &xlsx.CustomFilters{Filters: []xlsx.CustomFilter{{Operator: "notEqual", Val: " "}}}
		return col, true
	}
	if len(values) == 0 {
		return col, false
	}
	if op == "eq" && len(values) > 2 {
		col.Values = slices.Clone(values)
		return col, true
	}
	if len(values) > 2 {
		slog.Warn("calc: filter condition has more values than an xlsx column holds; saving the first two",
			"op", op, "values", len(values))
		values = values[:2]
	}
	operator, pattern := "equal", func(v string) string { return escapeWildcards(v) }
	switch op {
	case "gt":
		operator, pattern = "greaterThan", func(v string) string { return v }
	case "lt":
		operator, pattern = "lessThan", func(v string) string { return v }
	case "neq":
		operator = "notEqual"
	case "contains":
		pattern = func(v string) string { return "*" + escapeWildcards(v) + "*" }
	case "startsWith":
		pattern = func(v string) string { return escapeWildcards(v) + "*" }
	case "endsWith":
		pattern = func(v string) string { return "*" + escapeWildcards(v) }
	case "eq":
	default:
		return col, false
	}
	cf := &xlsx.CustomFilters{And: op == "neq" && len(values) == 2}
	for _, v := range values {
		cf.Filters = append(cf.Filters, xlsx.CustomFilter{Operator: operator, Val: pattern(v)})
	}
	col.Custom = cf
	return col, true
}

// sameCriterion compares criteria by meaning: nil and empty lists match.
func sameCriterion(a, b FilterCriterion) bool {
	if a.Type != b.Type || !slices.Equal(a.AllowedValues, b.AllowedValues) {
		return false
	}
	if a.Condition == nil || b.Condition == nil {
		return a.Condition == b.Condition
	}
	return a.Condition.Op == b.Condition.Op && slices.Equal(a.Condition.Values, b.Condition.Values)
}

// autoFilterFromView builds the autoFilter calc's filter view saves as,
// on top of the file's own filter (orig, nil when it has none) so the
// save loses nothing calc did not change:
//
//   - A criterion that still reads as the file column it came from keeps
//     that column verbatim (omnidoc re-emits its Raw XML), so a no-op
//     save is byte-identical.
//   - A changed or new criterion is written from calc's criterion; a
//     hidden filter button from the file column stays.
//   - A file column calc cannot show (filterColumnCriterion fails) had no
//     criterion in calc, so the user could not have removed it: it is
//     kept while it lies inside the range. A file column calc could show
//     but no longer has a criterion was removed in calc, and goes.
//   - The unmodeled children (sortState, extLst) stay while the range is
//     unchanged; they name the old range, so a resized filter drops them.
//
// Columns sit at their absolute column, re-based on the saved range.
// fv nil returns nil (no filter).
func autoFilterFromView(fv *FilterView, orig *xlsx.AutoFilter) *xlsx.AutoFilter {
	if fv == nil {
		return nil
	}
	rng := xlsx.Range{
		StartRow: max(fv.Range.StartRow, 1),
		StartCol: max(fv.Range.StartCol, 1),
	}
	rng.EndRow = max(fv.Range.EndRow, rng.StartRow)
	rng.EndCol = max(fv.Range.EndCol, rng.StartCol)

	origCols := map[int]xlsx.FilterColumn{}
	sameRef := false
	if orig != nil {
		if origRng, err := xlsx.ParseRange(orig.Ref); err == nil {
			sameRef = origRng == rng
			for _, col := range orig.Columns {
				origCols[origRng.StartCol+col.ColID] = col
			}
		}
	}

	af := &xlsx.AutoFilter{Ref: rng.String()}
	if sameRef {
		af.Extra = orig.Extra
	}
	inRange := func(abs int) bool { return abs >= rng.StartCol && abs <= rng.EndCol }
	for abs, c := range fv.Criteria {
		if !inRange(abs) {
			continue
		}
		fileCol, inFile := origCols[abs]
		if inFile {
			if read, ok := filterColumnCriterion(fileCol); ok && sameCriterion(read, c) {
				fileCol.ColID = abs - rng.StartCol
				af.Columns = append(af.Columns, fileCol)
				continue
			}
		}
		col, ok := criterionFilterColumn(abs-rng.StartCol, c)
		if !ok {
			continue
		}
		col.HiddenButton = inFile && fileCol.HiddenButton
		af.Columns = append(af.Columns, col)
	}
	for abs, fileCol := range origCols {
		if _, kept := fv.Criteria[abs]; kept || !inRange(abs) {
			continue
		}
		if _, ok := filterColumnCriterion(fileCol); ok {
			continue
		}
		fileCol.ColID = abs - rng.StartCol
		af.Columns = append(af.Columns, fileCol)
	}
	sort.Slice(af.Columns, func(i, j int) bool { return af.Columns[i].ColID < af.Columns[j].ColID })
	return af
}

// buildFilterViewYMap encodes a filter view in the Y shape lib/filter.ts
// reads. savedHeights is written only when the file's filter hides rows;
// otherwise it stays absent so the client's first applyFilter records the
// real heights.
func buildFilterViewYMap(fv *FilterView) *ycrdt.YMap {
	view := ycrdt.NewYMap(nil)
	view.Set("mode", fv.Mode)
	rng := ycrdt.NewYMap(nil)
	rng.Set("startRow", fv.Range.StartRow)
	rng.Set("endRow", fv.Range.EndRow)
	rng.Set("startCol", fv.Range.StartCol)
	rng.Set("endCol", fv.Range.EndCol)
	view.Set("range", rng)
	criteria := ycrdt.NewYMap(nil)
	for _, col := range sortedIntKeys(fv.Criteria) {
		criteria.Set(strconv.Itoa(col), buildCriterionYMap(fv.Criteria[col]))
	}
	view.Set("criteria", criteria)
	if fv.SavedHeights != nil {
		saved := ycrdt.NewYMap(nil)
		for _, row := range sortedIntKeys(fv.SavedHeights) {
			saved.Set(strconv.Itoa(row), fv.SavedHeights[row])
		}
		view.Set("savedHeights", saved)
	}
	return view
}

func buildCriterionYMap(c FilterCriterion) *ycrdt.YMap {
	m := ycrdt.NewYMap(nil)
	m.Set("type", c.Type)
	if c.Type == "values" {
		m.Set("allowedValues", newYArrayOf(stringsToArrayAny(c.AllowedValues)))
		return m
	}
	cond := ycrdt.NewYMap(nil)
	cond.Set("op", c.Condition.Op)
	if len(c.Condition.Values) > 0 {
		cond.Set("values", newYArrayOf(stringsToArrayAny(c.Condition.Values)))
	}
	m.Set("condition", cond)
	return m
}

func stringsToArrayAny(in []string) ycrdt.ArrayAny {
	out := make(ycrdt.ArrayAny, 0, len(in))
	for _, s := range in {
		out = append(out, s)
	}
	return out
}

// decodeFilterView reads the sheet meta filterView Y.Map the way
// readFilterView in lib/filter.ts does. Returns nil when the view is
// absent or its range is malformed (the client treats that as no
// filter); criteria it cannot read are skipped.
func decodeFilterView(meta *ycrdt.YMap) *FilterView {
	view, ok := meta.Get(filterViewKey).(*ycrdt.YMap)
	if !ok {
		return nil
	}
	rngMap, ok := view.Get("range").(*ycrdt.YMap)
	if !ok {
		return nil
	}
	for _, k := range []string{"startRow", "endRow", "startCol", "endCol"} {
		if !isYNumber(rngMap.Get(k)) {
			return nil
		}
	}
	fv := &FilterView{
		Mode: "range",
		Range: FilterRange{
			StartRow: numberFromAny(rngMap.Get("startRow")),
			EndRow:   numberFromAny(rngMap.Get("endRow")),
			StartCol: numberFromAny(rngMap.Get("startCol")),
			EndCol:   numberFromAny(rngMap.Get("endCol")),
		},
	}
	if view.Get("mode") == "header" {
		fv.Mode = "header"
	}
	fv.SavedHeights = decodeSparseIntMap(view, "savedHeights")
	if crit, ok := view.Get("criteria").(*ycrdt.YMap); ok {
		crit.ForEach(func(key string, value any, _ *ycrdt.YMap) {
			col, err := strconv.Atoi(key)
			if err != nil {
				return
			}
			m, ok := value.(*ycrdt.YMap)
			if !ok {
				return
			}
			if c, ok := decodeCriterion(m); ok {
				if fv.Criteria == nil {
					fv.Criteria = map[int]FilterCriterion{}
				}
				fv.Criteria[col] = c
			}
		})
	}
	return fv
}

// decodeCriterion mirrors criterionFromYMap (lib/filter.ts), including
// the legacy single `value` string.
func decodeCriterion(m *ycrdt.YMap) (FilterCriterion, bool) {
	switch m.Get("type") {
	case "values":
		return FilterCriterion{Type: "values", AllowedValues: decodeStringArrayKeepEmpty(m, "allowedValues")}, true
	case "condition":
		cond, ok := m.Get("condition").(*ycrdt.YMap)
		if !ok {
			return FilterCriterion{}, false
		}
		op := stringFromAny(cond.Get("op"))
		values := decodeStringArrayKeepEmpty(cond, "values")
		if _, isArray := cond.Get("values").(*ycrdt.YArray); !isArray {
			if legacy, ok := cond.Get("value").(string); ok {
				values = []string{legacy}
			}
		}
		switch op {
		case "gt", "lt", "eq", "neq", "contains", "startsWith", "endsWith":
			return condition(op, values...), true
		case "isEmpty", "isNotEmpty":
			return condition(op), true
		}
	}
	return FilterCriterion{}, false
}

func isYNumber(v any) bool {
	switch v.(type) {
	case int, int32, int64, float32, float64:
		return true
	}
	return false
}
