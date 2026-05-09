package calc

import (
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"tinycld.org/core/realtime"
)

// stubHandle is a minimal realtime.DocHandle that records calls.
// Used by SaveCoordinator tests so they don't need goja.
type stubHandle struct {
	mu          sync.Mutex
	applied     int
	encodeCalls int
	closed      bool
}

func (h *stubHandle) ApplyUpdate(payload []byte) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.applied++
	return nil
}

func (h *stubHandle) EncodeStateAsUpdate() ([]byte, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.encodeCalls++
	return nil, nil
}

func (h *stubHandle) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	return nil
}

// fastCoord builds a SaveCoordinator with millisecond-scale intervals
// so tests run in real time rather than seconds. The flush captures
// every call's room id and lets tests block/unblock individual saves
// via the gate channel.
type fastCoord struct {
	c        *SaveCoordinator
	calls    *[]string
	callsMu  *sync.Mutex
	gate     chan struct{} // optional: if non-nil, flush blocks on receive
	failOnce *atomic.Bool  // optional: when true, the next flush returns an error then resets
}

func newFastCoord(t *testing.T) *fastCoord {
	t.Helper()
	calls := []string{}
	mu := sync.Mutex{}
	failOnce := atomic.Bool{}
	gate := make(chan struct{}, 1024) // pre-buffered; tests opt in by reading
	flush := func(driveItemID string, _ realtime.DocHandle) error {
		// Block on gate if a test wants to control flush timing.
		// The default uses an unbuffered receive only when the
		// test explicitly drains; otherwise we proceed immediately
		// because gate is pre-buffered with sentinel values.
		select {
		case <-gate:
		default:
		}
		if failOnce.Load() {
			failOnce.Store(false)
			return errors.New("synthetic flush failure")
		}
		mu.Lock()
		calls = append(calls, driveItemID)
		mu.Unlock()
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 50 * time.Millisecond
	c.ceilingEvery = 250 * time.Millisecond
	c.teardownTimeout = 2 * time.Second
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	return &fastCoord{c: c, calls: &calls, callsMu: &mu, gate: gate, failOnce: &failOnce}
}

func (fc *fastCoord) callCount() int {
	fc.callsMu.Lock()
	defer fc.callsMu.Unlock()
	return len(*fc.calls)
}

// TestSaveCoordinatorDebounceCoalesces: many updates within the
// debounce window produce exactly one save.
func TestSaveCoordinatorDebounceCoalesces(t *testing.T) {
	fc := newFastCoord(t)
	fc.c.OnRoomCreate("room", &stubHandle{})
	for i := 0; i < 10; i++ {
		fc.c.OnDocUpdate("room")
		time.Sleep(5 * time.Millisecond)
	}
	// Wait past the debounce window after the last update.
	time.Sleep(150 * time.Millisecond)
	if got := fc.callCount(); got != 1 {
		t.Fatalf("expected 1 save after debounced burst, got %d", got)
	}
}

// TestSaveCoordinatorCeilingFiresUnderConstantLoad: continuous
// updates at a rate faster than the debounce should still produce a
// save when the ceiling fires.
func TestSaveCoordinatorCeilingFiresUnderConstantLoad(t *testing.T) {
	fc := newFastCoord(t)
	fc.c.OnRoomCreate("ceiling-room", &stubHandle{})
	// Hammer updates every 10ms (faster than the 50ms debounce) for
	// 600ms — well past two ceiling windows of 250ms each.
	stop := time.After(600 * time.Millisecond)
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
LOOP:
	for {
		select {
		case <-tick.C:
			fc.c.OnDocUpdate("ceiling-room")
		case <-stop:
			break LOOP
		}
	}
	// Drain the trailing debounce.
	time.Sleep(150 * time.Millisecond)
	if got := fc.callCount(); got < 2 {
		t.Fatalf("expected at least 2 saves under continuous edits + ceiling, got %d", got)
	}
}

// TestSaveCoordinatorAwarenessNeverSaves: the broker only invokes
// OnDocUpdate for MsgDocUpdate, so the coordinator should never save
// if it never sees that hook fire. We don't have a broker here — we
// just verify that OnRoomCreate alone produces no saves, ever.
func TestSaveCoordinatorAwarenessNeverSaves(t *testing.T) {
	fc := newFastCoord(t)
	fc.c.OnRoomCreate("quiet-room", &stubHandle{})
	time.Sleep(400 * time.Millisecond) // > debounce + ceiling
	if got := fc.callCount(); got != 0 {
		t.Fatalf("expected 0 saves with no OnDocUpdate, got %d", got)
	}
}

// TestSaveCoordinatorInFlightCoalescing: an update arriving during
// an in-flight save produces exactly one follow-up save (not many).
func TestSaveCoordinatorInFlightCoalescing(t *testing.T) {
	calls := []string{}
	mu := sync.Mutex{}
	releaseFlush := make(chan struct{})
	doneFirst := make(chan struct{})
	flush := func(driveItemID string, _ realtime.DocHandle) error {
		mu.Lock()
		first := len(calls) == 0
		calls = append(calls, driveItemID)
		mu.Unlock()
		if first {
			close(doneFirst)
			<-releaseFlush
		}
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 30 * time.Millisecond
	c.ceilingEvery = 200 * time.Millisecond
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnRoomCreate("coal-room", &stubHandle{})

	// Trigger first save.
	c.OnDocUpdate("coal-room")
	<-doneFirst // first flush is now mid-call, blocked on releaseFlush

	// Inject more updates while save is in flight.
	for i := 0; i < 5; i++ {
		c.OnDocUpdate("coal-room")
		time.Sleep(5 * time.Millisecond)
	}

	// Release the first flush; the coordinator should now coalesce
	// the queued updates into a single follow-up save.
	close(releaseFlush)
	time.Sleep(150 * time.Millisecond)

	mu.Lock()
	got := len(calls)
	mu.Unlock()
	if got != 2 {
		t.Fatalf("expected exactly 2 saves (first + 1 coalesced follow-up), got %d", got)
	}
}

// TestSaveCoordinatorFailureRetries: a failing flush schedules a
// retry, and the retry succeeds.
func TestSaveCoordinatorFailureRetries(t *testing.T) {
	var calls atomic.Int32
	var failNext atomic.Bool
	failNext.Store(true)
	flush := func(driveItemID string, _ realtime.DocHandle) error {
		calls.Add(1)
		if failNext.CompareAndSwap(true, false) {
			return errors.New("synthetic")
		}
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 30 * time.Millisecond
	c.ceilingEvery = 1 * time.Hour // keep ceiling out of this test
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnRoomCreate("retry-room", &stubHandle{})

	c.OnDocUpdate("retry-room")
	// First save fires after 30ms, fails. Retry uses retryBackoff(0)
	// which is 1 second. Wait long enough for retry to land.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if calls.Load() >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got := calls.Load(); got < 2 {
		t.Fatalf("expected at least 2 flush attempts (failure + retry), got %d", got)
	}
}

// TestSaveCoordinatorTeardownFinalSave: OnRoomEmpty fires a save
// synchronously even if the debounce hasn't elapsed, and blocks
// until it returns.
func TestSaveCoordinatorTeardownFinalSave(t *testing.T) {
	var calls atomic.Int32
	doneSignal := make(chan struct{})
	flush := func(driveItemID string, _ realtime.DocHandle) error {
		calls.Add(1)
		// Slow flush: 100ms.
		time.Sleep(100 * time.Millisecond)
		close(doneSignal)
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.debounceEvery = 5 * time.Second // long; teardown should win
	c.ceilingEvery = 5 * time.Second
	c.teardownTimeout = 2 * time.Second
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnRoomCreate("teardown-room", &stubHandle{})
	c.OnDocUpdate("teardown-room")

	start := time.Now()
	c.OnRoomEmpty("teardown-room")
	elapsed := time.Since(start)

	if got := calls.Load(); got != 1 {
		t.Fatalf("expected 1 save during teardown, got %d", got)
	}
	if elapsed < 90*time.Millisecond {
		t.Fatalf("OnRoomEmpty returned in %s; expected to block for the ~100ms flush", elapsed)
	}
	select {
	case <-doneSignal:
	default:
		t.Fatal("flush hadn't completed when OnRoomEmpty returned")
	}
}

// TestSaveCoordinatorTeardownNoOpsCleanRoom: closing a room that
// never received an update should NOT call flush.
func TestSaveCoordinatorTeardownNoOpsCleanRoom(t *testing.T) {
	var calls atomic.Int32
	flush := func(string, realtime.DocHandle) error {
		calls.Add(1)
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnRoomCreate("clean-room", &stubHandle{})
	c.OnRoomEmpty("clean-room")
	if got := calls.Load(); got != 0 {
		t.Fatalf("expected 0 saves for clean teardown, got %d", got)
	}
}

// TestSaveCoordinatorIgnoresUpdateForUnknownRoom: an OnDocUpdate
// without a prior OnRoomCreate is a no-op (e.g. NewDoc failed and
// the broker fell back to pure relay). Must not panic.
func TestSaveCoordinatorIgnoresUpdateForUnknownRoom(t *testing.T) {
	var calls atomic.Int32
	flush := func(string, realtime.DocHandle) error {
		calls.Add(1)
		return nil
	}
	c := NewSaveCoordinator(flush)
	c.SetLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.OnDocUpdate("never-created")
	time.Sleep(150 * time.Millisecond)
	if got := calls.Load(); got != 0 {
		t.Fatalf("expected 0 saves for unknown room, got %d", got)
	}
}
