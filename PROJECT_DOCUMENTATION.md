# IoT Smart Grid Cyber-Physical Theft Detection Project

## 1. Project Overview

This project is an educational smart-grid and cyber-security simulation. It demonstrates how electricity theft and cyber attacks can affect smart meters and how a monitoring system may detect manipulated or missing telemetry.

The system combines:

- A Python FastAPI backend
- A SQLite database
- A React and Vite dashboard
- Real-time WebSocket telemetry
- Interactive HTML attack simulations
- Rule-based detection for tamper, false data, bypass, replay, coordinated FDI, and denial of service

The project does not control real electricity or require physical IoT hardware. It runs as a local laboratory for visualization and demonstration.

## 2. Problem Statement

Traditional meter readings can be modified, blocked, replayed, or bypassed. A reporting problem may look like normal low consumption even though electrical load is still flowing through the feeder.

The project addresses this problem through multiple sources of information:

- Physical ground-truth measurements
- Meter-reported measurements
- Master-feeder measurements
- Packet freshness and sequence information
- Cryptographic and hardware concepts
- Conservation of energy and feeder balance

The purpose is not only to calculate whether theft occurred, but to show how several security and physics checks can identify an attack.

## 3. High-Level Architecture

```text
Smart Grid HTML Visualizations
       |
       | Independent browser simulation
       v
React/Vite Dashboard Tabs
       |
       | REST and WebSocket
       v
FastAPI Backend
       |
       +--> Simulation Engine
       +--> Rule-Based Detection Engine
       +--> SQLite Database
       +--> WebSocket Telemetry Manager
```

The active React tabs embed standalone HTML pages. The standalone pages are independent browser simulations. They do not send commands to FastAPI or change the SQLite database.

The backend remains the source of the continuous smart-meter simulation.

## 4. Technology Stack

| Component | Technology |
|---|---|
| Backend framework | Python, FastAPI |
| ASGI server | Uvicorn |
| Database | SQLite |
| Database ORM | SQLModel and SQLAlchemy |
| Backend models | Pydantic |
| Frontend framework | React 18 |
| Frontend language | TypeScript |
| Frontend build tool | Vite |
| Charts | Recharts |
| Icons | Lucide React |
| Styling | Tailwind CSS and custom CSS |
| Real-time communication | WebSocket |
| Standalone visualizations | HTML, CSS, Canvas, JavaScript |

## 5. Project Structure

```text
IOT CP SEM 5/
├── backend/
│   ├── main.py
│   ├── models.py
│   ├── detection.py
│   ├── database.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── public/
│   │   ├── defense-engine.html
│   │   ├── smart-grid.html
│   │   ├── dos_attack.html
│   │   ├── replay-attack.html
│   │   └── coordinated-fdi.html
│   ├── package.json
│   ├── vite.config.ts
│   └── dist/
├── index.html
├── smart-grid.html
├── dos_attack.html
├── IoT Smart Grid Replay Attack Simulation.html
├── coordinated_fdi_dashboard.html
├── energy_simulation.db
├── PROJECT_DOCUMENTATION.md
├── PROJECT_SPECIFICATION.docx
├── WINDOWS_SETUP_GUIDE.md
└── run_steps.txt
```

## 6. Backend Files

### 6.1 `backend/main.py`

`main.py` contains:

- FastAPI application setup
- CORS configuration
- The simulation state
- Meter load generation
- Ground-truth and reported telemetry
- Active attack management
- The background simulation worker
- REST endpoints
- WebSocket broadcasting
- Database reset behavior

The simulation starts with the FastAPI lifespan event. It creates the database tables, seeds meter records, and starts a one-second background worker.

### 6.2 `backend/models.py`

The database has three main SQLModel tables.

#### `Meter`

Stores meter identity and configuration:

- Database ID
- Unique meter ID
- Display name
- Consumer or feeder type
- Base current
- Creation time

#### `TelemetryReadings`

Stores one reading for each meter during each simulation step. It stores both:

- Ground-truth values
- Reported values

Ground-truth values represent actual physical behavior. Reported values represent what the meter or packet claims.

Fields include voltage, current, power factor, active power, cumulative energy, tamper flag, simulation step, and timestamp.

#### `Alerts`

Stores security events with:

