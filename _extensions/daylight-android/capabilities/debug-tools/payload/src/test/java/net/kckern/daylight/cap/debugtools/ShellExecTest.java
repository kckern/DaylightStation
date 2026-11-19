package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class ShellExecTest {
    @Test public void capturesStdoutStderrAndTheExitCode() throws Exception {
        JSONObject r = ShellExec.run("echo out; echo err 1>&2; exit 3", 5000);
        assertTrue(r.getBoolean("ok"));
        assertEquals(3, r.getInt("exit"));
        assertEquals("out\n", r.getString("stdout"));
        assertEquals("err\n", r.getString("stderr"));
    }

    @Test public void aCommandPastItsTimeoutIsKilled() throws Exception {
        JSONObject r = ShellExec.run("sleep 30", 300);
        assertTrue(r.optBoolean("timeout"));
        assertEquals(-1, r.getInt("exit"));
        assertTrue(r.getLong("ms") < 10_000);
    }

    // ── beyond the plan: the output cap, and running without a shell ──────────

    @Test public void eachStreamIsCappedAt256KiBAndSaysWhenItWasCut() throws Exception {
        assertEquals(256 * 1024, ShellExec.MAX_BYTES);
        JSONObject r = ShellExec.run("head -c 400000 /dev/zero | tr '\\0' 'a'; head -c 300000 /dev/zero | tr '\\0' 'b' 1>&2", 10_000);
        assertEquals(0, r.getInt("exit"));
        for (String stream : new String[] { "stdout", "stderr" }) {
            String text = r.getString(stream);
            assertTrue(stream, text.endsWith(ShellExec.TRUNCATED));
            assertEquals(stream, ShellExec.MAX_BYTES + ShellExec.TRUNCATED.length(), text.length());
            assertTrue(r.getBoolean(stream + "Truncated"));
        }
        JSONObject small = ShellExec.run("echo hi", 5000);
        assertFalse(small.getBoolean("stdoutTruncated"));
        assertFalse(small.getString("stdout").contains("truncated"));
    }

    @Test public void anArgumentListRunsWithNoShellSoMetacharactersAreJustText() throws Exception {
        JSONObject r = ShellExec.exec(new String[] { "echo", "a; echo b", "$HOME", "`id`" }, 5000);
        assertEquals(0, r.getInt("exit"));
        assertEquals("a; echo b $HOME `id`\n", r.getString("stdout"));
    }

    @Test public void aCommandThatCannotBeStartedIsReportedNotThrown() throws Exception {
        JSONObject r = ShellExec.exec(new String[] { "/no/such/binary-daylight" }, 1000);
        assertFalse(r.getBoolean("ok"));
        assertTrue(r.has("error"));
    }

    @Test public void theResultDoesNotRepeatTheCommand() throws Exception {
        // The route logs the command itself; the result is what goes back to the caller.
        assertFalse(ShellExec.run("echo hi", 5000).has("cmd"));
    }
}
