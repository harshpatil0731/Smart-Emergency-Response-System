# Academic Presentation & Viva Demonstration Guide
**Smart Emergency Response & Disaster Management System**  
*Step-by-Step Viva Script, Live Demo Sequence, and Defense Guide*

---

## 1. System Setup & Run Commands

Before beginning the viva demonstration, execute the following commands in order:

### Step 1: Build the C++ DSA Engine
```powershell
cd "d:\College Projects\SY\Smart-Emergency-Response-System\ds-engine"
cmake -B build -S .
cmake --build build --config Debug
# Output: ds-engine/build/Debug/engine_console.exe
```

### Step 2: Start the Central Backend & Web Dashboard
```powershell
cd "d:\College Projects\SY\Smart-Emergency-Response-System\backend"
npm install
node server.js
# Output: Spawns engine_console.exe --ipc, seeds Pune city network, listens on http://localhost:4000
```

### Step 3: Open the Operator Dashboard
- Open any web browser: `http://localhost:4000/`
- Verify the connection badge says **"WS LIVE"** (green) and the 7-node Pune urban map loads in Leaflet.js.

### Step 4: Launch the Android Driver Application
```powershell
# 1. Start Android Emulator (if using emulator):
C:\Users\harsh\AppData\Local\Android\Sdk\emulator\emulator.exe -avd Pixel_7 -no-boot-anim

# 2. Fix emulator location to Pune base station:
C:\Users\harsh\AppData\Local\Android\Sdk\platform-tools\adb.exe emu geo fix 73.8567 18.5204

# 3. Build and launch the debug APK:
cd "d:\College Projects\SY\Smart-Emergency-Response-System\android-app"
.\gradlew.bat assembleDebug
C:\Users\harsh\AppData\Local\Android\Sdk\platform-tools\adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
C:\Users\harsh\AppData\Local\Android\Sdk\platform-tools\adb.exe shell am start -n com.smarte.response.debug/com.smarte.response.MainActivity
```

### Step 5: Run the Automated Scenario Runner (Demonstrates 10 Scenarios)
```powershell
cd "d:\College Projects\SY\Smart-Emergency-Response-System"
node simulation/scenarios/scenario_runner.js
```

---

## 2. Recommended Live Demonstration Sequence

Follow this sequence during your live presentation to demonstrate the end-to-end event loop:

### Scene 1: System Baseline & Architecture (2 minutes)
1. **Show the Operator Dashboard**:
   - Point out the 7 Pune city nodes (`Hospital_A`, `Shivaji_Nagar_B`, `FC_Road_C`, etc.) on the real Leaflet map.
   - Point out the 4 response teams (`A01` Ambulance, `A02` Ambulance, `F01` Fire Brigade, `R01` Rescue Team) in the Response Fleet Status panel.
   - Point out the Road Network Controls listing 9 open road segments.
2. **Show the Android Driver App**:
   - Log in as unit **`A01`** (Ambulance).
   - Show that unit `A01` displays **"STANDBY READY"** and **"WS LIVE"**.
   - Emphasize to the examiners: **"The mobile app has zero local routing algorithms. It is an execution client listening to the C++ Dijkstra engine via WebSockets."**

### Scene 2: Incident Intake & Triage Priority Queue (2 minutes)
1. **Dispatch an Incident**:
   - On the Operator Dashboard, fill out the Incident Intake form:
     - **Type**: `MEDICAL`
     - **Priority**: `HIGH`
     - **Target Node**: `FC_Road_C`
     - **Severity**: `4`
     - **Injured**: `2`
   - Click **"DISPATCH EMERGENCY"**.
2. **Explain the Algorithmic Actions**:
   - **Triage**: Incident enters the custom C++ **Binary Max-Heap** (`EmergencyScheduler`).
   - **Nearest Unit Selection**: The engine filters compatible available units and computes great-circle **Haversine distance**. Unit `A01` (at `Hospital_A`) is selected.
   - **Shortest Path**: The custom **C++ Dijkstra algorithm** computes the route: `Hospital_A -> Shivaji_Nagar_B -> FC_Road_C` ($3.50\text{ km}$).
   - **Dynamic ETA**: Calculated using Ambulance speed ($50\text{ km/h}$) and corridor traffic factors $\to \mathbf{5\text{ min}}$.
3. **Show the Mobile Driver Alert**:
   - Instantly, the Android app displays a full-screen **"DISPATCH ALERT"** modal with audio chime and haptics, displaying the route sequence, distance, and 5-min ETA.

### Scene 3: Mission Acceptance & Active Transit (2 minutes)
1. **Accept the Mission**:
   - On the Android app, tap **"ACCEPT MISSION"**.
   - The app transitions to the **Active Transit Screen**.
   - On the Operator Dashboard, unit `A01` status switches to **`BUSY`** (amber), and an active cyan dashed line connects the route on the Leaflet map.
2. **Simulate Vehicle Movement**:
   - On the Android app, toggle **"SIMULATOR: DEMO LOCATION MODE"**.
   - Tap **"NEXT NODE"** once to move to `Shivaji_Nagar_B`.
   - Point out the dynamic metrics: Remaining distance drops to $0.98\text{ km}$, and ETA drops to $2\text{ min}$.
   - On the Operator Dashboard, the vehicle marker moves to `Shivaji_Nagar_B` in real time via WebSocket.

