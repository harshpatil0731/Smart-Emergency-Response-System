# Standalone C++ DS Engine

This directory is Milestone 2 of the Smart Emergency Response project. It is a standalone C++20 engine: it has no backend, database, JSON adapter, or user-interface code.

## Build and test

From the repository root, use a C++20-capable compiler and CMake 3.20 or newer:

```powershell
cmake -S ds-engine -B ds-engine/build -DCMAKE_BUILD_TYPE=Debug
cmake --build ds-engine/build --config Debug
ctest --test-dir ds-engine/build -C Debug --output-on-failure
```

Run the small standalone demonstration:

```powershell
.\ds-engine\build\Debug\engine_console.exe
```

On a single-configuration generator such as Ninja, the console executable is usually located at `ds-engine/build/engine_console` instead.

## Design boundaries

- `structures/` contains the custom linked list, queue, stack, hash table, and binary heap.
- `graph/` contains the adjacency-list road graph and Dijkstra shortest-path algorithm.
- `services/` contains priority ordering, compatibility, Haversine resource selection, and routing policies.
- `engine/` exposes `EmergencyEngine`, a transport-neutral façade that a later NDJSON adapter can call.
- `tests/` verifies the data structures and emergency-management scenarios.

The engine uses C++ standard-library strings, vectors, optionals, and variants as support types, but does not use `std::priority_queue`, `std::unordered_map`, `std::list`, or another library replacement for the required DS implementations.