- Meter ID
- Alert type
- Severity
- Message
- Simulation step
- Simulated time
- Timestamp
- Resolution state

### 6.3 `backend/detection.py`

`DetectionEngine` evaluates reported telemetry using three rules:

1. Tamper detection
2. Physics consistency
3. Feeder imbalance

The 1-percent physics tolerance and 5-percent feeder imbalance threshold are configurable.

### 6.4 `backend/database.py`

SQLite is configured with:

- `check_same_thread=False`
- Write-Ahead Logging mode
- Normal synchronous mode
- A 5-second busy timeout

WAL mode allows the background worker to write readings while API clients read them. The busy timeout prevents short database-lock conflicts.

Database files may include:

- `energy_simulation.db`
- `energy_simulation.db-shm`
- `energy_simulation.db-wal`

The SHM and WAL files are supporting SQLite runtime files and may appear while the database is active.

## 7. Telemetry Model

The project models six nodes:

- `meter_01`: residential meter
- `meter_02`: residential meter
- `meter_03`: commercial meter
- `meter_04`: residential meter
- `meter_05`: residential meter
- `feeder_master`: master grid feeder

One real second represents 15 simulated minutes.

The simulated clock advances on every telemetry tick.

### 7.1 Physical Ground Truth

For each consumer meter, the backend generates:

- A feeder voltage
- A meter voltage
- A random current
- A power factor
- Active power
- Cumulative energy

Active power follows:

```text
P = V × I × PF
```

Cumulative energy is calculated using the 15-minute simulation interval:

```text
Energy(kWh) = Power(kW) × 0.25 hours
```

### 7.2 Master Feeder

The master feeder represents actual aggregate load plus an assumed technical loss of 3 percent:

```text
Feeder Power = Total Consumer Ground-Truth Power × 1.03
```

The reported feeder values are normally equal to the feeder ground-truth values.

### 7.3 Ground Truth Versus Reported Data

Ground-truth data represents physical reality.

Reported data represents the data transmitted or exposed by the smart meter.

An attack can change reported data while leaving ground truth unchanged. This is the main idea behind the theft and false-data demonstrations.

## 8. Backend Attacks

The active backend attack types are:

### 8.1 Tamper

Attack name:

```text
trigger_tamper
```

The reported tamper flag becomes true.

Detection:

```text
TAMPER_DETECTED
```

Severity: Critical

### 8.2 False Data Injection

Attack name:

```text
false_data_injection
```

The reported active power is reduced by the selected intensity.

Voltage and current remain unchanged. This creates a mismatch with:

```text
P = V × I × PF
```

Detection:

```text
PHYSICS_INCONSISTENCY
```

Severity: Warning

### 8.3 Bypass

Attack name:

```text
bypass
```

The meter reports:

- Zero active power
- Zero current

The feeder continues to observe the real physical load. The reported consumer sum becomes lower than feeder delivery.

Detection:

```text
BYPASS_ALERT
```

Severity: Critical

The detector requires this imbalance to remain present for three consecutive simulation ticks.

## 9. Detection Rules

### Rule 1: Tamper Check

Condition:

```text
reported tamper_flag == true
```

Result:

- Create a TAMPER_DETECTED critical alert
- Identify the target meter

### Rule 2: Physics Inconsistency

Condition:

```text
absolute(reported power - voltage × current × power factor)
>
1 percent of expected power
```

The check is only applied when expected power is above 1 watt.

Result:

- Create a PHYSICS_INCONSISTENCY warning
- Display the difference percentage

### Rule 3: Feeder Balance

The detector compares:

- Feeder reported energy
- Sum of consumer meter reported energy
- Feeder reported power
- Sum of consumer reported power

An imbalance above 5 percent starts a consecutive imbalance counter.

When the imbalance lasts for three ticks:

- Create a BYPASS_ALERT
- Mark the target as the master feeder
- State the imbalance percentage

If the readings return to balance, the consecutive counter resets.

## 10. REST API

The backend runs at:

```text
http://localhost:8000
```

Swagger documentation is available at:

```text
http://localhost:8000/docs
```

### Health Check

```text
GET /
```

Returns backend status, simulated step, active attacks, and connected WebSocket client count.

### List Meters

```text
GET /meters
```

Returns every meter and its latest reading.

### Meter History

