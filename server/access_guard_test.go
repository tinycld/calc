package calc

import (
	"testing"

	"tinycld.org/core/rlstest"
)

// Every access path in every rule of an install with this package — core's
// rules included, since some of them gain a branch per package — must need a
// login, except the public paths named here.
func TestAccessRules_EveryPathRequiresLogin(t *testing.T) {
	app := rlstest.NewAssembledApp(t,
		rlstest.MigrationsDir(t, "../../drive/pb-migrations"),
		rlstest.MigrationsDir(t, "../pb-migrations"),
	)
	rlstest.RequireAuthGuardOnAccessRules(t, app, rlstest.CorePublicPaths()...)
}
