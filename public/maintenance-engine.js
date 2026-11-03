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
      : Number(task.baselineMileage ?? currentMileage);

    const anchorDate = task.lastCompletedDate || task.baselineDate || todayStr;

    const nextDueMileage = intervalMiles > 0 ? anchorMileage + intervalMiles : null;
    const nextDueDate = intervalMonths > 0 ? addMonthsToDateString(anchorDate, intervalMonths) : null;

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
        id: 'car-rav4-2022',
        year: 2022,
        make: 'Toyota',
        model: 'RAV4 Hybrid XSE',
        nickname: 'Daily Cruiser',
        vin: 'JTMEB3FVXND048291',
        licensePlate: '8XJV492',
        currentMileage: 34620,
        colorAccent: '#0ea5e9',
        notes: 'Uses 0W-16 synthetic oil (4.8 qt with filter). Hybrid battery cooling filter under rear passenger seat.'
      },
      {
        id: 'car-miata-2018',
        year: 2018,
        make: 'Mazda',
        model: 'MX-5 Miata Club',
        nickname: 'Weekend Roadster',
        vin: 'JM1NDAC78J0219403',
        licensePlate: 'ND2ZOOM',
        currentMileage: 58900,
        colorAccent: '#f43f5e',
        notes: 'Brembo/BBS package. Track day & canyon spec: DOT 4 brake fluid and 75W-90 GL-4 manual transmission fluid.'
      }
    ];

    const tasks = [
      {
        id: 'task-rav4-oil',
        carId: 'car-rav4-2022',
        title: 'Engine Oil & Filter Change',
        category: 'Engine',
        intervalMiles: 5000,
        intervalMonths: 6,
        lastCompletedDate: '2026-05-14',
        lastCompletedMileage: 29850,
        baselineDate: '2026-05-14',
        baselineMileage: 29850,
        notes: 'Toyota Genuine 0W-16 Full Synthetic + OEM filter 90915-YZZN1',
        completionCount: 6
      },
      {
        id: 'task-rav4-tires',
        carId: 'car-rav4-2022',
        title: 'Tire Rotation & Balance',
        category: 'Tires & Wheels',
        intervalMiles: 5000,
        intervalMonths: 6,
        lastCompletedDate: '2026-08-10',
        lastCompletedMileage: 32100,
        baselineDate: '2026-08-10',
        baselineMileage: 32100,
        notes: 'Set cold tire pressure to 35 PSI all around; torque lugs to 76 ft-lbs.',
        completionCount: 6
      },
      {
        id: 'task-rav4-cabin',
        carId: 'car-rav4-2022',
        title: 'Cabin & Hybrid HV Fan Filter Cleaning',
        category: 'HVAC',
        intervalMiles: 15000,
        intervalMonths: 12,
        lastCompletedDate: '2025-10-05',
        lastCompletedMileage: 19200,
        baselineDate: '2025-10-05',
        baselineMileage: 19200,
        notes: 'Replace glovebox cabin filter and vacuum hybrid battery intake screen.',
        completionCount: 2
      },
      {
        id: 'task-miata-oil',
        carId: 'car-miata-2018',
        title: 'Synthetic Oil & Filter Service',
        category: 'Engine',
        intervalMiles: 4000,
        intervalMonths: 6,
        lastCompletedDate: '2026-07-19',
        lastCompletedMileage: 56400,
        baselineDate: '2026-07-19',
        baselineMileage: 56400,
        notes: 'Pennzoil Ultra Platinum 5W-30 (4.5 qt) + OEM Mazda PE01-14-302B filter.',
        completionCount: 14
      },
      {
        id: 'task-miata-brakes',
        carId: 'car-miata-2018',
        title: 'DOT 4 Brake & Clutch Fluid Flush',
        category: 'Brakes',
        intervalMiles: 15000,
        intervalMonths: 12,
        lastCompletedDate: '2025-09-20',
        lastCompletedMileage: 48500,
        baselineDate: '2025-09-20',
        baselineMileage: 48500,
        notes: 'Motul RBF 600 brake fluid flush before autumn track event.',
        completionCount: 4
      }
    ];

    const logs = [
      {
        id: 'log-rav4-1',
        carId: 'car-rav4-2022',
        taskId: 'task-rav4-tires',
        taskTitle: 'Tire Rotation & Balance',
        category: 'Tires & Wheels',
        completedDate: '2026-08-10',
        mileage: 32100,
        cost: 35.0,
        performedBy: 'America\'s Tire',
        notes: 'Rotated front-to-rear and crossed fronts to rear. Tread depth measured 7/32" across all four Michelin Primacy tires. Re-torqued lug nuts to 76 ft-lbs.',
        photos: [
          {
            id: 'photo-seed-1',
            name: 'tire-tread-inspection.svg',
            caption: 'Tread depth & rotation work order at 32,100 mi',
            dataUrl: createSamplePhotoDataUrl(
              'Tire Rotation & Balance',
              '2022 Toyota RAV4 Hybrid • 32,100 miles • 2026-08-10',
              '#0ea5e9',
              [
                'LF Tread: 7/32"  |  RF Tread: 7/32"',
                'LR Tread: 7/32"  |  RR Tread: 7/32"',
                'Cold Pressure: 35 PSI all corners',
                'Lug Nut Torque: 76 ft-lbs verified'
              ]
            )
          }
        ]
      },
      {
        id: 'log-miata-1',
        carId: 'car-miata-2018',
        taskId: 'task-miata-oil',
        taskTitle: 'Synthetic Oil & Filter Service',
        category: 'Engine',
        completedDate: '2026-07-19',
        mileage: 56400,
        cost: 54.85,
        performedBy: 'DIY Garage',
        notes: 'Drained warm oil, installed new aluminum crush washer (9956-41-400) torqued to 25 ft-lbs, and filled 4.5 quarts 5W-30 synthetic. Inspected serpentine belt—no cracking.',
        photos: [
          {
            id: 'photo-seed-2',
            name: 'miata-oil-service-receipt.svg',
            caption: 'Parts receipt & odometer check at 56,400 mi',
            dataUrl: createSamplePhotoDataUrl(
              'DIY Oil & Filter Service',
              '2018 Mazda MX-5 Miata • 56,400 miles • 2026-07-19',
              '#f43f5e',
              [
                '1x Mazda OEM Oil Filter #PE01-14-302B   $11.95',
                '1x Drain Plug Crush Washer #9956-41-400  $1.90',
                '5qt Pennzoil Ultra Platinum 5W-30       $41.00',
                'Odometer Verified: 56,400 MI'
              ]
            )
          },
          {
            id: 'photo-seed-3',
            name: 'odometer-56400.svg',
            caption: 'Cluster odometer snapshot (56,400 mi)',
            dataUrl: createSamplePhotoDataUrl(
              'Odometer Photo Log',
              'Cluster Reading: 56,400 MI • Trip A Reset: 0.0',
              '#10b981',
              [
                'Oil Life Reminder Reset: COMPLETE',
                'No Diagnostic Trouble Codes (DTCs)',
                'Battery Voltage (Key On): 12.6V'
              ]
            )
          }
        ]
      },
      {
        id: 'log-rav4-2',
        carId: 'car-rav4-2022',
        taskId: 'task-rav4-oil',
        taskTitle: 'Engine Oil & Filter Change',
        category: 'Engine',
        completedDate: '2026-05-14',
        mileage: 29850,
        cost: 68.5,
        performedBy: 'DIY Garage',
        notes: '30k mile oil change with Toyota 0W-16 synthetic and OEM filter. Also inspected front and rear brake pads (9mm front / 8mm rear remaining).',
        photos: []
      },
      {
        id: 'log-miata-2',
        carId: 'car-miata-2018',
        taskId: 'task-miata-brakes',
        taskTitle: 'DOT 4 Brake & Clutch Fluid Flush',
        category: 'Brakes',
        completedDate: '2025-09-20',
        mileage: 48500,
        cost: 42.0,
        performedBy: 'TrackSpec Motorsports',
        notes: 'Pressure bled brake calipers (RR, LR, RF, LF) and clutch slave cylinder using Motul RBF 600. Front Brembo pads at 65% life.',
        photos: [
          {
            id: 'photo-seed-4',
            name: 'brembo-pad-check.svg',
            caption: 'Front Brembo caliper & pad thickness inspection',
            dataUrl: createSamplePhotoDataUrl(
              'Brake & Clutch Fluid Flush',
              '2018 Mazda MX-5 Miata • 48,500 miles • 2025-09-20',
              '#f59e0b',
              [
                'Fluid Used: Motul RBF 600 DOT 4 (2x 500ml)',
                'Front Pad Thickness: 7.5 mm (Even wear)',
                'Rear Pad Thickness: 6.8 mm',
                'Pedal Firmness: Tested & Verified'
              ]
            )
          }
        ]
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
