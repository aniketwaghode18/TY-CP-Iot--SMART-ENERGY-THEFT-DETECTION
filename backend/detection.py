from typing import Dict, List
from models import Alerts


class DetectionEngine:
    """
    Rule-Based Anomaly & Energy Theft Detection Engine.
    Processes reported telemetry before saving and generates alerts for:
      - Rule 1 (Tamper): Critical Alert if tamper_flag == True
      - Rule 2 (Physics Inconsistency): Warning Alert if Reported P != V * I * PF (+-1% tolerance)
      - Rule 3 (Feeder Imbalance): Bypass Alert if Feeder energy > 5% above sum of meters for 3 consecutive ticks
    """

    def __init__(self, physics_tolerance: float = 0.01, imbalance_threshold: float = 0.05):
        self.physics_tolerance = physics_tolerance       # 1% tolerance
        self.imbalance_threshold = imbalance_threshold   # 5% threshold
        self.consecutive_imbalance_ticks = 0

    def evaluate(self, tick_data: Dict) -> List[Alerts]:
        """
        Evaluates rules against the current tick's reported telemetry.
        Returns a list of triggered Alerts.
        """
        alerts: List[Alerts] = []
        meters = tick_data.get("meters", {})
        step = tick_data.get("simulation_step", 0)
        sim_time = tick_data.get("simulated_time", "")

        total_consumer_energy = 0.0
        total_consumer_power = 0.0
        feeder_energy = 0.0
        feeder_power = 0.0
        feeder_id = "feeder_master"

        for meter_id, m_data in meters.items():
            rep = m_data.get("reported", {})
            m_type = m_data.get("type", "consumer")
            m_name = m_data.get("name", meter_id)

            # -------------------------------------------------------------
            # RULE 1 (Tamper Alert): Critical Alert if tamper_flag == True
            # -------------------------------------------------------------
            if rep.get("tamper_flag", False) is True:
                alerts.append(
                    Alerts(
                        meter_id=meter_id,
                        alert_type="TAMPER_DETECTED",
                        severity="CRITICAL",
                        message=f"Tamper sensor triggered on {m_name} ({meter_id})! Physical enclosure or magnetic field breach detected.",
                        simulation_step=step,
                        simulated_time=sim_time,
                    )
                )

            # -------------------------------------------------------------
            # RULE 2 (Physics Inconsistency): Warning Alert if P != V * I * PF (1% tolerance)
            # -------------------------------------------------------------
            v = float(rep.get("voltage", 0.0))
            i = float(rep.get("current", 0.0))
            pf = float(rep.get("power_factor", 1.0))
            reported_p = float(rep.get("active_power", 0.0))

            expected_p = v * i * pf

            # Check discrepancy if expected power is non-trivial (> 1.0W)
            if expected_p > 1.0:
                abs_diff = abs(reported_p - expected_p)
                pct_diff = abs_diff / expected_p
                if pct_diff > self.physics_tolerance:
                    alerts.append(
                        Alerts(
                            meter_id=meter_id,
                            alert_type="PHYSICS_INCONSISTENCY",
                            severity="WARNING",
                            message=(
                                f"Physics Inconsistency on {m_name} ({meter_id}): "
                                f"Reported P={reported_p:.1f}W does not match V*I*PF ({v:.1f}V * {i:.2f}A * {pf:.2f} = {expected_p:.1f}W). "
                                f"Discrepancy: {pct_diff * 100:.2f}% (exceeds 1.0% tolerance)."
                            ),
                            simulation_step=step,
                            simulated_time=sim_time,
                        )
                    )

            # Accumulate totals for Rule 3
            rep_energy = float(rep.get("cumulative_energy", 0.0))
            if m_type == "master_feeder":
                feeder_energy = rep_energy
                feeder_power = reported_p
                feeder_id = meter_id
            else:
                total_consumer_energy += rep_energy
                total_consumer_power += reported_p

        # -------------------------------------------------------------
        # RULE 3 (Feeder Imbalance): Bypass Alert if Feeder energy > 5% higher
        # than sum of 5 consumer meters for 3 consecutive ticks.
        # -------------------------------------------------------------
        # Also check tick power delta as instant proxy if cumulative base is large
        if total_consumer_energy > 0:
            energy_imbalance = (feeder_energy - total_consumer_energy) / total_consumer_energy
            power_imbalance = (feeder_power - total_consumer_power) / total_consumer_power if total_consumer_power > 0 else 0

            # Condition: Feeder > 5% higher than consumer sum
            is_imbalanced = (energy_imbalance > self.imbalance_threshold) or (power_imbalance > self.imbalance_threshold)

            if is_imbalanced:
                self.consecutive_imbalance_ticks += 1
                if self.consecutive_imbalance_ticks >= 3:
                    higher_pct = max(energy_imbalance, power_imbalance) * 100
                    alerts.append(
                        Alerts(
                            meter_id=feeder_id,
                            alert_type="BYPASS_ALERT",
                            severity="CRITICAL",
                            message=(
                                f"Feeder Imbalance Detected! Feeder delivery is {higher_pct:.1f}% higher "
                                f"than the sum of consumer meters for {self.consecutive_imbalance_ticks} consecutive ticks. "
                                f"Illegal unmetered line tap or smart meter bypass suspected."
                            ),
                            simulation_step=step,
                            simulated_time=sim_time,
                        )
                    )
            else:
                self.consecutive_imbalance_ticks = 0

        return alerts
