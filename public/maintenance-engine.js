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
   * Produces rich initial demo data with 2 vehicles, recurring tasks, and maintenance history with notes & photos.
   */
  function createInitialSeedData() {
    const cars = [
      {
        id: 'car-371tooqm',
        year: 2016,
        make: 'Mazda',
        model: 'CX-5 Grand Touring',
        nickname: '',
        vin: 'JM3KE4DY5G0765059',
        licensePlate: '9RCW065',
        currentMileage: 107696,
        colorAccent: '#0ea5e9',
        notes: '0W-20 full synthetic oil. Tire rotation: Rear forward, front cross (lug torque 108 ft-lbs).',
        parts: [
          {
            id: 'part-cx5-oil',
            item: 'Engine Oil',
            spec: '0W-20 Full Synthetic (GF-5 / API SN/SP)',
            notes: '4.8 quarts (4.5 L) with filter'
          },
          {
            id: 'part-cx5-oil-filter',
            item: 'Oil Filter',
            spec: 'Mazda OEM PE01-14-302B (1WPE-14-302)',
            notes: 'Drain plug crush washer 9956-41-400'
          },
          {
            id: 'part-cx5-cabin-filter',
            item: 'Cabin Air Filter',
            spec: 'Mazda OEM KD45-61-J6X',
            notes: ''
          },
          {
            id: 'part-cx5-engine-filter',
            item: 'Engine Air Filter',
            spec: 'Mazda OEM PE07-13-3A0A',
            notes: ''
          },
          {
            id: 'part-cx5-spark-plugs',
            item: 'Spark Plugs',
            spec: 'Mazda PE5R-18-110 / NGK ILKAR7L11 (Iridium)',
            notes: ''
          },
          {
            id: 'part-cx5-atf',
            item: 'Transmission Fluid',
            spec: 'Mazda Original Oil ATF-FZ (Blue)',
            notes: ''
          },
          {
            id: 'part-cx5-diff',
            item: 'Rear Diff / Transfer Case Fluid',
            spec: 'Mazda Long Life Hypoid Gear Oil SG1 (80W-90 GL-5)',
            notes: ''
          },
          {
            id: 'part-cx5-coolant',
            item: 'Coolant',
            spec: 'Mazda FL22 Extended Life Coolant (55/45)',
            notes: ''
          },
          {
            id: 'part-cx5-brake-fluid',
            item: 'Brake Fluid',
            spec: 'DOT 3',
            notes: ''
          }
        ]
      },
      {
        id: 'car-pg28a2r5',
        year: 2014,
        make: 'Toyota',
        model: 'Corolla S',
        nickname: "Katie's Car",
        vin: '5YFBURHE6EP055308',
        licensePlate: '7DSS008',
        currentMileage: 103000,
        colorAccent: '#10b981',
        notes: '0W-20 full synthetic oil. Tire rotation: front back / rear cross.',
        parts: [
          {
            id: 'part-corolla-oil',
            item: 'Engine Oil',
            spec: '0W-20 Full Synthetic (API SN/SP)',
            notes: '4.4 quarts (4.2 L) with filter'
          },
          {
            id: 'part-corolla-oil-filter',
            item: 'Oil Filter',
            spec: 'Toyota OEM 04152-YZZA6',
            notes: 'Cartridge filter • Drain plug washer 90430-12031'
          },
          {
            id: 'part-corolla-cabin-filter',
            item: 'Cabin Air Filter',
            spec: 'Toyota OEM 87139-07010 / 87139-YZZ20',
            notes: ''
          },
          {
            id: 'part-corolla-engine-filter',
            item: 'Engine Air Filter',
            spec: 'Toyota OEM 17801-0T030 / 17801-21050',
            notes: ''
          },
          {
            id: 'part-corolla-spark-plugs',
            item: 'Spark Plugs',
            spec: 'Denso SC16HR11 / NGK ILKAR7B11 (Iridium)',
            notes: 'Gap: 0.043 in (1.1 mm)'
          },
          {
            id: 'part-corolla-cvt-fluid',
            item: 'Transmission Fluid',
            spec: 'Toyota Genuine CVT Fluid FE',
            notes: ''
          },
          {
            id: 'part-corolla-coolant',
            item: 'Coolant',
            spec: 'Toyota Super Long Life Coolant (Pink, 50/50)',
            notes: ''
          },
          {
            id: 'part-corolla-brake-fluid',
            item: 'Brake Fluid',
            spec: 'DOT 3',
            notes: ''
          }
        ]
      }
    ];

    const tasks = [
      {
        id: 'task-18tyc2gm',
        carId: 'car-371tooqm',
        title: 'Engine Oil/filter',
        category: 'Engine',
        intervalMiles: 6000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 103613,
        baselineDate: null,
        baselineMileage: 103613,
        notes: 'Full synthetic 0W-20 oil and OEM oil filter + crush washer.',
        completionCount: 1
      },
      {
        id: 'task-cx5-fuel-cleaner',
        carId: 'car-371tooqm',
        title: 'Fuel Cleaner',
        category: 'Engine',
        intervalMiles: 6000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 103613,
        baselineDate: null,
        baselineMileage: 103613,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-is5pxrz7',
        carId: 'car-371tooqm',
        title: 'Tire Rotation',
        category: 'Tires & Wheels',
        intervalMiles: 6000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 103613,
        baselineDate: null,
        baselineMileage: 103613,
        notes: '(Rear forward, front cross) • Torque lug nuts 108 ft-lbs',
        completionCount: 1
      },
      {
        id: 'task-cx5-cabin-filter',
        carId: 'car-371tooqm',
        title: 'Cabin Air Filter',
        category: 'HVAC',
        intervalMiles: 15000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 79000,
        baselineDate: null,
        baselineMileage: 79000,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-cx5-engine-filter',
        carId: 'car-371tooqm',
        title: 'Engine Air Filter',
        category: 'Engine',
        intervalMiles: 25000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 79000,
        baselineDate: null,
        baselineMileage: 79000,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-cx5-brakes',
        carId: 'car-371tooqm',
        title: 'Brake Pads/rotors',
        category: 'Brakes',
        intervalMiles: 36000,
        intervalMonths: 0,
        lastCompletedDate: '2025-12-01',
        lastCompletedMileage: 92628,
        baselineDate: '2025-12-01',
        baselineMileage: 92628,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-cx5-brake-fluid',
        carId: 'car-371tooqm',
        title: 'Brake Fluid',
        category: 'Brakes',
        intervalMiles: 0,
        intervalMonths: 36,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        baselineDate: null,
        baselineMileage: null,
        notes: '',
        completionCount: 0
      },
      {
        id: 'task-cx5-rear-diff',
        carId: 'car-371tooqm',
        title: 'Rear Differential Fluid',
        category: 'Drivetrain',
        intervalMiles: 60000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 98805,
        baselineDate: null,
        baselineMileage: 98805,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-cx5-transfer-case',
        carId: 'car-371tooqm',
        title: 'Transfer Case Fluid',
        category: 'Drivetrain',
        intervalMiles: 60000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 98805,
        baselineDate: null,
        baselineMileage: 98805,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-cx5-coolant',
        carId: 'car-371tooqm',
        title: 'Coolant Drain and Fill',
        category: 'Cooling',
        intervalMiles: 120000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        baselineDate: null,
        baselineMileage: null,
        notes: '',
        completionCount: 0
      },
      {
        id: 'task-cx5-trans-fluid',
        carId: 'car-371tooqm',
        title: 'Transmission fluid',
        category: 'Drivetrain',
        intervalMiles: 75000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        baselineDate: null,
        baselineMileage: null,
        notes: '',
        completionCount: 0
      },
      {
        id: 'task-cx5-spark-plugs',
        carId: 'car-371tooqm',
        title: 'Spark Plugs',
        category: 'Ignition',
        intervalMiles: 75000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 84500,
        baselineDate: null,
        baselineMileage: 84500,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-corolla-oil',
        carId: 'car-pg28a2r5',
        title: 'Engine Oil/filter',
        category: 'Engine',
        intervalMiles: 6500,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 95395,
        baselineDate: null,
        baselineMileage: 95395,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-corolla-fuel',
        carId: 'car-pg28a2r5',
        title: 'Fuel System Clean',
        category: 'Engine',
        intervalMiles: 6500,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 95395,
        baselineDate: null,
        baselineMileage: 95395,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-corolla-tires',
        carId: 'car-pg28a2r5',
        title: 'Tire Rotation',
        category: 'Tires & Wheels',
        intervalMiles: 6500,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 95395,
        baselineDate: null,
        baselineMileage: 95395,
        notes: '(front back/ rear cross)',
        completionCount: 1
      },
      {
        id: 'task-corolla-cabin-filter',
        carId: 'car-pg28a2r5',
        title: 'Cabin Air Filter',
        category: 'HVAC',
        intervalMiles: 15000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 95395,
        baselineDate: null,
        baselineMileage: 95395,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-corolla-engine-filter',
        carId: 'car-pg28a2r5',
        title: 'Engine Air Filter',
        category: 'Engine',
        intervalMiles: 30000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 95395,
        baselineDate: null,
        baselineMileage: 95395,
        notes: '',
        completionCount: 1
      },
      {
        id: 'task-corolla-brakes',
        carId: 'car-pg28a2r5',
        title: 'Brake Pads/rotors',
        category: 'Brakes',
        intervalMiles: 36000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        baselineDate: null,
        baselineMileage: null,
        notes: '',
        completionCount: 0
      },
      {
        id: 'task-corolla-trans-fluid',
        carId: 'car-pg28a2r5',
        title: 'Transmission fluid',
        category: 'Drivetrain',
        intervalMiles: 80000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        baselineDate: null,
        baselineMileage: null,
        notes: '',
        completionCount: 0
      },
      {
        id: 'task-corolla-coolant',
        carId: 'car-pg28a2r5',
        title: 'Coolant',
        category: 'Cooling',
        intervalMiles: 100000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        baselineDate: null,
        baselineMileage: null,
        notes: '',
        completionCount: 0
      },
      {
        id: 'task-corolla-brake-fluid',
        carId: 'car-pg28a2r5',
        title: 'Brake Fluid',
        category: 'Brakes',
        intervalMiles: 0,
        intervalMonths: 36,
        lastCompletedDate: null,
        lastCompletedMileage: null,
        baselineDate: null,
        baselineMileage: null,
        notes: '',
        completionCount: 0
      },
      {
        id: 'task-corolla-spark-plugs',
        carId: 'car-pg28a2r5',
        title: 'Spark Plugs',
        category: 'Ignition',
        intervalMiles: 100000,
        intervalMonths: 0,
        lastCompletedDate: null,
        lastCompletedMileage: 86952,
        baselineDate: null,
        baselineMileage: 86952,
        notes: '',
        completionCount: 1
      }
    ];

    const logs = [
      {
        id: 'log-cx5-1',
        carId: 'car-371tooqm',
        taskId: 'task-18tyc2gm',
        taskTitle: 'Engine Oil/filter',
        category: 'Engine',
        completedDate: '2026-07-03',
        mileage: 103613,
        cost: 48.0,
        performedBy: 'DIY Garage',
        notes: 'Full synthetic 0W-20 oil + OEM oil filter, fuel cleaner, and tire rotation (rear forward, front cross).',
        photos: []
      },
      {
        id: 'log-cx5-2',
        carId: 'car-371tooqm',
        taskId: 'task-cx5-brakes',
        taskTitle: 'Brake Pads/rotors',
        category: 'Brakes',
        completedDate: '2025-12-01',
        mileage: 92628,
        cost: 340.0,
        performedBy: 'DIY Garage',
        notes: 'Replaced brake pads and rotors at 92,628 miles (Dec 2025).',
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
