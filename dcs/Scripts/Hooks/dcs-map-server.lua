-------------------------------------------------------------------------------
-- dcs-map-server -- Export Hook
--
-- Sends telemetry over UDP to a server running locally on this machine.
-- Schema 3: tab-separated, batched, versioned.
--
-- Install: copy into Saved Games\DCS\Scripts\Hooks\
-------------------------------------------------------------------------------

local SCHEMA        = 3
local HOST          = '127.0.0.1'   -- deliberately loopback only, the LAN hop is WebSocket
local DEFAULT_PORT  = 50000         -- overridable in Config\dcs-map-server.cfg, see read_port()
local INTERVAL      = 0.1           -- 10 Hz, matching what the client expects
local MAX_DATAGRAM  = 8000          -- uncritical over loopback, keeps latency low
local SWEEP_BUDGET  = 120           -- objects per tick; bounds the Lua load on the sim thread

local function log(msg)
  net.log('[map-server] ' .. msg)
end

-- Optional settings file for power users: Saved Games\DCS\Config\dcs-map-server.cfg,
-- lines of `key = value`, `#` starts a comment. tools/hook-config.js reads the
-- same file for the server, so both ends agree without anyone editing this
-- script. Parsed as plain text rather than run as Lua: a typo there must not
-- be able to execute anything or stop the hook from loading.
local CONFIG_FILE = 'Config\\dcs-map-server.cfg'

local function read_port()
  local ok_dir, dir = pcall(function() return lfs.writedir() end)
  if not ok_dir or type(dir) ~= 'string' then return DEFAULT_PORT, 'default' end
  local f = io.open(dir .. CONFIG_FILE, 'r')
  if not f then return DEFAULT_PORT, 'default' end
  local port, source = DEFAULT_PORT, 'default'
  for line in f:lines() do
    local key, value = line:gsub('#.*$', ''):match('^%s*([%w_]+)%s*=%s*(.-)%s*$')
    if key == 'udp_port' then
      local n = tonumber(value)
      if n and n == math.floor(n) and n >= 1 and n <= 65535 then
        port, source = n, CONFIG_FILE
      else
        log('ignoring udp_port=' .. tostring(value) .. ' in ' .. CONFIG_FILE .. ' (not a port number)')
      end
    end
  end
  f:close()
  return port, source
end

