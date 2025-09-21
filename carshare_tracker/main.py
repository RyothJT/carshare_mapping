import os
import time
import datetime
import csv
import json
import itertools
import sys
import threading
import tty
import termios
import sqlite3
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from utils.detect import detect_cars_from_html
from utils.transform import pixel_to_latlon
from utils.distance import compute_distances
from utils.closest import compute_closest_distance
from utils.debug_image import create_debug_map

stop_event = threading.Event()

def monitor_exit_key():
    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        while not stop_event.is_set():
            ch = sys.stdin.read(1)
            if ch.lower() == 'q':
                print("\n[!] q key pressed. Exiting cleanly...")
                stop_event.set()
                break
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

threading.Thread(target=monitor_exit_key, daemon=True).start()

def show_spinner_with_distance(dist_km):
    if (dist_km is not None and dist_km >= 0):
        sys.stdout.write(f"Scanning... {next(spinner)} | Closest: {dist_km:.2f} km | Press 'q' to quit     \r")
    else:
        sys.stdout.write(f"Starting up... {next(spinner)}     \r")
    sys.stdout.flush()

# Ensure folders exist
os.makedirs("screenshots", exist_ok=True)
os.makedirs("logs", exist_ok=True)

def launch_driver(options_ref):
    # while datetime.datetime.now().second not in [25, 55]:
    #     show_spinner_with_distance(-1)
    #     time.sleep(0.5)
    options = options_ref
    driver = webdriver.Chrome(options=options)
    return driver

# === Setup ===
REF_POINT = (44.966058, -93.285047)  # Change to your fixed reference point
DEBUG = False

with open("config/map_config.json") as f:
    cfg = json.load(f)

print(datetime.datetime.now().strftime("Start scanning at: %Y-%m-%d %H:%M:%S\n"))

spinner = itertools.cycle(["|", "/", "-", "\\"])

# raw_coordinates_path = "logs/car_coordinates.csv"

conn = sqlite3.connect("logs/car_coordinates.db")
c = conn.cursor()

c.execute("""
CREATE TABLE IF NOT EXISTS car_coordinates (
    timestamp TEXT,
    lat REAL,
    lon REAL,
    pixel_x INTEGER,
    pixel_y INTEGER
)
""")
conn.commit()
conn.close()

# === Launch browser once ===
options = Options()
if not DEBUG:
    options.add_argument("--headless=chrome")  # Instead of just --headless
    options.add_argument("--disable-gpu")  # Recommended on Linux
    options.add_argument("--disable-dev-shm-usage")

options.add_experimental_option("excludeSwitches", ["enable-automation"])
options.add_experimental_option("useAutomationExtension", False)

target_width = 1670
target_height = 1021

window_width = target_width + 400
window_height = target_height + 400

options.add_argument(f"--window-size={window_width},{window_height}")

# === Repeated screenshot + analysis loop ===
driver = launch_driver(options)
sample_flag = True
closest_dist = -1

# Window likes to resize itself, make it better
driver.set_window_position(0, 0)  # optional: to always anchor top-left
real_width = driver.execute_script("return window.innerWidth")
real_height = driver.execute_script("return window.innerHeight")

sys.stdout.write(f"\nViewport starting size: {real_width} x {real_height}\n\r")

width_diff = real_width - target_width
height_diff = real_height - target_height

while (width_diff != 0 or height_diff != 0) :
    sys.stdout.write(f"\nDifferences: {width_diff} x {height_diff}\n\r")

    window_width = window_width - width_diff
    window_height = window_height - height_diff

    driver.set_window_size(window_width, window_height)

    real_width = driver.execute_script("return window.innerWidth")
    real_height = driver.execute_script("return window.innerHeight")

    width_diff = real_width - target_width
    height_diff = real_height - target_height

sys.stdout.write(f"\nViewport ending size: {real_width} x {real_height}\n\r")

if (real_width != 1670 or real_height != 1021):
    print("Bad window size\n")
    stop_event.set();

while datetime.datetime.now().second not in [15, 45]:
    show_spinner_with_distance(-1)
    time.sleep(0.5)

driver.get("https://map.eviecarshare.com/")

while not stop_event.is_set():
    show_spinner_with_distance(closest_dist)
    time.sleep(0.5)

    if datetime.datetime.now().second not in [0, 30]:
        sample_flag = True
    if sample_flag and datetime.datetime.now().second in [0, 30]:
        sample_flag = False
        try:
            timestamp = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
            screenshot_path = f"screenshots/map_{timestamp}.png"

            car_pixels = detect_cars_from_html(driver)
            car_coords = [pixel_to_latlon(x, y) for (x, y) in car_pixels]
            dists = compute_distances(car_coords, REF_POINT)
            closest_dist, closest_coords = compute_closest_distance(car_coords, REF_POINT)
            if closest_dist is None or closest_coords is None:
                print("\n Cars not found, length of list:", length(car_pixels))

            avg_dist = sum(dists) / len(dists) if dists else 0

            if DEBUG and car_coords:
                driver.save_screenshot(screenshot_path)
                closest_index = dists.index(min(dists))
                closest_coord = car_coords[closest_index]
                create_debug_map(screenshot_path, car_coords, REF_POINT, closest_coord)

            with open("logs/distances.csv", "a") as f:
                f.write(f"{timestamp},{avg_dist:.3f},{len(car_coords)},{closest_dist:.3f},{closest_coords[0]:.6f},{closest_coords[1]:.6f}\n")


            # with open(raw_coordinates_path, mode="a", newline="") as f:
            #     writer = csv.writer(f)
            #     for (lat, lon) in car_coords:
            #         writer.writerow([timestamp, f"{lat:.6f}", f"{lon:.6f}", ])

            conn = sqlite3.connect("logs/car_coordinates.db")
            c = conn.cursor()

            data_rows = [
                (timestamp, float(f"{lat:.6f}"), float(f"{lon:.6f}"), int(pixel[0]), int(pixel[1]))
                for (pixel, (lat, lon)) in zip(car_pixels, car_coords)
            ]

            c.executemany("INSERT INTO car_coordinates (timestamp, lat, lon, pixel_x, pixel_y) VALUES (?, ?, ?, ?, ?)", data_rows)

            conn.commit()
            conn.close()



        except Exception as e:
            if stop_event.is_set():
                break
            print("\n[!] Driver error detected:", e)
            try:
                driver.quit()
            except Exception:
                pass
            print("[!] Restarting browser session...")
            driver = launch_driver(options)

print("\n[!] Tracker stopped.")
driver.quit();

# === Restart prompt ===
while True:
    answer = input("Do you want to restart the tracker? (y/N): ").strip().lower()
    if answer == "y":
        print("Restarting now...\n")
        os.execv(sys.executable, ["python3"] + sys.argv)  # Relaunch same script
    else:
        print("Exiting completely.")
        sys.exit(0)
