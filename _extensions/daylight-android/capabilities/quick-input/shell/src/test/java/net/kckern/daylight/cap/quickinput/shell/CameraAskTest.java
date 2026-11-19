package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class CameraAskTest {
    private static final String CAMERA = "android.permission.CAMERA";

    /**
     * Android's rule for ACTION_IMAGE_CAPTURE: an app that does not declare CAMERA may
     * use the system camera through the intent without it; an app that declares CAMERA
     * must hold it, or the intent is refused. The phone build does not declare it.
     */
    @Test public void theCameraPermissionIsAskedForOnlyByABuildThatDeclaresIt() {
        assertFalse(CameraAsk.mustAsk(new String[] { "android.permission.INTERNET", "android.permission.RECORD_AUDIO" }, false));
        assertFalse(CameraAsk.mustAsk(null, false));
        assertFalse(CameraAsk.mustAsk(new String[0], false));
        assertTrue(CameraAsk.mustAsk(new String[] { "android.permission.INTERNET", CAMERA }, false));
        assertFalse("declared and already held", CameraAsk.mustAsk(new String[] { CAMERA }, true));
    }

    @Test public void theAnswerToTheDialogIsReadForTheCameraOnly() {
        assertTrue(CameraAsk.granted(new String[] { CAMERA }, new int[] { 0 }));
        assertFalse(CameraAsk.granted(new String[] { CAMERA }, new int[] { -1 }));
        assertFalse(CameraAsk.granted(new String[] { "android.permission.RECORD_AUDIO" }, new int[] { 0 }));
        assertFalse(CameraAsk.granted(null, null));
        assertFalse("a dialog that was dismissed answers with nothing", CameraAsk.granted(new String[0], new int[0]));
    }
}
