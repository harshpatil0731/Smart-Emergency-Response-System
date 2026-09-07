# Smart Emergency Response & Disaster Management System
## Two-Phase Master Implementation Plan (50% / 50% Division)

This document provides the complete roadmap for implementing the **Smart Emergency Response & Disaster Management System** as specified in [`Project README.md`](./Project%20README.md).

The project is split into two equal 50% milestones:
- **Phase 1 (50%):** Core DSA Engine (C++), IPC Adapter, Backend API Server, Real-Time Event Bus & Unit Test Harness.
- **Phase 2 (50%):** Operator PC Web Dashboard, Response Team Mobile App, Dynamic Mid-Transit Rerouting Flow, Automated Simulation Mode, Complexity Analysis & Academic Viva Deliverables.

---

## Git Repository Strategy & Step-by-Step Push Guide

Follow these commands to initialize Git, commit the workspace, link your remote GitHub repository, and push milestones.

### Step 1: Initialize Git Repository and Configure `.gitignore`
Run these commands from the project root directory:

```powershell
# Navigate to the project root
cd "d:\College Projects\SY\Smart-Emergency-Response-System"

# Initialize local git repository
git init -b main

# Set user identity if not already configured globally
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

Create a comprehensive `.gitignore` file:
```gitignore
# C++ build artifacts
build/
bin/
obj/
*.exe
*.o
*.obj
*.dll
*.lib

# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Python
__pycache__/
*.py[cod]
*$py.class
venv/
.env

# IDE and OS files
.vscode/
.idea/
.DS_Store
Thumbs.db
```

### Step 2: Initial Git Commit
```powershell
git add .
git commit -m "chore: initial commit - project documentation and standalone C++ DS engine"
```

### Step 3: Link Remote GitHub / GitLab Repository and Push
1. Go to **[GitHub](https://github.com/new)** and create a new repository:
   - Name: `Smart-Emergency-Response-System`
   - Visibility: Public or Private
   - Do **NOT** initialize with README, .gitignore, or license (we already have them).
2. Run the following commands in your terminal:

```powershell
# Add the remote URL (replace YOUR_USERNAME and REPO_NAME with yours)
git remote add origin https://github.com/YOUR_USERNAME/Smart-Emergency-Response-System.git

# Verify the remote URL
git remote -v

# Push to the main branch
git push -u origin main
```

### Step 4: Branching Workflow for Development
```powershell
# Create and switch to development branch
git checkout -b develop

# For Phase 1 features:
git checkout -b feature/phase1-backend
# ... work and commit ...
git commit -m "feat: implement backend API and C++ engine IPC bridge"
git checkout develop
git merge feature/phase1-backend
git push origin develop

# Phase 1 completion tag:
git tag -a v0.5.0-phase1 -m "Phase 1 Complete: Core DS Engine, Backend, and Tests"
git push origin v0.5.0-phase1