### Scene 4: The Signature Novelty — Dynamic Mid-Transit Rerouting (3 minutes)
1. **Introduce a Road Blockage**:
   - On the Operator Dashboard, find road **`R_BC`** (`Shivaji_Nagar_B` to `FC_Road_C`) in Road Network Controls.
   - Click **"BLOCK"**.
2. **Highlight the Algorithmic Behavior**:
   - Road `R_BC` turns red on the map.
   - The C++ graph disables edge `R_BC`.
   - The C++ engine detects that unit `A01` is actively en route and requires `R_BC`.
   - **Crucial Academic Point**: Dijkstra reruns with **source = `Shivaji_Nagar_B`** (the unit's latest reported location), **NOT `Hospital_A`** (the original depot).
   - An alternate path is found: `Shivaji_Nagar_B -> Hospital_A -> Swargate_E -> Deccan_Gymkhana_D -> FC_Road_C` ($9.0\text{ km}$, recalculated ETA $12\text{ min}$).
3. **Show Real-Time System Reaction**:
   - Operator Dashboard displays the gold **"DYNAMIC REROUTE ALERT"** banner and redraws the cyan route bypassing the red blocked road.
   - Android App vibrates and displays the gold **"DYNAMIC ROUTE RECALCULATED"** card, automatically revising the route and ETA without user intervention.

### Scene 5: Mission Completion & Unit Release (1 minute)
1. **Complete Incident**:
   - On the Android app, tap **"MISSION COMPLETE / RESOLVED"** (or click "RESOLVE" on the Operator Dashboard).
2. **Verify State Transition**:
   - Incident moves to the **Resolved** tally.
   - Unit `A01` returns to **`AVAILABLE`** (green) and resumes `STANDBY READY`.
   - Road `R_BC` can be clicked to **"UNBLOCK"**, restoring normal graph topology.

### Scene 6: Automated Test Verification (2 minutes)
- Run `node simulation/scenarios/scenario_runner.js`.
- Show the examiners all **10/10 official scenarios passing** with real backend and C++ engine assertions.

---

## 3. What to Explain to Judges / Professors

### Question 1: "Why did you build your own data structures instead of using `std::priority_queue` or `std::unordered_map`?"
> **Answer:**  
> "The core educational objective of this project is to implement, profile, and master fundamental Data Structures and Algorithms. Using standard library containers hides internal operations like sift-up, sift-down, collision chaining, and memory reallocations. By manually implementing `BinaryHeap`, `HashTable`, `LinkedList`, `Queue`, and `Stack` in C++, we have complete control over tie-breaking logic, direct iterator callbacks, and memory safety."

### Question 2: "Why do you use Haversine for team selection, but Dijkstra for route planning?"
> **Answer:**  
> "Haversine and Dijkstra solve two fundamentally different problems at different stages:
> 1. **Resource Allocation (Haversine)** operates in continuous physical space using raw GPS coordinates. Evaluating all available units in $O(T)$ time via Haversine great-circle distance provides an optimal nearest-candidate heuristic.
> 2. **Navigation (Dijkstra)** operates on the discrete, topological road network graph. It is obstacle-aware, obeys road segments, and recalculates dynamically when roads are blocked. Running Dijkstra on every unit before selection would cost $O(T \cdot (V + E) \log V)$; running Haversine first keeps allocation $O(T)$ and restricts Dijkstra to the single selected unit."

### Question 3: "What is the core technical novelty of this project?"
> **Answer:**  
> "Most existing emergency systems compute static routes when an emergency is first reported. If a road becomes blocked during transit (landslides, flash floods, or pile-ups), standard systems either fail or calculate an invalid route from the original dispatch depot. Our system implements **real-time mid-transit rerouting** where the C++ Dijkstra engine dynamically takes the unit's **current reported telemetry position** as the new source node, reruns relaxation avoiding blocked edges, and broadcasts updated paths and ETAs over WebSockets in sub-millisecond time."

### Question 4: "Is Google Maps calculating the route?"
> **Answer:**  
> "No. The system does not use Google Directions API, OSRM, or Mapbox. The C++ Dijkstra engine is the 100% sole authority for shortest paths and rerouting. The 'Open Navigation in Maps' button on the mobile app simply passes the destination coordinates to Google Maps as an external viewing intent for the driver's convenience. The actual route geometry, distance, and dynamic blockage avoidance are entirely computed by our C++ graph engine."

---

## 5. System Limitations & Future Scope (Academic Honesty)

When presenting, proactively acknowledge the following real-world boundaries:

1. **Current Graph Scope**: The default implementation models a 7-node, 9-road representation of Pune's central urban corridor. Expanding to city-scale graphs ($10^5$ nodes) would benefit from Contraction Hierarchies or A* search heuristics.
2. **In-Memory State**: Engine state currently lives in RAM for maximum speed during simulation. In production, adding an SQLite write-ahead log (WAL) would ensure persistence across power failures.
3. **Traffic Factors**: Traffic is currently modeled deterministically ($1.0\times$ to $1.3\times$). Future iterations could integrate real-time sensor streams or time-of-day traffic matrices.
