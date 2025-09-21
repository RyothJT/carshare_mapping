import cv2
from geopy.distance import geodesic

def create_debug_map(screenshot_path, car_coords, ref_point, closest_coord):
    """
    Creates a debug map image with car positions labeled and closest car marked,
    computing pixel positions from geographic coordinates using two reference points.

    Args:
        screenshot_path (str): Path to the original screenshot.
        car_coords (list of (lat, lon)): Geographic coordinates of cars.
        ref_point (lat, lon): Fixed reference point.
        closest_coord (lat, lon): Geographic coordinates of the closest car.
    """
    # Two reference points from your JSON
    pixel1 = (199, 250)
    geo1 = (45.013270, -93.308237)

    pixel2 = (2361, 1297)
    geo2 = (44.925733, -93.052804)

    # Calculate scaling (pixels per degree)
    scale_x = (pixel2[0] - pixel1[0]) / (geo2[1] - geo1[1])  # longitude difference
    scale_y = (pixel2[1] - pixel1[1]) / (geo2[0] - geo1[0])  # latitude difference

    def geo_to_pixel(lat, lon):
        """Convert geographic coordinates to pixel coordinates."""
        x = pixel1[0] + (lon - geo1[1]) * scale_x
        y = pixel1[1] + (lat - geo1[0]) * scale_y
        return int(round(x)), int(round(y))

    img = cv2.imread(screenshot_path)

    # Convert all cars from geo coords to pixels
    car_pixels = [geo_to_pixel(lat, lon) for lat, lon in car_coords]

    # Draw all cars with number and distance
    for i, ((x, y), latlon) in enumerate(zip(car_pixels, car_coords)):
        dist = geodesic(latlon, ref_point).km
        cv2.circle(img, (x, y), 10, (0, 0, 255), 2)  # Red circle
        cv2.putText(img, f"#{i+1}", (x + 12, y - 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(img, f"{dist:.2f} km", (x + 12, y + 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1, cv2.LINE_AA)

    # Mark closest car
    closest_pixel = geo_to_pixel(*closest_coord)
    cv2.drawMarker(img, closest_pixel, (255, 0, 255), cv2.MARKER_CROSS, 30, 3)

    debug_path = screenshot_path.replace(".png", "_debug.png")
    cv2.imwrite(debug_path, img)
    print(f"[DEBUG] Saved debug map: {debug_path}")
