import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch
} from "firebase/firestore";
import { db } from "./firebase.js";

const LEGACY_GITHUB_SYNC_KEY = "garagelog_github_sync_v1";
const LEGACY_GIST_FILENAME = "garagelog-cloud-sync.json";
const MAX_BATCH_OPS = 400;

let activeUnsubscribers = [];
let activeUid = null;
let lastSyncedAtIso = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.slice(0, 200).map((p) => ({
    id: String(p?.id || ""),
    item: String(p?.item || "").trim(),
    spec: String(p?.spec || "").trim(),
    notes: String(p?.notes || "").trim()
  }));
}

function normalizePhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos.slice(0, 20).map((p) => ({
    id: String(p?.id || ""),
    name: String(p?.name || "photo"),
    caption: String(p?.caption || ""),
    dataUrl: String(p?.dataUrl || "")
  }));
}

function normalizeCar(car, timestamp = nowIso()) {
  const yearNum = Math.round(Number(car?.year) || new Date().getFullYear());
  const clampedYear = Math.min(2100, Math.max(1900, yearNum));
  return {
    id: String(car.id),
    year: clampedYear,
    make: String(car.make || "").trim().slice(0, 80) || "Vehicle",
    model: String(car.model || "").trim().slice(0, 80) || "Model",
    nickname: String(car.nickname || "").trim(),
    vin: String(car.vin || "").trim().toUpperCase(),
    licensePlate: String(car.licensePlate || "").trim().toUpperCase(),
    currentMileage: Math.max(0, Math.round(Number(car.currentMileage) || 0)),
    colorAccent: String(car.colorAccent || "#0ea5e9").trim(),
    notes: String(car.notes || "").trim(),
    parts: normalizeParts(car.parts),
    updatedAt: timestamp
  };
}

function normalizeTask(task, timestamp = nowIso()) {
  const lastCompletedDate = task.lastCompletedDate ? String(task.lastCompletedDate) : null;
  const lastCompletedMileage =
    task.lastCompletedMileage != null && task.lastCompletedMileage !== ""
      ? Math.max(0, Math.round(Number(task.lastCompletedMileage) || 0))
      : null;

  const baselineDate = task.baselineDate
    ? String(task.baselineDate)
    : lastCompletedDate;

  const baselineMileage =
    task.baselineMileage != null && task.baselineMileage !== ""
      ? Math.max(0, Math.round(Number(task.baselineMileage) || 0))
      : lastCompletedMileage;

  return {
    id: String(task.id),
    carId: String(task.carId || "").trim(),
    title: String(task.title || "").trim().slice(0, 140) || "Maintenance Task",
    category: String(task.category || "General").trim(),
    intervalMiles: Math.max(0, Math.round(Number(task.intervalMiles) || 0)),
    intervalMonths: Math.max(0, Math.round(Number(task.intervalMonths) || 0)),
    lastCompletedDate,
    lastCompletedMileage,
    baselineDate,
    baselineMileage,
    notes: String(task.notes || "").trim(),
    completionCount: Math.max(0, Math.round(Number(task.completionCount) || 0)),
    updatedAt: timestamp
  };
}

function normalizeLog(log, timestamp = nowIso()) {
  return {
    id: String(log.id),
    carId: String(log.carId || "").trim(),
    taskId: log.taskId ? String(log.taskId).trim() : null,
    taskTitle: String(log.taskTitle || "Maintenance Service").trim().slice(0, 140) || "Maintenance Service",
    category: String(log.category || "General").trim(),
    completedDate: String(log.completedDate || nowIso().slice(0, 10)).trim(),
    mileage: Math.max(0, Math.round(Number(log.mileage) || 0)),
    cost: Math.max(0, Number(log.cost) || 0),
    performedBy: String(log.performedBy || "").trim(),
    notes: String(log.notes || "").trim(),
    photos: normalizePhotos(log.photos),
    updatedAt: timestamp
  };
}

function sortCars(cars) {
  return [...cars].sort((a, b) => {
    const yearDiff = Number(b.year || 0) - Number(a.year || 0);
    if (yearDiff !== 0) return yearDiff;
    return String(a.make || "").localeCompare(String(b.make || ""));
  });
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
}

function sortLogs(logs) {
  return [...logs].sort((a, b) => {
    const dateCmp = String(b.completedDate || "").localeCompare(String(a.completedDate || ""));
    if (dateCmp !== 0) return dateCmp;
    return Number(b.mileage || 0) - Number(a.mileage || 0);
  });
}