```text
GET /meters/{meter_id}/history?limit=50
```

Returns historical telemetry for one meter.

Example:

```text
meter_02
```

### Alerts

```text
GET /alerts?limit=40
```

Returns recent alerts.

```text
POST /alerts/clear
```

Deletes all alerts.

### Inject Attack

```text
POST /simulation/attack
```

Example JSON:

```json
{
  "meter_id": "meter_02",
  "attack_type": "false_data_injection",
  "intensity": 0.5,
  "duration_steps": null
}
```

Valid attack types are:

- `trigger_tamper`
- `tamper`
- `false_data_injection`
- `physics`
- `bypass`
- `stop`
- `clear`

### Stop Attack

```text
POST /simulation/attack/stop
```

Stop one meter:

```json
{
  "meter_id": "meter_02"
}
```

Stop every meter:

```json
{
  "meter_id": null
}
```

### Reset Simulation

```text
POST /simulation/reset
```

The reset endpoint:

- Stops active attacks
- Clears all telemetry records
- Clears all alerts
- Restores the simulated clock
- Restores cumulative energy values
- Resets the imbalance counter

### Active Attacks

```text
GET /simulation/attacks
```

Returns active attacks and their count.

### Compatibility Endpoint

```text
POST /simulate/attack
```

This is an alias for `/simulation/attack`.

## 11. WebSocket API

WebSocket URL:

```text
ws://localhost:8000/ws/telemetry
```

The backend sends one telemetry payload every second. A payload contains:

- UTC timestamp
- Simulation step
- Simulated time
- Time-compression information
- Active attacks
- All six meters
- Ground-truth values
- Reported values
- New alerts

The frontend connects automatically and reconnects after three seconds if the connection closes.

## 12. Final React Front Interface

The React application has the following tabs:

1. Defense Engine
2. Smart Grid Lab
3. DoS Attack
4. Replay Attack
5. Coordinated FDI

The Viva Live Dashboard and Viva Test Bench were removed from the final tab navigation.

They are not the final presentation pages.

### 12.1 Defense Engine

The Defense Engine is loaded from:

```text
index.html
```

It is copied into Vite as:

```text
frontend/public/defense-engine.html
```

It explains and demonstrates defense mechanisms:

- Cryptographic gatekeeping
- Hardware tamper checks
- Physics and anomaly filtering
- Cross-layer conservation
- Hash-chain recovery
- Resilience under attack

It provides separate internal tabs for the defense pipeline, hardware shield, physics filter, conservation check, cryptographic gatekeeper, and hash-chain recovery.

This page also accepts normal, tamper, FDI, stealth FDI, replay, and DoS test streams.

### 12.2 Smart Grid Lab

The Smart Grid Lab is loaded from:

```text
smart-grid.html
```

It visually represents:

- A distribution transformer
- A feeder
- Five consumer homes
- Smart meters
- Physical power flow
- Reported packet flow
- A DISCOM control center

It supports:

- Meter selection
- Bypass
- Spoofing
- Physical tampering
- Load variation
- Stolen-power variation
- Pan and zoom

The DISCOM dashboard compares actual feeder delivery, normal line loss, meter reports, and unexplained energy.

### 12.3 DoS Attack

The DoS page demonstrates telemetry disruption.

It can show:

- Packet loss
- Missing heartbeats
- Stale meters
- Delayed telemetry
- Detection delay
- A loss-versus-time chart
- A network and control-center diagram

This simulation uses independently generated packet and heartbeat information. It is not currently connected to the backend packet queue.

### 12.4 Replay Attack

The replay attack page demonstrates an attacker capturing a valid packet and sending it later.

The demonstration includes:

- Fresh packet capture
- Packet replay
- Sequence numbers
- Timestamp freshness
- A replay counter
- Defense enable/disable behavior
- Server acceptance or rejection

The replay lab is independent of the backend WebSocket.

### 12.5 Coordinated FDI

The coordinated FDI page demonstrates coordinated false data across several meters.

It explains:

- Normal operation
- Simple FDI
- Physics mismatch
- Coordinated FDI
- Balancing inconsistencies
- Feeder-level detection
- Critical alerts

The page includes internal modes for normal operation, simple FDI, stealth FDI, and coordinated FDI.

This page is independent of the backend REST and WebSocket APIs.

