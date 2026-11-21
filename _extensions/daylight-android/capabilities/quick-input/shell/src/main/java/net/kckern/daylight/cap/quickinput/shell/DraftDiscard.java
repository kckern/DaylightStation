package net.kckern.daylight.cap.quickinput.shell;

/** One confirmation belongs to the selected draft and the dialog that requested it. */
final class DraftDiscard {
    static final class Request {
        final String id;
        private Request(String id) { this.id = id; }
    }

    private Request pending;

    Request ask(String id) {
        pending = new Request(id);
        return pending;
    }

    boolean confirm(Request request, String selectedId) {
        if (pending != request || !java.util.Objects.equals(request.id, selectedId)) return false;
        invalidate();
        return true;
    }

    void invalidate() { pending = null; }
}
