-- Drives the export hook against mocked DCS APIs and writes the generated
-- datagrams to stdout. This lets the wire format be checked without DCS.

local FRAMES = tonumber(arg[1]) or 40
local OPTIONS_VIEW = arg[2] or 'optview_all'
local N_OBJECTS = tonumber(arg[3]) or 150
local MOVING_SHARE = tonumber(arg[5]) or 0

local sent = {}
package.preload['socket'] = function()
  return {
    udp = function()
      return {
        settimeout = function() end,
        close = function() end,
        sendto = function(_, payload) sent[#sent + 1] = payload end,
      }
    end,
  }
end

net = { log = function(m) io.stderr:write(m, '\n') end }

local t = 0.0
local objects = {}
for i = 1, N_OBJECTS do
  -- Mixed object types, so the server's classification can be checked.
  -- level1: 1 Air, 2 Ground, 3 Navy, 4 Weapon, 5 Static
  local kind = i % 7
  local name, l1, l2
  if kind == 0 then      name, l1, l2 = 'AIM_120C', 4, 4
  elseif kind == 1 then  name, l1, l2 = 'S-300PS 5P85C LN', 2, 0
  elseif kind == 2 then  name, l1, l2 = '2S6 Tunguska', 2, 0
  elseif kind == 3 then  name, l1, l2 = 'T-72B', 2, 0
  elseif kind == 4 then  name, l1, l2 = 'MiG-29A', 1, 1
  elseif kind == 5 then  name, l1, l2 = 'Ka-50', 1, 2
  else                   name, l1, l2 = 'Frigate', 3, 0
  end
  local is_weapon = (kind == 0)

  objects[1000 + i] = {
    Name = name,
    -- Watch out, Lua pitfall: `cond and nil or X` always evaluates to X. Hence if/else.
    GroupName = nil,
    UnitName = 'Unit-' .. i,
    CoalitionID = (i % 2) + 1,
    Heading = i / 100,
    Type = { level1 = l1, level2 = l2 },
    LatLongAlt = { Lat = 42.0 + i * 0.001, Long = 41.0 + i * 0.001, Alt = 100 + i },
  }
  if not is_weapon then
    -- Deliberately with a comma and a tab: the comma must be preserved, the tab defused.
    objects[1000 + i].GroupName = 'Convoy, Group\t' .. i
  end
  -- One aircraft flown by a person, for the Flags.Human field of A lines.
  if kind == 4 and i < 10 then objects[1000 + i].Flags = { Human = true, AI_ON = true } end
end

DCS = {
  getModelTime = function() return t end,
  getCurrentMission = function()
    return { mission = {
      triggers = { zones = {
        { zoneId = 7, name = 'FOB Vulture', hidden = false, type = 0, radius = 762, x = -69625, y = 485002,
          color = { 1, 1, 1, 0.15 } },
        { zoneId = 8, name = 'A', hidden = false, type = 2, radius = 0, x = 0, y = 0,
          verticies = { { x = 0, y = 0 }, { x = 100, y = 0 }, { x = 100, y = 100 }, { x = 0, y = 100 } } },
      } },
      -- The player's group, found by unit name as in single player. Waypoint
      -- names with a comma and a semicolon: both separate fields on the wire.
      coalition = { blue = { country = { { plane = { group = { {
        units = { { unitId = 17, name = 'Hornet-1-1' } },
        route = { points = {
          { x = 0, y = 0, alt = 0, name = '' },
          { x = 11100, y = 8000, alt = 6000, name = 'IP, north;1' },
          { x = 22200, y = 16000, alt = 6000, name = 'TGT' },
        } },
      } } } } } } },
    } }
  end,
  getMissionOptions = function() return { difficulty = { optionsView = OPTIONS_VIEW } } end,
  setUserCallbacks = function(cb) _G.__cb = cb end,
}

Export = {
  LoGetModelTime = function() return t end,
  LoGetMissionStartTime = function() return 22800 end, -- 06:20
  LoLoCoordinatesToGeoCoordinates = function(x, z)
    return { latitude = 44 + x / 111000, longitude = 40 + z / 80000 }
  end,
  LoGetPlayerPlaneId = function() return 1 end,
  LoGetSelfData = function()
    return {
      Name = 'FA-18C_hornet',
      UnitName = 'Hornet-1-1',
      GroupName = 'Hornet, Flight 1',   -- the comma must be preserved
      CoalitionID = 2,
      Heading = 1.2345,
      LatLongAlt = { Lat = 41.61 + t * 0.001, Long = 41.60 + t * 0.001, Alt = 2000 + t },
    }
  end,
  LoGetVectorWindVelocity = function() return { x = 3.2, y = 0, z = -1.8 } end,
  LoGetSnares = function() return { chaff = 60, flare = 60 } end,
  LoGetAltitudeAboveGroundLevel = function() return 1985 end,
  LoGetAccelerationUnits = function() return { y = 1.05 } end,
  LoGetAircraftDrawArgumentValue = function() return 0 end,
  LoGetTrueAirSpeed = function() return 230.5 end,
  LoGetAngleOfAttack = function() return 4.2 end,
  LoGetWorldObjects = function(kind)
    if kind == 'airdromes' then
      -- Deliberately with a comma in the name, like the units.
      return {
        [5001] = { Name = 'Kutaisi, Kopitnari', CoalitionID = 0, Heading = 4.43,
                   Type = { level1 = 5, level2 = 13 },
                   LatLongAlt = { Lat = 42.179, Long = 42.496, Alt = 45 } },
      }
    end
    local copy = {}
    for k, v in pairs(objects) do copy[k] = v end
    return copy
  end,
}

dofile(arg[4] or 'dcs/Scripts/Hooks/dcs-map-server.lua')
local cb = _G.__cb
assert(cb, 'setUserCallbacks was not called')

cb.onSimulationStart()
for _ = 1, FRAMES do
  cb.onSimulationFrame()
  t = t + 0.1
  -- Move ground targets: without this, only the best case of stationary
  -- objects is measured. MOVING_SHARE controls what fraction moves.
  local moving = math.floor(N_OBJECTS * MOVING_SHARE)
  for i = 1, moving do
    local o = objects[1000 + i]
    if o then
      o.LatLongAlt.Lat = o.LatLongAlt.Lat + 0.00002
      o.LatLongAlt.Long = o.LatLongAlt.Long + 0.00001
    end
  end
  -- Remove a few objects partway through, to provoke D packets.
  if math.abs(t - FRAMES * 0.05) < 0.051 then
    for i = 1, 20 do objects[1000 + i] = nil end
  end
end
cb.onSimulationStop()

for _, p in ipairs(sent) do io.write(p) end

-- Check what the hook actually produced.
--
-- Running it against mocked APIs only proves it does not crash. The wire
-- format is the one thing a mistake in stays invisible until someone is in
-- the cockpit, and it is also the part a user can least diagnose -- so the
-- harness states the contract rather than printing it and hoping somebody
-- reads carefully.

local function fail(msg, line)
  io.stderr:write('hook_harness: ', msg, '\n')
  if line then io.stderr:write('  in: ', (line:gsub('\t', '<TAB>')), '\n') end
  os.exit(1)
end

local function fields(line)
  local out = {}
  for f in (line .. '\t'):gmatch('([^\t]*)\t') do out[#out + 1] = f end
  return out
end

-- Schema 3 field counts, the same table src/server/protocol.ts parses by.
-- A lines carry Flags.Human as a 13th field; the parser also still takes the
-- older 12-field line, but this hook always writes 13.
local LAYOUT = { O = 20, A = 13, W = 8, D = 2, B = 9, Z = 10, R = 4 }

local counts = { O = 0, A = 0, W = 0, D = 0, B = 0, Z = 0, R = 0 }
local headers, closed = 0, false
local own_id = nil
local ids_as_unit = {}
local humans = 0
local route = nil

for _, payload in ipairs(sent) do
  if payload:match('^close_socket') then
    closed = true
  else
    local first = true
    for line in payload:gmatch('[^\n]+') do
      if line:find('\r') then fail('a carriage return reached the wire', line) end

      if first then
        local f = fields(line)
        if f[1] ~= 'MM' then fail('datagram does not start with a header line', line) end
        if f[2] ~= '3' then fail('header does not announce schema 3', line) end
        if not tonumber(f[3]) then fail('header carries no model time', line) end
        if f[4] ~= OPTIONS_VIEW then
          fail(string.format('header says optionsView=%s, expected %s', tostring(f[4]), OPTIONS_VIEW), line)
        end
        if f[5] ~= '22800' then
          fail(string.format('header says mission start=%s, expected 22800', tostring(f[5])), line)
        end
        -- Sixth field: '1' only when the objects are blocked; here they are not.
        if f[6] ~= '' then
          fail(string.format('header flags blocked objects (%s) though they were delivered', tostring(f[6])), line)
        end
        headers = headers + 1
        first = false
      else
        local f = fields(line)
        local kind = f[1]
        local want = LAYOUT[kind]
        if not want then fail('unknown line type ' .. tostring(kind), line) end
        if #f ~= want then
          fail(string.format('%s line has %d fields, expected %d', kind, #f, want), line)
        end
        if kind == 'R' then
          -- R<TAB>source<TAB>next<TAB>lat,lon,alt,name;... -- no id, a source instead.
          if f[2] ~= '' and f[2] ~= 'mission' and f[2] ~= 'aircraft' then
            fail('R line has an unknown source ' .. tostring(f[2]), line)
          end
          if not tonumber(f[3]) then fail('R line has no numeric next waypoint', line) end
          for p in (f[4] .. ';'):gmatch('([^;]*);') do
            if f[4] ~= '' and not p:match('^%-?[%d.]+,%-?[%d.]+,%-?%d+,[^,]*$') then
              fail('R line has a malformed waypoint "' .. p .. '"', line)
            end
          end
          route = f
        elseif not tonumber(f[2]) then
          fail(kind .. ' line has no numeric id', line)
        end
        if kind == 'A' then
          if f[13] ~= '0' and f[13] ~= '1' then fail('A line has no 0/1 human flag', line) end
          if f[13] == '1' then humans = humans + 1 end
        end
        counts[kind] = counts[kind] + 1

        if kind == 'O' then own_id = f[2] end
        if kind == 'A' or kind == 'W' then ids_as_unit[f[2]] = true end
        if (kind == 'A' or kind == 'W') and (f[3] == nil or f[3] == '') then
          fail(kind .. ' line has an empty type name', line)
        end
      end
    end
  end
end

if headers == 0 then fail('no datagram was sent at all') end
if counts.O == 0 then fail('the own aircraft was never sent') end
if counts.A == 0 then fail('no other units were sent') end
if counts.D == 0 then fail('objects were removed but no D line was sent') end
if counts.B == 0 then fail('the airbase list was never sent') end
if counts.Z == 0 then fail('the trigger zones were never sent') end
if not closed then fail('the session did not end with close_socket') end
if humans == 0 then fail('a unit flown by a person was not flagged as human') end

-- The flight plan comes from the mission file (the mocked aircraft reports
-- no route of its own): all three waypoints, separators in names defused.
if counts.R == 0 or not route then fail('the flight plan was never sent') end
if route[2] ~= 'mission' then fail('flight plan source is "' .. route[2] .. '", expected mission') end
local n = 0
for _ in (route[4] .. ';'):gmatch('([^;]*);') do n = n + 1 end
if n ~= 3 then fail(string.format('flight plan has %d waypoints, expected 3', n)) end

-- LoGetWorldObjects() includes the player's own aircraft. It already has its
-- own O line, and a second copy would draw the same aircraft twice.
if own_id and ids_as_unit[own_id] then
  fail('the own aircraft was also sent as an ordinary unit, id ' .. own_id)
end

-- The mocked group name carries a comma and a tab: the comma has to survive,
-- the tab must not reach the wire. Field counts above already prove no tab
-- did; this proves the comma was not stripped with it.
local saw_comma = false
for _, payload in ipairs(sent) do
  if payload:find('Convoy, Group', 1, true) then saw_comma = true end
end
if not saw_comma then fail('a comma in a group name did not survive') end

io.stderr:write(string.format(
  'Datagrams: %d  (O %d, A %d, W %d, D %d, B %d, R %d)  -- format OK\n',
  #sent, counts.O, counts.A, counts.W, counts.D, counts.B, counts.R))
