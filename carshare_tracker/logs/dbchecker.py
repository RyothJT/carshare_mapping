import sqlite3

# Connect to the database
conn = sqlite3.connect("car_coordinates.db")
cursor = conn.cursor()

# Target timestamps
timestamps = [
    "2025-07-28T12:05:00",
    "2025-07-28T12:06:30"
]

# Run the query (adjust column names as needed)
query = """
SELECT * FROM car_coordinates
WHERE timestamp IN (?, ?)
AND lon = ?
"""
cursor.execute(query, (*timestamps, -93.279291))

# Print matching rows
rows = cursor.fetchall()
for row in rows:
    print(row)

# Close the connection
conn.close()
