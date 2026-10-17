from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Meter(SQLModel, table=True):
    __tablename__ = "meters"

    id: Optional[int] = Field(default=None, primary_key=True)
    meter_id: str = Field(unique=True, index=True)
    name: str
    type: str                  # "consumer" or "master_feeder"
    base_current: Optional[float] = None
    created_at: datetime = Field(default_factory=utc_now)


class TelemetryReadings(SQLModel, table=True):
    __tablename__ = "telemetry_readings"

    id: Optional[int] = Field(default=None, primary_key=True)
    meter_id: str = Field(index=True)
    simulation_step: int = Field(index=True)
    simulated_time: str
    timestamp: datetime = Field(default_factory=utc_now, index=True)

    # Ground Truth Values (Physical Reality)
    gt_voltage: float
    gt_current: float
    gt_power_factor: float
    gt_active_power: float
    gt_cumulative_energy: float
    gt_tamper_flag: bool = Field(default=False)

    # Reported Values (Smart Meter Data Transmitted)
    rep_voltage: float
    rep_current: float
    rep_power_factor: float
    rep_active_power: float
    rep_cumulative_energy: float
    rep_tamper_flag: bool = Field(default=False)


class Alerts(SQLModel, table=True):
    __tablename__ = "alerts"

    id: Optional[int] = Field(default=None, primary_key=True)
    meter_id: str = Field(index=True)
    alert_type: str            # e.g. "TAMPER_DETECTED", "PHYSICS_INCONSISTENCY", "BYPASS_ALERT"
    severity: str              # "INFO", "WARNING", "CRITICAL"
    message: str
    simulation_step: int
    simulated_time: str
    timestamp: datetime = Field(default_factory=utc_now)
    resolved: bool = Field(default=False)
