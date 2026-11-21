package net.kckern.daylight.cap.widgets.shell;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

final class FreematicsReading {
    final boolean ecuLinked;
    final Integer speed, rpm, coolant;
    final int millivolts, ageMillis;

    private FreematicsReading(ByteBuffer packet) {
        int flags = packet.get(1) & 0xff;
        ecuLinked = (flags & 2) != 0;
        ageMillis = Short.toUnsignedInt(packet.getShort(10));
        boolean fresh = ecuLinked && (flags & 1) != 0 && ageMillis <= 5000;
        speed = fresh && (flags & 4) != 0 ? (int) packet.getShort(2) : null;
        rpm = fresh && (flags & 8) != 0 ? (int) packet.getShort(4) : null;
        coolant = fresh && (flags & 16) != 0 ? (int) packet.getShort(6) : null;
        millivolts = Short.toUnsignedInt(packet.getShort(8));
    }

    static FreematicsReading decode(byte[] data) {
        if (data == null || data.length != 12 || data[0] != 1) return null;
        return new FreematicsReading(ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN));
    }
}
