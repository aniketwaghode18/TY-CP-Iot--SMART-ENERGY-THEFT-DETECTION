import asyncio
import datetime
import json
import random
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Set

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select, delete

from database import create_db_and_tables, engine, get_session
from detection import DetectionEngine
from models import Alerts, Meter, TelemetryReadings


# --- Pydantic Schemas for Telemetry & Phase 4 Attack Injection ---
class MetricPayload(BaseModel):
    voltage: float
    current: float
    power_factor: float
    active_power: float
    cumulative_energy: float
    tamper_flag: bool = False


class MeterTelemetry(BaseModel):
    meter_id: str
    name: str
    type: str
    ground_truth: MetricPayload
    reported: MetricPayload
    active_attack: Optional[str] = None


class SimulationAttackRequest(BaseModel):
    meter_id: str                          # e.g., "meter_01" to "meter_05"
    attack_type: str                       # "trigger_tamper", "false_data_injection", "bypass", "stop"
    intensity: Optional[float] = 0.5       # Default 0.5 (e.g. 50% power cut)
    duration_steps: Optional[int] = None   # None = indefinite until manually stopped


class StopAttackRequest(BaseModel):
    meter_id: Optional[str] = None         # If provided, stops specific meter; if None, stops all


# --- Simulation State Engine with Phase 4 Cyber & Physical Attack Engine ---
class SimulationState:
    def __init__(self):
        self.step: int = 0
        self.simulated_clock: datetime.datetime = datetime.datetime.now().replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        self.cumulative_energy: Dict[str, float] = {
            "meter_01": 124.50,
            "meter_02": 89.20,
            "meter_03": 210.80,
            "meter_04": 65.40,
            "meter_05": 145.10,
            "feeder_master": 650.00,
        }
        # Track reported cumulative energy separately so fraudulent readings affect accumulation
        self.reported_cumulative_energy: Dict[str, float] = self.cumulative_energy.copy()

        self.meter_configs = {
            "meter_01": {"name": "Smart Meter 01 (Res. A)", "base_i": 5.2, "var_i": 1.2},
            "meter_02": {"name": "Smart Meter 02 (Res. B)", "base_i": 3.8, "var_i": 0.8},
            "meter_03": {"name": "Smart Meter 03 (Commercial)", "base_i": 12.5, "var_i": 2.5},
            "meter_04": {"name": "Smart Meter 04 (Res. C)", "base_i": 4.1, "var_i": 1.0},
            "meter_05": {"name": "Smart Meter 05 (Res. D)", "base_i": 6.0, "var_i": 1.5},
        }

        # Active Attacks mapped by meter_id -> {attack_type, intensity, remaining_steps}
        self.active_attacks: Dict[str, dict] = {}

    def set_attack(
        self,
        meter_id: str,
        attack_type: str,
        intensity: float = 0.5,
        duration: Optional[int] = None,
    ):
        if attack_type in ["stop", "clear"]:
            return self.stop_attack(meter_id)

        self.active_attacks[meter_id] = {
            "meter_id": meter_id,
            "attack_type": attack_type,
            "intensity": intensity if intensity is not None else 0.5,
            "remaining_steps": duration,
        }
        return {
            "status": "attack_active",
            "meter_id": meter_id,
            "attack_type": attack_type,
            "intensity": intensity,
            "duration": duration or "indefinite",
        }

    def stop_attack(self, meter_id: Optional[str] = None):
        if meter_id:
            if meter_id in self.active_attacks:
                del self.active_attacks[meter_id]
                return {"status": "stopped", "meter_id": meter_id}
            return {"status": "not_active", "meter_id": meter_id}
        else:
            count = len(self.active_attacks)
            self.active_attacks.clear()
            return {"status": "all_stopped", "cleared_count": count}

    def tick(self) -> Dict:
        """
        Advances simulation by 1 step (1s real = 15m sim).
        Mutates reported telemetry if an attack is active,
        while strictly preserving ground_truth as physical reality.
        """
        self.step += 1
        delta_hours = 0.25
        self.simulated_clock += datetime.timedelta(minutes=15)

        hour = self.simulated_clock.hour
        time_factor = 1.35 if 18 <= hour <= 22 else (0.75 if 1 <= hour <= 5 else 1.05)

        feeder_voltage = round(random.gauss(230.5, 0.8), 2)
        total_ground_truth_power = 0.0
        meters_output: Dict[str, dict] = {}

        # 1. Process 5 Consumer Meters
        for m_id, cfg in self.meter_configs.items():
            # Physical voltage drop along line
            v = round(feeder_voltage - random.uniform(0.4, 1.8), 2)
            # Physical current
            i_val = max(0.5, random.gauss(cfg["base_i"] * time_factor, cfg["var_i"]))
            i = round(i_val, 2)
            # Physical power factor
            pf = round(random.uniform(0.92, 0.98), 3)
            # Physical active power P = V * I * PF (Watts)
            active_p = round(v * i * pf, 2)
            total_ground_truth_power += active_p

            # True physical energy consumption
            self.cumulative_energy[m_id] += (active_p * delta_hours) / 1000.0
            gt_cum_kwh = round(self.cumulative_energy[m_id], 4)

            # Ground Truth remains 100% physically accurate
            gt_metrics = {
                "voltage": v,
                "current": i,
                "power_factor": pf,
                "active_power": active_p,
                "cumulative_energy": gt_cum_kwh,
                "tamper_flag": False,
            }

            # Reported metrics start as copy of ground truth
            rep_v = v
            rep_i = i
            rep_pf = pf
            rep_active_p = active_p
            rep_tamper = False

            # --- PHASE 4 ATTACK MUTATION PIPELINE ---
            # Mutates reported data BEFORE broadcast/persistence, keeping ground_truth intact
            attack = self.active_attacks.get(m_id)
            if attack:
                atk_type = attack["attack_type"]
                intensity = attack.get("intensity", 0.5)

                if atk_type in ["trigger_tamper", "tamper"]:
                    # Mutation 1: Physical / Magnetic Enclosure Tamper
                    rep_tamper = True

                elif atk_type in ["false_data_injection", "physics"]:
                    # Mutation 2: False Data Injection (FDI)
                    # Cuts reported power by 50% (or specified intensity) without changing V or I
                    cut_factor = max(0.0, 1.0 - intensity)
                    rep_active_p = round(active_p * cut_factor, 2)
                    # Notice: rep_v and rep_i remain unchanged, triggering Rule 2 (Physics Discrepancy)!

                elif atk_type in ["bypass"]:
                    # Mutation 3: Meter Physical/Wiring Bypass
                    # Drops meter reported power and current to 0, but feeder output remains high
                    rep_active_p = 0.0
                    rep_i = 0.0

            # Accumulate reported cumulative energy based on mutated reported active power
            self.reported_cumulative_energy[m_id] += (rep_active_p * delta_hours) / 1000.0
            rep_cum_kwh = round(self.reported_cumulative_energy[m_id], 4)

            rep_metrics = {
                "voltage": rep_v,
                "current": rep_i,
                "power_factor": rep_pf,
                "active_power": rep_active_p,
                "cumulative_energy": rep_cum_kwh,
                "tamper_flag": rep_tamper,
            }

            meters_output[m_id] = {
                "meter_id": m_id,
                "name": cfg["name"],
                "type": "consumer",
                "ground_truth": gt_metrics,
                "reported": rep_metrics,
                "active_attack": attack["attack_type"] if attack else None,
            }

        # 2. Master Feeder Aggregation
        # The Feeder measures true aggregate physical load delivered (+ ~3% distribution technical loss)
        # Even if a consumer meter reports 0 due to bypass, the physical electricity still flows from the feeder!
        technical_loss_pct = 0.03
        feeder_active_power = round(total_ground_truth_power * (1.0 + technical_loss_pct), 2)
        feeder_pf = 0.96
        feeder_current = round(feeder_active_power / (feeder_voltage * feeder_pf), 2)

        self.cumulative_energy["feeder_master"] += (feeder_active_power * delta_hours) / 1000.0
        self.reported_cumulative_energy["feeder_master"] += (feeder_active_power * delta_hours) / 1000.0
        feeder_cum_kwh = round(self.reported_cumulative_energy["feeder_master"], 4)

        feeder_metrics = {
            "voltage": feeder_voltage,
            "current": feeder_current,
            "power_factor": feeder_pf,
            "active_power": feeder_active_power,
            "cumulative_energy": feeder_cum_kwh,
            "tamper_flag": False,
        }

        meters_output["feeder_master"] = {
            "meter_id": "feeder_master",
            "name": "Master Grid Feeder",
            "type": "master_feeder",
            "ground_truth": feeder_metrics,
            "reported": feeder_metrics.copy(),
            "active_attack": None,
        }

        # Decrement remaining steps if finite duration was set
        expired_meters = []
        for m_id, atk in self.active_attacks.items():
            if atk.get("remaining_steps") is not None:
                atk["remaining_steps"] -= 1
                if atk["remaining_steps"] <= 0:
                    expired_meters.append(m_id)
        for m_id in expired_meters:
            del self.active_attacks[m_id]

        return {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "simulation_step": self.step,
            "simulated_time": self.simulated_clock.strftime("%Y-%m-%d %H:%M:%S"),
            "time_compression": "1 sec = 15 mins",
            "active_attacks": {
                m_id: atk["attack_type"] for m_id, atk in self.active_attacks.items()
            },
            "meters": meters_output,
        }


