import math

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def compute_closest_distance(cars, target):
    """
    Find the closest car's distance and its coordinates.

    Args:
        cars: list of (lat, lon) tuples
        target: (lat, lon) tuple

    Returns:
        (float, (lat, lon)): (distance in km, coordinates of closest car)
    """
    if not cars:
        return None, None

    closest_car = min(cars, key=lambda car: haversine(car[0], car[1], target[0], target[1]))
    closest_dist = haversine(closest_car[0], closest_car[1], target[0], target[1])
    return closest_dist, closest_car
