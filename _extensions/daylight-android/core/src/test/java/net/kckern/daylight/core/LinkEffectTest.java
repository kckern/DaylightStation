package net.kckern.daylight.core;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class LinkEffectTest {
    @Test public void linkEffectsHaveOneShape() throws Exception {
        assertEquals("none", LinkEffect.none().getString("effect"));
        assertTrue(LinkEffect.none().getBoolean("ok"));
        JSONObject front = LinkEffect.front();
        assertTrue(front.getBoolean("ok"));
        assertEquals("front", front.getString("effect"));
        assertEquals("Saved", LinkEffect.toast("Saved").getString("message"));
        assertEquals("toast", LinkEffect.toast("Saved").getString("effect"));
    }

    @Test public void anEffectNeverCarriesAnIntentOrAUrlForTheShellToStart() throws Exception {
        // The link activity is exported. What it does after a link is one of three fixed
        // things; the payload cannot name an activity, an intent or a URL for it to open.
        for (JSONObject effect : new JSONObject[] { LinkEffect.none(), LinkEffect.front(), LinkEffect.toast("x") }) {
            assertFalse(effect.has("intentUri"));
            assertFalse(effect.has("intent"));
            assertFalse(effect.has("url"));
        }
    }

    @Test public void aRefusalIsNotOkAndSaysWhy() throws Exception {
        JSONObject refused = LinkEffect.refused("not_allowed", "That link is not for this app");
        assertFalse(refused.getBoolean("ok"));
        assertEquals("not_allowed", refused.getString("error"));
        assertEquals("That link is not for this app", refused.getString("message"));
    }
}
