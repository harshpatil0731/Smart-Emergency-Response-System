# Algorithmic Foundations & Core Logic
**Smart Emergency Response & Disaster Management System**  
*Comprehensive Technical & Mathematical Specification*

---

## 1. System Overview

The system operates as an event-driven algorithmic pipeline designed to solve the dynamic multi-agent emergency response problem on an urban road network. The C++ DSA Engine (`ds-engine/`) serves as the central decision authority, communicating asynchronously with the Node.js backend over an NDJSON IPC channel.

```
       [Operator Intake]                    [Road Network Sensor]
              │                                      │
              ▼                                      ▼
     ┌─────────────────┐                    ┌─────────────────┐
     │ Priority Triage │                    │ Road Blockage   │
     │  (Binary Heap)  │                    │ (Graph Update)  │
     └────────┬────────┘                    └────────┬────────┘
              │                                      │
              ▼                                      │
     ┌─────────────────┐                             │
     │ Resource Alloc. │                             │
     │   (Haversine)   │                             │
     └────────┬────────┘                             │
              │                                      │
              ▼                                      │
     ┌─────────────────┐                             │
     │ Route Planning  │◄────────────────────────────┘
     │   (Dijkstra)    │  (Reroutes from current vehicle node)
     └────────┬────────┘
              │
              ▼
     ┌─────────────────┐
     │   Dynamic ETA   │
     │ (Speed+Traffic) │
     └────────┬────────┘
              │
              ▼
   [Android Driver Telemetry]
```

---

## 2. Emergency Priority & Priority Policy

### Priority Hierarchy
Every emergency incident belongs to an enumerated severity tier:

$$\text{PriorityRank}(p) = \begin{cases} 
4, & p = \text{CRITICAL} \\ 
3, & p = \text{HIGH} \\ 
2, & p = \text{MEDIUM} \\ 
1, & p = \text{LOW} 
\end{cases}$$

### Strict Deterministic Ordering
When comparing two emergencies $A$ and $B$, the system evaluates:
1. **Primary Key**: $\text{PriorityRank}(A) > \text{PriorityRank}(B)$
2. **Secondary Key (FIFO timestamp tie-breaker)**: $\text{CreatedAt}(A) < \text{CreatedAt}(B)$
3. **Tertiary Key (Lexicographic ID tie-breaker)**: $\text{ID}(A) < \text{ID}(B)$

```cpp
bool PriorityPolicy::comesBefore(const Emergency& a, const Emergency& b) {
    const int rankA = priorityRank(a.priority), rankB = priorityRank(b.priority);
    if (rankA != rankB) return rankA > rankB;
    if (a.createdAt != b.createdAt) return a.createdAt < b.createdAt;
    return a.id < b.id;
}
```

This guarantees mathematical stability: no two emergencies can occupy indeterminate relative positions in the queue.

---

## 3. Priority Queue Heap Mechanics

- **Structure**: Complete binary tree implemented in a flat contiguous array via custom `BinaryHeap<T, Comparator>`.
- **Heap Invariant**: For every element at index $i$:
  - Left child: $\text{left}(i) = 2i + 1$
  - Right child: $\text{right}(i) = 2i + 2$
  - Parent: $\text{parent}(i) = \lfloor (i - 1) / 2 \rfloor$
  - Condition: $\text{Comparator}(\text{parent}(i), \text{element}(i)) == \text{true}$
- **Push ($O(\log N)$)**: Appends element at the end of the array and executes `siftUp(size - 1)` swapping with parent until invariant holds.
- **Pop ($O(\log N)$)**: Replaces root with the last element in the array, decrements size, and executes `siftDown(0)` swapping with the highest-priority child.
- **Peek ($O(1)$)**: Direct array access at index `0`.

---

## 4. Resource Compatibility & Filtering

Before calculating physical distances, the system filters registered units using a strict compatibility matrix implemented in `ResourceCompatibility`:

$$\text{IsCompatible}(\text{EmergencyType}, \text{TeamType}) \to \{\text{true}, \text{false}\}$$

| Emergency Type | Compatible Response Team Types |
|---|---|
| `FIRE` | `FIRE_BRIGADE` |
| `MEDICAL` | `AMBULANCE` |
| `ACCIDENT` | `AMBULANCE`, `RESCUE_TEAM` |
| `FLOOD` | `RESCUE_TEAM` |
| `BUILDING_COLLAPSE` | `RESCUE_TEAM`, `FIRE_BRIGADE` |

Any unit whose status is not `AVAILABLE` (`BUSY` or `OFFLINE`) or whose operational type is incompatible is excluded from candidate consideration before geometric computation.

---

## 5. Haversine Spherical Distance Calculation