# --- WebSocket Connection Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        payload = json.dumps(message)
        dead_connections = set()
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead_connections.add(connection)
        for dead in dead_connections:
            self.active_connections.discard(dead)


manager = ConnectionManager()
sim_state = SimulationState()
detection_engine = DetectionEngine(physics_tolerance=0.01, imbalance_threshold=0.05)


def seed_meters_if_empty():
    """Ensure baseline meters exist in the SQLite database."""
    with Session(engine) as session:
        count = session.exec(select(Meter)).all()
        if not count:
            feeder = Meter(
                meter_id="feeder_master",
                name="Master Grid Feeder",
                type="master_feeder",
                base_current=35.0,
            )
            session.add(feeder)
            for m_id, cfg in sim_state.meter_configs.items():
                m = Meter(
                    meter_id=m_id,
                    name=cfg["name"],
                    type="consumer",
                    base_current=cfg["base_i"],
                )
                session.add(m)
            session.commit()
            print("[Database] Seeded 6 initial meters.")


def persist_telemetry_and_alerts(tick_data: dict, alerts: List[Alerts]):
    """
    Batched atomic commit of telemetry and alerts in SQLite WAL mode.
    """
    sim_step = tick_data["simulation_step"]
    sim_time = tick_data["simulated_time"]
    now_dt = datetime.datetime.now(datetime.timezone.utc)

    readings_to_insert = []
    for m_id, m_data in tick_data["meters"].items():
        gt = m_data["ground_truth"]
        rep = m_data["reported"]

        record = TelemetryReadings(
            meter_id=m_id,
            simulation_step=sim_step,
            simulated_time=sim_time,
            timestamp=now_dt,
            gt_voltage=gt["voltage"],
            gt_current=gt["current"],
            gt_power_factor=gt["power_factor"],
            gt_active_power=gt["active_power"],
            gt_cumulative_energy=gt["cumulative_energy"],
            gt_tamper_flag=gt.get("tamper_flag", False),
            rep_voltage=rep["voltage"],
            rep_current=rep["current"],
            rep_power_factor=rep["power_factor"],
            rep_active_power=rep["active_power"],
            rep_cumulative_energy=rep["cumulative_energy"],
            rep_tamper_flag=rep.get("tamper_flag", False),
        )
        readings_to_insert.append(record)

    with Session(engine) as session:
        session.add_all(readings_to_insert)
        if alerts:
            session.add_all(alerts)
        session.commit()


