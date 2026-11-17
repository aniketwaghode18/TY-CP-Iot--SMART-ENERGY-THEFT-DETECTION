# New Device Setup Guide for Windows
## IoT Smart Energy Theft Monitoring & Cyber-Attack Detection System

This guide provides step-by-step instructions to set up, configure, and run this project on a brand-new or freshly formatted **Windows 10 / Windows 11 (64-bit)** machine.

---

## 1. System Requirements & Prerequisites

Ensure your Windows PC meets the following minimum requirements:
- **Operating System**: Windows 10 (Build 19041+) or Windows 11 (64-bit)
- **RAM**: 4 GB minimum (8 GB recommended)
- **Disk Space**: At least 1.5 GB free space
- **Network**: Internet connection required only for initial installation of dependencies

### Required Software Components
1. **Python 3.10 – 3.13** (Includes `pip` package manager)
2. **Node.js (LTS v18 or v20+)** (Includes `npm`)
3. **Git for Windows** (Optional, for cloning repository)
4. **Web Browser** (Google Chrome, Microsoft Edge, Mozilla Firefox, or Brave)

---

## 2. Step 1: Installing Required Software

You can install the tools either using **Windows Package Manager (`winget`)** (fastest) or by downloading **manual installers**.

### Method A: Fast Installation via Windows Terminal / PowerShell (Recommended)

Open **PowerShell as Administrator** (Right-click Start menu $\rightarrow$ *Terminal (Admin)* or *PowerShell (Admin)*) and run:

```powershell
# 1. Install Python 3.12 or 3.13
winget install -e --id Python.Python.3.12

# 2. Install Node.js LTS
winget install -e --id OpenJS.NodeJS.LTS

# 3. Install Git (if not already installed)
winget install -e --id Git.Git
```

> **IMPORTANT**: Close and reopen your terminal after installation so that the newly added PATH environment variables take effect.

---

### Method B: Manual Installer Downloads

If you prefer installing using graphical installers (`.exe` / `.msi`):

