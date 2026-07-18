-- 51-bluez-sink-pin.lua
-- =====================================================================
-- STAGED / NOT YET ENABLED. This is the turnkey zero-cross-bleed fix.
-- It is NOT auto-deployed. Enable it ONLY in a maintenance window with the
-- headsets under test, following the runbook in the extension README
-- ("Zero-cross-bleed WirePlumber hook — window activation"). Reason: enabling
-- it requires a WirePlumber reload that re-establishes the bluez sinks (a brief
-- blip on every connected headset), and a wrong rule can misroute or silence
-- ALL headsets. There is no offline Lua validation tooling on the hub, so it
-- must be validated live. Two live-audio changes on 2026-07-17 caused outages;
-- do not enable this blind.
-- =====================================================================
--
-- WHAT IT DOES
-- A bluez_output headset sink must accept ONLY the mpv stream that explicitly
-- targeted it (mpv's --audio-device sets the stream's `target.object` to the
-- sink's node.name). When a headset drops, PipeWire's policy-node re-targets the
-- orphaned mpv stream onto whatever sink survives — another connected headset —
-- which is the cross-bleed ("2 streams on yellow, none on red"). This hook
-- watches every new link and, the instant a link forms from an mpv stream to a
-- bluez_output sink it did NOT target, destroys that link. The orphan then parks
-- silent; the daemon's fast reaper (cross_bleed_guard, ~1s) kills + respawns it
-- on reconnect. A link to the stream's OWN sink (target.object == sink node.name)
-- is left untouched, so normal reconnect-to-own-headset still works.
--
-- WHY NOT THE SIMPLER OPTIONS (both analyzed/tested 2026-07-17, both fail):
--   * node.dont-reconnect on the stream (policy-node.lua line ~640/678): it
--     disables ALL re-targeting, including relinking to the stream's OWN sink
--     after a transient A2DP renegotiation blip -> a healthy headset goes
--     permanently silent. This is the documented "dont-reconnect" outage.
--   * a null-sink as the PipeWire default: a trap. Orphans migrate to the null
--     sink and never return (it is a valid sink they are happy to sit on) ->
--     within seconds every stream drifts to silence. Tested live and rolled back.
--
-- This hook avoids both: no stream-side reconnect change, no default change.
-- It only ever destroys a link that is provably wrong (foreign target).

local nodes = ObjectManager { Interest { type = "node" } }
nodes:activate()

-- Resolve a node property by node id (link props give us node ids, not names).
local function node_prop(id, key)
  if id == nil then return nil end
  local n = nodes:lookup { Constraint { "object.id", "=", tonumber(id) } }
  return n and n.properties[key] or nil
end

local links = ObjectManager { Interest { type = "link" } }

links:connect("object-added", function(_, link)
  local p = link.properties
  local in_id  = p["link.input.node"]    -- the SINK side
  local out_id = p["link.output.node"]   -- the STREAM side

  local sink_name = node_prop(in_id, "node.name")
  if sink_name == nil or not sink_name:match("^bluez_output%.") then
    return  -- not a headset sink; ignore (loopbacks, monitors, other sinks)
  end

  if node_prop(out_id, "node.name") ~= "mpv" then
    return  -- not one of our mpv streams; ignore
  end

  local target = node_prop(out_id, "target.object")
  if target ~= sink_name then
    -- Foreign link: an mpv stream that did NOT target this headset landed on it.
    Log.info(string.format(
      "bluez-sink-pin: rejecting cross-bleed link mpv(target=%s) -> %s",
      tostring(target), sink_name))
    link:request_destroy()
  end
  -- else: legit link (stream's own sink) -> leave it. Normal (re)connect works.
end)

links:activate()

-- VALIDATION NOTES for the window (confirm each against the live graph):
--  1. `target.object` on the mpv stream is the sink NODE.NAME string
--     (e.g. "bluez_output.41_42_3A_E5_43_07.1") — verified via pw-dump 2026-07-17.
--  2. `Constraint { "object.id", "=", n }` and `link:request_destroy()` are the
--     0.4.x idioms (see /usr/share/wireplumber/scripts/policy-node.lua). If lookup
--     by object.id misbehaves, iterate nodes:iterate() and match by "object.id".
--  3. main.lua.d/ files can be clobbered by package updates; the 51- prefix loads
--     AFTER 50-*-config. Re-verify after any `apt upgrade` (like the seat-gate fix).
