from geopy.distance import geodesic

def compute_distances(points, ref_point):
    return [geodesic(p, ref_point).km for p in points]
