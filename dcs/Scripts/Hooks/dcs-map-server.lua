-------------------------------------------------------------------------------
-- dcs-map-server -- Export-Hook
--
-- Sendet Positionsdaten per UDP an einen lokal laufenden Server.
-- Schema 2: tabgetrennt, gebuendelt, versioniert.
--
-- Installation: nach Saved Games\DCS\Scripts\Hooks\
-------------------------------------------------------------------------------

local SCHEMA        = 3
local HOST          = '127.0.0.1'   -- bewusst nur Loopback, der LAN-Hop ist WebSocket
local PORT          = 50000
local INTERVAL      = 0.1           -- 10 Hz, wie vom Client erwartet
local MAX_DATAGRAM  = 8000          -- ueber Loopback unkritisch, haelt die Latenz klein
local SWEEP_BUDGET  = 120           -- Objekte pro Tick; begrenzt die Lua-Last im Sim-Thread

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
  local sweep = {}          -- Restliste des laufenden Durchlaufs
  local seen = {}           -- IDs aus dem letzten vollstaendigen Durchlauf
  local current = {}        -- IDs des laufenden Durchlaufs
  local buffer = {}
  local buffer_len = 0

  --- Tabs und Zeilenumbrueche wuerden das Format zerlegen. Komma darf bleiben:
  --- DCS-Unit- und Gruppennamen enthalten regelmaessig Kommata, Tabs praktisch nie.
  local function clean(s)
    if s == nil then return '' end
    return (tostring(s):gsub('[\t\r\n]', ' '))
  end

  local function flush()
    if buffer_len == 0 then return end
    local payload = table.concat(buffer)
    buffer, buffer_len = {}, 0
    -- Ein fehlgeschlagenes Senden darf die Simulation nie anhalten.
    pcall(function() udp:sendto(payload, HOST, PORT) end)
  end

  local function emit(line)
    if buffer_len + #line > MAX_DATAGRAM then
      flush()
      -- Jedes Datagramm traegt einen eigenen Kopf, damit es fuer sich lesbar ist.
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

    -- Weight on Wheels ueber die Einfederung eines beliebigen Fahrwerksbeins.
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
    if v.GroupName ~= nil then
      -- level1 und level2 mitschicken: Ohne sie laesst sich Flugabwehr nicht von
      -- sonstigen Bodenzielen trennen, und nur Erstere bekommt einen Bedrohungsring.
      local t = v.Type or {}
      return string.format('A\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%s\t%s\t%d\t%d\t%d\n',
        id, clean(v.Name), v.LatLongAlt.Lat, v.LatLongAlt.Long, v.LatLongAlt.Alt,
        v.Heading or 0, clean(v.UnitName), clean(v.GroupName), v.CoalitionID or 0,
        t.level1 or 0, t.level2 or 0)
    elseif v.Type and v.Type.level1 == 4 and v.Type.level2 == 4 then
      return string.format('W\t%d\t%s\t%.6f\t%.6f\t%.1f\t%.5f\t%d\n',
        id, clean(v.Name), v.LatLongAlt.Lat, v.LatLongAlt.Long, v.LatLongAlt.Alt,
        v.Heading or 0, v.CoalitionID or 0)
    end
    return nil
  end

  function mm.onSimulationStart()
    udp = socket.udp()
    udp:settimeout(0)          -- nicht blockierend: der Sim-Thread wartet auf nichts
    next_send = 0
    sweep, seen, current = {}, {}, {}
    buffer, buffer_len = {}, 0
    log('Export gestartet -> ' .. HOST .. ':' .. PORT)
  end

  function mm.onSimulationStop()
    if udp then
      pcall(function() udp:sendto('close_socket', HOST, PORT) end)
      udp:close()
      udp = nil
    end
    log('Export beendet')
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

    -- Bei eingeschraenkter Sicht gar nicht erst senden, statt sich auf eine
    -- nachgelagerte Filterung zu verlassen.
    if options_view ~= 'optview_onlymap' and options_view ~= 'optview_myaircraft' then
      if next(sweep) == nil then
        -- Durchlauf abgeschlossen: Verschwundene melden und neu beginnen.
        for id in pairs(seen) do
          if not current[id] then emit(string.format('D\t%d\n', id)) end
        end
        seen, current = current, {}
        sweep = Export.LoGetWorldObjects() or {}
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
          end
        end
        if budget <= 0 then break end
      end
    end

    flush()
  end

  DCS.setUserCallbacks(mm)
  log('geladen (Schema ' .. SCHEMA .. ')')
end

local ok, err = pcall(load_hook)
if not ok then
  net.log('[map-server] Ladefehler: ' .. tostring(err))
end
