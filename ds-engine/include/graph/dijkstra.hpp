#pragma once

#include <string>
#include <vector>
#include "domain/enums.hpp"
#include "graph/city_graph.hpp"

namespace emergency {

struct RouteResult {
    RouteStatus status{RouteStatus::UNREACHABLE};
    std::vector<std::string> nodeIds;
    std::vector<std::string> roadIds;
    double totalDistanceKm{};
    std::string sourceNodeId;
    std::string destinationNodeId;
};

class Dijkstra {
public:
    [[nodiscard]] RouteResult findShortestPath(const CityGraph& graph, const std::string& sourceNodeId,
                                               const std::string& destinationNodeId) const;
};

}  // namespace emergency
