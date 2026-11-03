package calc

import (
	"testing"

	"github.com/pocketbase/pocketbase"

	"tinycld.org/core/realtime"
)

// Drive makes automatic versions (opt-in, drive decides) from editcheckpoint,
// which only rooms of a kind with EditCheckpoints fire.
func TestRealtime_CalcRoomsFireEditCheckpoints(t *testing.T) {
	app := pocketbase.New()
	registerRealtime(app)

	opts, ok := realtime.LookupOptionsForTest(app, "calc")
	if !ok {
		t.Fatal("registerRealtime did not register the 'calc' room kind")
	}
	if !opts.EditCheckpoints {
		t.Fatal("calc room kind does not fire edit checkpoints")
	}
}
