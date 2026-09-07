# Smart Emergency Response & Disaster Management System

## 1. Project Overview

This project is a **Data Structures and Algorithms course project** that simulates a smart emergency-response and disaster-management system.

The system manages:

- Multiple simultaneous emergencies
- Ambulances
- Fire brigades
- Rescue teams
- Emergency priorities
- Response-team availability
- Response-team locations
- Emergency assignments
- Dynamic road blockages
- Alternative route calculation
- Communication between a central operator and response teams

The main purpose of the project is to demonstrate how **Data Structures and Algorithms can be integrated to solve a dynamic real-world problem**.

This is NOT intended to be a production-grade emergency dispatch system.

It is an **academic simulation/prototype** with a strong focus on Data Structures and Algorithms.

---

# 2. Core Problem

During disasters or accidents, several emergencies may occur simultaneously.

For example:

```text
Emergency E1 → Critical accident → 10 injured
Emergency E2 → Fire → 5 people trapped
Emergency E3 → Medical emergency → 2 injured
```

However, the emergency center has limited resources:

```text
3 Ambulances
2 Fire Brigades
1 Rescue Team
```

The system must decide:

1. Which emergency should be handled first?
2. Which available response team should be assigned?
3. Which response team is closest?
4. What route should the response team take?
5. What happens if a new emergency occurs?
6. What happens if a response team becomes unavailable?
7. What happens if a road becomes blocked while a team is travelling?
8. How should the system dynamically update the response plan?

The central problem is:

> **How can a system dynamically manage multiple emergencies, limited response resources, changing response-team availability, and changing road conditions using Data Structures and Algorithms?**

---

# 3. Core Solution

The system consists of three major parts:

```text
                 SYSTEM
                    |
        ┌───────────┴───────────┐
        |                       |
        ↓                       ↓
Operator PC              Response Mobile App
        |                       |
        └───────────┬───────────┘
                    ↓
              Central Backend
                    ↓
             DS Engine
                    ↓
        Emergency + Resource + Route
             Decision System
```

### Operator

The operator works from a PC at the emergency control center.

The operator provides information such as:

- New emergency
- Emergency location
- Emergency type
- Number of injured people
- Severity
- Road blockage
- Other incident updates

### Response Team

Response teams use a mobile application.

The mobile app is used by:

- Ambulances
- Fire brigades
- Rescue teams

The mobile app provides:

- Login
- Team identity
- Availability status
- Current location
- Emergency assignments
- Assignment acceptance
- Route information
- Emergency completion

### DS Engine

The DS engine performs:

- Emergency prioritization
- Resource filtering
- Resource allocation
- Distance calculation
- Graph management
- Shortest-path calculation
- Dynamic route recalculation
- State updates

---

# 4. Important Design Principle

The project must NOT be built as a normal CRUD application with Data Structures added artificially.

The **Data Structures and Algorithms must be central to the decision-making process.**

The architecture should clearly demonstrate:

```text
Real-world event
      ↓
Data update
      ↓
Data Structure update
      ↓
Algorithm execution
      ↓
Decision
      ↓
Response-team update
```

---

# 5. Main Novelty

The primary novelty is:

## Dynamic Incident-Aware Response Management

The system does not calculate a response plan only once.

It dynamically adapts when:

- A new emergency occurs
- Emergency priority changes
- A response team becomes available
- A response team becomes busy
- A response team becomes offline
- A response team's location changes
- A road becomes blocked
- The current route becomes invalid
- An emergency is completed

The strongest feature is:

## Dynamic Rerouting

Example:

```text
Ambulance A01
      ↓
Emergency E1
      ↓
Route:
A → B → C → D
```

While A01 is travelling:

```text
Road C-D becomes blocked
```

The system must:

```text
1. Detect that the current route is affected.
2. Update its internal graph.
3. Start from A01's latest known location.
4. Run Dijkstra again.
5. Find an alternative available route.
6. Send the updated route to A01.
```

The system does NOT modify Google Maps.

The project's own graph is responsible for emergency-response route planning.

Google Maps is used only for actual navigation.

---

# 6. Users / Roles

There are two major interface categories.

## 6.1 Operator

The operator uses a PC application.

Operator capabilities:

- Login
- View dashboard
- Report emergency
- View active emergencies
- View pending emergencies
- View assigned emergencies
- View response teams
- View team status
- View team locations
- Report road blockage
- View route information
- Monitor assignments
- Close/complete emergencies

---

## 6.2 Response Team

The response team uses a mobile application.