#### 1. Python Installation:
- Download the Windows 64-bit installer from the official website: [python.org/downloads](https://www.python.org/downloads/)
- **CRITICAL STEP**: On the very first installer screen, you **MUST** check the box that says:
  $$\boxed{\checkmark\ \textbf{Add python.exe to PATH}}$$
- Click **Install Now**.
- At the end of the installation, click **Disable path length limit** (if prompted), then click **Close**.

#### 2. Node.js Installation:
- Download the **LTS installer** from [nodejs.org](https://nodejs.org/)
- Run the `.msi` installer, accept the license, keep default paths, and ensure the **Add to PATH** feature is selected.
- Complete the installation.

---

## 3. Step 2: Verify Your Environment

Open a **new** PowerShell window and verify that all tools are correctly recognized:

```powershell
python --version
pip --version
node --version
npm --version
```

### Expected Output:
```text
Python 3.1x.x
pip 2x.x.x from ...
v18.x.x (or v20.x.x / v22.x.x)
10.x.x (or higher)
```

> [!WARNING]
> If PowerShell prints `The term 'python' is not recognized` or `The term 'node' is not recognized`:
> 1. You must restart PowerShell or your PC.
> 2. If it still fails, search Windows for **"Edit the system environment variables"** $\rightarrow$ click **Environment Variables** $\rightarrow$ select `Path` under User variables $\rightarrow$ verify that the paths to your Python and Node installations are present.

---

## 4. Step 3: Project Directory Navigation

Open PowerShell and navigate to the project root folder. For example:

```powershell
cd "C:\Users\<YourUsername>\Documents\TY-CP-Iot--SMART-ENERGY-THEFT-DETECTION"
```

Verify the project structure contains both `backend` and `frontend` folders:

```powershell
Get-ChildItem
```

---

## 5. Step 4: Python Backend Setup

### 5.1 Navigate to the Backend Folder
```powershell
cd backend
```

### 5.2 (Recommended) Create and Activate a Python Virtual Environment
A virtual environment isolates this project's dependencies from your global Python installation.

```powershell
# Create the virtual environment named 'venv'
python -m venv venv

# Activate the virtual environment
.\venv\Scripts\Activate.ps1
```

> [!NOTE]
> **If you encounter an execution policy error**:  
> `File ...\Activate.ps1 cannot be loaded because running scripts is disabled on this system.`  
> Run the following command once in PowerShell to allow script execution:
> ```powershell
> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
> ```
> Then run `.\venv\Scripts\Activate.ps1` again. Your terminal prompt will now show `(venv)`.

### 5.3 Upgrade pip & Install Backend Dependencies
With your virtual environment active, run:

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Verify that the core dependencies installed properly:
- `fastapi`
- `uvicorn[standard]`
- `pydantic`
- `sqlmodel`

```powershell
python -c "import fastapi, uvicorn, pydantic, sqlmodel; print('All backend dependencies successfully installed!')"
```

### 5.4 Database Note (SQLite)
No separate database installation (such as PostgreSQL or MySQL) is required!  
The backend utilizes an embedded **SQLite** database configured in **WAL (Write-Ahead Logging)** mode. The tables and baseline meter seeds are created automatically on the first server launch.

---

## 6. Step 5: React / Vite Frontend Setup

Open a **separate, second PowerShell window** (leave the backend window open).

### 6.1 Navigate to the Frontend Folder
```powershell
cd "C:\Users\<YourUsername>\Documents\TY-CP-Iot--SMART-ENERGY-THEFT-DETECTION\frontend"
```

### 6.2 Install Node Modules
Run npm install to download all frontend packages (React, Lucide, Recharts, Tailwind CSS, Vite):

```powershell
npm install
```

> [!TIP]
> If npm reports minor optional audit warnings, they can safely be ignored.

---

## 7. Step 6: Launching the Application

To run the complete system, keep two terminal windows open:

### Terminal 1: Backend Server (FastAPI + Uvicorn)
```powershell
cd backend
# If using a virtual environment:
.\venv\Scripts\Activate.ps1

python -m uvicorn main:app --reload --port 8000
```

You should see:
```text
INFO:     Started server process [...]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

---

### Terminal 2: Frontend Dev Server (Vite + React)
```powershell
cd frontend
npm run dev
```

You should see:
```text
  VITE v5.x.x  ready in ... ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

---

## 8. Step 7: Accessing the Application

Open your browser and navigate to the following URLs:

| Service | URL | Purpose |
| :--- | :--- | :--- |
| **Main Dashboard & Test Bench** | [http://localhost:3000](http://localhost:3000) | Full graphical user interface |
| **Backend Health Check** | [http://localhost:8000](http://localhost:8000) | Confirms backend status & simulation step |
| **Swagger UI Interactive Docs** | [http://localhost:8000/docs](http://localhost:8000/docs) | Interactive testing of all REST endpoints |
| **ReDoc API Documentation** | [http://localhost:8000/redoc](http://localhost:8000/redoc) | Clean API reference specification |

---

## 9. Step 8: System Verification Checklist

To confirm that the setup on your new Windows machine is 100% operational:

1. **Connection Status**:
   - In the top-right header of the web page at `http://localhost:3000`, verify the connection badge reads **"Connected"** with a pulsing green indicator.
2. **Clock Ticking**:
   - Verify that the **Sim** timestamp in the header updates once every second (each second advances grid time by 15 minutes).
3. **Dual Metric Charting**:
   - Click on any consumer meter (e.g., *Smart Meter 02*). The chart will plot both **Reported Active Power** (Cyan) and **Ground Truth Power** (Amber/Gold). Under normal conditions, they track each other closely.
4. **Attack Injection Test**:
   - Scroll down to the **Attack Control Panel**.
   - Select *Smart Meter 02*, choose **False Data Injection (FDI)**, and click **Inject Attack**.
   - Observe that the Cyan line drops to 50%, while the Amber line stays high.
   - An alert titled `PHYSICS_INCONSISTENCY` will immediately appear in the **Security Alerts Log**.
   - Click **Stop Attack** to restore normal operation.
5. **Automated Test Bench Test**:
   - Switch to the **Test Bench (Viva)** tab in the top navigation bar.
   - Click **Run All Benchmark Tests**.
   - The system will automatically reset, execute `TC-03`, `TC-08`, and `TC-01`, and report **PASS** alongside detection latency in milliseconds.

---

## 10. Windows Troubleshooting & Common Pitfalls

### Issue 1: `npm` or `node` is not recognized
- **Cause**: Node.js was installed while PowerShell was open, or PATH was not added.
- **Fix**:
  1. Close all open PowerShell / Command Prompt windows and open a new one.
  2. If the issue persists, verify Node's path (typically `C:\Program Files\nodejs\`) exists in your Windows `PATH` environment variable.

### Issue 2: `Port 8000` or `Port 3000` is already in use
- **Cause**: A previously running instance of Python or Node is occupying the port.
- **Fix**:
  Find and terminate the process holding the port in PowerShell:
  ```powershell
  # Find process on port 8000
  netstat -ano | findstr :8000

  # Terminate process by PID (replace <PID> with the number from the last column)
  taskkill /PID <PID> /F
  ```
  *(Repeat with `:3000` if the frontend port is blocked).*

### Issue 3: Windows Defender / Antivirus Firewall Prompt
- **Symptom**: A popup appears asking *"Windows Defender Firewall has blocked some features of this app"*.
- **Fix**: Check the box for **Private networks (such as home or work network)** and click **Allow access**. This allows the frontend to communicate with localhost port 8000.

### Issue 4: Running inside OneDrive Synced Folders
- **Symptom**: Occasional errors like `[WinError 32] The process cannot access the file because it is being used by another process` on `energy_simulation.db-wal`.
- **Cause**: Microsoft OneDrive active sync locks SQLite write-ahead log files while syncing them to the cloud.
- **Fix**:
  - Either right-click the OneDrive cloud icon in your taskbar and click **Pause syncing**, or
  - Move the project folder to a local directory not managed by OneDrive (such as `C:\Projects\TY-CP-Iot--SMART-ENERGY-THEFT-DETECTION`).

### Issue 5: PowerShell script execution disabled (`PSSecurityException`)
- **Fix**: Run this one-time command in PowerShell:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```

---

## 11. Quick Run Summary (For Daily Use)

Once setup is complete, you only need to run these commands in two terminals whenever you restart your computer:

```powershell
# Terminal 1: Backend
cd backend
python -m uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev
```

Then visit **`http://localhost:3000`** in your browser.