async function commitBatchedOps(operations) {
  for (let i = 0; i < operations.length; i += MAX_BATCH_OPS) {
    const chunk = operations.slice(i, i + MAX_BATCH_OPS);
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.type === "set") {
        batch.set(op.ref, op.data);
      } else if (op.type === "update") {
        batch.update(op.ref, op.data);
      } else if (op.type === "delete") {
        batch.delete(op.ref);
      }
    }
    await batch.commit();
  }
}

async function tryLoadLegacyGitHubGist() {
  try {
    const raw = localStorage.getItem(LEGACY_GITHUB_SYNC_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    const token = String(cfg?.token || "").trim();
    const gistId = String(cfg?.gistId || "").trim();
    if (!token) return null;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    let gist = null;
    if (gistId) {
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
        headers,
        cache: "no-store"
      });
      if (res.ok) {
        gist = await res.json();
      }
    }

    if (!gist) {
      const listRes = await fetch("https://api.github.com/gists?per_page=100", {
        headers,
        cache: "no-store"
      });
      if (listRes.ok) {
        const list = await listRes.json();
        const match = Array.isArray(list)
          ? list.find((g) => g && g.files && g.files[LEGACY_GIST_FILENAME])
          : null;
        if (match?.id) {
          const fullRes = await fetch(`https://api.github.com/gists/${encodeURIComponent(match.id)}`, {
            headers,
            cache: "no-store"
          });
          if (fullRes.ok) {
            gist = await fullRes.json();
          }
        }
      }
    }

    const content = gist?.files?.[LEGACY_GIST_FILENAME]?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.cars)) {
      return parsed;
    }
  } catch {
    // Ignore legacy Gist read failures; user can still use local data or JSON import
  }
  return null;
}

function userDocRef(uid) {
  return doc(db, "users", uid);
}

function carsColRef(uid) {
  return collection(db, "users", uid, "cars");
}

function tasksColRef(uid) {
  return collection(db, "users", uid, "tasks");
}

function logsColRef(uid) {
  return collection(db, "users", uid, "logs");
}

async function replaceFullStateInFirestore(uid, ownerEmail, state, { migratedFrom = "import" } = {}) {
  const ts = nowIso();
  const [existingCars, existingTasks, existingLogs] = await Promise.all([
    getDocs(carsColRef(uid)),
    getDocs(tasksColRef(uid)),
    getDocs(logsColRef(uid))
  ]);

  const ops = [];
  existingCars.forEach((d) => ops.push({ type: "delete", ref: d.ref }));
  existingTasks.forEach((d) => ops.push({ type: "delete", ref: d.ref }));
  existingLogs.forEach((d) => ops.push({ type: "delete", ref: d.ref }));

  const cars = Array.isArray(state?.cars) ? state.cars : [];
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const logs = Array.isArray(state?.logs) ? state.logs : [];

  for (const car of cars) {
    const cleanCar = normalizeCar({ ...car, id: car.id || `car-${crypto.randomUUID().slice(0, 8)}` }, ts);
    ops.push({ type: "set", ref: doc(carsColRef(uid), cleanCar.id), data: cleanCar });
  }
  for (const task of tasks) {
    const cleanTask = normalizeTask({ ...task, id: task.id || `task-${crypto.randomUUID().slice(0, 8)}` }, ts);
    ops.push({ type: "set", ref: doc(tasksColRef(uid), cleanTask.id), data: cleanTask });
  }
  for (const log of logs) {
    const cleanLog = normalizeLog({ ...log, id: log.id || `log-${crypto.randomUUID().slice(0, 8)}` }, ts);
    ops.push({ type: "set", ref: doc(logsColRef(uid), cleanLog.id), data: cleanLog });
  }

  ops.push({
    type: "set",
    ref: userDocRef(uid),
    data: {
      ownerEmail: String(ownerEmail || "").trim().toLowerCase(),
      updatedAt: ts,
      initialized: true,
      migratedFrom,
      schemaVersion: 1
    }
  });

  await commitBatchedOps(ops);
  lastSyncedAtIso = ts;
  return ts;
}

function unsubscribeAll() {
  for (const unsub of activeUnsubscribers) {
    try {
      unsub();
    } catch {
      // ignore
    }
  }
  activeUnsubscribers = [];
  activeUid = null;
}

