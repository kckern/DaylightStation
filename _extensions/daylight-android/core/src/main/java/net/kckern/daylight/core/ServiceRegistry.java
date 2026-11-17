package net.kckern.daylight.core;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * How one capability offers something to another without either naming the other.
 * The interfaces live in net.kckern.daylight.core.spi. A consumer must cope with
 * find() returning null: the provider may not be part of this device's build.
 */
public final class ServiceRegistry {
    private final Map<Class<?>, List<Object>> byType = new ConcurrentHashMap<>();

    public <T> void provide(Class<T> type, T implementation) {
        byType.computeIfAbsent(type, k -> new CopyOnWriteArrayList<>()).add(implementation);
    }

    public <T> void withdraw(Class<T> type, T implementation) {
        List<Object> list = byType.get(type);
        if (list != null) list.remove(implementation);
    }

    /** The first provider, or null. */
    public <T> T find(Class<T> type) {
        List<Object> list = byType.get(type);
        return list == null || list.isEmpty() ? null : type.cast(list.get(0));
    }

    /** For a route that cannot work without it: answers 501 naming the missing capability. */
    public <T> T require(Class<T> type, String capability) {
        T t = find(type);
        if (t == null) throw new UnsupportedException("capability '" + capability + "' is not in this build");
        return t;
    }

    public <T> List<T> all(Class<T> type) {
        List<T> out = new ArrayList<>();
        List<Object> list = byType.get(type);
        if (list != null) for (Object o : list) out.add(type.cast(o));
        return out;
    }
}
