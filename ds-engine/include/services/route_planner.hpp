#pragma once

#include <string>
#include "graph/dijkstra.hpp"

namespace emergency {

class RoutePlanner {
public:
    [[nodiscard]] RouteResult createRoute(const CityGraph& graph, const std::string& teamCurrentNode,
                                          const std::string& emergencyDestinationNode) const;
    [[nodiscard]] RouteResult reroute(const CityGraph& graph, const std::string& teamLatestNode,
                                      const std::string& emergencyDestinationNode) const;
private:
    Dijkstra dijkstra_;
};

}  // namespace emergency