async function initializeAndSubscribeGarage(user, { getFallbackMigrationState, onData, onStatus, onError }) {
  unsubscribeAll();
  const uid = user.uid;
  const ownerEmail = String(user.email || "").trim().toLowerCase();
  activeUid = uid;

  if (onStatus) {
    onStatus("syncing", `Connecting to Google Account Cloud Sync (${ownerEmail})…`);
  }

  // Check if this Google account already has initialized garage data in Firestore
  let userSnap;
  try {
    userSnap = await getDocFromServer(userDocRef(uid));
  } catch {
    userSnap = await getDoc(userDocRef(uid));
  }

  if (activeUid !== uid) return;

  if (!userSnap.exists()) {
    // One-time automatic migration if user previously used GitHub Gist or local storage on this device
    let initialState = await tryLoadLegacyGitHubGist();
    let migratedFrom = "github-gist";

    if (!initialState && typeof getFallbackMigrationState === "function") {
      const fallback = await getFallbackMigrationState();
      if (fallback && fallback.state) {
        initialState = fallback.state;
        migratedFrom = fallback.migratedFrom || "local";
      }
    }

    if (initialState) {
      await replaceFullStateInFirestore(uid, ownerEmail, initialState, { migratedFrom });
      try {
        localStorage.removeItem(LEGACY_GITHUB_SYNC_KEY);
      } catch {
        // ignore
      }
    }
  }

  if (activeUid !== uid) return;

  const stateCache = {
    meta: userSnap.exists() ? userSnap.data() : null,
    cars: [],
    tasks: [],
    logs: [],
    ready: { meta: false, cars: false, tasks: false, logs: false },
    fromCache: { meta: false, cars: false, tasks: false, logs: false },
    hasPendingWrites: { meta: false, cars: false, tasks: false, logs: false }
  };

  function emitIfReady() {
    if (!stateCache.ready.cars || !stateCache.ready.tasks || !stateCache.ready.logs) {
      return;
    }
    const anyFromCache =
      stateCache.fromCache.cars || stateCache.fromCache.tasks || stateCache.fromCache.logs;
    const anyPending =
      stateCache.hasPendingWrites.meta ||
      stateCache.hasPendingWrites.cars ||
      stateCache.hasPendingWrites.tasks ||
      stateCache.hasPendingWrites.logs;

    if (!anyFromCache && !anyPending) {
      lastSyncedAtIso = nowIso();
    }

    onData(
      {
        updatedAt: stateCache.meta?.updatedAt || lastSyncedAtIso || nowIso(),
        cars: sortCars(stateCache.cars),
        tasks: sortTasks(stateCache.tasks),
        logs: sortLogs(stateCache.logs)
      },
      {
        fromCache: anyFromCache,
        hasPendingWrites: anyPending,
        lastSyncedAt: lastSyncedAtIso
      }
    );
  }

  const handleListenerError = (err) => {
    if (onError) onError(err);
  };

  activeUnsubscribers.push(
    onSnapshot(
      userDocRef(uid),
      { includeMetadataChanges: true },
      (snap) => {
        stateCache.meta = snap.exists() ? snap.data() : null;
        stateCache.ready.meta = true;
        stateCache.fromCache.meta = snap.metadata.fromCache;
        stateCache.hasPendingWrites.meta = snap.metadata.hasPendingWrites;
        emitIfReady();
      },
      handleListenerError
    ),
    onSnapshot(
      carsColRef(uid),
      { includeMetadataChanges: true },
      (snap) => {
        stateCache.cars = snap.docs.map((d) => d.data());
        stateCache.ready.cars = true;
        stateCache.fromCache.cars = snap.metadata.fromCache;
        stateCache.hasPendingWrites.cars = snap.metadata.hasPendingWrites;
        emitIfReady();
      },
      handleListenerError
    ),
    onSnapshot(
      tasksColRef(uid),
      { includeMetadataChanges: true },
      (snap) => {
        stateCache.tasks = snap.docs.map((d) => d.data());
        stateCache.ready.tasks = true;
        stateCache.fromCache.tasks = snap.metadata.fromCache;
        stateCache.hasPendingWrites.tasks = snap.metadata.hasPendingWrites;
        emitIfReady();
      },
      handleListenerError
    ),
    onSnapshot(
      logsColRef(uid),
      { includeMetadataChanges: true },
      (snap) => {
        stateCache.logs = snap.docs.map((d) => d.data());
        stateCache.ready.logs = true;
        stateCache.fromCache.logs = snap.metadata.fromCache;
        stateCache.hasPendingWrites.logs = snap.metadata.hasPendingWrites;
        emitIfReady();
      },
      handleListenerError
    )
  );
}

