import json

# Load two calibration points from config/map_config.json
with open("config/map_config.json") as f:
    cfg = json.load(f)
p1 = cfg["pixel1"]
p2 = cfg["pixel2"]
g1 = cfg["geo1"]
g2 = cfg["geo2"]

# Compute affine transform from pixel to geo
dx_px = p2[0] - p1[0]
dy_px = p2[1] - p1[1]
dx_lat = g2[0] - g1[0]
dy_lon = g2[1] - g1[1]

def pixel_to_latlon(x, y):
    lat = g1[0] + (y - p1[1]) * dx_lat / dy_px  # vertical pixels affect latitude
    lon = g1[1] + (x - p1[0]) * dy_lon / dx_px  # horizontal pixels affect longitude
    return (lat, lon)

