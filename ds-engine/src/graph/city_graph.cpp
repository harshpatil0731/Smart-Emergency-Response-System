#include "graph/city_graph.hpp"

namespace emergency {

bool CityGraph::addNode(const std::string& nodeId, GeoPoint point) {
    if (nodeId.empty() || vertices_.contains(nodeId)) return false;
    GraphVertex vertex; vertex.id = nodeId; vertex.point = point;
    return vertices_.insert(nodeId, vertex);
}

bool CityGraph::addRoad(const Road& road) {
    if (road.id.empty() || road.weightKm < 0.0 || roads_.contains(road.id) ||
        !containsNode(road.fromNodeId) || !containsNode(road.toNodeId)) return false;
    roads_.insert(road.id, road);
    vertices_.find(road.fromNodeId)->edges.pushBack({road.id, road.toNodeId, road.weightKm, road.status});
    vertices_.find(road.toNodeId)->edges.pushBack({road.id, road.fromNodeId, road.weightKm, road.status});
    return true;
}

bool CityGraph::setRoadStatus(const std::string& roadId, RoadStatus status) {
    Road* road = roads_.find(roadId);
    if (!road) return false;
    road->status = status;
    updateDirectedEdge(road->fromNodeId, roadId, status);
    updateDirectedEdge(road->toNodeId, roadId, status);
    return true;
}

const Road* CityGraph::getRoad(const std::string& roadId) const { return roads_.find(roadId); }
const LinkedList<GraphEdge>* CityGraph::getNeighbors(const std::string& nodeId) const {
    const GraphVertex* vertex = vertices_.find(nodeId);
    return vertex ? &vertex->edges : nullptr;
}
bool CityGraph::containsNode(const std::string& nodeId) const { return vertices_.contains(nodeId); }
bool CityGraph::containsRoad(const std::string& roadId) const { return roads_.contains(roadId); }

void CityGraph::updateDirectedEdge(const std::string& from, const std::string& roadId, RoadStatus status) {
    GraphVertex* vertex = vertices_.find(from);
    if (!vertex) return;
    if (GraphEdge* edge = vertex->edges.find([&](const GraphEdge& candidate) { return candidate.roadId == roadId; })) edge->status = status;
}

}  // namespace emergency
