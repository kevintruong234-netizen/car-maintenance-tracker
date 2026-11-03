'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { GarageDatabase } = require('./db.js');
const { createInitialSeedData } = require('../public/maintenance-engine.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function readJsonBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function createGarageServer({ dbPath } = {}) {
  const garageDb = new GarageDatabase(dbPath);
  const publicDir = path.join(__dirname, '..', 'public');

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (pathname === '/api/state' && req.method === 'GET') {
        return sendJson(res, 200, garageDb.getState());
      }

      if (pathname === '/api/state' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, garageDb.replaceFullState(body));
      }

      if (pathname === '/api/reset' && req.method === 'POST') {
        return sendJson(res, 200, garageDb.replaceFullState(createInitialSeedData()));
      }

      if (pathname === '/api/cars' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.make || !body.model) {
          return sendJson(res, 400, { error: 'Make and model are required.' });
        }
        garageDb.addOrUpdateCar(body);
        return sendJson(res, 200, garageDb.getState());
      }

      if (pathname.startsWith('/api/cars/') && pathname.endsWith('/mileage') && req.method === 'PATCH') {
        const carId = decodeURIComponent(pathname.slice('/api/cars/'.length, -'/mileage'.length));
        const body = await readJsonBody(req);
        garageDb.updateCarMileage(carId, body.currentMileage);
        return sendJson(res, 200, garageDb.getState());
      }

      if (pathname.startsWith('/api/cars/') && req.method === 'DELETE') {
        const carId = decodeURIComponent(pathname.slice('/api/cars/'.length));
        garageDb.deleteCar(carId);
        return sendJson(res, 200, garageDb.getState());
      }

      if (pathname === '/api/tasks' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.carId || !body.title) {
          return sendJson(res, 400, { error: 'Vehicle and task title are required.' });
        }
        garageDb.addOrUpdateTask(body);
        return sendJson(res, 200, garageDb.getState());
      }

      if (pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
        const taskId = decodeURIComponent(pathname.slice('/api/tasks/'.length));
        garageDb.deleteTask(taskId);
        return sendJson(res, 200, garageDb.getState());
      }

      if (pathname === '/api/logs' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.carId || !body.completedDate || body.mileage == null) {
          return sendJson(res, 400, { error: 'Vehicle, completion date, and mileage are required.' });
        }
        garageDb.completeTaskOrAddLog(body);
        return sendJson(res, 200, garageDb.getState());
      }

      if (pathname.startsWith('/api/logs/') && req.method === 'PATCH') {
        const logId = decodeURIComponent(pathname.slice('/api/logs/'.length));
        const body = await readJsonBody(req);
        garageDb.updateLog(logId, body);
        return sendJson(res, 200, garageDb.getState());
      }

      if (pathname.startsWith('/api/logs/') && req.method === 'DELETE') {
        const logId = decodeURIComponent(pathname.slice('/api/logs/'.length));
        garageDb.deleteLog(logId);
        return sendJson(res, 200, garageDb.getState());
      }

      // Static file serving
      const safeRelPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const resolvedPath = path.resolve(publicDir, safeRelPath);
      if (!resolvedPath.startsWith(publicDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        const ext = path.extname(resolvedPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(resolvedPath).pipe(res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });

  server.garageDb = garageDb;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = createGarageServer();
  server.listen(port, () => {
    console.log(`GarageLog Car Maintenance Tracker running at http://localhost:${port}`);
  });
}

module.exports = { createGarageServer };
