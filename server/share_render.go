package calc

import (
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/sharelink"
	"tinycld.org/packages/calc/render"
)

// calcMimeType is the canonical Office Open XML spreadsheet MIME. The
// public share-render endpoint refuses any drive item with a different
// mime so a non-xlsx blob can't be fed through the xlsx parser.
const calcMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// registerShareRenderAPI binds the PUBLIC (unauthenticated) calc render
// endpoint used by Drive's read-only share links. Access is gated by a
// signed share-session token (minted by drive), not by re.Auth — so an
// anonymous link visitor can render a shared spreadsheet without a
// PocketBase account.
//
// Route: GET /api/calc/share-render/{token}
//
// The {token} is the share-session JWT (not the link's public token).
// We verify it, re-check the link is live, confirm the item is a calc
// file, then reuse the same render core the authenticated endpoint uses.
// Images are forced to embed mode: the public iframe has no auth token to
// fetch image files, so the renderer inlines them as data: URIs.
func registerShareRenderAPI(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/calc/share-render/{token}", func(re *core.RequestEvent) error {
			return handleShareRender(app, re)
		})
		return e.Next()
	})
}

func handleShareRender(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	sessionToken := re.Request.PathValue("token")
	_, _, item, err := sharelink.VerifyAndResolve(app, sessionToken)
	if err != nil {
		return re.JSON(sharelink.HTTPStatus(err), map[string]string{"error": err.Error()})
	}

	if item.GetString("mime_type") != calcMimeType {
		return re.BadRequestError("not a spreadsheet", nil)
	}

	etag := renderETag(item.Id, item.GetString("updated"))
	if match := re.Request.Header.Get("If-None-Match"); match == etag {
		re.Response.Header().Set("ETag", etag)
		re.Response.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
		re.Response.WriteHeader(http.StatusNotModified)
		return nil
	}

	q := re.Request.URL.Query()
	opts := render.RenderOpts{
		Sheet: q.Get("sheet"),
		Range: q.Get("range"),
		Scope: render.Scope(q.Get("scope")),
		// Force embed: the anonymous iframe can't carry an auth token to
		// fetch image files, so the renderer inlines bytes as data URIs.
		Images: render.ImageMode("embed"),
	}

	html, err := RenderItemHTML(app, item, opts)
	if err != nil {
		return re.InternalServerError("could not render spreadsheet", err)
	}

	re.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
	re.Response.Header().Set("ETag", etag)
	re.Response.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	_, _ = re.Response.Write([]byte(html))
	return nil
}
