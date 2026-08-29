package net.kckern.portalkeys;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class PayloadStore {
    private final File dir;
    PayloadStore(File dir) { this.dir = dir; if (!dir.exists()) dir.mkdirs(); }
    File dir() { return dir; }
    String current() { return pointer("current"); }
    String previous() { return pointer("previous"); }
    synchronized void activate(String name) throws IOException {
        if (!new File(dir, name).isFile()) throw new IOException("missing payload " + name);
        String old = current();
        if (old != null && !old.equals(name)) write("previous", old);
        write("current", name);
    }
    synchronized String rollback() throws IOException {
        String p = previous(); if (p == null || !new File(dir, p).isFile()) return null;
        String c = current(); write("current", p); if (c != null) write("previous", c); return p;
    }
    List<String> available() {
        List<String> out = new ArrayList<>(); File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) if (f.getName().endsWith(".jar")) out.add(f.getName());
        Collections.sort(out); return out;
    }
    synchronized void commit(File part, String name, String expected) throws IOException {
        String got = sha256(part);
        if (!got.equalsIgnoreCase(expected)) { part.delete(); throw new IOException("sha256 mismatch: " + got); }
        Files.move(part.toPath(), new File(dir, name).toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }
    static String sha256(File f) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (FileInputStream in = new FileInputStream(f)) { byte[] b = new byte[65536]; int n; while ((n=in.read(b))>0) md.update(b,0,n); }
            StringBuilder s = new StringBuilder(); for (byte b : md.digest()) s.append(String.format("%02x", b)); return s.toString();
        } catch (Exception e) { throw new IOException(e); }
    }
    private String pointer(String n) { try { File f=new File(dir,n); return f.isFile()?new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8).trim():null; } catch(Exception e){return null;} }
    private void write(String n,String v) throws IOException { Files.write(new File(dir,n).toPath(),v.getBytes(StandardCharsets.UTF_8)); }
}
