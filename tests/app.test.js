'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GarageDatabase } = require('../src/db.js');
const { createGarageServer } = require('../src/server.js');
const {
  evaluateTaskStatus,
  addMonthsToDateString,
  createSamplePhotoDataUrl
} = require('../public/maintenance-engine.js');

test('MaintenanceEngine calculates next due date, mileage, and overdue/due-soon/on-track status', () => {
  assert.equal(addMonthsToDateString('2026-05-14', 6), '2026-11-14');

  const car = { id: 'car-1', currentMileage: 35100 };
  const task = {
    id: 'task-1',
    carId: 'car-1',
    title: 'Oil & Filter Change',
    intervalMiles: 5000,
    intervalMonths: 6,
    lastCompletedDate: '2026-05-14',
    lastCompletedMileage: 30000
  };

  // At 35,100 miles, due at 35,000 miles -> 100 miles overdue
  const overdueEval = evaluateTaskStatus(task, car, '2026-10-01');
  assert.equal(overdueEval.nextDueMileage, 35000);
  assert.equal(overdueEval.nextDueDate, '2026-11-14');
  assert.equal(overdueEval.milesRemaining, -100);
  assert.equal(overdueEval.status, 'overdue');

  // At 34,700 miles, 300 miles remaining -> due-soon
  const dueSoonEval = evaluateTaskStatus(task, { id: 'car-1', currentMileage: 34700 }, '2026-09-01');
  assert.equal(dueSoonEval.milesRemaining, 300);
  assert.equal(dueSoonEval.status, 'due-soon');

  // At 31,500 miles -> on-track
  const onTrackEval = evaluateTaskStatus(task, { id: 'car-1', currentMileage: 31500 }, '2026-07-01');
  assert.equal(onTrackEval.milesRemaining, 3500);
  assert.equal(onTrackEval.status, 'on-track');
});

test('GarageDatabase supports multiple cars, recurring tasks, completion at date/mileage, notes, and photos', () => {
  const db = new GarageDatabase(':memory:');

  // 1. Add a third car
  const addedCar = db.addOrUpdateCar({
    year: 2024,
    make: 'Subaru',
    model: 'Outback Wilderness',
    nickname: 'Mountain Wagon',
    currentMileage: 12400,
    vin: '4S4BTGUD0R3109988',
    licensePlate: 'SUBaru1'
  });
  assert.equal(addedCar.make, 'Subaru');
  assert.equal(addedCar.currentMileage, 12400);

  // 2. Create a recurring maintenance task for the new car
  const task = db.addOrUpdateTask({
    carId: addedCar.id,
    title: 'Rear Differential Fluid Service',
    category: 'Drivetrain',
    intervalMiles: 30000,
    intervalMonths: 24,
    lastCompletedDate: '2025-05-01',
    lastCompletedMileage: 5000,
    notes: 'Use 75W-90 GL-5 gear oil'
  });
  assert.equal(task.title, 'Rear Differential Fluid Service');

  // 3. Mark the recurring task complete at a specific date and higher mileage with notes and photos
  const samplePhoto = {
    id: 'photo-test-1',
    name: 'diff-drain-plug.svg',
    caption: 'Clean magnetic drain plug at 15,250 miles',
    dataUrl: createSamplePhotoDataUrl('Rear Diff Service', '15,250 mi', '#10b981', ['Torque: 36 ft-lbs'])
  };

  const completedLog = db.completeTaskOrAddLog({
    carId: addedCar.id,
    taskId: task.id,
    taskTitle: task.title,
    category: task.category,
    completedDate: '2026-11-02',
    mileage: 15250,
    cost: 48.75,
    performedBy: 'DIY Garage',
    notes: 'Replaced both crush gaskets and refilled 0.8 qt 75W-90.',
    photos: [samplePhoto]
  });

  assert.equal(completedLog.completedDate, '2026-11-02');
  assert.equal(completedLog.mileage, 15250);
  assert.equal(completedLog.photos.length, 1);
  assert.equal(completedLog.photos[0].caption, 'Clean magnetic drain plug at 15,250 miles');

  // Verify recurring task updated its lastCompletedDate & lastCompletedMileage
  const stateAfter = db.getState();
  const updatedTask = stateAfter.tasks.find((t) => t.id === task.id);
  assert.equal(updatedTask.lastCompletedDate, '2026-11-02');
  assert.equal(updatedTask.lastCompletedMileage, 15250);
  assert.equal(updatedTask.completionCount, 1);

  // Verify vehicle odometer automatically advanced to 15,250
  const updatedCar = stateAfter.cars.find((c) => c.id === addedCar.id);
  assert.equal(updatedCar.currentMileage, 15250);

  db.close();
});

