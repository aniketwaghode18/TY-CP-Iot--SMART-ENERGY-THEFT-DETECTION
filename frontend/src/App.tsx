import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Activity,
  Zap,
  Gauge,
  Cpu,
  Radio,
  Clock,
  RefreshCw,
  LineChart as LineChartIcon,
  Check,
  AlertTriangle,
  AlertOctagon,
  ShieldAlert,
  ShieldCheck,
  Flame,
  Bug,
  Trash2,
  Filter,
  Sliders,
  Square,
  Power,
  ChevronRight,
  ShieldX,
  FlaskConical,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Timer,
  LayoutDashboard,
  Award,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface MetricPayload {
  voltage: number;
  current: number;
  power_factor: number;
  active_power: number;
  cumulative_energy: number;
  tamper_flag?: boolean;
}

interface MeterData {
  meter_id: string;
  name: string;
  type: 'consumer' | 'master_feeder';
  ground_truth: MetricPayload;
  reported: MetricPayload;
  active_attack?: string | null;
}

interface AlertItem {
  id?: number;
  meter_id: string;
  alert_type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  simulation_step: number;
  simulated_time: string;
  timestamp?: string;
  resolved?: boolean;
}

interface TelemetryMessage {
  timestamp: string;
  simulation_step: number;
  simulated_time: string;
  time_compression: string;
  active_attacks?: Record<string, string>;
  alerts?: AlertItem[];
  meters: Record<string, MeterData>;
}

interface HistoryItem {
  id: number;
  meter_id: string;
  simulation_step: number;
  simulated_time: string;
  gt_voltage: number;
  gt_current: number;
  gt_power_factor: number;
  gt_active_power: number;
  gt_cumulative_energy: number;
  rep_voltage: number;
  rep_current: number;
  rep_power_factor: number;
  rep_active_power: number;
  rep_cumulative_energy: number;
}

interface ChartDataPoint {
  step: number;
  time: string;
  rep_active_power: number;
  gt_active_power: number;
  rep_voltage: number;
}

// Phase 5 Test Case Definition
interface TestCaseDefinition {
  id: string;
  code: string;
  name: string;
  targetMeter: string;
  attackType: string;
  intensity: number;
  expectedAlertType: string;
  expectedOutcome: string;
  description: string;
}

interface TestResult {
  id: string;
  name: string;
  expectedOutcome: string;
  actualOutcome: string;
  latencyMs: number | null;
  status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
  timestamp?: string;
  details?: string;
}

const TEST_CASES: TestCaseDefinition[] = [
  {
    id: 'TC-03',
    code: 'TC-03',
    name: 'Test Case 03: Simulated Bypass Attack',
    targetMeter: 'meter_01',
    attackType: 'bypass',
    intensity: 1.0,
    expectedAlertType: 'BYPASS_ALERT',
    expectedOutcome: 'Feeder Imbalance Alert (Feeder delivery > 5% above sum of meters for 3 consecutive ticks)',
    description: 'Zeros out Meter 01 reported load while feeder stays high; triggers Rule 3 bypass detection.',
  },
  {
    id: 'TC-08',
    code: 'TC-08',
    name: 'Test Case 08: False Data Injection (FDI)',
    targetMeter: 'meter_03',
    attackType: 'false_data_injection',
    intensity: 0.5,
    expectedAlertType: 'PHYSICS_INCONSISTENCY',
    expectedOutcome: 'Physics Inconsistency Warning (Reported Active Power != V * I * PF by > 1%)',
    description: 'Cuts reported active power by 50% without altering V or I; triggers Rule 2 physics law verification.',
  },
  {
    id: 'TC-01',
    code: 'TC-01',
    name: 'Test Case 01: Physical Tamper Sabotage',
    targetMeter: 'meter_02',
    attackType: 'trigger_tamper',
    intensity: 1.0,
    expectedAlertType: 'TAMPER_DETECTED',
    expectedOutcome: 'Critical Tamper Alert (Enclosure switch or magnetic sensor triggered)',
    description: 'Trips hardware tamper switch on Meter 02; triggers Rule 1 enclosure violation detection.',
  },
];

const API_BASE = 'http://localhost:8000';
const WS_URL = 'ws://localhost:8000/ws/telemetry';
const MAX_CHART_POINTS = 35;
const MAX_ALERTS_DISPLAY = 40;

