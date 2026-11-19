package net.kckern.daylight.cap.mediaservice;

import java.net.URLEncoder;

/** A content id as path segments of a backend route. Pure. */
final class ContentPath {
    private ContentPath() { }

    /** of("list", "plex:12345") is /api/v1/list/plex/12345. Every segment is percent-encoded. */
    static String of(String route, String contentId) {
        StringBuilder path = new StringBuilder("/api/v1/").append(route).append('/').append(ContentId.source(contentId));
        String local = ContentId.local(contentId);
        if (local.isEmpty()) return path.toString();
        for (String segment : local.split("/")) path.append('/').append(encode(segment));
        return path.toString();
    }

    static String encode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