async def telemetry_simulation_worker():
    """
    Continuous background loop:
      1. Generates telemetry tick with cyber/physical mutations
      2. DetectionEngine evaluates rules (Tamper, Physics Inconsistency, Feeder Imbalance)
      3. Saves readings and alerts into SQLite
      4. Broadcasts telemetry + alerts over WebSocket
    """
    while True:
        try:
            data = sim_state.tick()

            # Rule-Based Detection Engine processes incoming reported telemetry BEFORE broadcast
            new_alerts = detection_engine.evaluate(data)

            # Persist batch to SQLite
            persist_telemetry_and_alerts(data, new_alerts)

            # Attach alerts to WebSocket payload for instant UI notification
            data["alerts"] = [
                {
                    "meter_id": a.meter_id,
                    "alert_type": a.alert_type,
                    "severity": a.severity,
                    "message": a.message,
                    "simulation_step": a.simulation_step,
                    "simulated_time": a.simulated_time,
                }
                for a in new_alerts
            ]

            await manager.broadcast(data)
        except Exception as e:
            print(f"[Simulation Worker Error] {e}")
        await asyncio.sleep(1.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    seed_meters_if_empty()
    task = asyncio.create_task(telemetry_simulation_worker())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="IoT Smart Energy Theft Simulation API",
    version="4.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- REST API Endpoints ---

@app.get("/")
def health_check():
    return {
        "status": "online",
        "service": "IoT Smart Energy Theft Simulation Backend",
        "phase": 4,
        "database": "SQLite (WAL mode)",
        "detection_engine": "Rule-Based (Tamper, Physics Inconsistency, Feeder Imbalance)",
        "active_attacks": sim_state.active_attacks,
        "simulation_step": sim_state.step,
        "simulated_time": sim_state.simulated_clock.strftime("%Y-%m-%d %H:%M:%S"),
        "connected_clients": len(manager.active_connections),
    }


@app.get("/meters")
def get_meters(session: Session = Depends(get_session)):
    meters = session.exec(select(Meter).order_by(Meter.id)).all()
    results = []
    for m in meters:
        latest = session.exec(
            select(TelemetryReadings)
            .where(TelemetryReadings.meter_id == m.meter_id)
            .order_by(TelemetryReadings.id.desc())
            .limit(1)
        ).first()

        results.append({
            "id": m.id,
            "meter_id": m.meter_id,
            "name": m.name,
            "type": m.type,
            "base_current": m.base_current,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "latest_reading": latest,
            "active_attack": sim_state.active_attacks.get(m.meter_id, {}).get("attack_type"),
        })
    return results


@app.get("/meters/{meter_id}/history")
def get_meter_history(
    meter_id: str,
    limit: int = 50,
    session: Session = Depends(get_session),
):
    meter = session.exec(select(Meter).where(Meter.meter_id == meter_id)).first()
    if not meter:
        raise HTTPException(status_code=404, detail=f"Meter '{meter_id}' not found.")

    statement = (
        select(TelemetryReadings)
        .where(TelemetryReadings.meter_id == meter_id)
        .order_by(TelemetryReadings.id.desc())
        .limit(limit)
    )
    records = session.exec(statement).all()
    return list(reversed(records))


@app.get("/alerts")
def get_alerts(
    limit: int = 40,
    resolved: Optional[bool] = None,
    session: Session = Depends(get_session),
):
    """Returns recent alerts from the database."""
    statement = select(Alerts).order_by(Alerts.id.desc())
    if resolved is not None:
        statement = statement.where(Alerts.resolved == resolved)
    return session.exec(statement.limit(limit)).all()


@app.post("/alerts/clear")
def clear_alerts(session: Session = Depends(get_session)):
    """Clears all logged alerts."""
    alerts = session.exec(select(Alerts)).all()
    for a in alerts:
        session.delete(a)
    session.commit()
    return {"status": "cleared", "deleted_count": len(alerts)}


# --- PHASE 4 ATTACK INJECTION REST ENDPOINTS ---

@app.post("/simulation/attack")
def inject_attack(req: SimulationAttackRequest):
    """
    Injects a cyberattack or physical theft onto a specific meter:
      - "trigger_tamper": Sets tamper_flag=True on reported telemetry
      - "false_data_injection": Cuts reported active power by intensity (default 50%) without changing V or I
      - "bypass": Drops meter reported power and current to 0, while feeder load remains physically high
      - "stop": Stops attack on this meter
    """
    if req.meter_id not in sim_state.meter_configs:
        raise HTTPException(status_code=404, detail=f"Target meter '{req.meter_id}' not found.")

    res = sim_state.set_attack(
        meter_id=req.meter_id,
        attack_type=req.attack_type,
        intensity=req.intensity if req.intensity is not None else 0.5,
        duration=req.duration_steps,
    )
    return res


@app.post("/simulation/attack/stop")
def stop_attack_endpoint(req: StopAttackRequest = StopAttackRequest()):
    """Stops attack on a specific meter, or on all meters if meter_id is null."""
    return sim_state.stop_attack(meter_id=req.meter_id)


@app.post("/simulation/reset")
def reset_simulation(session: Session = Depends(get_session)):
    """
    Clears database state (telemetry readings & alerts), stops active attacks,
    and resets simulation clock/counters for automated test bench runs.
    """
    sim_state.active_attacks.clear()
    sim_state.step = 0
    sim_state.simulated_clock = datetime.datetime.now().replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    sim_state.cumulative_energy = {
        "meter_01": 124.50,
        "meter_02": 89.20,
        "meter_03": 210.80,
        "meter_04": 65.40,
        "meter_05": 145.10,
        "feeder_master": 650.00,
    }
    sim_state.reported_cumulative_energy = sim_state.cumulative_energy.copy()
    detection_engine.consecutive_imbalance_ticks = 0

    session.exec(delete(TelemetryReadings))
    session.exec(delete(Alerts))
    session.commit()

    return {
        "status": "reset_complete",
        "message": "Simulation clock, step, attacks, and database telemetry/alerts cleared successfully.",
    }


@app.get("/simulation/attacks")
def get_active_attacks():
    """Returns list of currently active cyber/physical attacks."""
    return {
        "active_attacks": sim_state.active_attacks,
        "count": len(sim_state.active_attacks),
    }


# Backwards compatibility alias
@app.post("/simulate/attack")
def simulate_attack_alias(req: SimulationAttackRequest):
    return inject_attack(req)


# --- WebSocket Telemetry Stream ---

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        current_data = sim_state.tick()
        await websocket.send_text(json.dumps(current_data))
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