The same mobile application supports:

```text
AMBULANCE
FIRE BRIGADE
RESCUE TEAM
```

Each response unit has a unique ID.

Examples:

```text
A01 → Ambulance
A02 → Ambulance
F01 → Fire Brigade
R01 → Rescue Team
```

Response-team capabilities:

- Login
- View own profile
- Set status
- Send/update location
- Receive emergency assignment
- Accept assignment
- View emergency information
- View recommended route
- Open Google Maps
- Mark emergency as completed

---

# 7. Response Team Status

Every response unit has exactly three main statuses:

```text
OFFLINE
AVAILABLE
BUSY
```

## OFFLINE

The unit is not available for emergency assignment.

The DS engine must NOT consider it for allocation.

---

## AVAILABLE

The unit is ready to receive an emergency.

The DS engine can consider it for assignment.

---

## BUSY

The unit is currently handling an emergency.

The DS engine normally must NOT assign another emergency to it.

Example:

```text
A01
Status: BUSY
Emergency: E101
```

---

# 8. Response Team Location

Each response unit has a current/latest known location.

Example:

```text
A01
Latitude: 18.xxxx
Longitude: 73.xxxx
Status: AVAILABLE
```

The location can be:

1. Obtained from the mobile device GPS in the advanced version.
2. Simulated through the application during development/testing.

The architecture should support real GPS later without redesigning the DS engine.

The server should maintain the latest known location of each response unit.

---

# 9. Emergency Data

Each emergency should have at least:

```text
Emergency ID
Emergency Type
Location
Latitude
Longitude
Number of injured people
Severity
Status
Assigned Response Team
Created Time
```

Possible emergency types:

```text
ACCIDENT
FIRE
MEDICAL
FLOOD
BUILDING_COLLAPSE
OTHER
```

Possible emergency statuses:

```text
PENDING
ASSIGNED
IN_PROGRESS
COMPLETED
CANCELLED
```

---

# 10. Emergency Priority

Emergencies must not simply be processed in arrival order.

The system must support priority.

Possible priority levels:

```text
CRITICAL
HIGH
MEDIUM
LOW
```

Priority should be determined using emergency information.

For the first version, a simple deterministic priority model is acceptable.

Example:

```text
Critical → highest priority
High     → second
Medium   → third
Low      → lowest
```

Later, the priority calculation can consider:

- Severity
- Number of injured people
- Emergency type
- People trapped
- Other defined factors

Do NOT introduce AI or machine learning into the core DS logic unless explicitly requested later.

This is a Data Structures project.

---

# 11. Priority Queue

A Priority Queue / Heap should be used to manage pending emergencies.

Example:

```text
Priority Queue

E101 → CRITICAL
E105 → CRITICAL
E103 → HIGH
E107 → MEDIUM
E109 → LOW
```

The highest-priority emergency should be processed first.

If two emergencies have the same priority, define a deterministic tie-breaker such as:

```text
Earlier reported emergency first
```

or another clearly documented rule.

---

# 12. Response Resource Allocation

When an emergency needs a response team:

### Step 1

Filter response units by:

```text
Status == AVAILABLE
```

Do NOT consider:

```text
BUSY
OFFLINE
```

### Step 2

Check whether the response unit type is appropriate for the emergency.

Example:

```text
Fire emergency → Fire Brigade
Medical emergency → Ambulance
Building collapse → Rescue Team
```

The system should support suitable resource types.

### Step 3

Calculate distance between:

```text
Emergency location
        ↓
Response team's current location
```

### Step 4

Select the nearest suitable available response unit according to the project's allocation policy.

Example:

```text
A01 → AVAILABLE → 2.4 km
A02 → AVAILABLE → 5.7 km
A03 → BUSY       → 1.2 km
A04 → OFFLINE    → 0.8 km
```

A01 should be selected.

The system should NOT select A03 or A04.

---

# 13. Important Distinction: Distance vs Route

There are two separate concepts.

## Distance-based resource selection

Used to determine:

> Which available response team should be assigned?

For the initial implementation, use geographic distance between current response-team location and emergency location.

## Graph-based route calculation

Used to determine:

> Which road path should the selected response team take?

The city is represented as a graph.

Dijkstra calculates the shortest available path.

These are separate stages.

```text
Emergency
    ↓
Find available suitable teams
    ↓
Compare distance
    ↓
Select team
    ↓
Graph + Dijkstra
    ↓
Calculate route
```

---

# 14. City Road Graph

The city must be represented as a weighted graph.