# Phase 2 completion tag:
git tag -a v1.0.0-phase2 -m "Phase 2 Complete: Full UI, Simulation, and Dynamic Rerouting"
git push origin v1.0.0-phase2
```

---

# Phase 1: Core Engine, Data Structures, Backend & Communication Layer (50%)

> **Objective:** Build the foundational algorithmic brain and communication backbone. Ensure 100% of data structures are manually implemented and tested in C++, and provide a secure, fast backend bridge with real-time event broadcasting.

### Milestone 1.1: Custom Data Structure Verification & Enhancements (C++)
Every data structure is built manually to satisfy academic DSA requirements:
1. **Binary Max/Min-Heap (Priority Queue):**
   - File: `ds-engine/include/structures/binary_heap.hpp`
   - Purpose: Emergency incident triage (`CRITICAL > HIGH > MEDIUM > LOW`).
   - Time Complexity: $O(\log n)$ insertion, $O(\log n)$ extraction, $O(1)$ peek.
   - Tie-breaker: Earlier incident timestamp wins on priority collisions.
2. **Hash Table with Separate Chaining:**
   - File: `ds-engine/include/structures/hash_table.hpp`
   - Purpose: $O(1)$ amortized lookup of active response units and emergencies by unique ID.
   - Operations: `insert(key, value)`, `get(key)`, `contains(key)`, `remove(key)`.
3. **FIFO Queue:**
   - File: `ds-engine/include/structures/queue.hpp`
   - Purpose: Holding backlog emergencies when all suitable response units are busy or offline.
4. **Doubly-Linked List:**
   - File: `ds-engine/include/structures/linked_list.hpp`
   - Purpose: Chronological event timeline, incident audit log, and active assignment tracking.
5. **LIFO Stack:**
   - File: `ds-engine/include/structures/stack.hpp`
   - Purpose: Path step backtracking, reroute breadcrumbs, and operator action undo stack.

### Milestone 1.2: Dynamic City Road Graph & Dijkstra Algorithm (C++)
1. **Adjacency List Weighted Graph:**
   - File: `ds-engine/include/graph/city_graph.hpp` & `src/graph/city_graph.cpp`
   - Vertices: Road intersections and landmarks with GPS coordinates (latitude, longitude).
   - Edges: Roads with distances (km) and dynamic state: `RoadState::OPEN` vs `RoadState::BLOCKED`.
2. **Dijkstra's Shortest Path Algorithm:**
   - File: `ds-engine/include/graph/dijkstra.hpp` & `src/graph/dijkstra.cpp`
   - Rules: Skips edges marked as `BLOCKED`.
   - Dynamic Source: When rerouting, the source vertex is **the unit's latest reported location**, never its original depot station.
3. **Resource Allocation Policy:**
   - File: `ds-engine/include/services/resource_allocator.hpp`
   - Rules: Filter units where `status == AVAILABLE` and `unit.type == emergency.required_type`.
   - Distance: Compute Haversine distance from unit to emergency and select the closest unit.

### Milestone 1.3: Inter-Process Communication (IPC) Bridge
- Create an NDJSON (Newline Delimited JSON) CLI executable:
  - File: `ds-engine/apps/engine_ipc.cpp`
  - Accepts standard input commands:
    - `{"action": "ADD_EMERGENCY", "data": {...}}`
    - `{"action": "UPDATE_TEAM_LOCATION", "data": {"team_id": "A01", "node_id": "C"}}`
    - `{"action": "BLOCK_ROAD", "data": {"u": "C", "v": "D"}}`
    - `{"action": "UNBLOCK_ROAD", "data": {"u": "C", "v": "D"}}`
    - `{"action": "DISPATCH_NEXT"}`
    - `{"action": "COMPLETE_EMERGENCY", "data": {"team_id": "A01"}}`
  - Emits JSON responses on standard output with allocation decisions, updated routes, and event status.

### Milestone 1.4: Central Backend API Server
- **Tech Stack:** Node.js (Express + WebSocket `ws`) or Python (FastAPI + WebSockets).
- **Core Responsibilities:**
  1. Spawns and manages the C++ engine child process via standard streams.
  2. In-memory and SQLite persistent state for users, emergencies, teams, and road segments.
  3. REST Endpoints:
     - `POST /api/emergencies` (Create incident)
     - `GET /api/emergencies/active` (List active and pending emergencies)
     - `GET /api/teams` (List response teams with status and coordinates)
     - `POST /api/teams/:id/status` (Update status: `AVAILABLE`, `BUSY`, `OFFLINE`)
     - `POST /api/teams/:id/location` (Update unit coordinates / nearest node)
     - `POST /api/roads/block` (Mark road edge as blocked)
     - `POST /api/roads/unblock` (Re-open road edge)
     - `POST /api/emergencies/:id/complete` (Mark incident resolved)
  4. Real-Time WebSocket Channel (`/ws`):
     - Broadcasts `INCIDENT_CREATED`, `UNIT_ASSIGNED`, `ROAD_BLOCKED`, and `ROUTE_RECALCULATED` to all connected clients.

### Milestone 1.5: Phase 1 Verification & Test Suite
- Run C++ unit tests for data structures and graph algorithms.
- Run backend integration tests verifying child process IPC communication.
- Create Git commit and tag `v0.5.0-phase1`.

---

# Phase 2: User Interfaces, Simulation & Academic Deliverables (50%)

> **Objective:** Deliver intuitive Operator and Response Team interfaces, complete the signature dynamic mid-transit rerouting flow, implement the automated scenario simulator, and document time/space complexities for academic viva.

### Milestone 2.1: Operator PC Web Application
- **Tech Stack:** HTML5 / CSS3 / JavaScript (Vanilla or lightweight Vue/React), Leaflet.js or HTML5 Canvas for the road network.
- **Key Features:**
  1. **Live City Network Map:**
     - Nodes displayed as map markers.
     - Green lines for `OPEN` roads; dashed red lines with warning markers for `BLOCKED` roads.
     - Colored markers for response teams ($A_{01}, F_{01}, R_{01}$) and incident icons.
  2. **Incident Dispatch Control Center:**
     - Form to register new incidents: Type (`ACCIDENT`, `FIRE`, `MEDICAL`, `FLOOD`, `BUILDING_COLLAPSE`), casualties, severity level, location.
     - Live Priority Queue viewer displaying current heap ordering.
  3. **Interactive Road Blockage Tool:**
     - Click any road edge on the map to toggle between `OPEN` and `BLOCKED`.
  4. **Live Response Units & Assignment Table:**
     - Real-time status indicators (`AVAILABLE`, `BUSY`, `OFFLINE`).

### Milestone 2.2: Response Team Mobile Application
- **Tech Stack:** Responsive Web App / Progressive Web App (PWA) styled for mobile viewports.
- **Key Features:**
  1. **Unit Selector & Status Control:**
     - Toggle between `A01` (Ambulance), `F01` (Fire Brigade), and `R01` (Rescue Team).
     - Switch status: `AVAILABLE`, `BUSY`, `OFFLINE`.
  2. **Assignment Notification Screen:**
     - Instant audio/visual alert when an emergency is assigned.
     - Incident details: Severity, casualties, target coordinates, calculated distance.
     - Step-by-step route itinerary: e.g., `Station A -> Node B -> Node C -> Emergency D`.
  3. **External Navigation Button:**
     - **"Open in Google Maps"** action button launching `https://www.google.com/maps/dir/?api=1&origin=...&destination=...`.
     - *Per README Section 23:* Google Maps is used exclusively for visual driving directions; the internal C++ engine retains full authority over routing and dynamic block avoidance.
  4. **Incident Resolution:**
     - "Complete Incident" button setting the unit back to `AVAILABLE`.

