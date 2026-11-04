/**
 * Core Maintenance Calculation Engine & Seed Data
 * Shared between browser UI and Node.js backend / test suite.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MaintenanceEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SERVICE_PRESETS = [
    {
      title: 'Engine Oil & Filter Change',
      category: 'Engine',
      intervalMiles: 5000,
      intervalMonths: 6,
      defaultNotes: 'Full synthetic 0W-20 oil and OEM oil filter + crush washer.'
    },
    {
      title: 'Tire Rotation & Pressure Check',
      category: 'Tires & Wheels',
      intervalMiles: 5000,
      intervalMonths: 6,
      defaultNotes: 'Cross-pattern rotation, inspect tread depth, torque lug nuts.'
    },
    {
      title: 'Cabin Air Filter Replacement',
      category: 'HVAC',
      intervalMiles: 15000,
      intervalMonths: 12,
      defaultNotes: 'Activated carbon cabin filter behind glovebox.'
    },
    {
      title: 'Engine Air Filter Replacement',
      category: 'Engine',
      intervalMiles: 20000,
      intervalMonths: 24,
      defaultNotes: 'Inspect intake box and replace pleated engine air filter.'
    },
    {
      title: 'Brake Fluid Flush & Pad Inspection',
      category: 'Brakes',
      intervalMiles: 30000,
      intervalMonths: 24,
      defaultNotes: 'Bleed all four corners with fresh DOT 3 / DOT 4 fluid and measure pad thickness.'
    },
    {
      title: 'Coolant System Flush',
      category: 'Cooling',
      intervalMiles: 50000,
      intervalMonths: 60,
      defaultNotes: 'Drain radiator and reservoir, refill with OEM long-life coolant.'
    },
    {
      title: 'Spark Plugs Replacement',
      category: 'Ignition',
      intervalMiles: 60000,
      intervalMonths: 60,
      defaultNotes: 'Replace iridium spark plugs and torque to factory specification.'
    },
    {
      title: 'Transmission / Differential Fluid Service',
      category: 'Drivetrain',
      intervalMiles: 45000,
      intervalMonths: 48,
      defaultNotes: 'Drain and fill transmission/transaxle fluid and replace sealing washers.'
    },
    {
      title: '12V Battery & Charging System Test',
      category: 'Electrical',
      intervalMiles: 15000,
      intervalMonths: 12,
      defaultNotes: 'Clean terminals, test cold cranking amps (CCA) and alternator voltage.'
    }
  ];

  /**
   * Adds calendar months to an ISO date string (YYYY-MM-DD) in UTC.
   */
  function addMonthsToDateString(dateStr, months) {
    if (!dateStr || !months || Number(months) <= 0) return null;
    const parts = String(dateStr).split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [year, month, day] = parts;
    const targetMonthIndex = (month - 1) + Number(months);
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
    const maxDayInMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    const clampedDay = Math.min(day, maxDayInMonth);
    const result = new Date(Date.UTC(targetYear, normalizedMonth, clampedDay));
    return result.toISOString().slice(0, 10);
  }

  /**
   * Computes difference in whole days between targetDateStr and refDateStr (target - ref).
   */
  function diffDays(targetDateStr, refDateStr) {
    if (!targetDateStr || !refDateStr) return null;
    const tParts = String(targetDateStr).split('-').map(Number);
    const rParts = String(refDateStr).split('-').map(Number);
    if (tParts.length !== 3 || rParts.length !== 3) return null;
    const tMs = Date.UTC(tParts[0], tParts[1] - 1, tParts[2]);
    const rMs = Date.UTC(rParts[0], rParts[1] - 1, rParts[2]);
    return Math.round((tMs - rMs) / 86400000);
  }

  /**
   * Evaluates a recurring maintenance task against the vehicle's current mileage and reference date.
   */
  function evaluateTaskStatus(task, car, referenceDateStr) {
    const todayStr = referenceDateStr || new Date().toISOString().slice(0, 10);
    const currentMileage = Number(car?.currentMileage || 0);
    const intervalMiles = Number(task.intervalMiles || 0);
    const intervalMonths = Number(task.intervalMonths || 0);

    const anchorMileage = task.lastCompletedMileage != null
      ? Number(task.lastCompletedMileage)
      : task.baselineMileage != null
        ? Number(task.baselineMileage)
        : 0;

    const anchorDate = task.lastCompletedDate || task.baselineDate || null;

    const nextDueMileage = intervalMiles > 0 ? anchorMileage + intervalMiles : null;
    const nextDueDate = intervalMonths > 0 && anchorDate ? addMonthsToDateString(anchorDate, intervalMonths) : null;

    const milesRemaining = nextDueMileage != null ? nextDueMileage - currentMileage : null;
    const daysRemaining = nextDueDate != null ? diffDays(nextDueDate, todayStr) : null;

    let mileageProgressPct = 0;
    if (intervalMiles > 0 && nextDueMileage != null) {
      const milesElapsed = Math.max(0, currentMileage - anchorMileage);
      mileageProgressPct = Math.min(100, Math.round((milesElapsed / intervalMiles) * 100));
    }

    let timeProgressPct = 0;
    if (intervalMonths > 0 && nextDueDate != null) {
      const totalDays = Math.max(1, diffDays(nextDueDate, anchorDate) || (intervalMonths * 30));
      const elapsedDays = Math.max(0, totalDays - (daysRemaining ?? 0));
      timeProgressPct = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
    }

    const overallProgressPct = Math.max(mileageProgressPct, timeProgressPct);

    let status = 'on-track';
    let statusLabel = 'On Track';
    let urgencyScore = overallProgressPct;

    const isMilesOverdue = milesRemaining != null && milesRemaining <= 0;
    const isDateOverdue = daysRemaining != null && daysRemaining < 0;
    const isMilesDueSoon = milesRemaining != null && milesRemaining > 0 && milesRemaining <= 500;
    const isDateDueSoon = daysRemaining != null && daysRemaining >= 0 && daysRemaining <= 30;

    if (isMilesOverdue || isDateOverdue) {
      status = 'overdue';
      statusLabel = 'Overdue';
      urgencyScore = 200 + (isMilesOverdue ? Math.abs(milesRemaining) / 100 : 0) + (isDateDueSoon || isDateOverdue ? Math.abs(daysRemaining || 0) : 0);
    } else if (isMilesDueSoon || isDateDueSoon) {
      status = 'due-soon';
      statusLabel = 'Due Soon';
      urgencyScore = 100 + overallProgressPct;
    }

    return {
      nextDueMileage,
      nextDueDate,
      milesRemaining,
      daysRemaining,
      mileageProgressPct,
      timeProgressPct,
      overallProgressPct,
      status,
      statusLabel,
      urgencyScore,
      isMilesOverdue,
      isDateOverdue
    };
  }

  /**
   * Generates a crisp SVG Data URL for demo service photos / receipts.
   */
  function createSamplePhotoDataUrl(title, subtitle, accentColor, detailLines) {
    const lines = Array.isArray(detailLines) ? detailLines : [];
    const escapedTitle = String(title).replace(/[&<>"]/g, '');
    const escapedSub = String(subtitle).replace(/[&<>"]/g, '');
    const lineElements = lines
      .map((line, idx) => {
        const clean = String(line).replace(/[&<>"]/g, '');
        return `<text x="36" y="${155 + idx * 28}" fill="#cbd5e1" font-family="monospace" font-size="14">${clean}</text>`;
      })
      .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#1e293b"/>
        </linearGradient>
      </defs>
      <rect width="640" height="420" rx="16" fill="url(#bg)"/>
      <rect x="16" y="16" width="608" height="388" rx="12" fill="none" stroke="${accentColor || '#38bdf8'}" stroke-width="2" stroke-dasharray="6 4"/>
      <rect x="36" y="36" width="120" height="28" rx="6" fill="${accentColor || '#38bdf8'}" fill-opacity="0.2"/>
      <text x="48" y="55" fill="${accentColor || '#38bdf8'}" font-family="sans-serif" font-weight="bold" font-size="13">SERVICE PHOTO</text>
      <text x="36" y="96" fill="#f8fafc" font-family="sans-serif" font-weight="bold" font-size="24">${escapedTitle}</text>
      <text x="36" y="122" fill="#94a3b8" font-family="sans-serif" font-size="15">${escapedSub}</text>
      <line x1="36" y1="134" x2="604" y2="134" stroke="#334155" stroke-width="1"/>
      ${lineElements}
      <circle cx="545" cy="335" r="42" fill="${accentColor || '#38bdf8'}" fill-opacity="0.15" stroke="${accentColor || '#38bdf8'}" stroke-width="2"/>
      <text x="545" y="340" text-anchor="middle" fill="${accentColor || '#38bdf8'}" font-family="sans-serif" font-weight="bold" font-size="13">VERIFIED</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  /**
   * Produces anonymized demo data for local/reset testing (zero personal vehicle data in public repo).
   */
  function createInitialSeedData() {
    const cars = [
      {
        id: 'car-demo-1',
        year: 2022,
        make: 'Toyota',
        model: 'RAV4 Hybrid',
        nickname: 'Daily Driver',
        vin: '2T3RWRFV0NW000001',
        licensePlate: 'DEMO001',
        currentMileage: 34500,
        colorAccent: '#0ea5e9',
        notes: '0W-16 full synthetic oil.',
        parts: [
          {
            id: 'part-demo-oil',
            item: 'Engine Oil',
            spec: '0W-16 Full Synthetic (API SP)',
            notes: '4.8 quarts with filter'
          }
        ]
      },
      {
        id: 'car-demo-2',
        year: 2019,
        make: 'Honda',
        model: 'Civic Sport',
        nickname: 'Commuter',
        vin: '19XFC2F80KE000002',
        licensePlate: 'DEMO002',
        currentMileage: 62100,
        colorAccent: '#10b981',
        notes: '0W-20 full synthetic oil.',
        parts: [
          {
            id: 'part-demo-civic-oil',
            item: 'Engine Oil',
            spec: '0W-20 Full Synthetic (API SN/SP)',
            notes: '3.7 quarts with filter'
          }
        ]
      }
    ];

    const tasks = [
      {
        id: 'task-demo-oil',
        carId: 'car-demo-1',
        title: 'Engine Oil/filter',
        category: 'Engine',
        intervalMiles: 5000,
        intervalMonths: 6,
        lastCompletedDate: '2026-06-15',
        lastCompletedMileage: 30000,
        baselineDate: '2026-06-15',
        baselineMileage: 30000,
        notes: 'Full synthetic oil and OEM filter.',
        completionCount: 1
      },
      {
        id: 'task-demo-tires',
        carId: 'car-demo-2',
        title: 'Tire Rotation',
        category: 'Tires & Wheels',
        intervalMiles: 6000,
        intervalMonths: 6,
        lastCompletedDate: '2026-05-10',
        lastCompletedMileage: 58000,
        baselineDate: '2026-05-10',
        baselineMileage: 58000,
        notes: 'Rotate front-to-back.',
        completionCount: 1
      }
    ];

    const logs = [
      {
        id: 'log-demo-1',
        carId: 'car-demo-1',
        taskId: 'task-demo-oil',
        taskTitle: 'Engine Oil/filter',
        category: 'Engine',
        completedDate: '2026-06-15',
        mileage: 30000,
        cost: 45.0,
        performedBy: 'DIY Garage',
        notes: 'Full synthetic oil + OEM filter.',
        photos: []
      }
    ];

    return { cars, tasks, logs };
  }

  return {
    SERVICE_PRESETS,
    addMonthsToDateString,
    diffDays,
    evaluateTaskStatus,
    createSamplePhotoDataUrl,
    createInitialSeedData
  };
});