Example:

```text
A ─── B ─── C
│     │     │
D ─── E ─── F
```

Where:

```text
Vertex = location/intersection
Edge = road
Weight = distance
```

Example:

```text
A → B = 4 km
B → C = 2 km
A → D = 3 km
D → E = 2 km
```

The graph must support dynamic road status.

A road can be:

```text
OPEN
BLOCKED
```

---

# 15. Dijkstra's Algorithm

Dijkstra must be used for shortest-path calculation.

Input:

```text
Source = response team's current location
Destination = emergency location
```

Output:

```text
Shortest available path
Total distance/cost
```

Example:

```text
A → B → C → D
```

If the shortest route is blocked:

```text
B → C = BLOCKED
```

Dijkstra must ignore that edge and find an alternative path.

---

# 16. Dynamic Road Blockage

This is one of the most important features.

Example:

```text
A → B → C → D
```

Ambulance A01 is travelling toward Emergency E1.

A new accident occurs and:

```text
Road C-D = BLOCKED
```

The operator reports this through the PC application.

The system then:

```text
1. Updates road C-D to BLOCKED.
2. Updates the graph.
3. Checks active assignments affected by the road blockage.
4. Gets the response team's latest known location.
5. Gets its emergency destination.
6. Runs Dijkstra again.
7. Generates a new available route.
8. Sends the new route to the response-team app.
```

The new route might be:

```text
C → E → F → D
```

---

# 17. Current Location During Rerouting

This is extremely important.

When rerouting is required, the system must NOT calculate from the ambulance's original starting location.

It must calculate from:

> **The response team's latest known location.**

Example:

```text
Original:
Hospital → A → B → C → D

Current ambulance location:
C

Road C-D blocked.

New Dijkstra source:
C

New route:
C → E → F → D
```

---

# 18. Monitoring Response Teams

The central server maintains the current state of all response teams.

Example:

```text
A01
Type: Ambulance
Status: BUSY
Emergency: E101
Location: B

A02
Type: Ambulance
Status: AVAILABLE
Emergency: None
Location: F

A03
Type: Ambulance
Status: OFFLINE
Emergency: None
Location: Unknown

F01
Type: Fire Brigade
Status: AVAILABLE
Emergency: None
Location: D

R01
Type: Rescue Team
Status: BUSY
Emergency: E103
Location: C
```

The mobile application periodically sends updates.

The DS engine reacts to important events rather than recalculating everything every second.

---

# 19. Event-Driven Architecture

Important events include:

## New emergency

```text
New emergency
      ↓
Add to Priority Queue
      ↓
Resource allocation
```

## Team becomes available

```text
AVAILABLE
      ↓
Update resource structure
```

## Team accepts emergency

```text
AVAILABLE
      ↓
BUSY
```

## Location update

```text
Mobile app
      ↓
Latest location
      ↓
Update team state
```

## Road blocked

```text
Road blocked
      ↓
Graph update
      ↓
Check affected routes
      ↓
Dijkstra
      ↓
New route
```

## Emergency completed

```text
BUSY
 ↓
Emergency completed
 ↓
AVAILABLE
```

---

# 20. Handling Multiple Emergencies

The system must support simultaneous emergencies.

Example:

```text
E1 → CRITICAL
E2 → HIGH
E3 → CRITICAL
E4 → MEDIUM
```

The Priority Queue decides processing order.

However, an already assigned response unit should NOT automatically be removed from an ongoing emergency just because a new emergency appears.

Example:

```text
A01 → BUSY → E1
```

If E2 occurs:

```text
E2 → CRITICAL
```

The system first searches for another suitable available resource.

Only if the project later defines an explicit emergency-preemption policy should an active assignment be reconsidered.

For the initial version:

> **Do not automatically interrupt an ongoing emergency response.**

---

# 21. Complex Scenario

The system must be designed to handle this scenario:

```text
E1 occurs
↓
E1 is CRITICAL
↓
A01 is selected
↓
A01 becomes BUSY
↓
A01 starts travelling
↓
A01 reaches halfway point
↓
E2 occurs
↓
E2 is also CRITICAL
↓
System checks available resources
↓
A01 remains assigned to E1
↓
Another suitable available unit is considered for E2
↓
Road used by A01 becomes blocked
↓
Operator reports road blockage
↓
Graph is updated
↓
Dijkstra recalculates from A01's latest location
↓
Alternative route is generated
↓
A01's mobile application receives the updated route
```

This scenario should eventually be included in the simulation/testing system.

