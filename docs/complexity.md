# Time & Space Complexity Analysis
**Smart Emergency Response & Disaster Management System**  
*Academic Data Structures & Algorithms Specification*

---

## 1. Executive Summary

The Smart Emergency Response System implements an algorithmic decision pipeline without third-party graph or routing engines. Every foundational data structure is manually implemented in C++20 under `ds-engine/include/structures/` and `ds-engine/include/graph/`.

This document specifies the exact theoretical and empirical Big-O time and space complexities for each data structure, algorithm, and system operation based on the actual codebase implementation.

---

## 2. Core Data Structures Complexity Table

| Data Structure | Implementation File | Operation | Average Time | Worst-Case Time | Space Complexity | Real-World Application in System |
|---|---|---|---|---|---|---|
| **Binary Heap** | [`binary_heap.hpp`](file:///d:/College%20Projects/SY/Smart-Emergency-Response-System/ds-engine/include/structures/binary_heap.hpp) | `push` (Insert) | $O(\log n)$ | $O(\log n)$ | $O(n)$ | Dynamic emergency triage queue & Dijkstra frontier |
| | | `pop` (Extract Top) | $O(\log n)$ | $O(\log n)$ | | Highest-priority emergency extraction |
| | | `peek` (Top Element) | $O(1)$ | $O(1)$ | | Inspecting next incident without de-queueing |
| | | `empty` / `size` | $O(1)$ | $O(1)$ | | Scheduler backlog evaluation |
| **Hash Table** | [`hash_table.hpp`](file:///d:/College%20Projects/SY/Smart-Emergency-Response-System/ds-engine/include/structures/hash_table.hpp) | `insert` / `upsert` | $O(1)$ | $O(n)$ | $O(k + n)$ | Fast indexing of vertices, roads, teams, incidents |
| *(Separate Chaining)* | | `find` (Search) | $O(1)$ | $O(n)$ | ($k = 64$ buckets) | Dijkstra visited/distance tracking |
| | | `erase` (Remove) | $O(1)$ | $O(n)$ | | Clearing active assignments on resolution |
| | | `forEach` (Traversal) | $O(k + n)$ | $O(k + n)$ | | State snapshot serialization (`GET_SNAPSHOT`) |
| **FIFO Queue** | [`queue.hpp`](file:///d:/College%20Projects/SY/Smart-Emergency-Response-System/ds-engine/include/structures/queue.hpp) | `push` (Enqueue) | $O(1)$ | $O(1)$ | $O(n)$ | FIFO incident backlog buffer |
| | | `pop` (Dequeue) | $O(1)$ | $O(1)$ | | Sequential event processing |
| | | `peek` | $O(1)$ | $O(1)$ | | Head inspection |
| **LIFO Stack** | [`stack.hpp`](file:///d:/College%20Projects/SY/Smart-Emergency-Response-System/ds-engine/include/structures/stack.hpp) | `push` | $O(1)$ | $O(1)$ | $O(n)$ | Dijkstra predecessor route path reversal |
| | | `pop` | $O(1)$ | $O(1)$ | | Route backtracking & undo history |
| | | `peek` | $O(1)$ | $O(1)$ | | Top node inspection |
| **Doubly Linked List** | [`linked_list.hpp`](file:///d:/College%20Projects/SY/Smart-Emergency-Response-System/ds-engine/include/structures/linked_list.hpp) | `append` / `prepend` | $O(1)$ | $O(1)$ | $O(n)$ | Graph adjacency list edges & audit event log |
| | | `removeNode` | $O(1)$ | $O(1)$ | | Active assignment list maintenance |
| | | `forEach` | $O(n)$ | $O(n)$ | | Edge iteration during Dijkstra relaxation |
| **City Road Graph** | [`city_graph.hpp`](file:///d:/College%20Projects/SY/Smart-Emergency-Response-System/ds-engine/include/graph/city_graph.hpp) | `addNode` | $O(1)$ avg | $O(V)$ | $O(V + E)$ | Urban topological road network |
| *(Adjacency List)* | | `addRoad` | $O(1)$ avg | $O(V + E)$ | | Bidirectional street connectivity |
| | | `setRoadStatus` | $O(\text{deg}(u))$ | $O(E)$ | | Dynamic road blockage / unblocking |

*Where:*  
- $n$ = Number of items in structure  
- $V$ = Number of vertices/intersections in city graph (7 in default Pune urban grid)  
- $E$ = Number of road segments/edges (9 bidirectional = 18 directed edges in default grid)  
- $k$ = Initial hash bucket count (64)  
- $\text{deg}(u)$ = Degree of vertex $u$ (out-degree, typically $2 \le \text{deg}(u) \le 4$ in street layouts)

---

## 3. Algorithmic Operations Analysis

### A. Emergency Triage (Priority Queue Push & Pop)
- **Insertion**: An incoming emergency is inserted into `EmergencyScheduler::heap_`. Inserting into a binary heap of size $N$ takes **$O(\log N)$** time as it performs up-heap sift operations comparing priority ranks.
- **Extraction**: When a team becomes available, the top emergency is extracted via `popNext()` in **$O(\log N)$** time through down-heap sift operations.
- **Space**: **$O(N)$** where $N$ is the number of pending emergencies.

### B. Response Team Allocation (Haversine Nearest Search)
- **Time Complexity**: **$O(T)$** where $T$ is the total number of registered response teams.
- **Operation**:
  ```cpp
  teams.forEach([&](const std::string&, const ResponseTeam& team) {
      if (team.status != TeamStatus::AVAILABLE || !ResourceCompatibility::isCompatible(...)) return;
      const double distance = haversineKm(team.currentLocation, emergency.location);
      // Min-distance update...
  });
  ```
  1. Filters by compatibility ($O(1)$ enum lookup).
  2. Computes Haversine spherical distance in $O(1)$ arithmetic time.
  3. Finds the minimum distance available unit in a single pass over $T$ teams.
- **Space Complexity**: **$O(1)$** auxiliary space.

### C. Dijkstra's Shortest Path Algorithm
- **Time Complexity**: **$O((V + E) \log V)$**
- **Operation Breakdown**:
  1. Distance and predecessor hash tables initialization: $O(V)$ average.
  2. Each vertex is popped from the `BinaryHeap` frontier at most once: $V \times O(\log V) = O(V \log V)$.
  3. For each vertex, outgoing edges in `LinkedList<GraphEdge>` are scanned. Total edges traversed across all vertices $= E$.
  4. If candidate distance is shorter, `frontier.push(...)` and `distances.upsert(...)` take $O(\log V) + O(1)$. Total relaxation time $= O(E \log V)$.
  5. Total runtime: $O((V + E) \log V)$.
- **Space Complexity**: **$O(V + E)$** to store graph vertices, adjacency lists, distances hash table, predecessor hash table, and the min-heap frontier.

### D. Dynamic Mid-Transit Rerouting
- **Trigger**: `RoadStatusChanged` event received via IPC.
- **Edge Disablement**: Setting edge status in `CityGraph` takes $O(\text{deg}(u))$ where $\text{deg}(u)$ is the degree of the incident vertex ($O(1)$ in planar urban road networks).
- **Affected Assignment Scanning**: Scans active assignments $A$ (typically $A \le T$). For each assignment:
  - Linear scan of traversed road IDs in assignment's current path: $O(P)$ where $P$ is route path length ($P \le V$).
- **Recalculation**: If blocked road is on the active path:
  - Invokes Dijkstra from **team's current node** to emergency destination: $O((V + E) \log V)$.
  - Stores revised route in assignment's revision stack.
- **Total Rerouting Time Complexity**: **$O(A \cdot P + (V + E) \log V)$**. With small fleet size $A \ll V$, this simplifies to **$O((V + E) \log V)$**.

### E. Dynamic ETA Recalculation
- **Time Complexity**: **$O(P)$** where $P$ is the number of node segments along the Dijkstra route.
- **Operation**:
  $$\text{ETA} = \max\left(1, \left\lceil \sum_{i=1}^{P-1} \frac{\text{Distance}(v_i, v_{i+1}) \times \text{TrafficFactor}(e_i)}{\text{BaseSpeed}(\text{VehicleType})} \times 60 \right\rceil\right)$$
  - Each road segment factor lookup is $O(1)$ via hash map.
  - Summation over $P-1$ segments takes $O(P)$ time ($P \le V$).
- **Space Complexity**: **$O(1)$** auxiliary space.

---

## 4. Architectural Separation: Why Haversine Allocation and Dijkstra Routing Differ

An essential academic distinction in this project is the two-phase separation of resource decision-making:

1. **Stage 1: Resource Selection (Haversine Spherical Distance)**
   - **Input**: Geographic coordinates $(\text{latitude}, \text{longitude})$ of units and incident.
   - **Complexity**: $O(T)$ evaluation over response teams.
   - **Rationale**: Response units operate in continuous physical space. Calculating full Dijkstra shortest paths for every unit in the city before selecting one would cost $O(T \cdot (V + E) \log V)$. Using Haversine distance as an $O(1)$ heuristic enables immediate $O(T)$ nearest-unit candidate filtering.

2. **Stage 2: Navigation & Route Planning (Dijkstra Graph Traversal)**
   - **Input**: Discrete topological road network graph $G = (V, E)$.
   - **Complexity**: $O((V + E) \log V)$ executed **only once** for the selected unit.
   - **Rationale**: Physical vehicles cannot travel "as the crow flies"; they are constrained by topological road segments, one-way channels, speed limits, and dynamic blockages. Dijkstra produces the actual turn-by-turn routing path.

---

## 5. Summary Complexity Scorecard

| System Event | Underlying Data Structure(s) | Time Complexity | Space Complexity |
|---|---|---|---|
| **Incident Intake** | `BinaryHeap`, `HashTable` | $O(\log N)$ | $O(1)$ aux |
| **Team Selection** | Array / `HashTable` pass | $O(T)$ | $O(1)$ aux |
| **Route Generation** | `BinaryHeap`, `CityGraph`, `HashTable` | $O((V + E) \log V)$ | $O(V + E)$ |
| **Road Blockage** | `LinkedList`, `HashTable` | $O(\text{deg}(u))$ | $O(1)$ aux |
| **Mid-Transit Reroute** | `CityGraph`, `Dijkstra`, `Stack` | $O((V + E) \log V)$ | $O(V + E)$ |
| **Simulated Stepping** | Array indexing, Haversine scale | $O(P)$ | $O(P)$ aux |
| **Incident Completion** | `HashTable` update, `BinaryHeap` pop | $O(\log N)$ | $O(1)$ aux |
