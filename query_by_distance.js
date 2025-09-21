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
    let allTimestamps = [];
    if (timeRange.start <= timeRange.end) {
        const uniqueTimestampsStmt = db.prepare(`
        SELECT DISTINCT timestamp FROM car_coordinates
        WHERE time(timestamp) BETWEEN ? AND ?
        ORDER BY timestamp
        `);
        allTimestamps = uniqueTimestampsStmt.all(timeRange.start, timeRange.end)
        .map(r => r.timestamp);
    } else {
        const uniqueTimestampsStmt1 = db.prepare(`
        SELECT DISTINCT timestamp FROM car_coordinates
        WHERE time(timestamp) >= ?
        `);
        const uniqueTimestampsStmt2 = db.prepare(`
        SELECT DISTINCT timestamp FROM car_coordinates
        WHERE time(timestamp) <= ?
        `);
        const ts1 = uniqueTimestampsStmt1.all(timeRange.start).map(r => r.timestamp);
        const ts2 = uniqueTimestampsStmt2.all(timeRange.end).map(r => r.timestamp);
        allTimestamps = ts1.concat(ts2);
    }

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
    let allTimestamps = [];
    if (timeRange.start <= timeRange.end) {
        const uniqueTimestampsStmt = db.prepare(`
        SELECT DISTINCT timestamp
        FROM car_coordinates
        WHERE TIME(timestamp) BETWEEN ? AND ?
        ORDER BY timestamp;
        `);
        allTimestamps = uniqueTimestampsStmt.all(timeRange.start, timeRange.end)
        .map(r => r.timestamp);
    } else {
        const uniqueTimestampsStmt1 = db.prepare(`
        SELECT DISTINCT timestamp FROM car_coordinates
        WHERE time(timestamp) >= ?
        `);
        const uniqueTimestampsStmt2 = db.prepare(`
        SELECT DISTINCT timestamp FROM car_coordinates
        WHERE time(timestamp) <= ?
        `);
        const ts1 = uniqueTimestampsStmt1.all(timeRange.start).map(r => r.timestamp);
        const ts2 = uniqueTimestampsStmt2.all(timeRange.end).map(r => r.timestamp);
        allTimestamps = ts1.concat(ts2);
    }

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

    // Filter to only include complete days
    const completeDaysMap = new Map();

    for (const [day, timestamps] of daysMap.entries()) {
        // Sort timestamps ascending
        timestamps.sort((a, b) => a - b);

        // Convert to UTC for easy comparison
        const startDate = new Date(`1970-01-01T${timeRange.start}Z`);
        const endDate   = new Date(`1970-01-01T${timeRange.end}Z`);

        const expectedCount = Math.abs(endDate.getTime() - startDate.getTime()) / 1000 / 30 + 1;

        if (timestamps.length === expectedCount) {
            completeDaysMap.set(day, timestamps);
        }
    }

    let countWithCar = 0;
    let totalDays = 0;

    for (const [day, timestamps] of completeDaysMap) {
        totalDays++;
        let carFound = false;

        for (const ts of timestamps) {
            const cars = carsByTimestamp.get(ts) || [];
            if (cars.some(car => haversineDistance(lat, lon, car.lat, car.lon) <= maxDistanceKm)) {
                carFound = true;
                break;
            }
        }

        if (carFound) countWithCar++;
    }

    return countWithCar / totalDays;
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

    const odds = calculateOddsOfCarRadar(lat, lon, maxDistanceKm, { start, end });
    res.json({ odds });
});

// Replace with your actual odds calculation function here

app.listen(3000, () => {
    console.log('API server running on http://localhost:3000');
});