test('HTTP Server API endpoints serve state, cars, tasks, and completion logs', async () => {
  const { Readable } = require('node:stream');
  const server = createGarageServer({ dbPath: ':memory:' });

  function invokeServer(method, url, bodyObj) {
    return new Promise((resolve, reject) => {
      const payloadStr = bodyObj ? JSON.stringify(bodyObj) : '';
      const req = Readable.from(payloadStr ? [Buffer.from(payloadStr, 'utf8')] : []);
      req.method = method;
      req.url = url;
      req.headers = { host: 'localhost:3000', 'content-type': 'application/json' };

      const chunks = [];
      const res = {
        statusCode: 200,
        headers: {},
        writeHead(code, hdrs) {
          this.statusCode = code;
          if (hdrs) Object.assign(this.headers, hdrs);
        },
        write(chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        },
        end(chunk) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: this.statusCode,
            headers: this.headers,
            text: raw,
            json: () => JSON.parse(raw)
          });
        }
      };

      server.emit('request', req, res);
    });
  }

  try {
    const stateRes = await invokeServer('GET', '/api/state');
    assert.equal(stateRes.status, 200);
    const initialState = stateRes.json();
    assert.ok(initialState.cars.length >= 2);

    const logRes = await invokeServer('POST', '/api/logs', {
      carId: initialState.cars[0].id,
      taskId: initialState.tasks[0].id,
      completedDate: '2026-11-02',
      mileage: 35050,
      cost: 72.0,
      performedBy: 'Dealer Express',
      notes: 'Completed 35k oil service + multi-point inspection.',
      photos: [
        {
          id: 'p-101',
          name: 'receipt.svg',
          caption: '35k service invoice',
          dataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        }
      ]
    });
    assert.equal(logRes.status, 200);
    const updatedState = logRes.json();
    const newestLog = updatedState.logs.find((l) => l.mileage === 35050);
    assert.ok(newestLog);
    assert.equal(newestLog.photos.length, 1);

    // Verify PUT /api/state (used by Import JSON backup restore)
    const replaceRes = await invokeServer('PUT', '/api/state', {
      cars: [initialState.cars[0]],
      tasks: [initialState.tasks[0]],
      logs: [newestLog]
    });
    assert.equal(replaceRes.status, 200);
    const replacedState = replaceRes.json();
    assert.equal(replacedState.cars.length, 1);
    assert.equal(replacedState.logs.length, 1);
  } finally {
    server.garageDb.close();
  }
});

test('PWA assets (manifest.webmanifest, sw.js, icon.svg) and Import JSON UI are present', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const publicDir = path.join(__dirname, '..', 'public');

  const manifestRaw = fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.short_name, 'GarageLog');
  assert.equal(manifest.display, 'standalone');

  assert.ok(fs.existsSync(path.join(publicDir, 'sw.js')));
  assert.ok(fs.existsSync(path.join(publicDir, 'icon.svg')));

  const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('manifest.webmanifest'));
  assert.ok(indexHtml.includes('apple-mobile-web-app-capable'));
  assert.ok(indexHtml.includes('id="btn-import-json"'));
  assert.ok(indexHtml.includes('id="sync-dialog"'));
  assert.ok(indexHtml.includes('id="sync-token-input"'));
  assert.ok(indexHtml.includes('id="part-dialog"'));
  assert.ok(indexHtml.includes('id="parts-section"'));

  const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.ok(appJs.includes('discoverOrCreateBackupGist'));
  assert.ok(appJs.includes('pullFromGitHubGist'));
  assert.ok(appJs.includes('pushToGitHubGist'));
  assert.ok(appJs.includes('openPartDialog'));
  assert.ok(appJs.includes('renderPartsSection'));
});

test('GarageDatabase persists per-vehicle parts and specifications and seeds 2014 Toyota Corolla S', () => {
  const db = new GarageDatabase(':memory:');
  const state = db.getState();
  const corolla = state.cars.find((c) => c.id === 'car-pg28a2r5');
  assert.ok(corolla, 'Should include 2014 Toyota Corolla S');
  assert.equal(corolla.vin, '5YFBURHE6EP055308');
  assert.equal(corolla.licensePlate, '7DSS008');
  assert.ok(Array.isArray(corolla.parts) && corolla.parts.length >= 1);
  assert.equal(corolla.parts[0].item, 'Engine Oil');
  assert.equal(corolla.parts[0].spec, '0W-20 Full Synthetic (API SN/SP)');

  // Add a new part to Corolla and verify it persists and survives odometer updates
  const updatedParts = [
    ...corolla.parts,
    { id: 'part-test-wiper', item: 'Wiper Blades', spec: '26" Driver / 16" Passenger', notes: 'OEM SightLine' }
  ];
  db.addOrUpdateCar({ ...corolla, parts: updatedParts });
  const afterUpdate = db.getState().cars.find((c) => c.id === 'car-pg28a2r5');
  assert.ok(afterUpdate.parts.some((p) => p.id === 'part-test-wiper'));

  db.close();
});
