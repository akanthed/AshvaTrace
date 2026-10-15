import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { routes } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { initShiftData, loadPersistedMachines, tickLiveSample, getMachineStatus, getMachines } from './services/machineService';
import { checkThresholds, publishAlert, loadPersistedAlerts } from './services/alertService';
import { loadPersistedIncidents, seedPastIncidents, investigateIncident, getIncidentById } from './services/incidentService';
import { broadcastEvent } from './routes/sseRoutes';
import { initBigQuery, seedBigQuery, seedSops } from './services/bigqueryService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
// 10mb limit: dashboard backgrounds are uploaded as base64 data URLs in the
// request body, which are ~33% larger than the original file.
app.use(express.json({ limit: '10mb' }));

// Static frontend (for local dev)
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', routes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Error handler
app.use(errorHandler);

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize
async function start() {
  // Initialize in-memory shift data
  const { data } = initShiftData();
  console.log(`[Init] Loaded shift data: ${data.machines.length} machines, ${data.N} samples`);

  // Initialize BigQuery (optional, non-blocking)
  if (process.env.GCP_PROJECT_ID) {
    await initBigQuery();
    await seedBigQuery(data.machines);
    await seedSops();
    // Load persisted machines and incidents so add/remove/update and the
    // investigation history survive a server restart.
    await loadPersistedMachines();
    await loadPersistedIncidents();
    await loadPersistedAlerts();
    // Seed synthetic past incidents so the AI has history to reference
    // ("last time this happened, we did X and it worked").
    seedPastIncidents();
  }

  // Start threshold checker (every 5 seconds)
  setInterval(async () => {
    const newAlerts = checkThresholds();
    for (const alert of newAlerts) {
      console.log(`[Alert] ${alert.severity.toUpperCase()}: ${alert.message}`);
      broadcastEvent({ type: 'alert', alert });
      await publishAlert(alert);
    }
  }, 5000);

  // Live demo feed: append a new random-walk sample to every machine every
  // 3 seconds and push each to connected clients over SSE, so every trend
  // chart moves over time instead of only one machine looking live while
  // the rest stay frozen at their seeded values.
  //
  // When a machine's live data spikes into warning/critical territory, the
  // threshold checker (below) creates alerts + incidents, and we auto-run
  // the AI investigation so the full "AI proposes" loop happens on its own.
  const AUTO_INVESTIGATE = process.env.LIVE_AUTO_INVESTIGATE !== 'false'; // default on
  const investigating = new Set<string>(); // incident ids currently being investigated

  setInterval(async () => {
    for (const m of getMachines()) {
      const tick = tickLiveSample(m.id);
      if (!tick) continue;

      // Broadcast the new sample AND the resulting status so the frontend can
      // update the machine card and its status badge instantly.
      const status = getMachineStatus(m.id);
      broadcastEvent({ type: 'liveSample', machineId: tick.machineId, sample: tick.sample, status });
    }

    // Run the threshold check once per tick (across all machines) so
    // alerts/incidents fire promptly (the 5s interval also runs, but this
    // makes the demo snappier).
    const newAlerts = checkThresholds();
    for (const alert of newAlerts) {
      console.log(`[Alert] ${alert.severity.toUpperCase()}: ${alert.message}`);
      broadcastEvent({ type: 'alert', alert });
      await publishAlert(alert);

      // Auto-investigate the incident created by a critical alert so the demo
      // shows the AI proposing hypotheses without the user clicking anything.
      if (AUTO_INVESTIGATE && alert.incidentId && !investigating.has(alert.incidentId)) {
        const incidentId = alert.incidentId;
        const incident = getIncidentById(incidentId);
        if (incident && incident.status === 'open') {
          investigating.add(incidentId);
          const st = getMachineStatus(alert.machineId);
          investigateIncident(incidentId, {
            machineId: alert.machineId,
            devPct: alert.devPct,
            signals: st
              ? { powerDevPct: st.devPct, actualPower: st.actual, expectedPower: st.expected, vibration: st.vibration, cycleTime: st.cycleTime }
              : {},
          })
            .then((updated) => {
              broadcastEvent({ type: 'incidentUpdated', incident: updated });
            })
            .catch((err) => console.error('[Live] Auto-investigate failed:', err))
            .finally(() => investigating.delete(incidentId));
        }
      }
    }
  }, 3000);

  app.listen(PORT, () => {
    console.log(`AshvaTrace server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
