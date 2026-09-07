#pragma once

#include <optional>
#include <string>
#include <vector>
#include "graph/dijkstra.hpp"
#include "services/resource_allocator.hpp"

namespace emergency {

struct EngineResult {
    bool success{true};
    std::string error;
    std::vector<std::string> notifications;
    std::optional<AllocationDecision> allocation;
    std::optional<RouteResult> route;
};

}  // namespace emergency
