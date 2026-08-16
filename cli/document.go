package cli

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"tinycld.org/cli/client"
)

const (
	itemsCollection    = "drive_items"
	commentsCollection = "calc_comments"
)

// maxPathDepth bounds the resolution walk. The tree cannot legitimately be
// this deep; hitting the cap means a corrupted (cyclic) parent chain.
const maxPathDepth = 64

var errNotFound = errors.New("not found")

// item is the drive_items row this package reads. Documents are drive items —
// text owns only the comments on them — so the shape is duplicated here rather
// than imported: siblings must not depend on each other, and a hard import of
// @tinycld/drive would break the lean-shell guarantee. Only the fields needed
// to resolve a path and name a document are declared.
type item struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	IsFolder bool   `json:"is_folder"`
	Parent   string `json:"parent"`
	MimeType string `json:"mime_type"`
}

// comment mirrors the `calc_comments` collection.
//
// A thread's root has an empty ParentComment; replies point at the root.
// ResolvedAt lives on the root only — replies inherit it. AuthorName is
// snapshotted at write time so a removed user still renders with a name.
//
// Unlike text's comments, which anchor to quoted prose, a calc comment anchors
// to a CELL: sheet_id plus a zero-based row/col. That is what `--cell A1`
// parses into, and what the CELL column renders back.
type comment struct {
	ID            string `json:"id"`
	DriveItem     string `json:"drive_item"`
	SheetID       string `json:"sheet_id"`
	Row           int    `json:"row"`
	Col           int    `json:"col"`
	Body          string `json:"body"`
	ResolvedAt    string `json:"resolved_at"`
	Author        string `json:"author"`
	AuthorName    string `json:"author_name"`
	ParentComment string `json:"parent_comment"`
	Created       string `json:"created"`
}

// resolveDocument walks a slash path down from the root, one indexed lookup
// per segment. An `id:<recordid>` argument short-circuits to a direct fetch.
//
// Deliberately a local copy of drive's resolver rather than a shared helper:
// siblings must not depend on each other, and the alternative — a core helper
// — would put drive's path model in core for two callers. The duplication is
// small and the shape is pinned by tests.
func resolveDocument(ctx context.Context, c *client.Client, path string) (item, error) {
	if id, ok := strings.CutPrefix(path, "id:"); ok {
		it, err := client.GetRecord[item](ctx, c, itemsCollection, id)
		if err != nil {
			return item{}, fmt.Errorf("%s: %w", path, err)
		}
		return it, nil
	}

	segments := splitPath(path)
	if len(segments) == 0 {
		return item{}, errors.New("a document path is required")
	}
	if len(segments) > maxPathDepth {
		return item{}, fmt.Errorf("%s: path exceeds %d segments", path, maxPathDepth)
	}

	var cur item
	seen := map[string]bool{}
	for i, seg := range segments {
		res, err := client.ListRecords[item](ctx, c, itemsCollection, client.ListOptions{
			Filter: client.Filter("parent = {:p} && name = {:n}",
				map[string]any{"p": cur.ID, "n": seg}),
			PerPage:   1,
			SkipTotal: true,
		})
		if err != nil {
			return item{}, err
		}
		if len(res.Items) == 0 {
			return item{}, fmt.Errorf("%s: %w", "/"+strings.Join(segments[:i+1], "/"), errNotFound)
		}
		cur = res.Items[0]
		if seen[cur.ID] {
			return item{}, fmt.Errorf("%s: cyclic parent chain at %q", path, cur.Name)
		}
		seen[cur.ID] = true
	}

	// A folder has no comments, and asking for them is a mistake worth naming
	// rather than answering with an empty list.
	if cur.IsFolder {
		return item{}, fmt.Errorf("%s: is a folder, not a document", path)
	}
	return cur, nil
}

func splitPath(path string) []string {
	var segments []string
	for _, seg := range strings.Split(path, "/") {
		if seg != "" && seg != "." {
			segments = append(segments, seg)
		}
	}
	return segments
}

// documentComments reads every comment on a document, oldest first, so a
// thread reads top to bottom.
func documentComments(ctx context.Context, c *client.Client, itemID string) ([]comment, error) {
	return client.ListAll[comment](ctx, c, commentsCollection,
		client.Filter("drive_item = {:d}", map[string]any{"d": itemID}),
		"created,id")
}

// threadOf returns the root id a comment belongs to: itself for a root, its
// parent for a reply. resolved_at lives on the root only, so resolving a reply
// has to walk up to it.
func threadOf(c comment) string {
	if c.ParentComment != "" {
		return c.ParentComment
	}
	return c.ID
}