### Milestone 2.3: Real-Time Dynamic Mid-Transit Rerouting Flow
Implementation and verification of Section 21 of the README:
```
1. E1 occurs (Critical Accident at Node D).
2. A01 (at Depot A) is assigned. Shortest path: A -> B -> C -> D.
3. A01 begins moving and updates location to Node C.
4. Road C-D is reported BLOCKED by operator.
5. C++ Graph marks edge C-D as BLOCKED.
6. Dijkstra reruns with Source = Node C (latest known location, NOT Depot A).
7. Alternate route (C -> E -> F -> D) is generated.
8. WebSocket immediately pushes the new route to A01's mobile app with visual alert.
```

### Milestone 2.4: Automated Simulation Mode
- File: `simulation/scenarios/scenario_runner.js` / `.py`
- Pre-scripted timelines demonstrating the 10 official test cases from README Section 35:
  1. Single emergency + single available unit.
  2. Single emergency + multiple units (nearest chosen via Haversine).
  3. Mixed status units (available vs busy vs offline).
  4. Multiple simultaneous emergencies (priority queue heap ordering).
  5. Shortest path computation.
  6. Static road blockage avoidance.
  7. Mid-transit dynamic road blockage rerouting.
  8. Zero available units (graceful queueing).
  9. Incident completion and unit release.
  10. Critical incident arriving during active assignment (no auto-preemption).

### Milestone 2.5: Academic Documentation & Viva Preparation
1. **`docs/complexity.md`:** Detailed Big-O table of Time and Space complexity for all custom data structures:
   - Binary Heap: Insertion $O(\log n)$, Deletion $O(\log n)$.
   - Hash Table: Average $O(1)$, Worst-case $O(n)$.
   - Dynamic Graph: Space $O(V + E)$, Edge update $O(1)$.
   - Dijkstra's Algorithm: $O((V + E) \log V)$ using min-heap.
2. **`docs/algorithms.md`:** Mathematical formulation of Haversine distance, priority scoring, and dynamic graph rerouting.
3. **`docs/presentation_guide.md`:** Demo script for presentation with screenshots and step-by-step commands.

### Milestone 2.6: Final Release & Git Push
```powershell
git add .
git commit -m "feat: complete Phase 2 - operator dashboard, mobile app, dynamic rerouting, and simulation"
git checkout main
git merge develop
git tag -a v1.0.0-phase2 -m "Phase 2 Complete: Smart Emergency Response & Disaster Management System v1.0"
git push origin main --tags
```

---

## Deliverables Summary Table

| Phase | Percentage | Scope & Key Deliverables | Verification Output |
|---|---|---|---|
| **Phase 1** | **50%** | • Git repository initialization & `.gitignore`<br>• Custom C++ Data Structures (Heap, Hash Table, Queue, Stack, Linked List)<br>• Dynamic Road Graph & Dijkstra Algorithm<br>• NDJSON IPC Child Process Bridge<br>• Central Backend REST API & WebSocket Server | • C++ Unit Tests (`structure_tests`, `graph_tests`, `engine_tests`)<br>• Backend API & WebSocket Test Harness<br>• Git Tag `v0.5.0-phase1` |
| **Phase 2** | **50%** | • Operator PC Web Dashboard (interactive map, incident creator, blockage tool)<br>• Response Mobile Web App (unit login, alerts, Google Maps launch, complete)<br>• Dynamic Mid-Transit Reroute End-to-End Flow<br>• Automated 10-Scenario Simulator<br>• Big-O Complexity Report & Academic Viva Docs | • Live Demonstrable UI Flow<br>• Automated Simulation Runner Results<br>• Big-O Complexity Documentation<br>• Git Tag `v1.0.0-phase2` pushed to remote |