export default function App() {
  // Navigation: 'dashboard' | 'testbench'
  const [activeTab, setActiveTab] = useState<'dashboard' | 'testbench'>('dashboard');

  const [telemetry, setTelemetry] = useState<TelemetryMessage | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [selectedMeterId, setSelectedMeterId] = useState<string>('meter_02');
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertFilter, setAlertFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');

  // Phase 4: Attack Control Panel State
  const [targetMeterId, setTargetMeterId] = useState<string>('meter_02');
  const [attackIntensity, setAttackIntensity] = useState<number>(0.5);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Phase 5: Automated Test Bench State
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({
    'TC-03': {
      id: 'TC-03',
      name: 'Test Case 03: Simulated Bypass Attack',
      expectedOutcome: 'Feeder Imbalance Alert (Feeder energy > 5% above sum for 3 ticks)',
      actualOutcome: 'Awaiting execution',
      latencyMs: null,
      status: 'IDLE',
    },
    'TC-08': {
      id: 'TC-08',
      name: 'Test Case 08: False Data Injection (FDI)',
      expectedOutcome: 'Physics Inconsistency Warning (P != V * I * PF by > 1%)',
      actualOutcome: 'Awaiting execution',
      latencyMs: null,
      status: 'IDLE',
    },
    'TC-01': {
      id: 'TC-01',
      name: 'Test Case 01: Physical Tamper Sabotage',
      expectedOutcome: 'Critical Tamper Alert (Enclosure breach detected)',
      actualOutcome: 'Awaiting execution',
      latencyMs: null,
      status: 'IDLE',
    },
  });
  const [orchestratorRunning, setOrchestratorRunning] = useState<boolean>(false);
  const [currentRunningTestId, setCurrentRunningTestId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedMeterRef = useRef<string>(selectedMeterId);
  const alertSubscribersRef = useRef<((alert: AlertItem) => void)[]>([]);

  useEffect(() => {
    selectedMeterRef.current = selectedMeterId;
  }, [selectedMeterId]);

  // Fetch initial history from REST API on meter selection
  const fetchHistory = async (meterId: string) => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE}/meters/${meterId}/history?limit=30`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data: HistoryItem[] = await res.json();

      const formatted: ChartDataPoint[] = data.map((item) => {
        const timeParts = item.simulated_time ? item.simulated_time.split(' ') : [];
        const displayTime = timeParts.length > 1 ? timeParts[1] : item.simulated_time;
        return {
          step: item.simulation_step,
          time: displayTime,
          rep_active_power: item.rep_active_power,
          gt_active_power: item.gt_active_power,
          rep_voltage: item.rep_voltage,
        };
      });

      setChartData(formatted);
    } catch (err) {
      console.error('[REST API] Failed to fetch meter history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchRecentAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/alerts?limit=25`);
      if (res.ok) {
        const data: AlertItem[] = await res.json();
        setAlerts(data);
      }
    } catch (err) {
      console.error('[REST API] Failed to fetch alerts:', err);
    }
  };

  useEffect(() => {
    fetchHistory(selectedMeterId);
  }, [selectedMeterId]);

  useEffect(() => {
    fetchRecentAlerts();
  }, []);

  // Attack Trigger & Stop Handlers
  const handleTriggerAttack = async (attackType: string, meterId?: string, intensity?: number) => {
    const target = meterId || targetMeterId;
    setActionLoading(attackType);
    try {
      await fetch(`${API_BASE}/simulation/attack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meter_id: target,
          attack_type: attackType,
          intensity: intensity !== undefined ? intensity : attackIntensity,
        }),
      });
      setSelectedMeterId(target);
    } catch (err) {
      console.error('[Attack Injection Error]:', err);
    } finally {
      setTimeout(() => setActionLoading(null), 400);
    }
  };

  const handleStopAttack = async (meterId?: string) => {
    setActionLoading('stop');
    try {
      await fetch(`${API_BASE}/simulation/attack/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meter_id: meterId || null,
        }),
      });
    } catch (err) {
      console.error('[Stop Attack Error]:', err);
    } finally {
      setTimeout(() => setActionLoading(null), 400);
    }
  };

  // Phase 5: Reset Simulation & Clear Database State
  const handleResetSimulation = async () => {
    setActionLoading('reset');
    try {
      const res = await fetch(`${API_BASE}/simulation/reset`, { method: 'POST' });
      if (res.ok) {
        setAlerts([]);
        setChartData([]);
        // Reset test results to idle
        setTestResults((prev) => {
          const reset: Record<string, TestResult> = {};
          Object.keys(prev).forEach((key) => {
            reset[key] = {
              ...prev[key],
              status: 'IDLE',
              actualOutcome: 'Awaiting execution',
              latencyMs: null,
            };
          });
          return reset;
        });
        fetchHistory(selectedMeterId);
      }
    } catch (err) {
      console.error('[Reset Simulation Error]:', err);
    } finally {
      setTimeout(() => setActionLoading(null), 400);
    }
  };

  const clearAllAlerts = async () => {
    try {
      await fetch(`${API_BASE}/alerts/clear`, { method: 'POST' });
      setAlerts([]);
    } catch (err) {
      console.error('[Clear Alerts Error]:', err);
    }
  };

  // WebSocket Ingest Pipeline
  useEffect(() => {
    const connect = () => {
      setConnectionStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const payload: TelemetryMessage = JSON.parse(event.data);
          setTelemetry(payload);

          // Ingest new alerts
          if (payload.alerts && payload.alerts.length > 0) {
            setAlerts((prev) => {
              const merged = [...payload.alerts!, ...prev];
              return merged.slice(0, MAX_ALERTS_DISPLAY);
            });

            // Notify Phase 5 test orchestrator subscribers
            payload.alerts.forEach((alert) => {
              alertSubscribersRef.current.forEach((subscriber) => subscriber(alert));
            });
          }

          // Append real-time chart point for active meter
          const currentMeterId = selectedMeterRef.current;
          const currentMeterData = payload.meters[currentMeterId];

          if (currentMeterData) {
            const timeParts = payload.simulated_time.split(' ');
            const displayTime = timeParts.length > 1 ? timeParts[1] : payload.simulated_time;

            const newPoint: ChartDataPoint = {
              step: payload.simulation_step,
              time: displayTime,
              rep_active_power: currentMeterData.reported.active_power,
              gt_active_power: currentMeterData.ground_truth.active_power,
              rep_voltage: currentMeterData.reported.voltage,
            };

            setChartData((prev) => {
              if (prev.length > 0 && prev[prev.length - 1].step === newPoint.step) {
                return prev;
              }
              const updated = [...prev, newPoint];
              return updated.length > MAX_CHART_POINTS
                ? updated.slice(updated.length - MAX_CHART_POINTS)
                : updated;
            });
          }
        } catch (err) {
          console.error('[WebSocket] Parse error:', err);
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  // -------------------------------------------------------------
  // PHASE 5: AUTOMATED TEST ORCHESTRATOR
  // -------------------------------------------------------------
  const executeSingleTest = useCallback(
    (tc: TestCaseDefinition): Promise<TestResult> => {
      return new Promise<TestResult>(async (resolve) => {
        setCurrentRunningTestId(tc.id);

        // Update UI status to RUNNING
        setTestResults((prev) => ({
          ...prev,
          [tc.id]: {
            ...prev[tc.id],
            status: 'RUNNING',
            actualOutcome: 'Attack injected. Awaiting alert verification on WebSocket stream...',
            latencyMs: null,
          },
        }));

        const startTime = performance.now();
        let testFinished = false;
        let timeoutHandle: ReturnType<typeof setTimeout>;

        // Alert Listener Callback for this test
        const alertHandler = (incomingAlert: AlertItem) => {
          if (testFinished) return;

          // Check if the alert matches the expected criteria
          const isExpectedType = incomingAlert.alert_type === tc.expectedAlertType;
          const isTargetMatched =
            tc.attackType === 'bypass'
              ? incomingAlert.meter_id === 'feeder_master' || incomingAlert.meter_id === tc.targetMeter
              : incomingAlert.meter_id === tc.targetMeter;

          if (isExpectedType && isTargetMatched) {
            testFinished = true;
            clearTimeout(timeoutHandle);
            // Remove listener
            alertSubscribersRef.current = alertSubscribersRef.current.filter((sub) => sub !== alertHandler);

            const latency = Math.round(performance.now() - startTime);
            const passedResult: TestResult = {
              id: tc.id,
              name: tc.name,
              expectedOutcome: tc.expectedOutcome,
              actualOutcome: `Verified: ${incomingAlert.message}`,
              latencyMs: latency,
              status: 'PASS',
              timestamp: new Date().toLocaleTimeString(),
              details: `Alert: ${incomingAlert.alert_type} (${incomingAlert.severity}) received in ${latency}ms at Sim Step #${incomingAlert.simulation_step}`,
            };

            setTestResults((prev) => ({ ...prev, [tc.id]: passedResult }));

            // Clean up: stop attack immediately
            handleStopAttack(tc.targetMeter);
            resolve(passedResult);
          }
        };

        // Register subscriber
        alertSubscribersRef.current.push(alertHandler);

        // Step 1: Call Attack API
        try {
          await fetch(`${API_BASE}/simulation/attack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              meter_id: tc.targetMeter,
              attack_type: tc.attackType,
              intensity: tc.intensity,
            }),
          });
        } catch (err) {
          console.error(`[Test Orchestrator] API failure on ${tc.id}:`, err);
        }

        // Step 2: Timeout guard (8 seconds max wait)
        timeoutHandle = setTimeout(() => {
          if (!testFinished) {
            testFinished = true;
            alertSubscribersRef.current = alertSubscribersRef.current.filter((sub) => sub !== alertHandler);
            const failedResult: TestResult = {
              id: tc.id,
              name: tc.name,
              expectedOutcome: tc.expectedOutcome,
              actualOutcome: `FAIL: Expected '${tc.expectedAlertType}' was not broadcast within 8000ms timeout.`,
              latencyMs: null,
              status: 'FAIL',
              timestamp: new Date().toLocaleTimeString(),
              details: 'Timeout exceeded without receiving target alert signature from detection engine.',
            };
            setTestResults((prev) => ({ ...prev, [tc.id]: failedResult }));
            handleStopAttack(tc.targetMeter);
            resolve(failedResult);
          }
        }, 8500);
      });
    },
    []
  );

  // Run All Tests Sequentially
  const runAllTests = async () => {
    if (orchestratorRunning) return;
    setOrchestratorRunning(true);

    try {
      // 1. Reset simulation and DB state before benchmark run
      await fetch(`${API_BASE}/simulation/reset`, { method: 'POST' });
      // Small delay for clean state sync
      await new Promise((r) => setTimeout(r, 1200));

      // 2. Run TC-03 (Simulated Bypass)
      const tc03 = TEST_CASES.find((t) => t.id === 'TC-03')!;
      await executeSingleTest(tc03);

      // Cooldown between tests
      await new Promise((r) => setTimeout(r, 1500));

      // 3. Run TC-08 (False Data Injection)
      const tc08 = TEST_CASES.find((t) => t.id === 'TC-08')!;
      await executeSingleTest(tc08);

      // Cooldown between tests
      await new Promise((r) => setTimeout(r, 1500));

      // 4. Run TC-01 (Tamper)
      const tc01 = TEST_CASES.find((t) => t.id === 'TC-01')!;
      await executeSingleTest(tc01);
    } catch (err) {
      console.error('[Test Bench Runner Error]:', err);
    } finally {
      setCurrentRunningTestId(null);
      setOrchestratorRunning(false);
      // Clean up all attacks
      handleStopAttack();
    }
  };

  const meters = telemetry?.meters || {};
  const masterFeeder = meters['feeder_master'];
  const consumerMeters = Object.values(meters).filter((m) => m.type === 'consumer');
  const activeMeter = meters[selectedMeterId];
  const activeAttacksMap = telemetry?.active_attacks || {};
  const activeAttacksCount = Object.keys(activeAttacksMap).length;

  const chartStats = useMemo(() => {
    if (!chartData.length) return { min: '0', max: '0', avg: '0', current: '0' };
    const values = chartData.map((d) => d.rep_active_power);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const current = values[values.length - 1];
    return {
      min: min.toFixed(1),
      max: max.toFixed(1),
      avg: avg.toFixed(1),
      current: current.toFixed(1),
    };
  }, [chartData]);

  const filteredAlerts = alerts.filter((a) => {
    if (alertFilter === 'ALL') return true;
    return a.severity === alertFilter;
  });

  const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const warningCount = alerts.filter((a) => a.severity === 'WARNING').length;

  // Test bench statistics
  const testResultsList = Object.values(testResults);
  const totalTestsCount = testResultsList.length;
  const passedTestsCount = testResultsList.filter((t) => t.status === 'PASS').length;
  const failedTestsCount = testResultsList.filter((t) => t.status === 'FAIL').length;
  const executedTestsCount = passedTestsCount + failedTestsCount;
  const passRate = executedTestsCount > 0 ? ((passedTestsCount / executedTestsCount) * 100).toFixed(0) : '0';

  const validLatencies = testResultsList.filter((t) => t.latencyMs !== null).map((t) => t.latencyMs as number);
  const averageLatency =
    validLatencies.length > 0 ? (validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length).toFixed(0) : 'N/A';

  const getAttackBadge = (type?: string | null) => {
    if (!type) return null;
    if (type === 'trigger_tamper' || type === 'tamper') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/50 rounded flex items-center gap-1 animate-pulse">
          <Bug className="w-3 h-3 text-rose-400" /> Tamper Injected
        </span>
      );
    }
    if (type === 'false_data_injection' || type === 'physics') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50 rounded flex items-center gap-1 animate-pulse">
          <Zap className="w-3 h-3 text-amber-400" /> FDI Active (-50%)
        </span>
      );
    }
    if (type === 'bypass') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/50 rounded flex items-center gap-1 animate-pulse">
          <AlertOctagon className="w-3 h-3 text-purple-400" /> Bypass Active (0W)
        </span>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-[#0d1322]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-gradient-to-tr from-cyan-600 to-blue-500 rounded-xl shadow-lg shadow-cyan-500/20 text-white">
              <Zap className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">
                  IoT Energy Theft Detection
                </h1>
                <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 rounded-full">
                  Phase 5 &bull; Viva Test Bench
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Automated Verification &bull; Latency Benchmark &bull; Viva Examination Mode
              </p>
            </div>
          </div>

          {/* Navigation Tab Selector */}
          <div className="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Live Dashboard
            </button>
            <button
              onClick={() => setActiveTab('testbench')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'testbench'
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Test Bench (Viva)
              {passedTestsCount > 0 && (
                <span className="bg-emerald-950 text-emerald-300 text-[10px] px-1.5 py-0.2 rounded font-mono border border-emerald-700">
                  {passedTestsCount}/{totalTestsCount}
                </span>
              )}
            </button>
          </div>

          {/* System Telemetry Pills */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400">Sim:</span>
              <span className="font-mono font-medium text-slate-200">
                {telemetry?.simulated_time || 'Synchronizing...'}
              </span>
            </div>

            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60'
                  : connectionStatus === 'connecting'
                  ? 'bg-amber-950/50 text-amber-300 border-amber-800/60'
                  : 'bg-rose-950/50 text-rose-300 border-rose-800/60'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-400 animate-ping'
                    : connectionStatus === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-rose-500'
                }`}
              />
              <span className="capitalize">{connectionStatus}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* ========================================================= */}
        {/* TAB 1: PHASE 5 AUTOMATED TEST BENCH (VIVA DEMO)          */}
        {/* ========================================================= */}
        {activeTab === 'testbench' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Test Bench Hero Header Card */}
            <section className="bg-gradient-to-br from-[#0c1829] via-[#0f1f38] to-[#0a1424] border border-cyan-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-cyan-900/40 pb-5 mb-5">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-gradient-to-tr from-emerald-500 to-cyan-500 text-slate-950 rounded-xl shadow-lg shadow-emerald-500/20">
                    <FlaskConical className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-white">
                        Automated Viva Test Bench
                      </h2>
                      <span className="text-xs bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded-full font-mono">
                        IEEE / Academic Evaluation
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Orchestrates cyber-physical theft injection, verifies WebSocket alert arrival, and benchmarks Detection Latency.
                    </p>
                  </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={handleResetSimulation}
                    disabled={orchestratorRunning || actionLoading !== null}
                    className="px-3.5 py-2 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${actionLoading === 'reset' ? 'animate-spin' : ''}`} />
                    Reset Simulation & DB
                  </button>

                  <button
                    onClick={runAllTests}
                    disabled={orchestratorRunning}
                    className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/30 disabled:opacity-50"
                  >
                    <Play className={`w-3.5 h-3.5 fill-current ${orchestratorRunning ? 'animate-pulse' : ''}`} />
                    {orchestratorRunning ? 'Orchestrator Running...' : 'Execute Full Test Suite'}
                  </button>
                </div>
              </div>

              {/* KPI Benchmark Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-[#0b1220]/80 p-3.5 rounded-xl border border-cyan-500/20">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Total Suite</span>
                  <div className="text-2xl font-bold font-mono text-white mt-0.5">
                    {totalTestsCount} <span className="text-xs text-slate-400 font-sans">Test Cases</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">TC-03, TC-08, TC-01</p>
                </div>

                <div className="bg-[#0b1220]/80 p-3.5 rounded-xl border border-cyan-500/20">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Pass Rate</span>
                  <div className="text-2xl font-bold font-mono text-emerald-400 mt-0.5">
                    {passRate}%
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {passedTestsCount} Passed &bull; {failedTestsCount} Failed
                  </p>
                </div>

                <div className="bg-[#0b1220]/80 p-3.5 rounded-xl border border-cyan-500/20">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Mean Latency</span>
                  <div className="text-2xl font-bold font-mono text-amber-400 mt-0.5 flex items-center gap-1">
                    <Timer className="w-4 h-4 text-amber-400" />
                    {averageLatency} <span className="text-xs text-slate-400 font-sans">ms</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Avg Detection Delay</p>
                </div>

                <div className="bg-[#0b1220]/80 p-3.5 rounded-xl border border-cyan-500/20">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Compliance</span>
                  <div className="text-2xl font-bold text-cyan-300 mt-0.5 flex items-center gap-1.5">
                    <Award className="w-5 h-5 text-cyan-400" />
                    <span>{passedTestsCount === totalTestsCount ? 'Verified' : 'Pending'}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Detection Specification</p>
                </div>
              </div>
            </section>

            {/* Test Results Table */}
            <section className="bg-[#0d1424] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 bg-[#0f172a] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Automated Test Matrix & Execution Ledger
                  </h3>
                  <p className="text-xs text-slate-400">
                    Real-time verification against WebSocket alert streams
                  </p>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  Timeout: 8.5s &bull; Method: Async WS Trap
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#090e18] text-slate-400 uppercase font-mono tracking-wider text-[11px] border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-5">Test ID & Name</th>
                      <th className="py-3 px-5">Target Node</th>
                      <th className="py-3 px-5">Expected Outcome</th>
                      <th className="py-3 px-5">Actual Outcome</th>
                      <th className="py-3 px-4 text-center">Latency</th>
                      <th className="py-3 px-5 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-sans">
                    {TEST_CASES.map((tc) => {
                      const res = testResults[tc.id];
                      const isRunning = currentRunningTestId === tc.id || res?.status === 'RUNNING';
                      const isPass = res?.status === 'PASS';

                      return (
                        <tr
                          key={tc.id}
                          className={`hover:bg-slate-800/30 transition-colors ${
                            isRunning ? 'bg-cyan-950/20' : ''
                          }`}
                        >
                          {/* Test Name & Code */}
                          <td className="py-4 px-5">
                            <div className="font-bold text-slate-100 flex items-center gap-2">
                              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-cyan-400">
                                {tc.code}
                              </span>
                              <span>{tc.name}</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
                              {tc.description}
                            </p>
                          </td>

                          {/* Target Node */}
                          <td className="py-4 px-5 font-mono text-cyan-300">
                            {tc.targetMeter}
                          </td>

                          {/* Expected Outcome */}
                          <td className="py-4 px-5 text-slate-300 max-w-xs font-mono text-[11px]">
                            <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
                              <span className="text-cyan-400 font-semibold block mb-0.5">
                                Alert: {tc.expectedAlertType}
                              </span>
                              <span className="text-slate-400">{tc.expectedOutcome}</span>
                            </div>
                          </td>

                          {/* Actual Outcome */}
                          <td className="py-4 px-5 max-w-sm font-mono text-[11px]">
                            {res?.status === 'IDLE' ? (
                              <span className="text-slate-400 italic">Not executed yet</span>
                            ) : isRunning ? (
                              <span className="text-cyan-400 flex items-center gap-1.5 animate-pulse">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                Awaiting alert signature...
                              </span>
                            ) : isPass ? (
                              <div className="text-emerald-300 bg-emerald-950/40 p-2 rounded-lg border border-emerald-800/60 leading-relaxed">
                                {res.actualOutcome}
                              </div>
                            ) : (
                              <div className="text-rose-300 bg-rose-950/40 p-2 rounded-lg border border-rose-800/60 leading-relaxed">
                                {res.actualOutcome}
                              </div>
                            )}
                          </td>

                          {/* Latency */}
                          <td className="py-4 px-4 text-center font-mono">
                            {res?.latencyMs !== null && res?.latencyMs !== undefined ? (
                              <span className="px-2.5 py-1 bg-amber-950/50 text-amber-300 border border-amber-800/60 rounded-md font-bold">
                                {res.latencyMs} ms
                              </span>
                            ) : (
                              <span className="text-slate-400">&mdash;</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="py-4 px-5 text-center">
                            {res?.status === 'IDLE' ? (
                              <span className="px-2.5 py-1 text-xs font-semibold bg-slate-800 text-slate-400 rounded-md">
                                READY
                              </span>
                            ) : isRunning ? (
                              <span className="px-2.5 py-1 text-xs font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 rounded-md flex items-center justify-center gap-1 animate-pulse">
                                <RefreshCw className="w-3 h-3 animate-spin" /> RUNNING
                              </span>
                            ) : isPass ? (
                              <span className="px-3 py-1 text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-600 rounded-md inline-flex items-center gap-1 shadow-sm">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> PASS
                              </span>
                            ) : (
                              <span className="px-3 py-1 text-xs font-bold bg-rose-950 text-rose-300 border border-rose-600 rounded-md inline-flex items-center gap-1 shadow-sm">
                                <XCircle className="w-4 h-4 text-rose-400" /> FAIL
                              </span>
                            )}
                          </td>

                          {/* Single Execution Action */}
                          <td className="py-4 px-4 text-right">
                            <button
                              onClick={() => executeSingleTest(tc)}
                              disabled={orchestratorRunning || isRunning}
                              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700 disabled:opacity-40 inline-flex items-center gap-1"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              Run
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: LIVE MONITORING & INTERACTIVE ATTACK DASHBOARD      */}
        {/* ========================================================= */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Attack Control Panel */}
            <section className="bg-gradient-to-br from-[#131b2e] via-[#0f172a] to-[#141a29] border border-rose-500/40 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                <Flame className="w-52 h-52 text-rose-400" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 mb-5 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-tr from-rose-600 to-amber-600 rounded-xl text-white shadow-lg shadow-rose-500/20">
                    <Flame className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      Attack Control Panel
                      <span className="text-xs bg-rose-950/80 text-rose-400 border border-rose-800 px-2.5 py-0.5 rounded-full font-mono">
                        POST /simulation/attack
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400">
                      Inject cyberattacks or physical tampering. Mutates reported telemetry while keeping Ground Truth intact.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activeAttacksMap[targetMeterId] && (
                    <button
                      onClick={() => handleStopAttack(targetMeterId)}
                      disabled={actionLoading !== null}
                      className="px-3 py-1.5 bg-amber-950/80 hover:bg-amber-900 border border-amber-800 text-amber-200 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5"
                    >
                      <Square className="w-3.5 h-3.5 text-amber-400" />
                      Stop Attack on {targetMeterId}
                    </button>
                  )}

                  {activeAttacksCount > 0 && (
                    <button
                      onClick={() => handleStopAttack()}
                      disabled={actionLoading !== null}
                      className="px-3 py-1.5 bg-rose-950/90 hover:bg-rose-900 border border-rose-700 text-rose-100 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-rose-950/40"
                    >
                      <Power className="w-3.5 h-3.5 text-rose-400" />
                      Stop All Attacks ({activeAttacksCount})
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                {/* Target Meter Selection */}
                <div className="lg:col-span-4 space-y-2">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    1. Select Target Smart Meter:
                  </label>
                  <div className="grid grid-cols-5 gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
                    {['meter_01', 'meter_02', 'meter_03', 'meter_04', 'meter_05'].map((id, index) => {
                      const isTarget = targetMeterId === id;
                      const hasAttack = Boolean(activeAttacksMap[id]);
                      return (
                        <button
                          key={id}
                          onClick={() => {
                            setTargetMeterId(id);
                            setSelectedMeterId(id);
                          }}
                          className={`py-2 px-1 rounded-lg text-xs font-mono font-bold transition-all relative ${
                            isTarget
                              ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30'
                              : hasAttack
                              ? 'bg-rose-950/50 text-rose-300 border border-rose-800/80 hover:bg-rose-900/50'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                          }`}
                        >
                          M{index + 1}
                          {hasAttack && (
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 absolute top-1 right-1 animate-ping" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center justify-between px-1">
                    <span>
                      Selected: <span className="font-mono text-cyan-300 font-bold">{targetMeterId}</span>
                    </span>
                    {activeAttacksMap[targetMeterId] ? (
                      <span className="text-rose-400 font-semibold flex items-center gap-1">
                        <Flame className="w-3 h-3" /> Under Attack ({activeAttacksMap[targetMeterId]})
                      </span>
                    ) : (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> Nominal Baseline
                      </span>
                    )}
                  </div>
                </div>

                {/* Intensity Configuration */}
                <div className="lg:col-span-3 space-y-2">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                    <span>2. FDI Cut Intensity:</span>
                    <span className="font-mono text-amber-400 font-bold">{(attackIntensity * 100).toFixed(0)}%</span>
                  </label>
                  <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
                    {[0.25, 0.5, 0.75, 0.9].map((val) => (
                      <button
                        key={val}
                        onClick={() => setAttackIntensity(val)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
                          attackIntensity === val
                            ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        {val * 100}%
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Reduces reported active power by {attackIntensity * 100}% without altering V or I.
                  </p>
                </div>

                {/* Attack Action Buttons */}
                <div className="lg:col-span-5 space-y-2">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <ChevronRight className="w-3.5 h-3.5 text-rose-400" />
                    3. Launch Attack on {targetMeterId}:
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleTriggerAttack('trigger_tamper')}
                      disabled={actionLoading !== null}
                      className={`p-2.5 rounded-xl border text-left transition-all duration-200 ${
                        activeAttacksMap[targetMeterId] === 'trigger_tamper'
                          ? 'bg-rose-950/80 border-rose-500 ring-2 ring-rose-500/40 text-white'
                          : 'bg-[#181e2e] border-rose-900/50 hover:border-rose-500 hover:bg-rose-950/40 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-rose-400 mb-1">
                        <Bug className="w-4 h-4" />
                        <span className="text-xs font-bold">Tamper</span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight">
                        Sets tamper_flag=True (Rule 1)
                      </p>
                    </button>

                    <button
                      onClick={() => handleTriggerAttack('false_data_injection')}
                      disabled={actionLoading !== null}
                      className={`p-2.5 rounded-xl border text-left transition-all duration-200 ${
                        activeAttacksMap[targetMeterId] === 'false_data_injection'
                          ? 'bg-amber-950/80 border-amber-500 ring-2 ring-amber-500/40 text-white'
                          : 'bg-[#181e2e] border-amber-900/50 hover:border-amber-500 hover:bg-amber-950/40 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-amber-400 mb-1">
                        <Zap className="w-4 h-4" />
                        <span className="text-xs font-bold">FDI Hack</span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight">
                        Cuts P by {(attackIntensity * 100).toFixed(0)}% (Rule 2)
                      </p>
                    </button>

                    <button
                      onClick={() => handleTriggerAttack('bypass')}
                      disabled={actionLoading !== null}
                      className={`p-2.5 rounded-xl border text-left transition-all duration-200 ${
                        activeAttacksMap[targetMeterId] === 'bypass'
                          ? 'bg-purple-950/80 border-purple-500 ring-2 ring-purple-500/40 text-white'
                          : 'bg-[#181e2e] border-purple-900/50 hover:border-purple-500 hover:bg-purple-950/40 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-purple-400 mb-1">
                        <ShieldX className="w-4 h-4" />
                        <span className="text-xs font-bold">Bypass</span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight">
                        Drops P to 0, Feeder high (Rule 3)
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Real-time Recharts Line Chart with Ground Truth vs Reported Comparison */}
            <section className="bg-gradient-to-br from-[#0c1322] via-[#0f172a] to-[#0c1322] border border-cyan-500/30 rounded-2xl p-6 shadow-2xl relative">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6 border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
                    <LineChartIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-white">
                        Live Active Power Telemetry
                      </h2>
                      <span className="text-xs bg-amber-950/70 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded-full font-mono">
                        {activeMeter ? activeMeter.name : selectedMeterId}
                      </span>
                      {getAttackBadge(activeAttacksMap[selectedMeterId])}
                    </div>
                    <p className="text-xs text-slate-400">
                      Observe the divergence between Reported Power (amber) and Ground Truth (cyan dashed) during attacks
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
                  <button
                    onClick={() => setSelectedMeterId('feeder_master')}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      selectedMeterId === 'feeder_master'
                        ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    Feeder
                  </button>
                  {['meter_01', 'meter_02', 'meter_03', 'meter_04', 'meter_05'].map((id, idx) => {
                    const hasAttack = Boolean(activeAttacksMap[id]);
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          setSelectedMeterId(id);
                          setTargetMeterId(id);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all relative ${
                          selectedMeterId === id
                            ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30'
                            : hasAttack
                            ? 'text-rose-300 bg-rose-950/40 border border-rose-800/60'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                      >
                        M{idx + 1}
                        {hasAttack && (
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 absolute top-0.5 right-0.5" />
                        )}
                      </button>
                    );
                  })}

                  <button
                    onClick={() => fetchHistory(selectedMeterId)}
                    title="Reload history from SQLite"
                    className="ml-1 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Metric KPI Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Reported Power</span>
                  <div className="text-xl font-bold font-mono text-amber-400">
                    {chartStats.current} <span className="text-xs text-slate-500 font-sans">W</span>
                  </div>
                </div>
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Average (Window)</span>
                  <div className="text-xl font-bold font-mono text-slate-200">
                    {chartStats.avg} <span className="text-xs text-slate-500 font-sans">W</span>
                  </div>
                </div>
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Peak Power</span>
                  <div className="text-xl font-bold font-mono text-rose-400">
                    {chartStats.max} <span className="text-xs text-slate-500 font-sans">W</span>
                  </div>
                </div>
                <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Min Power</span>
                  <div className="text-xl font-bold font-mono text-cyan-400">
                    {chartStats.min} <span className="text-xs text-slate-500 font-sans">W</span>
                  </div>
                </div>
              </div>

              {/* Line Chart */}
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" vertical={false} />
                    <XAxis
                      dataKey="time"
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      unit=" W"
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          const repVal = Number(payload[0]?.value || 0);
                          const gtVal = Number(payload[1]?.value || 0);
                          const diff = Math.abs(gtVal - repVal);
                          return (
                            <div className="bg-[#0b101b]/95 backdrop-blur-md p-3.5 rounded-xl border border-slate-700 shadow-xl text-xs space-y-1.5 font-mono">
                              <p className="text-slate-400 font-sans font-semibold">
                                Time: {label}
                              </p>
                              <div className="flex items-center justify-between gap-4 text-amber-400 font-bold">
                                <span>Reported Power:</span>
                                <span>{repVal.toFixed(1)} W</span>
                              </div>
                              <div className="flex items-center justify-between gap-4 text-cyan-400">
                                <span>Ground Truth (Physical):</span>
                                <span>{gtVal.toFixed(1)} W</span>
                              </div>
                              {diff > 10 && (
                                <div className="pt-1 border-t border-slate-800 text-rose-400 font-bold flex justify-between">
                                  <span>Theft Discrepancy:</span>
                                  <span>-{diff.toFixed(1)} W</span>
                                </div>
                              )}
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      wrapperStyle={{ paddingBottom: '10px', fontSize: '12px' }}
                    />
                    <Line
                      name="Reported Power (Mutated)"
                      type="monotone"
                      dataKey="rep_active_power"
                      stroke="#fbbf24"
                      strokeWidth={2.5}
                      dot={{ r: 2.5, fill: '#fbbf24' }}
                      activeDot={{ r: 5, fill: '#f59e0b', stroke: '#fff', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                    <Line
                      name="Ground Truth (Actual Physical)"
                      type="monotone"
                      dataKey="gt_active_power"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Active Alerts Feed Component */}
            <section className="bg-gradient-to-br from-[#0e1627] via-[#101b31] to-[#0a101d] border border-rose-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4 border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400">
                    <ShieldAlert className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-white">Active Alerts Feed</h2>
                      <span className="text-xs bg-rose-950/80 text-rose-300 border border-rose-800/60 px-2 py-0.5 rounded-full font-mono">
                        {filteredAlerts.length} Active
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Triggered by rule-based detection engine and stored in SQLite Alerts table
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-900/90 rounded-lg p-1 border border-slate-800 text-xs">
                    <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1" />
                    {(['ALL', 'CRITICAL', 'WARNING'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setAlertFilter(filter)}
                        className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all ${
                          alertFilter === filter
                            ? 'bg-rose-500 text-white shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {filter === 'ALL'
                          ? `All (${alerts.length})`
                          : filter === 'CRITICAL'
                          ? `Critical (${criticalCount})`
                          : `Warning (${warningCount})`}
                      </button>
                    ))}
                  </div>

                  {alerts.length > 0 && (
                    <button
                      onClick={clearAllAlerts}
                      title="Clear all alerts"
                      className="px-2.5 py-1 text-xs text-slate-400 hover:text-rose-400 bg-slate-900/90 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/60 rounded-lg transition-colors flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2.5 pr-1">
                {filteredAlerts.length === 0 ? (
                  <div className="py-7 text-center bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col items-center justify-center">
                    <ShieldCheck className="w-8 h-8 text-emerald-400/80 mb-2" />
                    <p className="text-sm font-semibold text-slate-200">
                      No active energy theft or physics anomalies detected
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Grid is operating within normal tolerances. Use the Attack Control Panel above or switch to Test Bench to execute benchmark tests.
                    </p>
                  </div>
                ) : (
                  filteredAlerts.map((alert, index) => {
                    const isCritical = alert.severity === 'CRITICAL';
                    return (
                      <div
                        key={alert.id ? `alert-${alert.id}` : `alert-dyn-${index}`}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isCritical
                            ? 'bg-rose-950/30 border-rose-800/60 hover:border-rose-700/80'
                            : 'bg-amber-950/30 border-amber-800/60 hover:border-amber-700/80'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            {isCritical ? (
                              <AlertOctagon className="w-4 h-4 text-rose-400 flex-shrink-0 animate-pulse" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                            )}
                            <span
                              className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                                isCritical
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              }`}
                            >
                              {alert.alert_type}
                            </span>
                            <span className="font-mono text-xs text-slate-300 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
                              Target: {alert.meter_id}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                            <span>Step #{alert.simulation_step}</span>
                            <span>&bull;</span>
                            <span>{alert.simulated_time}</span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-200 pl-6 leading-relaxed">
                          {alert.message}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Master Feeder Hero Section */}
            {masterFeeder && (
              <section
                onClick={() => setSelectedMeterId('feeder_master')}
                className={`cursor-pointer relative overflow-hidden rounded-2xl border transition-all duration-200 ${
                  selectedMeterId === 'feeder_master'
                    ? 'border-cyan-400 ring-2 ring-cyan-500/30'
                    : 'border-cyan-500/30 hover:border-cyan-400/60'
                } bg-gradient-to-br from-[#0e1c31] via-[#0d1627] to-[#0a0f1d] p-6 shadow-xl`}
              >
                <div className="flex flex-wrap items-center justify-between gap-4 mb-5 border-b border-cyan-900/40 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-400">
                      <Radio className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white">
                          {masterFeeder.name}
                        </h2>
                        <span className="text-[11px] font-mono bg-cyan-900/40 text-cyan-300 px-2 py-0.5 rounded border border-cyan-700/50">
                          ID: {masterFeeder.meter_id}
                        </span>
                        {selectedMeterId === 'feeder_master' && (
                          <span className="text-[11px] bg-cyan-500 text-slate-950 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Check className="w-3 h-3" /> Charting
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-cyan-300/70">
                        Upstream Distribution Transformer / Grid Aggregator & Source
                      </p>
                    </div>
                  </div>
                  <span className="text-xs bg-emerald-950/80 text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-800">
                    Grid Source Node
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900/80 rounded-xl p-4 border border-cyan-500/20">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                      <span className="text-xs font-semibold">Active Power (P)</span>
                      <Zap className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="text-2xl font-mono font-bold text-amber-400">
                      {masterFeeder.reported.active_power.toLocaleString()}{' '}
                      <span className="text-xs text-slate-400 font-sans">W</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {(masterFeeder.reported.active_power / 1000).toFixed(3)} kW
                    </p>
                  </div>

                  <div className="bg-slate-900/80 rounded-xl p-4 border border-cyan-500/20">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                      <span className="text-xs font-semibold">Voltage (V)</span>
                      <Gauge className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="text-2xl font-mono font-bold text-cyan-400">
                      {masterFeeder.reported.voltage.toFixed(2)}{' '}
                      <span className="text-xs text-slate-400 font-sans">V</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Substation nominal</p>
                  </div>

                  <div className="bg-slate-900/80 rounded-xl p-4 border border-cyan-500/20">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                      <span className="text-xs font-semibold">Total Current (I)</span>
                      <Activity className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-2xl font-mono font-bold text-emerald-400">
                      {masterFeeder.reported.current.toFixed(2)}{' '}
                      <span className="text-xs text-slate-400 font-sans">A</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      PF: {masterFeeder.reported.power_factor.toFixed(2)}
                    </p>
                  </div>

                  <div className="bg-slate-900/80 rounded-xl p-4 border border-cyan-500/20">
                    <div className="flex items-center justify-between text-slate-400 mb-1">
                      <span className="text-xs font-semibold">Cumulative Energy</span>
                      <Cpu className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div className="text-2xl font-mono font-bold text-indigo-400">
                      {masterFeeder.reported.cumulative_energy.toFixed(2)}{' '}
                      <span className="text-xs text-slate-400 font-sans">kWh</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Aggregated Metered</p>
                  </div>
                </div>
              </section>
            )}

            {/* 5 Consumer Meters Grid */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-cyan-400" />
                  <h2 className="text-lg font-bold text-white">
                    Consumer Smart Meters
                  </h2>
                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
                    Click any meter to chart & control
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Red badge indicates active attack mutation
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {consumerMeters.map((meter) => {
                  const rep = meter.reported;
                  const gt = meter.ground_truth;
                  const isSelected = selectedMeterId === meter.meter_id;
                  const attackType = activeAttacksMap[meter.meter_id];
                  const isTampered = rep.tamper_flag === true;
                  const hasAttack = Boolean(attackType);

                  return (
                    <div
                      key={meter.meter_id}
                      onClick={() => {
                        setSelectedMeterId(meter.meter_id);
                        setTargetMeterId(meter.meter_id);
                      }}
                      className={`cursor-pointer bg-[#111827] rounded-xl border transition-all duration-200 p-5 shadow-lg flex flex-col justify-between group ${
                        isSelected
                          ? 'border-cyan-400 ring-2 ring-cyan-500/20 bg-[#141e33]'
                          : hasAttack
                          ? 'border-rose-600/70 bg-[#1b1220]'
                          : 'border-slate-800 hover:border-slate-700 hover:bg-[#131b2e]'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <h3 className="font-semibold text-slate-100 group-hover:text-cyan-300 transition-colors">
                              {meter.name}
                            </h3>
                            <p className="font-mono text-xs text-slate-400">
                              {meter.meter_id}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {hasAttack ? (
                              getAttackBadge(attackType)
                            ) : (
                              <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 rounded-md">
                                Normal
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 my-4">
                          <div className="bg-[#0b0f19] p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                              <span>Reported Power</span>
                              <Zap className={`w-3.5 h-3.5 ${hasAttack ? 'text-rose-400' : 'text-amber-400'}`} />
                            </div>
                            <div className={`text-xl font-bold font-mono ${hasAttack ? 'text-rose-400' : 'text-amber-400'}`}>
                              {rep.active_power.toFixed(1)}
                              <span className="text-xs text-slate-400 ml-1 font-sans">
                                W
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">
                              GT: {gt.active_power.toFixed(1)} W
                            </span>
                          </div>

                          <div className="bg-[#0b0f19] p-3 rounded-lg border border-slate-800">
                            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                              <span>Voltage</span>
                              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                            </div>
                            <div className="text-xl font-bold font-mono text-cyan-400">
                              {rep.voltage.toFixed(1)}
                              <span className="text-xs text-slate-400 ml-1 font-sans">
                                V
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">
                              230V Nominal
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs text-slate-400 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/60 font-mono">
                          <div className="flex justify-between">
                            <span>Current:</span>
                            <span className="text-slate-200 font-medium">
                              {rep.current.toFixed(2)} A (GT: {gt.current.toFixed(2)}A)
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Power Factor:</span>
                            <span className="text-slate-200 font-medium">
                              {rep.power_factor.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Cumulative:</span>
                            <span className="text-indigo-300 font-medium">
                              {rep.cumulative_energy.toFixed(3)} kWh
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="flex items-center gap-1 text-slate-400">
                          {isTampered ? (
                            <span className="text-rose-400 font-semibold flex items-center gap-1">
                              <AlertOctagon className="w-3.5 h-3.5" /> Tamper Tripped
                            </span>
                          ) : hasAttack ? (
                            <span className="text-amber-400 font-semibold flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" /> Cyber Anomaly
                            </span>
                          ) : (
                            <span className="text-emerald-400/90 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                              GT == Reported
                            </span>
                          )}
                        </span>
                        <span className="text-cyan-400/80 group-hover:underline">
                          Graph &bull; Control &rarr;
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#0a0e1a] px-6 py-4 text-xs text-slate-400 flex flex-wrap justify-between items-center gap-4">
        <div>
          <span>IoT Smart Energy Theft Simulation &bull; Phase 5 Automated Viva Test Bench</span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span>Reset API: POST /simulation/reset</span>
          <span>Attack API: POST /simulation/attack</span>
          <span>WebSocket: /ws/telemetry</span>
        </div>
      </footer>
    </div>
  );
}
