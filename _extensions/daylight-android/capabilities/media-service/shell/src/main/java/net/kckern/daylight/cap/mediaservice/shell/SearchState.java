package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.FailureWords;

/**
 * What the search screen says under the field, pure. "Nothing called ..." belongs only to
 * an answer from home that was ok, not offline and empty; a failed or kept-only answer
 * says why home did not answer and what happens next, and offers Try again.
 */
final class SearchState {
    final String line;
    final boolean tryAgain;

    private SearchState(String line, boolean tryAgain) { this.line = line; this.tryAgain = tryAgain; }

    /**
     * @param ok      the payload answered with ok (kept-only answers are ok with offline true)
     * @param offline the answer is the kept matches only
     * @param count   results in the answer
     * @param cause   why home did not answer (null when it did)
     * @param plan    what the retry will do next
     */
    static SearchState of(String q, boolean ok, boolean offline, int count, FailureWords.Cause cause, SearchRetry.Waiting plan) {
        if (!ok) return new SearchState(FailureWords.line(cause) + dot(plan), true);
        if (!offline) {
            return count == 0 ? new SearchState("Nothing called \"" + q + "\". Try fewer words.", false) : new SearchState("", false);
        }
        String away = FailureWords.head(cause) + " · searching what's on this phone";
        if (count == 0) return new SearchState(away + " · nothing kept matches \"" + q + "\"." + sentence(plan), true);
        return new SearchState(away + dot(plan), true);
    }

    private static String dot(SearchRetry.Waiting plan) {
        return plan == SearchRetry.Waiting.TIMER ? " · trying again"
                : plan == SearchRetry.Waiting.NETWORK ? " · will try again when you're back online" : "";
    }

    private static String sentence(SearchRetry.Waiting plan) {
        return plan == SearchRetry.Waiting.TIMER ? " Trying again…"
                : plan == SearchRetry.Waiting.NETWORK ? " Will try again when you're back online." : "";
    }
}
