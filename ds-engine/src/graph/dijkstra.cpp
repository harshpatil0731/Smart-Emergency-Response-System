#include "graph/dijkstra.hpp"

#include <algorithm>
#include <limits>
#include "structures/binary_heap.hpp"
#include "structures/hash_table.hpp"

namespace emergency {
namespace {
struct FrontierNode { std::string nodeId; double distance{}; };
struct FrontierFirst {
    bool operator()(const FrontierNode& a, const FrontierNode& b) const {
        if (a.distance != b.distance) return a.distance < b.distance;
        return a.nodeId < b.nodeId;
    }
};
struct PreviousNode { std::string nodeId; std::string roadId; };
}

RouteResult Dijkstra::findShortestPath(const CityGraph& graph, const std::string& sourceNodeId,
                                       const std::string& destinationNodeId) const {
    RouteResult result; result.sourceNodeId = sourceNodeId; result.destinationNodeId = destinationNodeId;
    if (!graph.containsNode(sourceNodeId) || !graph.containsNode(destinationNodeId)) return result;
    if (sourceNodeId == destinationNodeId) { result.status = RouteStatus::AVAILABLE; result.nodeIds.push_back(sourceNodeId); return result; }

    HashTable<std::string, double> distances;
    HashTable<std::string, PreviousNode> previous;
    BinaryHeap<FrontierNode, FrontierFirst> frontier;
    distances.insert(sourceNodeId, 0.0);
    frontier.push({sourceNodeId, 0.0});

    while (!frontier.empty()) {
        const FrontierNode current = *frontier.pop();
        const double* known = distances.find(current.nodeId);
        if (!known || current.distance != *known) continue;
        if (current.nodeId == destinationNodeId) break;
        const LinkedList<GraphEdge>* neighbors = graph.getNeighbors(current.nodeId);
        if (!neighbors) continue;
        neighbors->forEach([&](const GraphEdge& edge) {
            if (edge.status == RoadStatus::BLOCKED) return;
            const double candidate = current.distance + edge.weightKm;
            const double* oldDistance = distances.find(edge.toNodeId);
            if (!oldDistance || candidate < *oldDistance) {
                distances.upsert(edge.toNodeId, candidate);
                previous.upsert(edge.toNodeId, {current.nodeId, edge.roadId});
                frontier.push({edge.toNodeId, candidate});
            }
        });
    }

    const double* finalDistance = distances.find(destinationNodeId);
    if (!finalDistance) return result;
    result.status = RouteStatus::AVAILABLE; result.totalDistanceKm = *finalDistance;
    std::string cursor = destinationNodeId;
    result.nodeIds.push_back(cursor);
    while (cursor != sourceNodeId) {
        const PreviousNode* prior = previous.find(cursor);
        if (!prior) return RouteResult{};  // Defensive guard for an inconsistent predecessor chain.
        result.roadIds.push_back(prior->roadId);
        cursor = prior->nodeId;
        result.nodeIds.push_back(cursor);
    }
    std::reverse(result.nodeIds.begin(), result.nodeIds.end());
    std::reverse(result.roadIds.begin(), result.roadIds.end());
    return result;
}

}  // namespace emergency
