import re

X_SCALE = 1.4523
X_OFFSET = 10
Y_SCALE = 1.4554
Y_OFFSET = 8.2107

def detect_cars_from_html(driver, debug=False):
    markers = driver.find_elements("css selector", "img.leaflet-marker-icon")

    points = []
    for marker in markers:
        style = marker.get_attribute("style")
        match = re.search(r"translate3d\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px", style)
        if match:
            raw_x = float(match.group(1))
            raw_y = float(match.group(2))

            scaled_x = int(raw_x * X_SCALE + X_OFFSET)
            scaled_y = int(raw_y * Y_SCALE + Y_OFFSET)

            points.append((scaled_x, scaled_y))

    if debug:
        print(f"[DEBUG] Found {len(points)} markers after scaling")
        for i, (x, y) in enumerate(points):
            print(f"  Marker #{i+1}: x={x}, y={y}")

    return points