---

# 22. Mobile Application

The response-team mobile application should provide a simple interface.

## Login

```text
Username
Password
Login
```

After login:

```text
Team ID
Team Type
Current Status
Current Location
```

---

## Home Screen

Example:

```text
AMBULANCE A01

Status: AVAILABLE

Current Location:
GPS Location

[ GO OFFLINE ]
```

---

## Emergency Assignment Screen

Example:

```text
NEW EMERGENCY

Emergency ID: E101
Type: Accident
Severity: CRITICAL
People Injured: 8

Location:
Emergency coordinates/address

Distance:
2.4 km

Recommended Route:
A → B → C → D

[ ACCEPT ]
```

After accepting:

```text
Status → BUSY
```

---

## Navigation

The app displays the system-generated route.

There should be an:

```text
[ OPEN GOOGLE MAPS ]
```

button.

Google Maps is responsible for actual navigation.

The project's own graph and Dijkstra implementation are responsible for emergency route planning and dynamic rerouting.

---

# 23. Google Maps Rule

Do NOT attempt to modify Google Maps' road network.

The project cannot directly tell Google Maps:

```text
"This road is blocked in our simulation."
```

Instead:

```text
Operator
   ↓
Reports road blockage
   ↓
Our Graph
   ↓
Road marked BLOCKED
   ↓
Dijkstra
   ↓
Alternative route
   ↓
Mobile app
   ↓
Google Maps for navigation
```

Google Maps is therefore a navigation utility, not the core routing engine of the project.

---

# 24. Data Structures Required

The following structures should be considered core:

### Required

```text
Priority Queue / Heap
Hash Table
Graph
Dijkstra
Queue
Linked List
Stack
```

### Possible additional structures

```text
Min Heap
Binary Search Tree
Trie
Disjoint Set Union
```

Additional structures should only be added if they have a genuine purpose.

Do NOT add data structures simply to increase the number of structures.

---

# 25. Data Structure Mapping

| Requirement | Data Structure / Algorithm |
|---|---|
| Emergency priority | Priority Queue / Heap |
| Pending emergencies | Queue |
| Emergency history | Linked List |
| Fast response-team lookup | Hash Table |
| Fast emergency lookup | Hash Table |
| City road network | Graph |
| Shortest route | Dijkstra |
| Route/action history | Stack |
| Resource selection | Heap/Priority Queue where appropriate |

---

# 26. C++ DS Engine Requirement

The Data Structures component should be implemented in **C++**.

This is a Data Structures course project, so the DS implementation must be visible and understandable.

Avoid making the entire DS engine simply:

```cpp
std::priority_queue
std::unordered_map
std::list
```

without implementing the underlying structures.

Where academically appropriate, implement the important structures manually.

The project should clearly demonstrate:

- Node structures
- Insert
- Delete
- Search
- Enqueue
- Dequeue
- Push
- Pop
- Heap operations
- Hashing
- Graph representation
- Dijkstra
- Complexity analysis

Standard library utilities may be used where they do not undermine the educational purpose, but the core DS implementations should be custom and documented.

---

# 27. Backend

The backend connects the interfaces with the DS engine.

It should manage:

- Authentication
- Users
- Response teams
- Emergencies
- Locations
- Assignments
- Road status
- Communication between operator and mobile app

The backend should NOT contain the core DS logic in a way that bypasses the C++ DS engine.

The architecture should preserve a clear separation:

```text
Frontend
   ↓
Backend/API
   ↓
DS Engine
   ↓
Decision
   ↓
Backend
   ↓
Frontend
```

---

# 28. Database

A database can store persistent application data.

Possible entities:

```text
Users
ResponseTeams
Emergencies
Assignments
Roads
Locations
EmergencyHistory
```

The database is for persistence.

The DS engine is for active decision-making.

Do NOT treat the database itself as the Data Structures implementation.

---

# 29. Suggested Folder Structure

The final project can use a structure similar to:

```text
smart-emergency-response/
│
├── README.md
│
├── backend/
│   ├── main
│   ├── routes/
│   ├── models/
│   ├── services/
│   └── database/
│
├── ds_engine/
│   ├── include/
│   ├── src/
│   ├── tests/
│   └── main.cpp
│
├── operator-app/
│   ├── index.html
│   ├── dashboard.html
│   ├── css/
│   └── js/
│
├── response-app/
│   ├── lib/
│   ├── screens/
│   ├── models/
│   ├── services/
│   └── widgets/
│
├── simulation/
│   ├── scenarios/
│   └── test-data/
│
├── docs/
│   ├── architecture.md
│   ├── algorithms.md
│   └── complexity.md
│
└── tests/
```

