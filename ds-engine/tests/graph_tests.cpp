#include "domain/road.hpp"
#include "graph/city_graph.hpp"
#include "graph/dijkstra.hpp"
#include "test_support.hpp"

namespace {
void tests() {
    emergency::CityGraph graph;
    for (const char* id : {"A", "B", "C", "D", "E"}) require(graph.addNode(id, {}), "graph node insertion");
    require(graph.addRoad({"AB", "A", "B", 1.0}), "road AB");
    require(graph.addRoad({"BC", "B", "C", 1.0}), "road BC");
    require(graph.addRoad({"CD", "C", "D", 1.0}), "road CD");
    require(graph.addRoad({"BE", "B", "E", 5.0}), "road BE");
    require(graph.addRoad({"ED", "E", "D", 1.0}), "road ED");

    emergency::Dijkstra dijkstra;
    auto route = dijkstra.findShortestPath(graph, "A", "D");
    require(route.status == emergency::RouteStatus::AVAILABLE, "reachable route");
    requireNear(route.totalDistanceKm, 3.0, 0.001, "shortest distance");
    require(route.nodeIds.size() == 4 && route.nodeIds[2] == "C", "shortest path nodes");

    require(graph.setRoadStatus("CD", emergency::RoadStatus::BLOCKED), "block road");
    route = dijkstra.findShortestPath(graph, "A", "D");
    require(route.status == emergency::RouteStatus::AVAILABLE && route.nodeIds.back() == "D", "alternative route after block");
    requireNear(route.totalDistanceKm, 7.0, 0.001, "alternative route distance");
    require(graph.setRoadStatus("ED", emergency::RoadStatus::BLOCKED), "block second road");
    route = dijkstra.findShortestPath(graph, "A", "D");
    require(route.status == emergency::RouteStatus::UNREACHABLE, "unreachable route");
}
}

int main() { return runTests("graph_tests", tests); }
