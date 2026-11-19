package net.kckern.daylight.cap.quickinput.shell;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.widget.Toast;

import java.io.File;
import java.security.SecureRandom;

/**
 * A photo as a quick input: opening this screen opens the system's camera app, and the
 * photo it takes is scaled, stripped of its EXIF and handed to the upload queue. There
 * is nothing to look at here and no review step: one touch, one photo.
 *
 * Not exported. It is opened by the payload when a keyed input link arrives, which only
 * this app's own surfaces can build. A page of the site, a link from another app and a
 * car cannot open the camera through it.
 *
 * The camera app writes to a file of this app through InputFileProvider, with access to
 * that one file for the length of the capture. This app has no camera of its own and
 * the phone build declares no CAMERA permission (CameraAsk has Android's rule).
 *
 * Rule for editing this file: perform, do not decide. What a capture becomes is
 * PhotoPlan's; names and what the provider serves are CaptureFiles'.
 */
public class PhotoCaptureActivity extends Activity {
    private static final String TAG = "Daylight-Input";
    private static final int REQUEST_CAPTURE = 1;
    private static final int REQUEST_CAMERA = 2;
    private static final String STATE_RAW = "raw";
    private static final int GRANT = Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION;

    private String dest;
    private String label;
    /** The name of the file the camera is writing; null before the camera is opened. */
    private String rawName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        dest = MemoFiles.dest(getIntent() == null ? null : getIntent().getStringExtra(MemoFiles.EXTRA_DEST));
        label = MemoFiles.label(getIntent() == null ? null : getIntent().getStringExtra(MemoFiles.EXTRA_LABEL));
        if (dest == null) { finish(); return; }
        if (label == null) label = "Photo";
        if (savedInstanceState != null) {
            // Android built the screen again while the camera app was in front (it may have
            // ended this process for the camera's memory). The capture goes on; its result
            // arrives in onActivityResult. Opening the camera a second time would be wrong.
            String saved = savedInstanceState.getString(STATE_RAW);
            rawName = CaptureFiles.idOf(saved) == null ? null : saved;
            if (rawName == null) finish();
            return;
        }
        CaptureFiles.sweep(inbox(), System.currentTimeMillis());
        if (CameraAsk.mustAsk(declaredPermissions(), checkSelfPermission(CameraAsk.CAMERA) == PackageManager.PERMISSION_GRANTED)) {
            requestPermissions(new String[] { CameraAsk.CAMERA }, REQUEST_CAMERA);
            return;
        }
        openCamera();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putString(STATE_RAW, rawName);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQUEST_CAMERA) return;
        if (CameraAsk.granted(permissions, grantResults)) {
            openCamera();
        } else {
            say("No camera permission: no photo was taken");
            finish();
        }
    }

    private File inbox() { return new File(getFilesDir(), CaptureFiles.INBOX); }

    private String[] declaredPermissions() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_PERMISSIONS).requestedPermissions;
        } catch (Exception e) {
            return null;
        }
    }

    private Uri uriFor(String name) {
        return new Uri.Builder().scheme("content").authority(getPackageName() + CaptureFiles.AUTHORITY_SUFFIX)
                .path(CaptureFiles.uriPath(name)).build();
    }

    private void openCamera() {
        File dir = inbox();
        String id = MemoFiles.newId(System.currentTimeMillis(), new SecureRandom().nextLong());
        String name = CaptureFiles.rawName(id, dest);
        File raw = new File(dir, name);
        try {
            if ((!dir.isDirectory() && !dir.mkdirs()) || !raw.createNewFile()) throw new java.io.IOException("cannot create the capture file");
            Uri uri = uriFor(name);
            Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri);
            // The grant is for this one file, and ends with the capture (onActivityResult).
            capture.setClipData(ClipData.newRawUri("", uri));
            capture.addFlags(GRANT);
            rawName = name;
            startActivityForResult(capture, REQUEST_CAPTURE);
        } catch (ActivityNotFoundException noCamera) {
            raw.delete();
            rawName = null;
            say("No camera app on this phone");
            finish();
        } catch (Exception refused) {
            // A SecurityException here is Android refusing the intent to an app that declares CAMERA without holding it.
            Log.w(TAG, "could not open the camera: " + refused.getClass().getSimpleName());
            raw.delete();
            rawName = null;
            say("Could not open the camera");
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAPTURE) return;
        final String name = rawName;
        rawName = null;
        final String id = CaptureFiles.idOf(name);
        if (id == null) { finish(); return; }
        try { revokeUriPermission(uriFor(name), GRANT); } catch (RuntimeException ignored) { }
        final File dir = inbox();
        final File raw = new File(dir, name);
        if (!PhotoPlan.captured(resultCode == RESULT_OK, raw.length())) {
            // Cancelled, or nothing was written: no file is left.
            raw.delete();
            finish();
            return;
        }
        final String to = dest;
        final String shown = label;
        Thread work = new Thread(() -> {
            File out = new File(dir, CaptureFiles.encodedName(id, to));
            boolean ok = PhotoPlan.process(raw, out, new AndroidPixels())
                    && out.renameTo(new File(dir, CaptureFiles.name(id, to, CaptureFiles.PHOTO)));
            if (!ok) out.delete();
            // The id and the outcome. Nothing of the photo.
            Log.i(TAG, "photo " + id + (ok ? " queued for " + to : " could not be prepared"));
            if (ok) CaptureFiles.tellPayload();
            final String message = ok ? "Sending to " + shown : "The photo could not be prepared. Nothing was sent.";
            runOnUiThread(() -> { say(message); finish(); });
        }, "Daylight-photo");
        work.start();
    }

    private void say(String message) {
        Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }
}
