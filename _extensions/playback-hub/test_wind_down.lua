local handlers, timers, commands, detached, properties, policy, events
local function reset(phase)
    handlers, timers, commands, detached, events = {}, {}, {}, {}, {}
    properties = {['playlist-pos']=0, ['playlist-count']=2}
    policy = {enabled=true, allowed=true, accepted=true, phase=phase or 'primary', session_id='test'}
    _G.mp = {
        get_property_native=function(k) return properties[k] end,
        commandv=function(...) commands[#commands+1]={...} end,
        command_native_async=function(args, callback) detached[#detached+1]=args; handlers.worker_done=callback end,
        register_script_message=function(k,f) handlers[k]=f end,
        register_event=function(k,f) events[k]=f end,
        add_periodic_timer=function(_,f) timers[#timers+1]=f end,
        msg={error=function() end},
    }
    package.loaded['mp.options'] = {read_options=function(o)
        o.base='/test'; o.slot='7'; o.session_id='test'
    end}
    package.loaded['mp.utils'] = {
        parse_json=function(_) return policy end,
        subprocess=function(args)
            local action
            for i,v in ipairs(args.args) do if v=='--action' then action=args.args[i+1] end end
            if action=='fallback' and policy.allowed then policy.phase='fallback' end
            if action=='eof' or action=='error' then policy.allowed=false; policy.phase='ended' end
            return {status=0,stdout='json'}
        end,
        subprocess_detached=function(args) detached[#detached+1]=args end,
    }
    dofile('wind_down.lua')
    events['file-loaded']()
end
local function eq(a,b) assert(a==b,tostring(a)..' != '..tostring(b)) end
reset(); handlers['hub-next'](); eq(commands[1][1],'playlist-next'); eq(#detached,0)
reset(); properties['playlist-pos']=1; events['file-loaded'](); handlers['hub-next']()
eq(policy.phase,'fallback'); eq(#detached,1)
handlers['hub-next'](); eq(#detached,1)
reset(); events['end-file']({reason='eof'}); eq(policy.phase,'primary')
reset(); properties['playlist-pos']=1; events['file-loaded'](); events['end-file']({reason='eof'})
eq(policy.phase,'ended'); eq(commands[#commands][1],'quit'); eq(#detached,0)
reset('fallback'); properties['playlist-pos']=1; events['file-loaded'](); events['end-file']({reason='eof'})
eq(policy.phase,'fallback')
reset(); properties['playlist-pos']=1; events['file-loaded'](); events['end-file']({reason='stop'})
eq(policy.phase,'primary')
reset(); events['end-file']({reason='error'}); eq(policy.phase,'ended')
reset(); policy.allowed=false; timers[1](); eq(commands[#commands][1],'quit')
reset(); policy.accepted=false; handlers['hub-next'](); eq(#detached,0); eq(commands[#commands][1],'quit')
reset(); properties['playlist-pos']=1; handlers['hub-next'](); handlers.worker_done(false, nil); eq(policy.phase,'ended')
print('wind_down.lua: 10 scenarios passed')
