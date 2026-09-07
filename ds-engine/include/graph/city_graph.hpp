#pragma once

#include <optional>
#include <string>
#include "domain/geo_point.hpp"
#include "domain/road.hpp"
#include "structures/hash_table.hpp"
#include "structures/linked_list.hpp"

namespace emergency {

struct GraphEdge {
    std::string roadId;
    std::string toNodeId;
    double weightKm{};
    RoadStatus status{RoadStatus::OPEN};
};

struct GraphVertex {
    std::string id;
    GeoPoint point{};
    LinkedList<GraphEdge> edges;
};

class CityGraph {
public:
    bool addNode(const std::string& nodeId, GeoPoint point);
    bool addRoad(const Road& road);
    bool setRoadStatus(const std::string& roadId, RoadStatus status);
    [[nodiscard]] const Road* getRoad(const std::string& roadId) const;
    [[nodiscard]] const LinkedList<GraphEdge>* getNeighbors(const std::string& nodeId) const;
    [[nodiscard]] bool containsNode(const std::string& nodeId) const;
    [[nodiscard]] bool containsRoad(const std::string& roadId) const;

    template <typename Visitor>
    void forEachNode(Visitor visitor) const {
        vertices_.forEach([&](const std::string&, const GraphVertex& v) { visitor(v); });
    }

    template <typename Visitor>
    void forEachRoad(Visitor visitor) const {
        roads_.forEach([&](const std::string&, const Road& r) { visitor(r); });
    }

private:
    HashTable<std::string, GraphVertex> vertices_;
    HashTable<std::string, Road> roads_;
    void updateDirectedEdge(const std::string& from, const std::string& roadId, RoadStatus status);
};

}  // namespace emergency
