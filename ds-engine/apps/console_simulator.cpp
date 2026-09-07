#include <iostream>
#include "engine/emergency_engine.hpp"

int main() {
    using namespace emergency;
    EmergencyEngine engine;
    engine.addGraphNode("Station", {}); engine.addGraphNode("Incident", {});
    engine.addRoad({"R1", "Station", "Incident", 2.5});
    ResponseTeam team; team.id = "A01"; team.type = TeamType::AMBULANCE; team.status = TeamStatus::AVAILABLE; team.currentGraphNodeId = "Station"; team.currentLocation = {18.5200, 73.8560};
    engine.addTeam(team);
    Emergency item; item.id = "E101"; item.type = EmergencyType::ACCIDENT; item.priority = EmergencyPriority::CRITICAL; item.location = {18.5210, 73.8570}; item.destinationGraphNodeId = "Incident"; item.createdAt = 1; item.updatedAt = 1;
    engine.submit(EmergencyReported{item});
    const EngineResult result = engine.processNextEvent();
    for (const auto& note : result.notifications) std::cout << note << '\n';
    if (result.route) std::cout << "Route distance: " << result.route->totalDistanceKm << " km\n";
    return result.success ? 0 : 1;
}