## 13. Standalone versus Backend-Connected Features

### Backend-Connected

- FastAPI REST endpoints
- FastAPI WebSocket telemetry
- Backend simulation worker
- SQLite persistence
- Backend tamper, FDI, and bypass injection
- Backend alerts

### Independent Browser Demonstrations

- Defense Engine
- Smart Grid Lab
- DoS Attack
- Replay Attack
- Coordinated FDI

The independent pages share no live state with the backend.

Changing controls in one standalone tab does not:

- Change the backend simulation
- Change SQLite records
- Generate backend alerts
- Modify another standalone page

The standalone pages are visual educational modules embedded in the same React shell.

## 14. Setup Requirements

### Windows Software

- Python 3.10 to 3.13
- Node.js 18 or newer
- npm
- Modern browser

### Backend Dependencies

```text
fastapi>=0.110.0
uvicorn[standard]>=0.28.0
pydantic>=2.0.0
sqlmodel>=0.0.16
```

## 15. Installation

### Backend

Open PowerShell in the project root:

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If script execution is blocked:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Frontend

Open a second terminal:

```powershell
cd frontend
npm install
```

Dependencies may already exist in `frontend/node_modules`.

## 16. Running the Project

### Start Backend

```powershell
cd backend
python -m uvicorn main:app --reload --port 8000
```

### Start Frontend

```powershell
cd frontend
npm run dev
```

Open:

```text
http://localhost:3000
```

Backend URLs:

```text
http://localhost:8000
http://localhost:8000/docs
http://localhost:8000/redoc
```

## 17. Production Frontend Build

```powershell
cd frontend
npm run build
npm run preview
```

The production build is written to:

```text
frontend/dist
```

Standalone HTML files must remain in `frontend/public` or be copied into `frontend/dist` for iframe routes to work.

## 18. Demonstration Sequence

### Backend Tamper Demonstration

1. Open the backend Swagger interface.
2. Call `/simulation/attack`.
3. Select `meter_02`.
4. Select `trigger_tamper`.
5. Observe `TAMPER_DETECTED`.
6. Call `/simulation/attack/stop`.

### Backend FDI Demonstration

1. Call `/simulation/attack`.
2. Select `meter_03`.
3. Select `false_data_injection`.
4. Set intensity to `0.5`.
5. Observe that reported power differs from `V × I × PF`.
6. Observe `PHYSICS_INCONSISTENCY`.

### Backend Bypass Demonstration

1. Call `/simulation/attack`.
2. Select `meter_01`.
3. Select `bypass`.
4. Wait for three consecutive ticks.
5. Observe feeder imbalance.
6. Observe `BYPASS_ALERT`.

### Defense Engine Demonstration

1. Open the Defense Engine tab.
2. Select normal stream.
3. Change to tamper, FDI, replay, stealth FDI, or DoS.
4. Observe packet acceptance or rejection.
5. Inspect the internal tabs for each defense layer.

### Replay Demonstration

1. Open Replay Attack.
2. Enable defense.
3. Launch the replay.
4. Observe the sequence and timestamp checks.
5. Disable defense to compare behavior.

### Coordinated FDI Demonstration

1. Open Coordinated FDI.
2. Compare normal operation and simple FDI.
3. Select stealth or coordinated FDI.
4. Observe how physics-only and feeder-only checks respond.
5. Observe cross-meter imbalance.

## 19. Troubleshooting

### Frontend Is Not Loading

Check:

```text
http://localhost:3000
```

Verify Node and npm:

```powershell
node --version
npm --version
```

### Backend Is Not Loading

Verify Python and installed packages:

```powershell
python --version
python -m pip show fastapi sqlmodel uvicorn
```

Restart:

```powershell
python -m uvicorn main:app --reload --port 8000
```

### Port 3000 Is Already Used

Find the process:

```powershell
netstat -ano | findstr :3000
```

Stop the exact process by PID:

```powershell
Stop-Process -Id <PID>
```

Do not use a name-based process stop command.

### Port 8000 Is Already Used

```powershell
netstat -ano | findstr :8000
Stop-Process -Id <PID>
```

### SQL Database Is Locked

- Confirm only one backend server is running
- Stop duplicate Uvicorn processes
- Check for stale SHM or WAL files
- Restart the backend
- Pause OneDrive synchronization if the project is inside a OneDrive folder

