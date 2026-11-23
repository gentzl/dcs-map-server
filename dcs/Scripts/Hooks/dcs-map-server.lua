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
local PORT          = 50000
local INTERVAL      = 0.1           -- 10 Hz, matching what the client expects
local MAX_DATAGRAM  = 8000          -- uncritical over loopback, keeps latency low
local SWEEP_BUDGET  = 120           -- objects per tick; bounds the Lua load on the sim thread

local function log(msg)
  net.log('[map-server] ' .. msg)
end

local function load_hook()
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
    -- A failed send must never stall the simulation.
    pcall(function() udp:sendto(payload, HOST, PORT) end)
  end

  local function emit(line)
    if buffer_len + #line > MAX_DATAGRAM then
      flush()
      -- Every datagram carries its own header, so it stays readable on its own.
      local header = string.format('MM\t%d\t%.3f\t%s\n', SCHEMA,
                                   Export.LoGetModelTime() or 0, options_view or '')
      buffer[#buffer + 1] = header
      buffer_len = #header
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
    return string.format('A\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%s\t%s\t%d\t%d\t%d\n',
      id, clean(v.Name), v.LatLongAlt.Lat, v.LatLongAlt.Long, v.LatLongAlt.Alt,
      v.Heading or 0, clean(v.UnitName), clean(v.GroupName), v.CoalitionID or 0,
      t.level1 or 0, t.level2 or 0)
  end

  function mm.onSimulationStart()
    udp = socket.udp()
    udp:settimeout(0)          -- non-blocking: the sim thread never waits on this
    next_send = 0
    sweep, seen, current = {}, {}, {}
    buffer, buffer_len = {}, 0
    log('export started -> ' .. HOST .. ':' .. PORT)

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

    buffer = { string.format('MM\t%d\t%.3f\t%s\n', SCHEMA, now, options_view) }
    buffer_len = #buffer[1]

    emit(ownship_line(Export.LoGetPlayerPlaneId() or 0, self_data))

    -- Under a restricted view, don't even send -- rather than relying on
    -- filtering further down the line.
    if options_view ~= 'optview_onlymap' and options_view ~= 'optview_myaircraft' then
      if next(sweep) == nil then
        -- Sweep complete: report anything that vanished, then start a new one.
        for id in pairs(seen) do
          if not current[id] then emit(string.format('D\t%d\n', id)) end
        end
        seen, current = current, {}
        sweep = Export.LoGetWorldObjects() or {}
        diag_objects = 0
        for _ in pairs(sweep) do diag_objects = diag_objects + 1 end
      end

      local budget = SWEEP_BUDGET
      for id, v in pairs(sweep) do
        sweep[id] = nil
        if v.LatLongAlt then
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
      diag_sent = 0
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