local function load_hook()
  local PORT, port_source = read_port()

  package.path  = package.path  .. ';.\\LuaSocket\\?.lua;'
  package.cpath = package.cpath .. ';.\\LuaSocket\\?.dll;'
  local socket = require('socket')

  local mm = {}
  local udp
  local next_send
  local options_view
  local sweep = {}          -- remaining items of the current sweep
  local seen = {}           -- ids from the last completed sweep
  local current = {}        -- ids seen in the sweep in progress
  local buffer = {}
  local buffer_len = 0
  local diag_at = 0          -- next diagnostic output
  local diag_objects = 0     -- objects in the last sweep
  local diag_sent = 0        -- of those, how many were actually sent
  local diag_send_errors = 0 -- datagrams that failed to go out since the last diagnostic
  local diag_send_error = '' -- the last such error
  local start_time = ''      -- mission start, seconds after midnight; '' if unknown
  local next_bases = 0       -- model time of the next airbase list
  local BASES_EVERY = 60     -- seconds: a base can change hands, but not often
  local zone_lines = nil     -- the mission's trigger zones as Z lines, built once
  local next_zones = 0
  local ZONES_EVERY = 300    -- seconds: zones never change; this only reaches a late server
  local next_route = 0
  local ROUTE_EVERY = 5      -- seconds: one short line, and a slot change shows up quickly
  local route_key = nil      -- slot/unit the cached mission route belongs to
  local route_cache = nil    -- R line of that mission route, false if there is none
  local route_source = nil   -- last source logged, so the log only notes changes

  --- Tabs and newlines would break the format apart. Commas may stay: DCS
  --- unit and group names routinely contain commas, tabs almost never.
  local function clean(s)
    if s == nil then return '' end
    return (tostring(s):gsub('[\t\r\n]', ' '))
  end

  local function flush()
    if buffer_len == 0 then return end
    local payload = table.concat(buffer)
    buffer, buffer_len = {}, 0
    -- A failed send must never stall the simulation -- but it is counted, so
    -- the diagnostic line can tell "DCS hands out nothing" apart from "the
    -- hook has data and can't get it out".
    local ok_call, sent_ok, err = pcall(function() return udp:sendto(payload, HOST, PORT) end)
    if not (ok_call and sent_ok) then
      diag_send_errors = diag_send_errors + 1
      diag_send_error = tostring(ok_call and err or sent_ok)
    end
  end

  -- Set when LoGetWorldObjects() returns nil rather than a list: the server
  -- has object export switched off, so there are no other units to send.
  local objects_blocked = false

  -- Header: schema, model time, visibility rule, mission start time, and '1'
  -- when the server blocks object export. The start time is what turns model
  -- time into the mission's clock time, the one the F10 map shows; the flag
  -- lets the map say why it is empty instead of just looking broken.
  local function header(model_time)
    return string.format('MM\t%d\t%.3f\t%s\t%s\t%s\n', SCHEMA, model_time,
                         options_view or '', start_time, objects_blocked and '1' or '')
  end

  local function emit(line)
    if buffer_len + #line > MAX_DATAGRAM then
      flush()
      -- Every datagram carries its own header, so it stays readable on its own.
      local head = header(Export.LoGetModelTime() or 0)
      buffer[#buffer + 1] = head
      buffer_len = #head
    end
    buffer[#buffer + 1] = line
    buffer_len = buffer_len + #line
  end

  local function ownship_line(id, d)
    local wind = Export.LoGetVectorWindVelocity() or { x = 0, y = 0, z = 0 }
    local exp = Export.LoGetSnares() or { chaff = 0, flare = 0 }
    local ralt = Export.LoGetAltitudeAboveGroundLevel() or 0
    local accel = Export.LoGetAccelerationUnits() or { y = 1 }

    -- Weight on wheels, via the compression of any landing gear strut.
    local gear = (Export.LoGetAircraftDrawArgumentValue(6) or 0)
               + (Export.LoGetAircraftDrawArgumentValue(1) or 0)
               + (Export.LoGetAircraftDrawArgumentValue(4) or 0)
    local wow = 0
    if gear > 0 then wow = (ralt > 10) and 2 or 1 end

    return string.format(
      'O\t%d\t%s\t%.7f\t%.7f\t%.2f\t%.5f\t%s\t%s\t%d\t%.2f\t%.2f\t%d\t%.3f\t%.3f\t%d\t%d\t%.2f\t%.2f\t%.2f\n',
      id, clean(d.Name),
      d.LatLongAlt.Lat, d.LatLongAlt.Long, d.LatLongAlt.Alt, d.Heading,
      clean(d.UnitName), clean(d.GroupName), d.CoalitionID or 0,
      Export.LoGetTrueAirSpeed() or 0, ralt, wow,
      Export.LoGetAngleOfAttack() or 0, accel.y or 1,
      exp.chaff or 0, exp.flare or 0,
      wind.x or 0, wind.y or 0, wind.z or 0)
  end

  local function object_line(id, v)
    local t = v.Type or {}

    if t.level1 == 4 and t.level2 == 4 then
      return string.format('W\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%d\n',
        id, clean(v.Name), v.LatLongAlt.Lat, v.LatLongAlt.Long, v.LatLongAlt.Alt,
        v.Heading or 0, v.CoalitionID or 0)
    end

    -- Everything else goes out as an A line, including static objects without
    -- a GroupName (buildings, barracks, fuel tanks, command posts). These used
    -- to be dropped entirely ("if v.GroupName ~= nil"), even though DCS's own
    -- F10 map shows them -- clean(nil) already returns an empty string, so
    -- skipping them bought nothing but missing objects.
    -- level1/level2 are included because without them air defence can't be
    -- told apart from other ground targets, and only the former gets a
    -- threat ring.
    -- The last field says whether a person flies it (Flags.Human); AI_ON
    -- is no use for that, it is true for players too. For a player,
    -- UnitName is the player's name.
    local human = (type(v.Flags) == 'table' and v.Flags.Human) and 1 or 0
    return string.format('A\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%s\t%s\t%d\t%d\t%d\t%d\n',
      id, clean(v.Name), v.LatLongAlt.Lat, v.LatLongAlt.Long, v.LatLongAlt.Alt,
      v.Heading or 0, clean(v.UnitName), clean(v.GroupName), v.CoalitionID or 0,
      t.level1 or 0, t.level2 or 0, human)
  end

  -- Airbases: DCS's own airfields (and whatever else it counts as one), from
  -- LoGetWorldObjects('airdromes') -- they are not in the plain object list.
  -- B<TAB>id<TAB>name<TAB>lat<TAB>lon<TAB>alt<TAB>hdg<TAB>coalition<TAB>level2
  local function base_line(id, v)
    local t = v.Type or {}
    return string.format('B\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%d\t%d\n',
      id, clean(v.Name), v.LatLongAlt.Lat, v.LatLongAlt.Long, v.LatLongAlt.Alt,
      v.Heading or 0, v.CoalitionID or 0, t.level2 or 0)
  end

  -- Sent at mission start and then once a minute: cheap (a few dozen lines),
  -- picks up a base changing hands, and reaches a server started mid-mission.
  local function emit_bases()
    local ok, bases = pcall(Export.LoGetWorldObjects, 'airdromes')
    if not ok or type(bases) ~= 'table' then return end
    for id, v in pairs(bases) do
      if v.LatLongAlt then emit(base_line(id, v)) end
    end
  end

  -- Trigger zones from the mission file: circles and quads the mission
  -- builder placed (FOBs, objectives, spawn points). Converted to lat/lon
  -- here, where the theater's projection is known, once per mission -- a
  -- thousand zones of up to five points each is too much to redo per send.
  -- Z<TAB>id<TAB>name<TAB>hidden<TAB>type<TAB>radius<TAB>lat<TAB>lon<TAB>r,g,b,a<TAB>lat,lon;lat,lon;...
  -- type 0 is a circle (radius), 2 a quad (the vertex list).
  local function build_zone_lines()
    local lines = {}
    local ok_m, cm = pcall(DCS.getCurrentMission)
    if not ok_m or type(cm) ~= 'table' then return lines end
    local m = cm.mission or cm
    local zones = m.triggers and m.triggers.zones
    if type(zones) ~= 'table' then return lines end
    local toGeo = Export.LoLoCoordinatesToGeoCoordinates
    for _, z in pairs(zones) do
      pcall(function()
        local ll = toGeo(z.x, z.y)
        local verts = {}
        if z.type == 2 and type(z.verticies) == 'table' then
          for _, v in ipairs(z.verticies) do
            local p = toGeo(v.x, v.y)
            verts[#verts + 1] = string.format('%.6f,%.6f', p.latitude, p.longitude)
          end
        end
        local c = z.color or {}
        lines[#lines + 1] = string.format('Z\t%d\t%s\t%d\t%d\t%.1f\t%.6f\t%.6f\t%.2f,%.2f,%.2f,%.2f\t%s\n',
          z.zoneId or 0, clean(z.name), z.hidden and 1 or 0, z.type or 0, z.radius or 0,
          ll.latitude, ll.longitude, c[1] or 1, c[2] or 1, c[3] or 1, c[4] or 0.15,
          table.concat(verts, ';'))
      end)
    end
    log('trigger zones: ' .. #lines)
    return lines
  end

  -- The player's own flight plan, fixed waypoints only:
  -- R<TAB>source<TAB>next<TAB>lat,lon,alt,name;lat,lon,alt,name;...
  -- source is 'aircraft' (LoGetRoute) or 'mission' (the group's route in the
  -- mission file); an empty source means there is none. next is the index
  -- of the waypoint being flown to, -1 when unknown. The whole route goes in
  -- one line, so a shorter route can't leave stale points behind.
  -- Not covered, because DCS doesn't hand them out: waypoints entered in the
  -- cockpit or with the F10 route tool on modules with their own navigation
  -- computer (F-16C and the like -- LoGetRoute stays nil), and dynamic-spawn
  -- slots, which have no group in the mission file.
  local MAX_WAYPOINTS = 100

  local function route_line(source, next_idx, pts)
    local parts = {}
    for i, p in ipairs(pts) do
      if i > MAX_WAYPOINTS then break end
      parts[#parts + 1] = string.format('%.6f,%.6f,%.0f,%s', p.lat, p.lon, p.alt or 0,
                                        (clean(p.name):gsub('[,;]', ' ')))
    end
    return string.format('R\t%s\t%d\t%s\n', source, next_idx, table.concat(parts, ';'))
  end

  -- What the aircraft itself reports. Mostly the simpler (FC3-style)
  -- aircraft; full-fidelity modules return nil.
  local function aircraft_route()
    local ok, r = pcall(Export.LoGetRoute)
    if not ok or type(r) ~= 'table' or type(r.route) ~= 'table' then return nil end
    local list = {}
    for _, wp in pairs(r.route) do
      if type(wp) == 'table' and type(wp.world_point) == 'table' then list[#list + 1] = wp end
    end
    table.sort(list, function(a, b) return (a.this_point_num or 0) < (b.this_point_num or 0) end)
    local goto_num = type(r.goto_point) == 'table' and r.goto_point.this_point_num or nil
    local toGeo = Export.LoLoCoordinatesToGeoCoordinates
    local pts, next_idx = {}, -1
    for _, wp in ipairs(list) do
      local w = wp.world_point
      -- World x is north, z east, y up.
      local ok_g, g = pcall(toGeo, w.x, w.z)
      if ok_g and type(g) == 'table' then
        pts[#pts + 1] = { lat = g.latitude, lon = g.longitude, alt = w.y or 0, name = '' }
        if goto_num ~= nil and wp.this_point_num == goto_num then next_idx = #pts - 1 end
      end
    end
    if #pts == 0 then return nil end
    return route_line('aircraft', next_idx, pts)
  end

  -- The slot is the mission's unitId ("1234", or "1234_2" for a second
  -- seat). Empty in single player, where the unit name finds it instead.
  local function my_slot()
    local ok, slot = pcall(function() return net.get_player_info(net.get_my_player_id(), 'slot') end)
    if ok and slot ~= nil then return tostring(slot):match('^(%d+)') end
    return nil
  end

  local function mission_route(slot, unit_name)
    local ok_m, cm = pcall(DCS.getCurrentMission)
    if not ok_m or type(cm) ~= 'table' then return nil end
    local m = cm.mission or cm
    if type(m.coalition) ~= 'table' then return nil end
    local toGeo = Export.LoLoCoordinatesToGeoCoordinates
    for _, side in pairs(m.coalition) do
      for _, country in pairs((type(side) == 'table' and side.country) or {}) do
        for _, cat in ipairs({ 'plane', 'helicopter' }) do
          local groups = (type(country[cat]) == 'table' and country[cat].group) or {}
          for _, g in pairs(groups) do
            for _, u in pairs((type(g) == 'table' and g.units) or {}) do
              local hit = (slot ~= nil and tostring(u.unitId) == slot)
                       or (unit_name ~= nil and unit_name ~= '' and u.name == unit_name)
              if hit then
                local pts = {}
                for _, p in ipairs((g.route and g.route.points) or {}) do
                  local ok_g, geo = pcall(toGeo, p.x, p.y)
                  if ok_g and type(geo) == 'table' then
                    pts[#pts + 1] = { lat = geo.latitude, lon = geo.longitude, alt = p.alt or 0, name = p.name or '' }
                  end
                end
                if #pts == 0 then return nil end
                return route_line('mission', -1, pts)
              end
            end
          end
        end
      end
    end
    return nil
  end

  local function emit_route(self_data)
    local line = aircraft_route()
    local source = line and 'aircraft' or nil
    if not line then
      local slot = my_slot()
      local key = tostring(slot) .. '|' .. tostring(self_data.UnitName)
      if key ~= route_key then
        route_key = key
        local ok_r, r = pcall(mission_route, slot, self_data.UnitName)
        route_cache = (ok_r and r) or false
      end
      line = route_cache or 'R\t\t-1\t\n'
      source = route_cache and 'mission' or 'none'
    end
    if source ~= route_source then
      route_source = source
      log('flight plan: ' .. (source == 'aircraft' and 'reported by the aircraft'
        or source == 'mission' and 'from the mission file'
        or 'none (dynamic slot, or no route in the mission)'))
    end
    emit(line)
  end

  function mm.onSimulationStart()
    udp = socket.udp()
    udp:settimeout(0)          -- non-blocking: the sim thread never waits on this
    next_send = 0
    sweep, seen, current = {}, {}, {}
    buffer, buffer_len = {}, 0
    next_bases = 0
    objects_blocked = false
    zone_lines = nil
    next_zones = 0
    next_route = 0
    route_key, route_cache, route_source = nil, nil, nil
    log('export started -> ' .. HOST .. ':' .. PORT .. ' (' .. port_source .. ')')

    -- Mission start time, seconds after midnight. The export API has it
    -- directly; the mission table is the fallback. Neither is guaranteed,
    -- so an unknown start is sent as an empty field rather than a guess.
    start_time = ''
    local ok_st, st = pcall(function() return Export.LoGetMissionStartTime() end)
    if not (ok_st and tonumber(st)) then
      ok_st, st = pcall(function()
        local m = DCS.getCurrentMission()
        return m and m.mission and m.mission.start_time
      end)
    end
    if ok_st and tonumber(st) then start_time = string.format('%.0f', tonumber(st)) end
    log('mission start time: ' .. (start_time ~= '' and start_time or 'unknown'))

    -- Probe: without this there's no way to tell apart LoGetWorldObjects
    -- being missing in the hooks environment, returning empty, or returning
    -- objects without a GroupName. All three look the same from outside.
    log('LoGetWorldObjects is ' .. type(Export.LoGetWorldObjects))
    local ok_probe, probe = pcall(Export.LoGetWorldObjects)
    if not ok_probe then
      log('LoGetWorldObjects() threw: ' .. tostring(probe))
    elseif type(probe) ~= 'table' then
      log('LoGetWorldObjects() returned ' .. type(probe))
    else
      local total, with_group, with_pos, first = 0, 0, 0, nil
      for id, v in pairs(probe) do
        total = total + 1
        if v.GroupName ~= nil then with_group = with_group + 1 end
        if v.LatLongAlt ~= nil then with_pos = with_pos + 1 end
        if first == nil then
          first = string.format('id=%s Name=%s GroupName=%s UnitName=%s Coalition=%s level1=%s',
            tostring(id), tostring(v.Name), tostring(v.GroupName), tostring(v.UnitName),
            tostring(v.CoalitionID), tostring(v.Type and v.Type.level1))
        end
      end
      log(string.format('LoGetWorldObjects(): %d objects, %d with a GroupName, %d with a position',
                        total, with_group, with_pos))
      if first then log('first object: ' .. first) end
    end

    -- Cross-check with the explicit argument; the default is "units".
    local ok_units, units = pcall(Export.LoGetWorldObjects, 'units')
    if ok_units and type(units) == 'table' then
      local n = 0
      for _ in pairs(units) do n = n + 1 end
      log(string.format("LoGetWorldObjects('units'): %d objects", n))
    else
      log("LoGetWorldObjects('units') not usable: " .. tostring(units))
    end
  end

  function mm.onSimulationStop()
    if udp then
      pcall(function() udp:sendto('close_socket', HOST, PORT) end)
      udp:close()
      udp = nil
    end
    log('export stopped')
  end

  function mm.onSimulationFrame()
    if not udp then return end
    local now = DCS.getModelTime()
    if now < next_send then return end
    next_send = now + INTERVAL

    local self_data = Export.LoGetSelfData()
    if not self_data or not self_data.LatLongAlt then return end

    local opts = DCS.getMissionOptions()
    options_view = opts and opts.difficulty and opts.difficulty.optionsView or 'optview_all'

    buffer = { header(now) }
    buffer_len = #buffer[1]

    local own_id = Export.LoGetPlayerPlaneId() or 0
    emit(ownship_line(own_id, self_data))

    if now >= next_bases then
      next_bases = now + BASES_EVERY
      emit_bases()
    end

    -- Built on the first frame with own data: the terrain's coordinate
    -- conversion is only reliable once the player is in the world.
    if now >= next_zones then
      next_zones = now + ZONES_EVERY
      if zone_lines == nil then zone_lines = build_zone_lines() end
      for _, line in ipairs(zone_lines) do emit(line) end
    end

    if now >= next_route then
      next_route = now + ROUTE_EVERY
      emit_route(self_data)
    end

    -- Under a restricted view, don't even send -- rather than relying on
    -- filtering further down the line.
    if options_view ~= 'optview_onlymap' and options_view ~= 'optview_myaircraft' then
      if next(sweep) == nil then
        -- Sweep complete: report anything that vanished, then start a new one.
        for id in pairs(seen) do
          if not current[id] then emit(string.format('D\t%d\n', id)) end
        end
        seen, current = current, {}
        local ok_objs, objs = pcall(Export.LoGetWorldObjects)
        objects_blocked = not (ok_objs and type(objs) == 'table')
        sweep = objects_blocked and {} or objs
        diag_objects = 0
        for _ in pairs(sweep) do diag_objects = diag_objects + 1 end
      end

      local budget = SWEEP_BUDGET
      for id, v in pairs(sweep) do
        sweep[id] = nil
        -- LoGetWorldObjects() includes the player's own aircraft too -- it
        -- already went out above as the dedicated O line, so skip it here,
        -- otherwise the client draws a second, ordinary contact symbol right
        -- on top of its own ownship marker.
        if v.LatLongAlt and id ~= own_id then
          local line = object_line(id, v)
          if line then
            emit(line)
            current[id] = true
            budget = budget - 1
            diag_sent = diag_sent + 1
          end
        end
        if budget <= 0 then break end
      end
    end

    -- Record what DCS actually gives us every ten seconds. Without this
    -- there's no way to tell whether missing contacts are held back by the
    -- mission's view setting or the export itself returns nothing.
    if now >= diag_at then
      diag_at = now + 10
      log(string.format('optionsView=%s  objects=%d  sent=%d',
                        tostring(options_view), diag_objects, diag_sent))
      if options_view == 'optview_onlymap' or options_view == 'optview_myaircraft' then
        log('mission is withholding other units (map view setting in the '
            .. 'mission or server options)')
      end
      if diag_send_errors > 0 then
        log(string.format('%d datagram(s) failed to send, last error: %s', diag_send_errors, diag_send_error))
      end
      diag_sent = 0
      diag_send_errors = 0
    end

    flush()
  end

  DCS.setUserCallbacks(mm)
  log('loaded (schema ' .. SCHEMA .. ')')
end

local ok, err = pcall(load_hook)
if not ok then
  net.log('[map-server] load error: ' .. tostring(err))
end