This structure may be changed if there is a strong technical reason.

---

# 30. Simulation Mode

The project must eventually include a simulation mode.

This is important because the project should be demonstrable without depending completely on real-world emergencies.

Simulation should support events such as:

```text
New emergency
Team becomes available
Team becomes busy
Team becomes offline
Location update
Road blockage
Road reopening
Emergency completion
```

Example:

```text
TIME 00:00
E101 reported
↓
A01 assigned

TIME 00:30
A01 location updated
↓
A01 halfway to E101

TIME 00:31
Road B-C blocked
↓
Graph updated

TIME 00:32
Dijkstra executed
↓
Alternative route generated

TIME 00:33
A01 receives new route
```

---

# 31. UI Design Principles

The UI should be:

- Clean
- Professional
- Simple
- Easy to understand
- Suitable for an academic project demonstration

Do NOT prioritize flashy animations over functionality.

The operator dashboard should focus on:

- Emergencies
- Priorities
- Response teams
- Status
- Assignments
- Road network
- Alerts

The mobile app should focus on:

- Current status
- Emergency assignment
- Emergency information
- Route
- Navigation
- Completion

---

# 32. Important Constraints

The project is an academic prototype.

Do NOT claim:

- Real emergency dispatch capability
- Guaranteed emergency response
- Guaranteed real-time GPS accuracy
- Real police/fire/ambulance integration
- Direct control over Google Maps
- Production-level reliability

The system should clearly be described as a:

> **Simulation and prototype for demonstrating Data Structures and Algorithms in emergency-response management.**

---

# 33. What NOT to Build

Do NOT unnecessarily add:

- AI
- Machine Learning
- Facial recognition
- Complex prediction models
- Blockchain
- IoT hardware
- Advanced traffic prediction
- Social media integration
- Unnecessary microservices

unless explicitly requested later.

The core project must remain:

> **Data Structures + Algorithms + Emergency Response Simulation**

---

# 34. Development Strategy

The project must be built incrementally.

Do NOT generate the entire project in one step.

Recommended development order:

## Phase 1 — Requirements and Architecture

Analyze this README.

Do not code yet.

Identify:

- Components
- Data models
- Interfaces
- APIs
- DS requirements
- Dependencies
- Risks

---

## Phase 2 — C++ DS Engine

Implement and test:

1. Emergency model
2. Response-team model
3. Priority Queue
4. Queue
5. Linked List
6. Hash Table
7. Graph
8. Dijkstra
9. Stack
10. Resource allocation logic
11. Dynamic road blockage
12. Dynamic rerouting

The DS engine should first work independently through console-based tests.

---

## Phase 3 — Backend

Create APIs for:

- Login
- Emergency creation
- Emergency retrieval
- Response-team status
- Response-team location
- Assignment
- Emergency completion
- Road blockage
- Route update

---

## Phase 4 — Operator PC Application

Build:

- Login
- Dashboard
- Emergency registration
- Emergency monitoring
- Response-team monitoring
- Road blockage reporting
- Assignment monitoring

---

## Phase 5 — Response Mobile Application

Build:

- Login
- Status
- Location
- Emergency assignment
- Accept
- Route
- Google Maps navigation
- Complete emergency

---

## Phase 6 — Integration

Connect:

```text
Operator
   ↓
Backend
   ↓
C++ DS Engine
   ↓
Backend
   ↓
Response Mobile App
```

---

## Phase 7 — Dynamic Simulation

Test:

- Multiple emergencies
- Multiple response teams
- Road blockage
- Route recalculation
- Location updates
- Team status changes
- Resource shortages

---

## Phase 8 — Testing and Documentation

Document:

- Data Structures
- Algorithms
- Time complexity
- Space complexity
- Test cases
- Edge cases
- Architecture
- Novelty
- Limitations
- Future scope

---

# 35. Testing Requirements

The project must include meaningful test cases.

Examples:

### Test 1

One emergency + one available ambulance.

Expected:

```text
Ambulance assigned.
```

### Test 2

One emergency + multiple available ambulances.

Expected:

```text
Nearest suitable ambulance selected.
```

### Test 3

Available + busy + offline ambulances.

Expected:

```text
Only available ambulance considered.
```

### Test 4

Multiple emergencies.

Expected:

```text
Priority Queue determines processing order.
```

### Test 5

Shortest route.

Expected:

