const Database = require('better-sqlite3');
const db = new Database('carshare_tracker/logs/car_coordinates.db');
// const db = new Database('car_coordinates_stable.db');

const EARTH_RADIUS_KM = 6371;

function haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = angle => angle * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function isTimeInRange(timeStr, timeRange) {
    const start = timeRange.start;
    const end = timeRange.end;

    if (start <= end) {
        return timeStr >= start && timeStr <= end;
    } else {
        // Crosses midnight
        return timeStr >= start || timeStr <= end;
    }
}

function queryCarsNearAtTime(lat, lon, maxDistanceKm, timeRange) {
    const margin = maxDistanceKm / 111;

    const stmt = db.prepare(`
    SELECT timestamp, lat, lon FROM car_coordinates
    WHERE lat BETWEEN ? AND ?
    AND lon BETWEEN ? AND ?
    AND time(timestamp) BETWEEN ? AND ?
    `);

    const rows = stmt.all(
        lat - margin,
        lat + margin,
        lon - margin,
        lon + margin,
        timeRange.start,
        timeRange.end
    );

    return rows.filter(row => {
        const dist = haversineDistance(lat, lon, row.lat, row.lon);
        return dist <= maxDistanceKm;
    });
}

function getRowsBetweenTimes(lat, lon, maxDistanceKm, timeRange) {
    const margin = maxDistanceKm / 111;

    let rows = [];
    if (timeRange.start <= timeRange.end) {
        // Normal case: e.g. 08:00:00 - 09:00:00
        const stmt = db.prepare(`
        SELECT timestamp, lat, lon FROM car_coordinates
        WHERE lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
        AND time(timestamp) BETWEEN ? AND ?
        ORDER BY timestamp
        `);
        rows = stmt.all(
            lat - margin,
            lat + margin,
            lon - margin,
            lon + margin,
            timeRange.start,
            timeRange.end
        );
    } else {
        // Time range crosses midnight: e.g. 23:00:00 - 01:00:00
        const stmt1 = db.prepare(`
        SELECT timestamp, lat, lon FROM car_coordinates
        WHERE lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
        AND time(timestamp) >= ?
        `);
        const rows1 = stmt1.all(
            lat - margin,
            lat + margin,
            lon - margin,
            lon + margin,
            timeRange.start
        );

        const stmt2 = db.prepare(`
        SELECT timestamp, lat, lon FROM car_coordinates
        WHERE lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
        AND time(timestamp) <= ?
        `);
        const rows2 = stmt2.all(
            lat - margin,
            lat + margin,
            lon - margin,
            lon + margin,
            timeRange.end
        );

        rows = rows1.concat(rows2);
    }

    return rows;
}

function getAllTimestamps(db, timeRange) {
    let allTimestamps = [];

    if (timeRange.start <= timeRange.end) {
        const stmt = db.prepare(`
            SELECT DISTINCT timestamp
            FROM car_coordinates
            WHERE TIME(timestamp) BETWEEN ? AND ?
            ORDER BY timestamp;
        `);
        allTimestamps = stmt.all(timeRange.start, timeRange.end)
                            .map(r => r.timestamp);
    } else {
        const stmt1 = db.prepare(`
            SELECT DISTINCT timestamp
            FROM car_coordinates
            WHERE TIME(timestamp) >= ?
        `);
        const stmt2 = db.prepare(`
            SELECT DISTINCT timestamp
            FROM car_coordinates
            WHERE TIME(timestamp) <= ?
        `);
        const ts1 = stmt1.all(timeRange.start).map(r => r.timestamp);
        const ts2 = stmt2.all(timeRange.end).map(r => r.timestamp);
        allTimestamps = ts1.concat(ts2);
    }

    return allTimestamps;
}


function calculateOddsOfCarNearby(lat, lon, maxDistanceKm, timeRange) {
    const margin = maxDistanceKm / 111;

    // Get all rows in bounding box & time range (handle midnight crossing)
    const rows = getRowsBetweenTimes(lat, lon, maxDistanceKm, timeRange);

    // Group by timestamp
    const carsByTimestamp = new Map();
    for (const row of rows) {
        if (!carsByTimestamp.has(row.timestamp)) {
            carsByTimestamp.set(row.timestamp, []);
        }
        carsByTimestamp.get(row.timestamp).push(row);
    }

    // Fetch all unique timestamps in the time range (handle midnight crossing)
    let allTimestamps = getAllTimestamps(db, timeRange);

    if (allTimestamps.length === 0) return 0;

    // Check for each timestamp if any car is nearby
    let countWithCar = 0;
    for (const ts of allTimestamps) {
        const cars = carsByTimestamp.get(ts) || [];
        const hasCarNearby = cars.some(car => haversineDistance(lat, lon, car.lat, car.lon) <= maxDistanceKm);
        if (hasCarNearby) countWithCar++;
    }

    return countWithCar / allTimestamps.length;
}

