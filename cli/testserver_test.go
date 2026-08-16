package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
)

// fakeCalc is an in-memory stand-in for the server: drive_items (for path
// resolution) and calc_comments. Filters are matched against the EXACT shapes
// the CLI builds — an unrecognized filter fails the test rather than returning
// everything, because a silently-ignored drive_item filter is how `comments`
// appears to work while showing another workbook's thread.
//
// WHAT THIS HARNESS CANNOT SEE: it runs no access rules and no OAuth scope
// middleware. calc_comments' rules reach through drive_item and admit only the
// document's creator or someone it is shared with, and create additionally
// demands the caller be the comment's own author — none of that exists here.
// The scope classification is proven in core's route_classification_test.go;
// these tests prove only that the right REQUESTS are sent.
type fakeCalc struct {
	t *testing.T

	items    map[string]*item
	comments map[string]*comment
	seq      int

	// Recorded writes, so a test can assert what was SENT rather than only
	// what came back — a fake that echoes its input proves nothing about the
	// body the command built.
	lastCreate map[string]any
	lastPatch  map[string]any
	patchedID  string
}

func newFakeCalc(t *testing.T) *fakeCalc {
	return &fakeCalc{t: t, items: map[string]*item{}, comments: map[string]*comment{}}
}

func (f *fakeCalc) nextID(prefix string) string {
	f.seq++
	return fmt.Sprintf("%s%03d", prefix, f.seq)
}

func (f *fakeCalc) addItem(id, name, parent string, isFolder bool) *item {
	it := &item{ID: id, Name: name, Parent: parent, IsFolder: isFolder}
	f.items[id] = it
	return it
}

func (f *fakeCalc) addComment(id, itemID, body, author string) *comment {
	c := &comment{
		ID: id, DriveItem: itemID, Body: body,
		Author: "user1", AuthorName: author,
		Created: fmt.Sprintf("2026-08-0%d 10:00:00Z", len(f.comments)+1),
	}
	f.comments[id] = c
	return c
}

var (
	// The path-walk lookup: one indexed read per segment.
	reChild = regexp.MustCompile(`^parent = "([^"]*)" && name = "((?:[^"\\]|\\.)*)"$`)
	// The comment read, always scoped to one document.
	reByItem = regexp.MustCompile(`^drive_item = "([^"]*)"$`)
)

func listResponse[T any](w http.ResponseWriter, items []T) {
	if items == nil {
		items = []T{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"page": 1, "perPage": 200, "totalItems": len(items), "totalPages": 1,
		"items": items,
	})
}

func decodeBody(r *http.Request) map[string]any {
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	return body
}

func (f *fakeCalc) serve() (*httptest.Server, *client.Client) {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /oauth/userinfo", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"sub": "user1"})
	})
	mux.HandleFunc("GET /api/collections/users/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"id": r.PathValue("id"), "name": "Ada Lovelace", "email": "ada@example.com",
		})
	})

	mux.HandleFunc("GET /api/collections/drive_items/records", func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("filter")
		m := reChild.FindStringSubmatch(filter)
		if m == nil {
			f.t.Errorf("unsupported drive_items filter: %q", filter)
			listResponse(w, []item{})
			return
		}
		parent, name := m[1], unquote(m[2])
		var out []item
		for _, it := range f.items {
			if it.Parent == parent && it.Name == name {
				out = append(out, *it)
			}
		}
		listResponse(w, out)
	})

	mux.HandleFunc("GET /api/collections/drive_items/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		it, ok := f.items[r.PathValue("id")]
		if !ok {
			notFound(w)
			return
		}
		json.NewEncoder(w).Encode(it)
	})

	mux.HandleFunc("GET /api/collections/calc_comments/records", func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("filter")
		m := reByItem.FindStringSubmatch(filter)
		if m == nil {
			f.t.Errorf("unsupported calc_comments filter: %q — comments must be "+
				"scoped to one workbook", filter)
			listResponse(w, []comment{})
			return
		}
		var out []comment
		for _, c := range f.comments {
			if c.DriveItem == m[1] {
				out = append(out, *c)
			}
		}
		sort.Slice(out, func(i, j int) bool {
			if out[i].Created != out[j].Created {
				return out[i].Created < out[j].Created
			}
			return out[i].ID < out[j].ID
		})
		listResponse(w, out)
	})

	mux.HandleFunc("GET /api/collections/calc_comments/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		c, ok := f.comments[r.PathValue("id")]
		if !ok {
			notFound(w)
			return
		}
		json.NewEncoder(w).Encode(c)
	})

	mux.HandleFunc("POST /api/collections/calc_comments/records", func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(r)
		f.lastCreate = body
		created := &comment{
			ID:            f.nextID("cmt"),
			DriveItem:     str(body["drive_item"]),
			Body:          str(body["body"]),
			Author:        str(body["author"]),
			AuthorName:    str(body["author_name"]),
			SheetID:       str(body["sheet_id"]),
			Row:           intOf(body["row"]),
			Col:           intOf(body["col"]),
			ParentComment: str(body["parent_comment"]),
		}
		f.comments[created.ID] = created
		json.NewEncoder(w).Encode(created)
	})

	mux.HandleFunc("PATCH /api/collections/calc_comments/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		c, ok := f.comments[id]
		if !ok {
			notFound(w)
			return
		}
		body := decodeBody(r)
		f.lastPatch = body
		f.patchedID = id
		if v, ok := body["resolved_at"].(string); ok {
			c.ResolvedAt = v
		}
		json.NewEncoder(w).Encode(c)
	})

	srv := httptest.NewServer(mux)
	f.t.Cleanup(srv.Close)
	store := &staticStore{tok: client.TokenSet{
		AccessToken: "test-token", RefreshToken: "r", ExpiresAt: time.Now().Add(time.Hour),
	}}
	return srv, client.New(srv.URL, store, srv.Client())
}

var reUnquote = strings.NewReplacer(`\"`, `"`, `\\`, `\`)

func unquote(s string) string { return reUnquote.Replace(s) }

func notFound(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNotFound)
	json.NewEncoder(w).Encode(map[string]string{"message": "Not found"})
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

// intOf reads a JSON number, which decodes to float64.
func intOf(v any) int {
	f, _ := v.(float64)
	return int(f)
}

type staticStore struct{ tok client.TokenSet }

func (s *staticStore) Load() (client.TokenSet, error) { return s.tok, nil }
func (s *staticStore) Save(t client.TokenSet) error   { s.tok = t; return nil }

// newTestRoot mirrors the shell root's persistent flag set — the contract
// output.FromCommand reads — and registers the calc group.
func newTestRoot(c *client.Client) *cobra.Command {
	root := &cobra.Command{Use: "tinycld", SilenceUsage: true, SilenceErrors: true}
	pf := root.PersistentFlags()
	pf.String("output", "table", "")
	pf.Bool("json", false, "")
	pf.String("context", "", "")
	pf.Bool("quiet", false, "")
	pf.Bool("no-color", false, "")
	pf.Bool("yes", false, "")
	Register(root, c)
	return root
}

func runCmd(t *testing.T, c *client.Client, args ...string) (string, string, error) {
	t.Helper()
	root := newTestRoot(c)
	var out, errBuf bytes.Buffer
	root.SetOut(&out)
	root.SetErr(&errBuf)
	root.SetIn(strings.NewReader(""))
	root.SetArgs(args)
	err := root.Execute()
	return out.String(), errBuf.String(), err
}
