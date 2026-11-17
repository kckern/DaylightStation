package net.kckern.daylight.cap.mediaservice;

import net.kckern.daylight.core.CertificatePins;

import java.util.Map;

/**
 * The setting media.controllerPins: "package=sha256, package=sha256". Each entry names
 * an app that may connect to the media session and the SHA-256 of the certificate it
 * must be signed with. The rules are CertificatePins', shared with car.hostPins. Pure.
 */
final class ControllerPinList {
    private ControllerPinList() { }

    /** Null when the value is a list of pins (or empty), otherwise what is wrong. No part of the value is repeated. */
    static String problem(String value) { return CertificatePins.problem(value); }

    static Map<String, String> parse(String value) { return CertificatePins.parse(value); }

    /** What the installed service reads: a JSON object of package to digest. */
    static String cacheJson(String value) { return CertificatePins.cacheJson(value); }
}