function calculateOddsOfCarRadar(lat, lon, maxDistanceKm, timeRange) {
    const margin = maxDistanceKm / 111;

    // Get all rows in bounding box & time range (handle midnight crossing)
    const rows = getRowsBetweenTimes(lat, lon, maxDistanceKm, timeRange);

    // Group by timestamp
    const carsByTimestamp = new Map();
    for (const row of rows) {
        if (!carsByTimestamp.has(row.timestamp)) {
            carsByTimestamp.set(row.timestamp, []);
        }
        carsByTimestamp.get(row.timestamp).push(row);
    }

    // Fetch all unique timestamps in the time range (handle midnight crossing)
    let allTimestamps = getAllTimestamps(db, timeRange);

    if (allTimestamps.length === 0) return 0;

    // Check for each timestamp if any car is nearby
    const daysMap = new Map();

    // Group all timestamps by day
    for (const ts of allTimestamps) {
        const tsDate = new Date(ts);
        const day = tsDate.toISOString().slice(0, 10); // YYYY-MM-DD

        if (!daysMap.has(day)) daysMap.set(day, []);
        daysMap.get(day).push(ts);
    }

    // Iterate over a copy of the keys so we can delete while looping
    for (const day of Array.from(daysMap.keys())) {
        const timestamps = daysMap.get(day);

        // Sort timestamps ascending
        timestamps.sort((a, b) => a - b);

        // Convert to UTC for easy comparison
        const startDate = new Date(`1970-01-01T${timeRange.start}Z`);
        const endDate   = new Date(`1970-01-01T${timeRange.end}Z`);

        const expectedCount = Math.abs(endDate.getTime() - startDate.getTime()) / 1000 / 30 + 1;

        if (timestamps.length !== expectedCount) {
            daysMap.delete(day); // remove incomplete day
        }
    }

    let totalDays = 0;
    let radarFound = 0;
    const carsOnValidDays = []; // collect all cars within maxDistanceKm on valid days

    for (const [day, timestamps] of daysMap) { // daysMap already contains only complete days
        totalDays++;
        let carFound = false;

        for (const ts of timestamps) {
            const cars = carsByTimestamp.get(ts) || [];

            // Get cars within maxDistanceKm
            const nearbyCars = cars.filter(car => haversineDistance(lat, lon, car.lat, car.lon) <= maxDistanceKm);

            if (nearbyCars.length > 0) {
                carFound = true;
                carsOnValidDays.push(...nearbyCars); // collect for mapping or further processing
                // break; // optional: stop after first timestamp with cars
            }
        }

        if (carFound) radarFound++;
    }

    const carsByIdentity = new Map();

    for (const car of carsOnValidDays) {
        const key = `${car.lat},${car.lon}`; // or use car.id if available
        if (!carsByIdentity.has(key)) carsByIdentity.set(key, []);
        carsByIdentity.get(key).push(car); // rows are already in timestamp order
    }

    const collapsedEvents = [];
    const lastSeen = new Map(); // key: lat,lon; value: last timestamp added

    // Sort first by timestamp
    carsOnValidDays.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    for (const car of carsOnValidDays) {
        const key = `${car.lat},${car.lon}`;
        const ts = new Date(car.timestamp);

        const lastTs = lastSeen.get(key);

        if (ts === lastTs) {
            continue;
        }

        if (lastTs && ts - lastTs === 30_000) {
            // consecutive, skip
            lastSeen.set(key, ts); // update last seen timestamp
            continue;
        }

        // New event
        collapsedEvents.push(car);
        lastSeen.set(key, ts);
    }

    odds =  radarFound / totalDays;

    return { odds, collapsedEvents }; // wrap in an object
}

const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors()); // Allow frontend to access the backend

app.get('/api/odds', (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const start = req.query.start || '08:00:00';
    const end = req.query.end || '09:00:00';
    const maxDistanceKm = parseFloat(req.query.radius) || 1;

    if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: 'Invalid lat/lon' });
    }

    const result = calculateOddsOfCarRadar(lat, lon, maxDistanceKm, { start, end });
    
    // Send both odds and collapsed events
    res.json(result);
});

app.listen(3000, () => {
    console.log('API server running on http://localhost:3000');
});

