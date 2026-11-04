'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createInitialSeedData } = require('../public/maintenance-engine.js');

class GarageDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '..', 'data', 'garage.db');
    if (this.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cars (
        id TEXT PRIMARY KEY,
        year INTEGER NOT NULL,
        make TEXT NOT NULL,
        model TEXT NOT NULL,
        nickname TEXT DEFAULT '',
        vin TEXT DEFAULT '',
        licensePlate TEXT DEFAULT '',
        currentMileage INTEGER NOT NULL DEFAULT 0,
        colorAccent TEXT DEFAULT '#0ea5e9',
        notes TEXT DEFAULT '',
        partsJson TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        carId TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        intervalMiles INTEGER DEFAULT 0,
        intervalMonths INTEGER DEFAULT 0,
        lastCompletedDate TEXT,
        lastCompletedMileage INTEGER,
        baselineDate TEXT,
        baselineMileage INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        completionCount INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        carId TEXT NOT NULL,
        taskId TEXT,
        taskTitle TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        completedDate TEXT NOT NULL,
        mileage INTEGER NOT NULL,
        cost REAL DEFAULT 0,
        performedBy TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        photosJson TEXT DEFAULT '[]'
      );
    `);

    try {
      this.db.exec("ALTER TABLE cars ADD COLUMN partsJson TEXT DEFAULT '[]'");
    } catch {
      // Column already exists
    }

    const countRow = this.db.prepare('SELECT COUNT(*) AS count FROM cars').get();
    if (!countRow || countRow.count === 0) {
      this.replaceFullState(createInitialSeedData());
    }
  }

  getState() {
    const rawCars = this.db.prepare('SELECT * FROM cars ORDER BY year DESC, make ASC').all();
    const cars = rawCars.map((row) => {
      let parts = [];
      try {
        parts = JSON.parse(row.partsJson || '[]');
      } catch {
        parts = [];
      }
      const { partsJson, ...rest } = row;
      return { ...rest, parts };
    });
    const tasks = this.db.prepare('SELECT * FROM tasks ORDER BY title ASC').all();
    const rawLogs = this.db.prepare('SELECT * FROM logs ORDER BY completedDate DESC, mileage DESC').all();
    const logs = rawLogs.map((row) => {
      let photos = [];
      try {
        photos = JSON.parse(row.photosJson || '[]');
      } catch {
        photos = [];
      }
      const { photosJson, ...rest } = row;
      return { ...rest, photos };
    });
    return { cars, tasks, logs };
  }

  addOrUpdateCar(carInput) {
    const id = carInput.id || `car-${crypto.randomUUID().slice(0, 8)}`;
    const year = Number(carInput.year) || new Date().getFullYear();
    const make = String(carInput.make || '').trim();
    const model = String(carInput.model || '').trim();
    const nickname = String(carInput.nickname || '').trim();
    const vin = String(carInput.vin || '').trim().toUpperCase();
    const licensePlate = String(carInput.licensePlate || '').trim().toUpperCase();
    const currentMileage = Math.max(0, Math.round(Number(carInput.currentMileage) || 0));
    const colorAccent = String(carInput.colorAccent || '#0ea5e9').trim();
    const notes = String(carInput.notes || '').trim();

    const existing = this.db.prepare('SELECT partsJson FROM cars WHERE id = ?').get(id);
    let existingParts = [];
    if (existing && existing.partsJson) {
      try {
        existingParts = JSON.parse(existing.partsJson);
      } catch {
        existingParts = [];
      }
    }
    const parts = Array.isArray(carInput.parts) ? carInput.parts : existingParts;
    const partsJson = JSON.stringify(parts);

    this.db.prepare(`
      INSERT INTO cars (id, year, make, model, nickname, vin, licensePlate, currentMileage, colorAccent, notes, partsJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        year = excluded.year,
        make = excluded.make,
        model = excluded.model,
        nickname = excluded.nickname,
        vin = excluded.vin,
        licensePlate = excluded.licensePlate,
        currentMileage = excluded.currentMileage,
        colorAccent = excluded.colorAccent,
        notes = excluded.notes,
        partsJson = excluded.partsJson
    `).run(id, year, make, model, nickname, vin, licensePlate, currentMileage, colorAccent, notes, partsJson);

    const saved = this.db.prepare('SELECT * FROM cars WHERE id = ?').get(id);
    const { partsJson: _pj, ...rest } = saved;
    return { ...rest, parts };
  }

  updateCarMileage(carId, mileage) {
    const cleanMileage = Math.max(0, Math.round(Number(mileage) || 0));
    this.db.prepare('UPDATE cars SET currentMileage = ? WHERE id = ?').run(cleanMileage, carId);
    return this.db.prepare('SELECT * FROM cars WHERE id = ?').get(carId);
  }

  deleteCar(carId) {
    this.db.prepare('DELETE FROM logs WHERE carId = ?').run(carId);
    this.db.prepare('DELETE FROM tasks WHERE carId = ?').run(carId);
    this.db.prepare('DELETE FROM cars WHERE id = ?').run(carId);
  }

  addOrUpdateTask(taskInput) {
    const id = taskInput.id || `task-${crypto.randomUUID().slice(0, 8)}`;
    const carId = String(taskInput.carId || '').trim();
    const title = String(taskInput.title || '').trim();
    const category = String(taskInput.category || 'General').trim();
    const intervalMiles = Math.max(0, Math.round(Number(taskInput.intervalMiles) || 0));
    const intervalMonths = Math.max(0, Math.round(Number(taskInput.intervalMonths) || 0));

    const car = this.db.prepare('SELECT * FROM cars WHERE id = ?').get(carId);
    const defaultMileage = car ? Number(car.currentMileage) : 0;
    const todayStr = new Date().toISOString().slice(0, 10);

    const lastCompletedDate = taskInput.lastCompletedDate ? String(taskInput.lastCompletedDate) : null;
    const lastCompletedMileage =
      taskInput.lastCompletedMileage != null && taskInput.lastCompletedMileage !== ''
        ? Math.max(0, Math.round(Number(taskInput.lastCompletedMileage)))
        : null;

    const baselineDate = taskInput.baselineDate || lastCompletedDate || todayStr;
    const baselineMileage =
      taskInput.baselineMileage != null && taskInput.baselineMileage !== ''
        ? Math.max(0, Math.round(Number(taskInput.baselineMileage)))
        : (lastCompletedMileage != null ? lastCompletedMileage : defaultMileage);

    const notes = String(taskInput.notes || '').trim();
    const completionCount = Math.max(0, Number(taskInput.completionCount) || 0);

    this.db.prepare(`
      INSERT INTO tasks (
        id, carId, title, category, intervalMiles, intervalMonths,
        lastCompletedDate, lastCompletedMileage, baselineDate, baselineMileage,
        notes, completionCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        carId = excluded.carId,
        title = excluded.title,
        category = excluded.category,
        intervalMiles = excluded.intervalMiles,
        intervalMonths = excluded.intervalMonths,
        lastCompletedDate = excluded.lastCompletedDate,
        lastCompletedMileage = excluded.lastCompletedMileage,
        baselineDate = excluded.baselineDate,
        baselineMileage = excluded.baselineMileage,
        notes = excluded.notes,
        completionCount = excluded.completionCount
    `).run(
      id,
      carId,
      title,
      category,
      intervalMiles,
      intervalMonths,
      lastCompletedDate,
      lastCompletedMileage,
      baselineDate,
      baselineMileage,
      notes,
      completionCount
    );

    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  }

  deleteTask(taskId) {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  }

  completeTaskOrAddLog(payload) {
    const id = payload.id || `log-${crypto.randomUUID().slice(0, 8)}`;
    const carId = String(payload.carId || '').trim();
    const taskId = payload.taskId ? String(payload.taskId).trim() : null;

    let linkedTask = null;
    if (taskId) {
      linkedTask = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    }

    const taskTitle = String(payload.taskTitle || linkedTask?.title || 'Maintenance Service').trim();
    const category = String(payload.category || linkedTask?.category || 'General').trim();
    const completedDate = String(payload.completedDate || new Date().toISOString().slice(0, 10)).trim();
    const mileage = Math.max(0, Math.round(Number(payload.mileage) || 0));
    const cost = Math.max(0, Number(payload.cost) || 0);
    const performedBy = String(payload.performedBy || '').trim();
    const notes = String(payload.notes || '').trim();
    const photos = Array.isArray(payload.photos) ? payload.photos : [];
    const photosJson = JSON.stringify(photos);

    this.db.prepare(`
      INSERT INTO logs (
        id, carId, taskId, taskTitle, category, completedDate,
        mileage, cost, performedBy, notes, photosJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        carId = excluded.carId,
        taskId = excluded.taskId,
        taskTitle = excluded.taskTitle,
        category = excluded.category,
        completedDate = excluded.completedDate,
        mileage = excluded.mileage,
        cost = excluded.cost,
        performedBy = excluded.performedBy,
        notes = excluded.notes,
        photosJson = excluded.photosJson
    `).run(id, carId, taskId, taskTitle, category, completedDate, mileage, cost, performedBy, notes, photosJson);

    if (linkedTask) {
      const prevMileage = Number(linkedTask.lastCompletedMileage || 0);
      const prevDate = linkedTask.lastCompletedDate || '';
      const newLastMileage = Math.max(prevMileage, mileage);
      const newLastDate = completedDate >= prevDate ? completedDate : prevDate;
      const newCount = Number(linkedTask.completionCount || 0) + 1;

      this.db.prepare(`
        UPDATE tasks
        SET lastCompletedDate = ?, lastCompletedMileage = ?, completionCount = ?
        WHERE id = ?
      `).run(newLastDate, newLastMileage, newCount, linkedTask.id);
    }

    const car = this.db.prepare('SELECT * FROM cars WHERE id = ?').get(carId);
    if (car && mileage > Number(car.currentMileage || 0)) {
      this.db.prepare('UPDATE cars SET currentMileage = ? WHERE id = ?').run(mileage, carId);
    }

    return { id, carId, taskId, taskTitle, category, completedDate, mileage, cost, performedBy, notes, photos };
  }

  updateLog(logId, updates) {
    const existing = this.db.prepare('SELECT * FROM logs WHERE id = ?').get(logId);
    if (!existing) return null;

    let currentPhotos = [];
    try {
      currentPhotos = JSON.parse(existing.photosJson || '[]');
    } catch {
      currentPhotos = [];
    }

    const completedDate = updates.completedDate != null ? String(updates.completedDate) : existing.completedDate;
    const mileage = updates.mileage != null ? Math.max(0, Math.round(Number(updates.mileage))) : existing.mileage;
    const cost = updates.cost != null ? Math.max(0, Number(updates.cost)) : existing.cost;
    const performedBy = updates.performedBy != null ? String(updates.performedBy).trim() : existing.performedBy;
    const notes = updates.notes != null ? String(updates.notes).trim() : existing.notes;
    const photos = Array.isArray(updates.photos) ? updates.photos : currentPhotos;

    this.db.prepare(`
      UPDATE logs
      SET completedDate = ?, mileage = ?, cost = ?, performedBy = ?, notes = ?, photosJson = ?
      WHERE id = ?
    `).run(completedDate, mileage, cost, performedBy, notes, JSON.stringify(photos), logId);

    return {
      ...existing,
      completedDate,
      mileage,
      cost,
      performedBy,
      notes,
      photos
    };
  }

  deleteLog(logId) {
    this.db.prepare('DELETE FROM logs WHERE id = ?').run(logId);
  }

  replaceFullState(state) {
    this.db.exec('DELETE FROM logs; DELETE FROM tasks; DELETE FROM cars;');
    const cars = Array.isArray(state?.cars) ? state.cars : [];
    const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
    const logs = Array.isArray(state?.logs) ? state.logs : [];

    for (const car of cars) {
      this.addOrUpdateCar(car);
    }
    for (const task of tasks) {
      this.addOrUpdateTask(task);
    }
    for (const log of logs) {
      const id = log.id || `log-${crypto.randomUUID().slice(0, 8)}`;
      const photosJson = JSON.stringify(Array.isArray(log.photos) ? log.photos : []);
      this.db.prepare(`
        INSERT INTO logs (
          id, carId, taskId, taskTitle, category, completedDate,
          mileage, cost, performedBy, notes, photosJson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        log.carId,
        log.taskId || null,
        log.taskTitle || 'Maintenance Service',
        log.category || 'General',
        log.completedDate || new Date().toISOString().slice(0, 10),
        Number(log.mileage || 0),
        Number(log.cost || 0),
        log.performedBy || '',
        log.notes || '',
        photosJson
      );
    }
    return this.getState();
  }

  close() {
    this.db.close();
  }
}

module.exports = { GarageDatabase };