```text
Dijkstra returns shortest available route.
```

### Test 6

Road blockage.

Expected:

```text
Blocked edge ignored.
Alternative route generated.
```

### Test 7

Road blockage while response team is halfway.

Expected:

```text
Dijkstra starts from latest known response-team location.
```

### Test 8

No available response team.

Expected:

```text
Emergency remains pending/queued.
```

### Test 9

Emergency completed.

Expected:

```text
BUSY → AVAILABLE.
```

### Test 10

New critical emergency while another critical emergency is active.

Expected:

```text
Existing assignment is not automatically interrupted.
System searches for another suitable resource.
```

---

# 36. Edge Cases

The system should handle:

- No available response team
- All ambulances busy
- All fire brigades busy
- All rescue teams offline
- No route exists
- Destination unreachable
- Road blockage disconnecting a location
- Multiple equal-distance teams
- Multiple emergencies with same priority
- Invalid emergency location
- Duplicate emergency
- Response team going offline while available
- Response team becoming unavailable after assignment
- Emergency cancellation
- Road reopening
- Response team location unavailable

The system should fail gracefully and display meaningful messages.

---

# 37. Performance / Complexity

The project must eventually document the complexity of important operations.

Examples:

```text
Priority Queue insertion
Priority Queue deletion
Hash Table search
Graph insertion
Graph edge update
Dijkstra
Queue operations
Stack operations
```

The final documentation should explain:

- Time complexity
- Space complexity
- Why each data structure was selected

---

# 38. Academic Demonstration

The final demonstration should clearly show:

```text
1. Operator reports emergency
        ↓
2. Emergency enters Priority Queue
        ↓
3. System finds available response teams
        ↓
4. Distance comparison
        ↓
5. Team selected
        ↓
6. Team becomes BUSY
        ↓
7. Dijkstra finds route
        ↓
8. Mobile app receives assignment
        ↓
9. Road becomes blocked
        ↓
10. Operator reports blockage
        ↓
11. Graph changes
        ↓
12. Dijkstra recalculates
        ↓
13. New route appears on mobile app
        ↓
14. Team completes emergency
        ↓
15. Team becomes AVAILABLE
```

This flow is the main project demonstration.

---

# 39. Final Project Statement

The project can be summarized as:

> **A Data Structures and Algorithms based emergency-response simulation that dynamically prioritizes emergencies, allocates available response teams based on their current state and location, represents the road network as a dynamic graph, calculates shortest routes using Dijkstra's algorithm, and adapts the response plan when new incidents or road blockages occur.**

---

# 40. Instructions for Codex

## IMPORTANT

You are acting as the **software implementation agent** for this project.

This README is the project's primary specification.

Before writing code:

1. Read this entire README.
2. Understand the architecture.
3. Identify ambiguities or contradictions.
4. Propose a development plan.
5. Propose the technology stack.
6. Propose the folder structure.
7. Explain how the C++ DS engine will communicate with the backend.
8. Explain the data models.
9. Explain the APIs.
10. Identify technical risks.
11. Identify anything that should be simplified for a student course project.

### DO NOT immediately generate the entire application.

Wait for approval before implementing major phases.

When implementing:

- Work incrementally.
- Keep modules small and understandable.
- Write clean, maintainable code.
- Add comments where the algorithm is non-obvious.
- Add tests for every major data structure.
- Do not hide the core DS logic behind libraries.
- Do not add unnecessary technologies.
- Do not add AI/ML unless explicitly requested.
- Do not redesign the project without discussing it first.
- Preserve the architecture defined in this README.
- If a requirement is technically impossible or unrealistic, explain the issue before implementing a workaround.

### Most Important Development Rule

**The Data Structures and Algorithms are the heart of the project.**

The UI and backend exist to demonstrate and interact with the DS engine.

Do not build a beautiful UI first and implement the actual DS logic later.

The correct development order is:

```text
DATA STRUCTURES
       ↓
ALGORITHMS
       ↓
DS ENGINE
       ↓
BACKEND
       ↓
OPERATOR UI
       ↓
MOBILE APP
       ↓
INTEGRATION
       ↓
SIMULATION
       ↓
TESTING
```

---

# 41. Current Development Status

At project initialization:

```text
Project concept: APPROVED
Architecture concept: DEFINED
Core novelty: DEFINED
README specification: DEFINED
Coding: NOT STARTED
```

The next step is:

> **Analyze this README and propose the detailed architecture and development plan. Do not start coding until the plan is reviewed and approved.**