async function refreshFromServer(uid, ownerEmail) {
  const [metaSnap, carsSnap, tasksSnap, logsSnap] = await Promise.all([
    getDocFromServer(userDocRef(uid)),
    getDocsFromServer(carsColRef(uid)),
    getDocsFromServer(tasksColRef(uid)),
    getDocsFromServer(logsColRef(uid))
  ]);
  const ts = nowIso();
  lastSyncedAtIso = ts;
  return {
    updatedAt: metaSnap.exists() ? metaSnap.data().updatedAt || ts : ts,
    ownerEmail,
    cars: sortCars(carsSnap.docs.map((d) => d.data())),
    tasks: sortTasks(tasksSnap.docs.map((d) => d.data())),
    logs: sortLogs(logsSnap.docs.map((d) => d.data())),
    lastSyncedAt: ts
  };
}

async function touchUserTimestamp(uid, ts) {
  await updateDoc(userDocRef(uid), {
    updatedAt: ts
  });
  lastSyncedAtIso = ts;
}

window.GarageLogCloud = {
  initializeAndSubscribeGarage,
  unsubscribeAll,
  refreshFromServer,
  replaceFullState: replaceFullStateInFirestore,
  getLastSyncedAt: () => lastSyncedAtIso,

  async saveCar(uid, car) {
    const ts = nowIso();
    const cleanCar = normalizeCar(car, ts);
    await setDoc(doc(carsColRef(uid), cleanCar.id), cleanCar);
    await touchUserTimestamp(uid, ts);
    return cleanCar;
  },

  async updateCarMileage(uid, carId, currentMileage) {
    const ts = nowIso();
    const cleanMileage = Math.max(0, Math.round(Number(currentMileage) || 0));
    await updateDoc(doc(carsColRef(uid), carId), {
      currentMileage: cleanMileage,
      updatedAt: ts
    });
    await touchUserTimestamp(uid, ts);
  },

  async deleteCarCascade(uid, carId, taskIds = [], logIds = []) {
    const ts = nowIso();
    const ops = [{ type: "delete", ref: doc(carsColRef(uid), carId) }];
    for (const taskId of taskIds) {
      ops.push({ type: "delete", ref: doc(tasksColRef(uid), taskId) });
    }
    for (const logId of logIds) {
      ops.push({ type: "delete", ref: doc(logsColRef(uid), logId) });
    }
    await commitBatchedOps(ops);
    await touchUserTimestamp(uid, ts);
  },

  async saveTask(uid, task) {
    const ts = nowIso();
    const cleanTask = normalizeTask(task, ts);
    await setDoc(doc(tasksColRef(uid), cleanTask.id), cleanTask);
    await touchUserTimestamp(uid, ts);
    return cleanTask;
  },

  async deleteTask(uid, taskId) {
    const ts = nowIso();
    await deleteDoc(doc(tasksColRef(uid), taskId));
    await touchUserTimestamp(uid, ts);
  },

  async saveLogWithSideEffects(uid, { log, taskUpdate = null, carMileageUpdate = null }) {
    const ts = nowIso();
    const cleanLog = normalizeLog(log, ts);

    // Guard against Firestore's 1 MiB document size limit when multiple photos are attached
    const estimatedBytes = new Blob([JSON.stringify(cleanLog)]).size;
    if (estimatedBytes > 950000) {
      throw new Error("Service record with photos exceeds the 1 MB cloud document limit. Please remove a photo or split into two records.");
    }

    const batch = writeBatch(db);
    batch.set(doc(logsColRef(uid), cleanLog.id), cleanLog);

    if (taskUpdate && taskUpdate.id) {
      batch.update(doc(tasksColRef(uid), taskUpdate.id), {
        lastCompletedDate: taskUpdate.lastCompletedDate || null,
        lastCompletedMileage:
          taskUpdate.lastCompletedMileage != null
            ? Math.max(0, Math.round(Number(taskUpdate.lastCompletedMileage) || 0))
            : null,
        completionCount: Math.max(0, Math.round(Number(taskUpdate.completionCount) || 0)),
        updatedAt: ts
      });
    }

    if (carMileageUpdate && carMileageUpdate.id) {
      batch.update(doc(carsColRef(uid), carMileageUpdate.id), {
        currentMileage: Math.max(0, Math.round(Number(carMileageUpdate.currentMileage) || 0)),
        updatedAt: ts
      });
    }

    await batch.commit();
    await touchUserTimestamp(uid, ts);
    return cleanLog;
  },

  async deleteLog(uid, logId) {
    const ts = nowIso();
    await deleteDoc(doc(logsColRef(uid), logId));
    await touchUserTimestamp(uid, ts);
  }
};
