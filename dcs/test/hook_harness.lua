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
end

DCS = {
  getModelTime = function() return t end,
  getMissionOptions = function() return { difficulty = { optionsView = OPTIONS_VIEW } } end,
  setUserCallbacks = function(cb) _G.__cb = cb end,
}

Export = {
  LoGetModelTime = function() return t end,
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
  LoGetWorldObjects = function()
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
io.stderr:write(string.format('Datagrams: %d\n', #sent))