To determine the nearest candidate among compatible available units, the system calculates the great-circle surface distance across the Earth's curvature between unit coordinates $(\phi_1, \lambda_1)$ and incident coordinates $(\phi_2, \lambda_2)$:

### Mathematical Formulation
Let $\phi$ denote latitude and $\lambda$ denote longitude in radians:
$$\Delta\phi = \phi_2 - \phi_1$$
$$\Delta\lambda = \lambda_2 - \lambda_1$$
$$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)$$
$$c = 2 \cdot \operatorname{atan2}\left(\sqrt{a}, \sqrt{1 - a}\right)$$
$$d = R \cdot c$$

*Where $R = 6371.0\text{ km}$ (mean radius of the Earth).*

Implemented in `ResourceAllocator::haversineKm`:
```cpp
double ResourceAllocator::haversineKm(GeoPoint from, GeoPoint to) {
    constexpr double pi = 3.14159265358979323846;
    constexpr double earthRadiusKm = 6371.0;
    const auto radians = [pi](double degrees) { return degrees * pi / 180.0; };
    const double dLat = radians(to.latitude - from.latitude);
    const double dLon = radians(to.longitude - from.longitude);
    const double a = std::sin(dLat / 2) * std::sin(dLat / 2) +
                     std::cos(radians(from.latitude)) * std::cos(radians(to.latitude)) *
                     std::sin(dLon / 2) * std::sin(dLon / 2);
    return earthRadiusKm * 2 * std::atan2(std::sqrt(a), std::sqrt(1 - a));
}
```

---

## 6. Distance-Based Allocation vs Graph-Based Route Calculation

A fundamental design invariant of the system is the decoupled two-stage navigation model:

| Dimension | Stage 1: Resource Allocation | Stage 2: Navigation & Route Planning |
|---|---|---|
| **Objective** | Select the best response unit from fleet | Compute exact turn-by-turn route |
| **Domain** | Continuous $\mathbb{R}^2$ spherical surface | Discrete topological graph $G = (V, E)$ |
| **Algorithm** | Haversine Great-Circle Formula | Dijkstra's Shortest Path Algorithm |
| **Input Data** | Raw GPS Latitude / Longitude | Graph vertices, edges, and street lengths |
| **Time Complexity** | $O(T)$ where $T$ is fleet size | $O((V + E) \log V)$ for single selected unit |
| **Obstacle Awareness**| Not obstacle-aware ("as the crow flies") | 100% obstacle-aware (bypasses blocked roads) |

**Rationale**: If the system executed Dijkstra across the entire graph for all $T$ available units before allocating, total computational overhead would be $O(T \cdot (V + E) \log V)$. By using Haversine as an $O(1)$ heuristic filter, candidate selection takes $O(T)$ time, after which Dijkstra runs **only once** on the winning unit.

---

## 7. City Graph Representation

- **Data Structure**: Adjacency list represented via custom data structures:
  - Vertices: `HashTable<std::string, GraphVertex>` where each vertex contains its string identifier, `GeoPoint` coordinates, and an outgoing edge list.
  - Edges: `LinkedList<GraphEdge>` where each edge contains target `toNodeId`, road identifier `roadId`, length in kilometers `weightKm`, and status `RoadStatus` (`OPEN` vs `BLOCKED`).
  - Road Segments: `HashTable<std::string, Road>` storing metadata.
- **Dynamic Updates**:
  When a road status changes, the graph updates the status flag on the directed edges directly without destroying or re-allocating memory:
  ```cpp
  bool CityGraph::setRoadStatus(const std::string& roadId, RoadStatus status) {
      Road* r = roads_.find(roadId);
      if (!r) return false;
      r->status = status;
      updateDirectedEdge(r->u, roadId, status);
      updateDirectedEdge(r->v, roadId, status);
      return true;
  }
  ```

---

## 8. Dijkstra's Shortest Path Algorithm

### Algorithm Flow
1. **Initialization**:
   - `distances`: Hash table mapping $\text{nodeId} \to \text{shortest distance discovered}$ (initialized with $d(\text{source}) = 0$, all others $\infty$).
   - `previous`: Hash table mapping $\text{nodeId} \to \{\text{predecessorNode}, \text{traversedRoadId}\}$.
   - `frontier`: Min-priority `BinaryHeap<FrontierNode>` ordered by cumulative candidate distance.
2. **Exploration**:
   - Pop vertex $u$ with minimum distance from `frontier`.
   - Skip if a shorter path to $u$ has already been processed (`current.distance != *known`).
   - If $u == \text{destination}$, terminate search.
3. **Neighbor Relaxation with Edge Filtering**:
   - Iterate through outgoing edges in `LinkedList<GraphEdge>`:
     ```cpp
     if (edge.status == RoadStatus::BLOCKED) return; // Skip blocked edges
     double candidate = current.distance + edge.weightKm;
     if (!oldDistance || candidate < *oldDistance) {
         distances.upsert(edge.toNodeId, candidate);
         previous.upsert(edge.toNodeId, {current.nodeId, edge.roadId});
         frontier.push({edge.toNodeId, candidate});
     }
     ```