Do not delete WAL or SHM files while the backend process is running.

### Standalone Tab Does Not Load

Verify the copied file exists in:

```text
frontend/public
```

Confirm the route:

```text
http://localhost:3000/defense-engine.html
http://localhost:3000/smart-grid.html
http://localhost:3000/dos_attack.html
http://localhost:3000/replay-attack.html
http://localhost:3000/coordinated-fdi.html
```

## 20. Testing Checklist

### Backend

- Root endpoint returns status `online`
- Swagger loads
- Six meters are seeded
- One new simulation tick occurs each second
- Simulated time advances
- Telemetry history is returned
- Active attacks are visible
- Alerts are stored
- Reset clears telemetry and alerts

### Frontend

- Vite starts on port 3000
- The project loads without TypeScript build errors
- Defense Engine loads as the default tab
- Smart Grid Lab loads
- DoS Attack loads
- Replay Attack loads
- Coordinated FDI loads
- Iframes resize within the project window

### Detection

- Tamper creates a critical alert
- FDI creates a physics inconsistency warning
- Bypass creates a feeder imbalance alert
- Stopping attacks restores normal telemetry
- Reset removes stale database records

## 21. Viva and Presentation Questions

### What is the purpose of the project?

The project demonstrates smart-meter electricity theft and cyber-attack detection using telemetry, physical equations, feeder balance, and security concepts.

### What is ground truth?

Ground truth is the simulated physical reality. It represents actual load and consumption. It is not the compromised meter report.

### What is false data injection?

False data injection changes transmitted meter values. In this project, reported active power is reduced while voltage and current remain unchanged.

### Why does FDI trigger a physics inconsistency?

The equation `P = V × I × PF` no longer holds because reported power does not match the reported voltage, current, and power factor.

### What is a bypass attack?

A bypass routes energy around the meter or causes the meter to report lower consumption. The feeder still detects real delivered power.

### Why does feeder imbalance require three ticks?

The three-tick rule reduces false alarms caused by temporary measurement or timing differences.

### What is a replay attack?

A replay attack sends a previously captured valid packet again instead of creating a new packet.

### How can replay be detected?

Replay can be detected through sequence numbers, freshness timestamps, and nonce or authentication checks.

### What is DoS?

Denial of service prevents telemetry or services from working normally, commonly through packet flooding or heartbeats that stop arriving.

### What is coordinated FDI?

Coordinated FDI modifies several meter reports consistently so that individual meters appear plausible while aggregate feeder information reveals the coordinated imbalance.

### Which parts are backend-connected?

The backend simulation, database, REST API, and WebSocket are connected. The standalone HTML pages are independent demonstrations.

### What are the project limitations?

- The project uses synthetic random loads
- It does not use physical smart meters
- It does not execute cryptographic operations in the backend
- Replay, coordinated FDI, DoS, and the Defense Engine pages are browser simulations
- Detection uses rule thresholds rather than machine learning
- Database content persists until explicitly cleared or manually removed

## 22. Possible Future Improvements

- Connect replay and coordinated FDI pages to FastAPI
- Add backend DoS and replay attack endpoints
- Replace rule thresholds with explainable machine learning
- Add authentication and signed telemetry
- Use a real AMI dataset
- Add MQTT or CoAP communication
- Add Grafana or external monitoring
- Deploy the backend with PostgreSQL or TimescaleDB
- Add Docker Compose deployment
- Add automated unit and integration tests
- Add role-based authentication
- Add a tamper event from real hardware
- Add geographic or transformer-level visualization
- Add exportable PDF or CSV incident reports

## 23. Security and Safety Notes

- This project is a simulation and is safe to use locally
- Do not connect it directly to critical utility infrastructure
- Do not reuse real credentials or utility account data
- Use generated or test-only data
- The standalone simulations should be used for academic demonstration only

## 24. Final Summary

The project is a complete educational smart-grid cyber-security laboratory. It separates:

- Real physical behavior
- Reported smart-meter behavior
- Detection rules
- Database persistence
- Real-time display
- Standalone attack education

Its core principle is:

```text
Physical reality should agree with reported meter data and master-feeder data.
If they disagree, the system generates evidence and an alert.
```
