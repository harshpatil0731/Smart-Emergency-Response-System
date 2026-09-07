#include "services/route_planner.hpp"

namespace emergency {

RouteResult RoutePlanner::createRoute(const CityGraph& graph, const std::string& teamCurrentNode,
                                      const std::string& emergencyDestinationNode) const {
    return dijkstra_.findShortestPath(graph, teamCurrentNode, emergencyDestinationNode);
}
RouteResult RoutePlanner::reroute(const CityGraph& graph, const std::string& teamLatestNode,
                                  const std::string& emergencyDestinationNode) const {
    return dijkstra_.findShortestPath(graph, teamLatestNode, emergencyDestinationNode);
}

}  // namespace emergency