4. **Path Reconstruction**:
   - Backtrack from $\text{destination}$ to $\text{source}$ via `previous` map.
   - Reverse sequence into source-to-destination vector using stack logic.

---

## 9. Dynamic Mid-Transit Road Blockage & Rerouting

When an active transit road is blocked in real life, vehicles cannot teleport back to their depot. They must reroute starting from their **current physical location**.

### Exact Rerouting Procedure
1. Operator marks road $R_{xy}$ as `BLOCKED`.
2. Engine invokes `CityGraph::setRoadStatus(R_xy, BLOCKED)`.
3. Engine inspects active assignments in `state_.assignmentsById`.
4. If assignment path contains $R_{xy}$:
   - Look up team's **current position**: $\text{source} = \text{team.currentGraphNodeId}$.
   - Look up emergency target: $\text{destination} = \text{emergency.destinationGraphNodeId}$.
   - Execute Dijkstra:
     $$\text{NewRoute} = \text{Dijkstra}(\text{CityGraph}, \text{team.currentGraphNodeId}, \text{emergency.destinationGraphNodeId})$$
   - Store route revision in assignment breadcrumbs.
   - Emit `ROAD_STATUS_CHANGED` event containing the revised route, new total distance, and recalculated ETA.
5. Android app receives event, vibrates, updates route nodes on screen, and displays the "DYNAMIC ROUTE RECALCULATED" alert banner.

---

## 10. Dynamic ETA Calculation Engine

ETA is no longer fixed or hardcoded. It dynamically scales according to route distance, vehicle type performance, and deterministic road traffic factors.

### Transit Time & ETA Formulas
$$\text{Transit Time (hours)} = \sum_{e \in \text{Route}} \frac{\text{Distance}(e) \times \text{TrafficFactor}(e)}{\text{BaseSpeed}(\text{VehicleType})}$$

$$\text{ETA (minutes)} = \max\left(1, \left\lceil \text{Transit Time (hours)} \times 60 \right\rceil\right)$$

### Parameters
1. **Configurable Base Speeds**:
   - `AMBULANCE`: $50\text{ km/h}$
   - `FIRE_BRIGADE`: $40\text{ km/h}$
   - `RESCUE_TEAM`: $42\text{ km/h}$
   - `DEFAULT`: $45\text{ km/h}$
2. **Deterministic Corridor Traffic Factors**:
   - Standard arterial corridors (`R_AB`, `R_DE`, `R_EF`, `R_GA`): $1.0\times$
   - Moderate commercial corridors (`R_CD`, `R_FA`): $1.1\times$
   - High-density corridors (`R_BC`, `R_FG`): $1.2\times$
   - Core congested bottleneck (`R_EA`): $1.3\times$

### Simulated Movement ETA Reduction
In Demo Location Mode, as the driver advances through route nodes $(v_0, v_1, \dots, v_k)$:
- Haversine distance from current node $v_i$ to destination $v_k$ is calculated and scaled to the C++ Dijkstra graph distance.
- Remaining distance and ETA decrease deterministically:
  $$\text{RemainingDist}(i) = \text{FullDist} \times \frac{\sum_{j=i}^{k-1} \text{Haversine}(v_j, v_{j+1})}{\sum_{j=0}^{k-1} \text{Haversine}(v_j, v_{j+1})}$$
  $$\text{RemainingETA}(i) = \max\left(1, \left\lceil \frac{\text{RemainingDist}(i) \times 1.1}{\text{BaseSpeed}} \times 60 \right\rceil\right)$$
  - Reaching destination node ($i = k$) sets distance to $0.00\text{ km}$ and ETA to $0\text{ min}$.

---

## 11. Event-Driven Communication Pipeline

All interactions between system subsystems follow an asynchronous event-driven lifecycle:

```text
[Operator / App Action]
       │  HTTP REST (JSON)
       ▼
[Node.js Backend]
       │  NDJSON over Stdin (RequestId Correlation)
       ▼
[C++ Engine (console_simulator.cpp)]
       │  Submits DomainEvent
       │  Processes in EmergencyEngine::handle()
       │  Emits JSON Response over Stdout
       ▼
[Node.js Backend rl.on('line')]
       │  Resolves Pending Promise for RequestId
       │  Enriches snapshot with dynamic ETA
       ▼
[WebSocket Broadcast (/ws)]
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[Operator Web Dashboard]              [Android Response Team App]
(Leaflet.js redraws Cyan Polyline)   (StateFlow updates DriverViewModel)
```
