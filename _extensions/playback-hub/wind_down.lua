-- Explicitly loaded for devices with a wind_down profile only.
local utils = require 'mp.utils'
local options = {base='', slot='', session_id=''}
require('mp.options').read_options(options, 'wind_down')
local phase, last, switching = 'primary', false, false

local function policy(action)
    local result = utils.subprocess({args={'python3', options.base..'/session_policy.py',
        '--base', options.base, '--slot', options.slot, '--action', action,
        '--session-id', options.session_id}, cancellable=false})
    if result.status ~= 0 then
        mp.msg.error('session policy unavailable; stopping playback')
        mp.commandv('quit')
        return nil
    end
    local state = utils.parse_json(result.stdout)
    if not state or not state.accepted then
        mp.msg.error('stale or malformed session policy; stopping playback')
        mp.commandv('quit')
        return nil
    end
    phase = state.phase
    if not state.allowed then mp.commandv('quit') end
    return state
end

mp.register_script_message('hub-next', function()
    if switching then return end
    local state = policy('tick')
    if not state or not state.allowed then return end
    local pos = mp.get_property_native('playlist-pos')
    local count = mp.get_property_native('playlist-count')
    if phase == 'primary' and pos and count and count > 0 and pos == count-1 then
        switching = true
        state = policy('fallback')
        if not state or not state.allowed then return end
        -- Stop the old track while the worker constructs the fallback. The
        -- worker restarts mpv under the existing slot lock and session deadline.
        mp.commandv('set', 'pause', 'yes')
        mp.command_native_async({name='subprocess', playback_only=false,
            args={'bash', options.base..'/playback-hub.sh', 'profile-fallback', options.slot, options.session_id}},
            function(success, result)
                if not success or not result or result.status ~= 0 then
                    switching = false
                    policy('error')
                end
            end)
    else
        mp.commandv('playlist-next')
    end
end)

mp.register_script_message('hub-fallback-loaded', function() switching = false end)

mp.register_event('file-loaded', function()
    local pos = mp.get_property_native('playlist-pos')
    local count = mp.get_property_native('playlist-count')
    last = pos ~= nil and count ~= nil and count > 0 and pos == count-1
end)

mp.register_event('end-file', function(event)
    if switching then return end
    if event.reason == 'error' then
        policy('error')
    elseif event.reason == 'eof' and last then
        -- Re-read durable phase: an old player's event cannot end fallback.
        local state = policy('tick')
        if state and state.allowed and phase == 'primary' then policy('eof') end
    end
end)

mp.add_periodic_timer(1, function() policy('tick') end)
policy('tick')
