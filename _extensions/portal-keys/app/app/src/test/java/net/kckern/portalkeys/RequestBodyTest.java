package net.kckern.portalkeys;
import org.junit.Test;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import static org.junit.Assert.*;
public class RequestBodyTest {
  @Test public void readsAPutBodyFromNanoHttpdsTempFile() throws Exception {
    File tmp=File.createTempFile("put-body",".tmp");tmp.deleteOnExit();
    Files.write(tmp.toPath(),"{\"locked\":true,\"lockedUntil\":2000}".getBytes(StandardCharsets.UTF_8));
    Map<String,String> files=new HashMap<>();files.put("content",tmp.getAbsolutePath());
    assertEquals("{\"locked\":true,\"lockedUntil\":2000}",RequestBody.of(files));
    assertTrue(LockdownCommand.parse(RequestBody.of(files),1000).locked);
  }
  @Test public void prefersAPostBody() throws Exception {
    Map<String,String> files=new HashMap<>();files.put("postData","{\"locked\":false}");files.put("content","/nonexistent");
    assertEquals("{\"locked\":false}",RequestBody.of(files));
  }
  @Test public void noBodyIsNull() throws Exception {
    assertNull(RequestBody.of(new HashMap<>()));
  }
}
